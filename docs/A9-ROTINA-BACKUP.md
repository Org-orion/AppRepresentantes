# A9 — Rotina operacional de backup

> **Estado: rotina em operação agendada — execução diária automática ATIVA às
> 10:30.** A tarefa `Concrem Connect - Backup do Portal (A9)` está registrada,
> habilitada e foi validada por uma execução real via Task Scheduler
> (`LastTaskResult = 0x0`). Próxima execução prevista: **27/08/2026 10:30**.
> Ver §8 (ciclo manual), §9 (Task Scheduler) e §10 (o que ainda falta).
>
> **O A9 permanece 🟡 PARCIALMENTE TRATADO.** A retenção está **habilitada
> operacionalmente**, mas sua **primeira exclusão real ainda não foi observada** —
> existem 2 conjuntos e a política mantém 7 diários. Não há backup gerenciado nem
> PITR, e o restore integral da plataforma (`auth`, `storage`) segue sem teste.
>
> Implementação em `scripts/backup/`. Operação em `scripts/backup/README.md`.
---

## 1. Decisões aprovadas

### 1.1 Plano Supabase — permanência no Free como aceitação explícita de risco

**Decisão: permanecer no Free Plan. Não contratar backup gerenciado agora.**

Isto é **aceitação de risco**, registrada como tal. **Não é equivalente a backup
gerenciado** e não deve ser lido assim em nenhum documento.

O que se aceita, concretamente: não há backup automático da plataforma, não há PITR, e a
recuperação depende de uma rotina que roda nesta máquina. Se a máquina falhar junto com
o banco, a recuperação depende exclusivamente da cópia externa.

**Reavaliar o upgrade quando qualquer um destes ocorrer:**

1. for necessário RPO menor que 24 h;
2. for necessário *point-in-time recovery*;
3. a rotina automática ficar **sem backup válido por mais de 24 h**;
4. a criticidade operacional passar a justificar recuperação gerenciada.

### 1.2 Frequência

> ✅ **Em vigor desde 26/08/2026.** A tarefa do Task Scheduler executa o backup
> `scheduled` **diariamente às 10:30**. Ver §9.

| | |
|---|---|
| **Diário** | backup completo `scheduled`, uma vez por dia |
| **Antes de mudança** | backup `prechange` obrigatório antes de alteração relevante em **schema/migrations**, **auth**, **storage** ou **configuração estrutural do Supabase** |

### 1.3 Retenção

**7 diários · 4 semanais · 3 mensais**, aplicados a sets `scheduled`.

O conjunto mantido é a **união** das três categorias. Um set que sirva às três continua
sendo **um único diretório** — não se guardam três cópias idênticas, e **nada é apagado
por ter pertencido a mais de uma categoria**.

`prechange` tem piso próprio de **7 dias**, não ocupa vaga diária, e não é removido
automaticamente depois disso. `manual` nunca é removido automaticamente.

### 1.4 Redundância

- backup primário **fora do repositório**;
- **segunda cópia fora da máquina**, obrigatória;
- cifrada quando contiver `auth.users` ou outros dados sensíveis — e ela sempre contém;
- **dumps nunca versionados no Git**.

---

## 2. RPO / RTO e ensaio

| | |
|---|---|
| **RPO alvo** | **24 horas** |
| **RTO alvo** | **4 horas úteis** |
| Backup `scheduled` | diário |
| Backup `prechange` | antes de mudança relevante |
| Verificação de integridade | **em toda execução** |
| Restore-test da aplicação `public` | **trimestral**, e após qualquer mudança material no pipeline de backup/restore |

**O RPO de 24 h depende da rotina agendada rodando — e ela agora roda**, diariamente
às 10:30 (§9). Duas ressalvas honestas sobre o RPO efetivo: a tarefa é `Interactive`,
então **um dia sem logon é um dia sem backup** (mitigado por `StartWhenAvailable`, que
recupera o horário perdido no próximo logon); e o RPO só se confirma com a série de
execuções sendo acompanhada. Executada à mão, na prática o RPO viraria semanal — era
esse o cenário que disparava o gatilho 3 de reavaliação do plano.

**Justificativa.** Orçamento é o trabalho do representante: perder um dia significa
refazer o dia. Sem o Portal, ninguém monta orçamento e a equipe comercial não vê o
pipeline — não é sistema de minutos, mas um dia parado é inaceitável.

---

## 3. Arquitetura

```
[0] pré-checagem   ferramentas · destino · pgpass (existe + ACL) · conectividade
[1] staging\<setId>\
[2] roles          pg_dumpall --roles-only --no-role-passwords
[3] schema         pg_dump --schema-only → .raw.sql → 12 transformações → .sql
[4] dados          pg_dump --data-only   → .raw.sql → SET/neutraliza/RESET → .sql
[5] storage        descoberta (buckets/objects) → download → conferência de tamanho
[6] sanidade       10 tabelas nominais · baselines como piso · auth.users · sem vazamento
[7] evidência + manifesto SHA-256
[8] selagem        revalida hashes → BACKUP-OK.json → move staging → sets
──────────────── backup LOCAL válido a partir daqui ────────────────
[9] cópia externa  tar → gpg AES256 → hash local → copiar → hash destino → comparar
[10] retenção      keep-set GFS, só sobre selados
                   exit 0
```

**`exit 0` exige os três:** set selado, cópia externa concluída e retenção aplicada.

### 3.1 Imutabilidade do set

O set selado **nunca é reaberto**. Resultado da cópia externa, da retenção e o código de
saída ficam em `logs\RUN-RESULT-<setId>.json`, **fora** do set.

A razão é direta: `BACKUP-EVIDENCE` entra no `SHA256SUMS`. Escrever nele depois da
selagem invalidaria o próprio manifesto que acabou de ser conferido.

`BACKUP-OK.json` significa **uma coisa só**: este conjunto local passou nas validações.
**Não afirma nada sobre a cópia externa.**

### 3.2 Sem circularidade no manifesto

`SHA256SUMS.txt` cobre os artefatos **e** o `BACKUP-EVIDENCE`. **Não cobre** a si próprio
nem o `BACKUP-OK.json`. Ordem: artefatos → evidência → manifesto → **reler do disco e
revalidar** → selo → mover.

---

## 4. Credencial

`%APPDATA%\postgresql\pgpass.conf`, com `PGPASSFILE` **explícito** e `PGSSLMODE=require`.

Três cuidados que não são detalhe:

1. **`PGPASSWORD` herdado é neutralizado.** Ele tem precedência sobre o `.pgpass` e
   trocaria a fonte da senha em silêncio. `PGSERVICE`, `PGHOST`, `PGPORT`, `PGUSER` e
   `PGDATABASE` também são limpos — host, porta, usuário e banco são sempre explícitos.
2. **As variáveis originais do processo são preservadas e restauradas** ao fim.
3. **O `.pgpass` nunca é lido pelo script.** Verifica-se existência e ACL; quem lê a
   senha é o `libpq`.

**ACL por whitelist**, não por blacklist: qualquer ACE `Allow` fora de {usuário atual,
`SYSTEM`, `Administrators`} derruba a execução. Procurar só por `Everyone`/`Users`
deixaria passar um grupo qualquer com acesso concedido.

**Escaping obrigatório:** senha com `:` ou `\` precisa de `\:` e `\\`. Sem isso o
`libpq` corta no primeiro `:` e a falha aparece como "senha errada".

---

## 5. Parâmetros pinados

Da execução validada de **2026-08-25**. Não alterar sem nova validação.

```
roles:   pg_dumpall --roles-only --no-role-passwords

schema:  pg_dump --schema-only --quote-all-identifiers --role postgres
                 --exclude-schema "<29 schemas gerenciados>"

dados:   pg_dump --data-only --quote-all-identifiers --role postgres
                 --exclude-schema "<lista de dados>"
                 --exclude-table auth.schema_migrations
                 --exclude-table storage.migrations
                 --exclude-table supabase_functions.migrations
                 --schema "*"
```

> ⚠️ **`--quote-all-identifiers`, no plural.** O `supabase db dump --dry-run` exibe o
> singular; o `pg_dump` nativo 18.6 **rejeita** essa forma. Está comentado no código
> para ninguém "corrigir" de volta.

**Sem `--column-inserts`** — `COPY` já é o padrão nativo.

### 5.1 As 12 transformações do schema

Reproduzidas em .NET/PowerShell, **sem `sed` e sem Git Bash**, com UTF-8 **sem BOM**
(`Out-File -Encoding utf8` do PowerShell 5.1 grava BOM, e BOM quebra o `psql`).

1. `\restrict` / `\unrestrict` → comentadas
2-4. `CREATE SCHEMA|TABLE|SEQUENCE "` → `... IF NOT EXISTS "`
5-7. `CREATE VIEW|FUNCTION|TRIGGER "` → `CREATE OR REPLACE ... "`
8. publicações, event triggers, FDW owner e default privileges do `supabase_admin` → comentados
9. `GRANT`/`REVOKE` dirigidos aos 29 schemas internos → comentados
10. `CREATE EXTENSION` de `pg_tle`, `pgsodium`, `pgmq` → forma curta
11. `COMMENT ON EXTENSION`, políticas e tabelas de `cron`, `transaction_timeout` → comentados
12. toda linha iniciada por `--` → removida

### 5.2 ⚠️ Consequência do passo 12

O passo 12 apaga **qualquer** linha iniciada por `--`, **inclusive comentários dentro de
corpos de função**. Nossas migrations são densamente comentadas e o `pg_dump` reproduz o
corpo como está no banco.

**As funções restauram sintaticamente válidas, mas sem seus comentários internos.** É o
comportamento do pipeline original, reproduzido de propósito.

**Por isso os `.raw.sql` são preservados e não podem ser apagados:** são a única cópia
com o código-fonte íntegro das funções.

---

## 6. Sanidade — nomes, não só contagens

`RequiredPublicTables` — as 10 precisam existir no schema **e** ter `COPY` nos dados:

`_import_usuarios` · `client_groups` · `concremapprep_notificacoes` ·
`concremapprep_orcamento_itens` · `concremapprep_orcamentos` ·
`concremapprep_representantes` · `concremapprep_usuario_representantes` ·
`concremapprep_usuarios` · `pedidos_status_historico` · `user_client_groups`

Baselines de 2026-08-25 — **piso, nunca igualdade**: 10 tabelas `public`, 10 `COPY` de
`public`, 39 `COPY` no total. Detectam regressão sem impedir o banco de crescer.

Mais duas guardas: **`auth.users` obrigatório**, e **nenhum schema gerenciado no dump**.
A segunda existe porque o `--exclude-schema` usa alternação `|` — se o `pg_dump`
interpretasse esse padrão de outro jeito, não excluiria nada e o dump viria com
`auth`/`storage`/`realtime` dentro, **sem erro nenhum**.

---

## 7. Storage

**Descoberta antes do download.** A rotina consulta `storage.buckets` e
`storage.objects` e **falha** se houver bucket com objetos fora da configuração (exit 32)
ou bucket configurado que deixou de ser público (exit 33).

É isto que impede a automação de ficar verde depois que alguém cria um bucket e esquece
de incluí-lo no backup.

Download com `curl.exe --fail --location --silent --show-error`. Cada **segmento** do
nome é codificado separadamente e as barras preservadas — codificar o nome inteiro
transformaria `/` em `%2F` e o endpoint devolveria 404.

Baseline de 2026-08-25: bucket `avatars`, público, 2 objetos.

---

## 8. Primeiro ciclo real — 2026-08-26 (execução **manual**)

A rotina deixou de ser código testado offline. Rodou contra o banco de produção,
do começo ao fim, e o resultado foi verificado por fora.

**Disparo: manual, por um operador** — o Task Scheduler ainda não existia neste
momento; foi criado depois, com base nesta execução (§9). `-Reason scheduled` diz o
*tipo* de backup, o que define a categoria na retenção GFS, e não implica agendamento.

**Comando:** `-Reason scheduled` com `-WhatIfRetention`, configuração real.
**Resultado: exit 0.**

| | |
|---|---|
| `setId` | `2026-08-26T144106` |
| `reason` | `scheduled` |
| `note` | *primeiro ciclo real - retencao em dry-run* |
| duração | 15 s |
| set local | `…\AppRepresentatives-Backups\sets\2026-08-26T144106` |

### 8.1 O pipeline que passou

| Estágio | Resultado |
|---|---|
| conectividade (Session Pooler) | OK |
| `roles` | OK |
| `schema` + as 12 transformações | OK |
| `dados` | OK |
| Storage | **2 objetos em 1 bucket**, tamanhos conferidos |
| sanidade | `public` = **10** tabelas · `COPY public` = **10** · `COPY` total = **39** · **`auth.users` presente** |
| manifesto | **8 artefatos** |
| selagem | OK |
| passphrase do GPG + ACL | OK |
| cópia externa cifrada | OK — hash local × destino **idêntico** |
| retenção | **WhatIf**: 1 mantido, 0 a remover |

Os números batem com o backup manual validado em 25/08 — 10 tabelas, 39 blocos
`COPY`, 2 objetos de Storage. É o que confirma que a rotina produz o mesmo
conjunto que a execução manual conferida.

### 8.2 Verificação independente do set local

`Verify-PortalBackup.ps1`, offline, sem banco e sem credencial:

**exit 0 · 8/8 artefatos íntegros · 0 divergentes · 0 ausentes · 0 extras ·
`BACKUP-OK.json` válido.**

### 8.3 A cópia externa foi recuperada, não só conferida

Esta é a parte que faltava. Um hash conferido no momento da cópia prova que o
arquivo saiu inteiro; não prova que ele **volta**. O artefato sincronizado no
OneDrive foi então descriptografado e extraído numa área temporária fora do
repositório, do `BackupRoot` e do próprio OneDrive:

| | |
|---|---|
| SHA-256 **após a sincronização** | `3b968f42043b62aaf75c1ac67fa76810acd7ef5c7b48e096ed5d55fbc440746d` |
| × sidecar `.sha256` | **idêntico** |
| `gpg --decrypt` | **exit 0** — **AES256** confirmado pelo próprio gpg |
| `tar -xf` | **exit 0** |
| `Verify-PortalBackup` no set **extraído** | **exit 0** |
| artefatos | **8/8 íntegros · 0 divergentes · 0 ausentes · 0 extras** |
| `setId` / `reason` extraídos × local | idênticos |
| **conteúdo extraído × set local** | **8 idênticos, 0 diferentes** (SHA-256 arquivo a arquivo) |

O `.tar` em claro e o diretório extraído foram apagados ao final — o `.tar` em
claro contém dados pessoais e não pode sobreviver ao ensaio.

**A conclusão que isto autoriza, e só ela:** a cópia externa sincronizada é
**comprovadamente recuperável** e **byte a byte equivalente** ao conjunto selado
local.

### 8.4 As duas falhas que antecederam o sucesso

Ambas falharam **fechado**: staging preservado, nenhum conjunto promovido,
nenhuma cópia externa, nenhuma retenção. Os dois stagings seguem preservados.

| `setId` | Onde parou | Causa | Correção |
|---|---|---|---|
| `2026-08-26T140018` | `roles`, exit **20** | `pg_dumpall` recebeu `--dbname postgres`, mas nessa ferramenta `--dbname` é **conninfo**, não nome de banco | a chamada passou a reproduzir o comando manual validado, **sem `--dbname`** |
| `2026-08-26T142243` | logo após o manifesto | `.Count` sobre `$null`: coleção vazia **desenrolada no `return`** de `Test-Manifest` | normalização com `@()` na invocação + rastreamento explícito de estágio |

A segunda trouxe uma melhoria de diagnóstico junto: falha **inesperada** em
manifesto/selagem agora sai com **exit 50**, o código do estágio, em vez do
genérico `1`. Cada estágio tem o seu, e o `RUN-RESULT` registra `failedStage`.

**Por que as duas escaparam da suíte offline.** A primeira dependia da ferramenta
real — nenhum teste offline invoca `pg_dumpall`. A segunda vivia no **caminho
feliz**: os testes de manifesto sempre usavam conjuntos adulterados, e a lista de
problemas só vem vazia quando está tudo certo. As duas ganharam teste de
regressão (**I** e **J**).

---

## 9. Task Scheduler — configurado e validado em 2026-08-26

**A execução diária automática está ATIVA.** A tarefa
`Concrem Connect - Backup do Portal (A9)` roda o backup `scheduled` todo dia às
**10:30**. Próxima execução prevista quando esta seção foi escrita: **27/08/2026
10:30**.

### 9.1 Configuração registrada

| | |
|---|---|
| Nome | `Concrem Connect - Backup do Portal (A9)` |
| Estado | `Enabled = True` · `State = Ready` |
| **Usuário** | `1kmz` (`kmz\1kmz`) — **não** SYSTEM |
| **LogonType** | **`Interactive`** — só executa com o usuário conectado |
| **RunLevel** | **`Limited`** — **não elevada** |
| Trigger | diário, **10:30** |
| Ação | `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` |
| WorkingDirectory | `C:\aplicações\AppRepresentantes-main\scripts\backup` |

Argumentos finais:

```
-NoProfile -ExecutionPolicy Bypass -File "C:\aplicações\AppRepresentantes-main\scripts\backup\Invoke-PortalBackup.ps1" -Reason scheduled -ConfigPath "C:\aplicações\AppRepresentantes-main\scripts\backup\backup.config.psd1"
```

| Settings | | Condições | |
|---|---|---|---|
| `MultipleInstances` | `IgnoreNew` | não exige energia AC | ✅ |
| `StartWhenAvailable` | `True` | não para ao entrar em bateria | ✅ |
| timeout | **1 hora** | rede **não** é condição do Scheduler | ✅ |
| `RestartCount` / `RestartInterval` | **2** / **30 min** | `WakeToRun` | `False` |

`MultipleInstances = IgnoreNew` **não é preferência, é requisito**: o script não
tem lock próprio, então esta é a única barreira contra duas execuções escreverem
no mesmo `staging`/`sets`.

Rede fora das condições do Scheduler é deliberado: sem conectividade o script
falha explicitamente com `exit 13` e deixa log. Uma condição de rede faria a
execução ser **silenciosamente pulada**, que é pior.

### 9.2 Por que `Interactive` + `Limited`, e não SYSTEM

Quatro razões, e nenhuma é estilística:

1. **`.pgpass` e a passphrase do GPG pertencem ao usuário**, com ACL restrita a
   ele. Sob outro contexto o `%APPDATA%` é outro e a credencial não seria
   alcançada — a falha se disfarçaria de "senha errada".
2. **O OneDrive roda no contexto do usuário.** Sem sessão dele, o cliente de
   sincronização não está em execução: o `.tar.gpg` cairia no disco e só subiria
   no próximo logon, sem nenhum sinal disso no `RUN-RESULT`.
3. **O OneDrive recusou execução sob PowerShell elevado.** A elevação troca o
   token e o provedor de sincronização do usuário não é alcançado. Marcar
   *"executar com privilégios mais altos"* **quebraria a cópia externa** — e o
   script não precisa de elevação: não tem `#Requires -RunAsAdministrator`, não
   chama `RunAs`, e o ciclo manual validado rodou numa sessão não elevada.
4. **SYSTEM não serve a esta arquitetura**, pelas três razões acima somadas.

**O custo, declarado:** com `Interactive`, se ninguém fizer logon num dia, **não
há backup naquele dia**. É o preço de garantir o OneDrive operacional.
`StartWhenAvailable = True` recupera o horário perdido no próximo logon.

### 9.3 Como foi validada — primeiro com `-WhatIfRetention`

A tarefa nunca havia executado neste contexto: a sessão de tarefa não é a sessão
interativa, e token, variáveis e ambiente podem diferir. Estrear o agendamento e
a retenção destrutiva no mesmo disparo seria imprudente. Por isso a tarefa foi
**criada com `-WhatIfRetention`** e disparada por `Start-ScheduledTask`.

**Resultado — `LastTaskResult = 0` (`0x0`):**

| | |
|---|---|
| `setId` | **`2026-08-26T164034`** · `reason` `scheduled` |
| `exitCode` · `failedStage` | **0** · **null** |
| `externalCopy` · `retention` | **`success`** · **`whatif`** |
| Sanidade | `public` = **10** tabelas · `COPY public` = **10** · `COPY` total = **39** · **`auth.users` presente** |
| Storage · manifesto | **2 objetos** · **8 artefatos** |
| `Verify-PortalBackup` no set | **exit 0** |
| Cópia externa | `.tar.gpg` + `.sha256` gerados · **hash externo = sidecar** |
| OneDrive | **ambos os arquivos com status verde — sincronização concluída neste ciclo** |
| Retenção | **nenhuma exclusão real** · nenhum set ou staging existente removido |

Os números reproduzem os dois ciclos anteriores. **A tarefa agendada produz o
mesmo resultado que a execução manual** — era exatamente o que faltava provar.

### 9.4 Liberação da retenção real

Validado o ciclo acima e confirmada a sincronização, a tarefa foi editada:
**`-WhatIfRetention` removido**, junto com a `-Note` de primeira execução.

A alteração foi verificada por **diff de retrato sobre 26 propriedades**
(identificação, principal, trigger, ação, settings e condições):
**exatamente uma mudou — `Action.Arguments`.** Usuário, `Interactive`,
`Limited`, horário, `WorkingDirectory`, `MultipleInstances`,
`StartWhenAvailable`, timeout, retries e condições ficaram idênticos. **A tarefa
não foi disparada novamente após a edição.**

### 9.5 Retenção: habilitada, ainda não observada apagando

**A retenção está habilitada operacionalmente** — `-WhatIfRetention` não está
mais nos argumentos, então a próxima execução pode apagar.

**Mas a primeira exclusão real ainda não foi observada.** Não é limitação de
código: com **2 conjuntos** existentes e `Daily = 7`, simplesmente não há nada
fora da janela. O log do ciclo de validação registrou
`retenção: 2 mantidos, 0 a remover`.

A primeira remoção deve ocorrer quando existir um conjunto realmente fora da
**união** do keep-set GFS — **aproximadamente a partir do 8º ciclo diário**,
dependendo de como as categorias semanal e mensal se sobrepõem. **Vale conferir o
log daquele dia especificamente**, procurando as linhas `REMOVER` e
`retenção externa: removendo`.

Nenhum teste destrutivo artificial foi feito para antecipar isso.

### 9.6 O que o `exit 0` não prova sobre o OneDrive

**`exit 0` prova gravação local íntegra no diretório sincronizado e hash idêntico
entre origem e destino — não prova upload concluído.** A sincronização é do
cliente OneDrive, assíncrona, e o script não a enxerga.

No ciclo de validação do Scheduler (`2026-08-26T164034`) os dois arquivos foram
**conferidos visualmente com status verde**, portanto **esse ciclo específico
teve a sincronização concluída**. Isso não se estende automaticamente aos ciclos
seguintes: a conferência do ícone continua sendo humana.

### 9.7 Quando a tarefa falhar

O *Último resultado da execução* **é** o diagnóstico. `logs\RUN-RESULT-<setId>.json`
traz `exitCode` e **`failedStage`**; `logs\backup-<setId>.log` traz a linha exata;
e o `staging\<setId>` é **preservado**. Ver §6 e a tabela de códigos em
`scripts/backup/README.md`.

Atenção a um caso: **`exit 60`** (cópia externa) significa que o **backup local
continua válido e selado** — e que a retenção **não** rodou. Com
`RestartCount = 2`, um retry criaria um segundo conjunto no mesmo dia; inofensivo
com `Daily = 7`, mas vale saber por que ele aparece.

---

## 10. O que falta para A9 deixar de ser parcial

| | Item | Estado |
|---|---|---|
| 1 | `.pgpass` real configurado e ACL validada | ✅ |
| 2 | Destino externo real configurado | ✅ — OneDrive, sincronização confirmada |
| 3 | Passphrase do GPG configurada, com ACL verificada | ✅ |
| 4 | Primeiro ciclo completo executado e verificado | ✅ **§8** |
| 5 | Recuperação da cópia externa testada | ✅ **§8.3** |
| 6 | Permanência no Free registrada como aceitação de risco | ✅ **§1.1** |
| 7 | **Task Scheduler configurado e validado** | ✅ **§9** — execução diária automática **ATIVA** às 10:30 |
| 8 | **Retenção habilitada operacionalmente** | ✅ **§9.4** — `-WhatIfRetention` removido |
| 9 | **Primeira exclusão real da retenção observada** | 🟡 **§9.5** — habilitada, mas ainda não exercitada: 2 conjuntos, política mantém 7 diários |
| 10 | **Backup gerenciado / PITR** | ❌ — o plano Free não inclui. É o núcleo do A9 |
| 11 | **Restore integral da plataforma (`auth`, `storage`)** | ❌ |

**A9 continua 🟡 PARCIALMENTE TRATADO.** O que mudou desde 24/08 é grande: existe
backup real, selado, verificado, cifrado fora da máquina, **provadamente
recuperável**, e agora **produzido por uma tarefa agendada que roda sozinha todo
dia às 10:30**.

O que **não** mudou: o **caminho destrutivo da retenção nunca foi observado** —
ela está habilitada, mas ainda não teve o que apagar; **não há backup gerenciado
nem PITR**; e o **restore integral da plataforma segue sem teste**.

**Nada disto é restore integral do Supabase.** O provado continua sendo schema e
dados da aplicação `public`.

---

## 11. Testes offline executados

Todos passaram, sem tocar produção e sem executar backup real:

| | Cobertura |
|---|---|
| **A** | parse/sintaxe dos dois `.ps1` e do `.psd1` |
| **B** | as 12 transformações do schema — 37 casos sintéticos |
| **C** | transformação dos dados, UTF-8 sem BOM, acentuação |
| **D** | `Verify-PortalBackup`: válido passa; adulterado, hash errado, sem selo, arquivo a mais, artefato ausente e selo inválido falham |
| **E** | retenção GFS: diário, semanas ISO, meses, união, `prechange`, `manual`, sem selo, `staging`, `WhatIf` |
| **F** | URL encoding do Storage: espaço, `#`, `%`, Unicode, subpastas, barras preservadas |
| **G** | `RUN-RESULT` fora do set, imutabilidade do selo, readiness para Task Scheduler |
| **H** | auditoria estática: `--use-copy`, exit code de nativo, argumentos e ACL do GPG, whitelist de ACL, travessia de caminho no Storage, imutabilidade pós-selo, integridade e retenção externas, independência de CWD/PATH |
| **I** | **regressão**: argumentos montados para o `pg_dumpall` — sem `-d`/`--dbname`/`-l`/`--database`, idênticos ao comando manual validado, e `pg_dump`/`psql` mantendo `--dbname` |
| **J** | **regressão**: manifesto de 8 artefatos íntegro, coleções de 0/1/N elementos, selagem completa, e falha inesperada em manifesto/selagem saindo com **exit 50** |

**I e J nasceram das duas falhas do primeiro ciclo real** (§8.4). Uma suíte que
passa inteira não prova que o pipeline funciona — prova que os casos cobertos
funcionam. Foram exatamente os dois casos **não** cobertos que quebraram.

### Defeitos reais encontrados e corrigidos pelos testes

1. **`Verify` não detectava a falta do dump final de dados.** O glob
   `backup-portal-dados-*.sql` também casa `backup-portal-dados-*.raw.sql`, então a
   checagem de estrutura passava. Corrigido com regex e `(?<!\.raw)`.
2. **`@(<List[object]>)` dentro de `[ordered]@{}` lança exceção no PowerShell 5.1.**
   Quebrava `Get-RetentionPlan`, `New-Manifest`, `Test-Manifest` e `Test-BackupSet`.
   Corrigido com `.ToArray()`.
3. **Variáveis do PowerShell são case-insensitive** — `$SRC` e `$src` eram a mesma
   variável e o teste sobrescrevia o próprio caminho. Erro do teste, não do código.
4. **`Get-LocalObjectPath` não protegia contra travessia.** Um objeto de Storage
   chamado `../../x` gravaria fora do set e o backup seria selado como válido.
   Corrigido com validação por segmento, canonicalização e exit 34 dedicado.
5. **Toda invocação de nativo dependia de `$LASTEXITCODE` e de redirecionamento de
   stderr** — que no PS 5.1 vira `NativeCommandError` e derruba a execução mesmo
   com exit 0. Substituído por um wrapper único sobre `System.Diagnostics.Process`.
6. **O `gpg` não recebia `--pinentry-mode loopback`** — sem ele o gpg2 ignora o
   `--passphrase-file` e trava em batch. A cifragem do primeiro ciclo real só
   funcionou por causa desta correção.

### E os dois que só o ciclo real encontrou

7. **`pg_dumpall` com `--dbname`** — nessa ferramenta o parâmetro é *conninfo*.
8. **`.Count` sobre coleção vazia desenrolada no `return`** — o caminho feliz, que
   a suíte nunca exercitava.

Ver §8.4. A lição operacional é direta: **teste offline reduz risco, não o
elimina.** As barreiras de desenho — staging separado, selo por último, retenção
enxergando só selados — é que garantiram que as duas falhas não produzissem backup
inválido.
