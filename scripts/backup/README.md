# Rotina de backup do Portal

Automação do achado **A9**. Não depende de Docker: usa `pg_dump`, `pg_dumpall` e `psql` nativos.

| Script | O que faz |
|---|---|
| `Invoke-PortalBackup.ps1` | gera, valida, sela, copia para fora e aplica retenção |
| `Verify-PortalBackup.ps1` | verifica **offline** um conjunto já gerado — sem rede, sem banco, sem credencial |
| `backup.config.sample.psd1` | modelo de configuração. **Sem segredo** |

---

## 1. Configuração inicial — três ações humanas

Nenhuma delas é feita por script: as três envolvem segredo.

### 1.1 `.pgpass` — a única fonte da senha do banco

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\postgresql" | Out-Null
notepad "$env:APPDATA\postgresql\pgpass.conf"
```

Uma linha, no formato:

```
aws-1-sa-east-1.pooler.supabase.com:5432:postgres:postgres.ikjeyaxfciferyezxskh:SENHA
```

> ⚠️ **Escaping.** O `:` separa campos e o `\` escapa. Se a senha contiver algum
> deles, escape: `:` vira `\:` e `\` vira `\`. Sem isso o `libpq` corta a senha no
> primeiro `:` e a conexão falha com "senha errada" — sintoma que engana.

Restrinja a ACL. **O `libpq` no Windows não valida permissões de arquivo** como faz no
Linux, então a proteção depende inteiramente do NTFS:

```powershell
icacls "$env:APPDATA\postgresql\pgpass.conf" /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(R,W)"
```

> ⚠️ **Use `${env:VAR}`, com chaves.** Escrever `"$env:USERNAME:(R,W)"` é ambíguo:
> o `:` logo depois do nome fica colado ao caminho de variável e o PowerShell pode
> engolir parte do argumento. Com `${...}` o fim do nome é explícito.

O script **recusa rodar** se encontrar qualquer ACE `Allow` fora da whitelist.

**A whitelist tem exatamente dois principals:**

| Principal | Por quê |
|---|---|
| **usuário atual** | quem roda o backup precisa ler o arquivo |
| **`NT AUTHORITY\SYSTEM`** | necessidade operacional: uma tarefa do Task Scheduler com *"Run whether user is logged on or not"* pode rodar como SYSTEM. Sem essa ACE a rotina agendada não leria o arquivo, e a alternativa seria afrouxar a ACL inteira |

**`BUILTIN\Administrators` NÃO está na whitelist, de propósito.** Não há necessidade
operacional para ela — nem o backup interativo nem o agendado rodam sob esse grupo.
Um administrador local continua podendo tomar posse do arquivo; o ponto não é impedir
isso, é que a ACE larga não sobreviva por inércia de herança sem ninguém perceber.
O `icacls` acima remove a herança e deixa exatamente o usuário atual — se a execução
falhar com `exit 12` reclamando de `Administrators`, é porque a herança não foi
removida: rode o `icacls` de novo.

### 1.2 Passphrase do GPG — cifra a cópia externa

Arquivo em texto puro contendo **só** a passphrase, fora do repositório, com a
**mesma disciplina de ACL do `.pgpass`** — e ela é **verificada a cada execução**, não
apenas recomendada. Mesma whitelist, mesma consequência: ACE inesperada aborta a cópia
externa com `exit 60`.

```powershell
icacls "C:\caminho\para\gpg-passphrase.txt" /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(R,W)"
```

O caminho vai em `GpgPassphraseFile`, **absoluto**. A passphrase entra no `gpg` por
`--passphrase-file` e **nunca** como argumento de linha de comando — argumento de
processo é legível por qualquer processo da máquina.

### 1.3 Configuração

```powershell
Copy-Item .\backup.config.sample.psd1 .\backup.config.psd1
notepad .\backup.config.psd1
```

Preencha `ExternalBackupRoot` e `GpgPassphraseFile`. **`backup.config.psd1` é
gitignored e não contém senha.**

**Todo caminho da configuração precisa ser absoluto** — `BackupRoot`,
`ExternalBackupRoot`, `GpgPassphraseFile`, `PgpassFile` e os de `Tools`. Caminho
relativo é recusado com `exit 80`: sob o Task Scheduler ele resolveria contra
`C:\Windows\System32`.

Para o Task Scheduler, preencha também `Tools` e `PgpassFile` — ver §9.

---

## 2. Uso

```powershell
# rotina diária
.\Invoke-PortalBackup.ps1 -Reason scheduled

# antes de mudança em schema/migration/auth/storage/config estrutural
.\Invoke-PortalBackup.ps1 -Reason prechange -Note 'antes da migration 20260901_x'

# avulso
.\Invoke-PortalBackup.ps1 -Reason manual -Note 'investigação do chamado 123'

# primeiro ciclo real: veja o que a retenção FARIA, sem apagar
.\Invoke-PortalBackup.ps1 -Reason scheduled -WhatIfRetention
```

Verificação offline, a qualquer momento:

```powershell
.\Verify-PortalBackup.ps1 -SetPath 'C:\...\AppRepresentatives-Backups\sets\2026-08-26T020000'
.\Verify-PortalBackup.ps1 -SetsRoot 'C:\...\AppRepresentatives-Backups\sets'
```

---

## 3. Estrutura

```
AppRepresentatives-Backups\
├─ sets\2026-08-26T020000\      ← conjunto SELADO e IMUTÁVEL
│   ├─ backup-portal-roles-<setId>.sql
│   ├─ backup-portal-schema-<setId>.raw.sql   ← saída bruta do pg_dump
│   ├─ backup-portal-schema-<setId>.sql       ← após as 12 transformações
│   ├─ backup-portal-dados-<setId>.raw.sql
│   ├─ backup-portal-dados-<setId>.sql
│   ├─ storage\avatars\...                    ← objetos, caminho original preservado
│   ├─ BACKUP-EVIDENCE-<setId>.txt
│   ├─ SHA256SUMS.txt
│   └─ BACKUP-OK.json                         ← o selo, gravado por último
├─ staging\<setId>\             ← em construção; NUNCA conta como backup
└─ logs\
    ├─ backup-<setId>.log
    └─ RUN-RESULT-<setId>.json  ← cópia externa, retenção, exit code
```

**O set selado nunca é reaberto.** Tudo que muda depois — resultado da cópia externa,
da retenção e o código de saída — vive em `logs\RUN-RESULT-<setId>.json`, **fora** do
set. Assim o `SHA256SUMS.txt` continua descrevendo exatamente o que existe lá dentro.

`BACKUP-OK.json` significa **uma coisa só**: este conjunto local passou integralmente
nas validações. Ele **não** afirma nada sobre a cópia externa.

---

## 4. Como um backup incompleto é impedido de valer

1. **Staging separado** — nada é escrito no destino final durante a execução.
2. **Selo por último** — `BACKUP-OK.json` só depois de reverificar todos os hashes.
3. **A retenção só enxerga selados** — um set incompleto nunca ocupa vaga e, portanto,
   nunca desloca um backup bom para fora da janela. É a barreira que mais importa:
   sem ela, sete falhas seguidas apagariam todos os backups válidos.
4. **`Verify-PortalBackup.ps1`** — verificador independente, offline.

---

## 5. Códigos de saída

| Código | Significado |
|---|---|
| `0` | sucesso: set selado **+** cópia externa **+** retenção |
| `10` `11` `12` `13` | ferramenta ausente · destino · **pgpass ausente ou com ACL ampla** · conectividade |
| `20` `21` `22` | roles · schema · dados |
| `30` `31` | download do Storage · tamanho/contagem divergente |
| `32` `33` | **bucket com objetos fora da configuração** · **bucket deixou de ser público** |
| `34` | **nome de objeto inseguro para o filesystem** — travessia, caractere proibido ou nome reservado do Windows |
| `40` `41` `42` | schema abaixo do baseline ou tabela obrigatória ausente · `COPY` · **`auth.users` ausente** |
| `43` | **schema gerenciado vazou para o dump** |
| `50` | manifesto/selagem: hash não confere |
| `60` | cópia externa |
| `70` | retenção |
| `80` | configuração |

Se a cópia externa falhar, **o backup local continua válido e selado** — mas o exit é
`60` e a **retenção não roda**. Nunca se apaga backup antigo sem ter a cópia nova
confirmada nos dois lados.

**A retenção externa poda os `.tar.gpg` pela mesma política e pelos mesmos `setId`** —
e só depois da cópia nova validada por hash nos dois lados. Ela remove **apenas** o que
o plano local marcou explicitamente como `Delete`. Um `.tar.gpg` órfão — cujo set local
já não existe — é registrado no log como `MANTIDO`, nunca apagado por dedução: o set
local pode ter sido movido ou removido à mão, e apagar a única cópia restante por causa
disso seria destruir backup bom. `-WhatIfRetention` vale para as duas.

---

## 6. Sanidade

**Nomes, não só contagens.** As 10 tabelas de `RequiredPublicTables` precisam existir no
schema **e** ter bloco `COPY` no dump de dados. Contagem sozinha não distingue "10
tabelas" de "as 10 tabelas certas".

Os baselines (`SchemaPublicTables`, `CopyPublic`, `CopyTotal`) são **piso**, nunca
igualdade: detectam regressão sem impedir o banco de crescer.

Duas guardas adicionais:

- **`auth.users` obrigatório** — sem ele o restore recria o sistema sem nenhum login
  possível, e `concremapprep_usuarios.id` referencia `auth.users(id)`;
- **nenhum schema gerenciado no dump** — o `--exclude-schema` usa alternação `|`; se o
  `pg_dump` interpretasse esse padrão de outro jeito, ele não excluiria nada e o dump
  viria com `auth`/`storage`/`realtime` dentro, **sem erro nenhum**.

---

## 7. Storage

**Descoberta antes do download, sempre.** A rotina consulta `storage.buckets` e
`storage.objects`, e falha se encontrar bucket com objetos fora de `StorageBuckets`
(exit 32) ou bucket configurado que deixou de ser público (exit 33).

É isto que impede a automação de ficar verde depois que alguém cria um bucket novo e
esquece de incluí-lo. `StorageBuckets` é declaração de intenção — **nunca** substitui a
descoberta.

**O nome do objeto vem do banco — é dado, não é comando.** Antes de virar caminho
no disco ele passa por validação que **falha fechado** (exit 34): travessia (`..`),
caminho absoluto, prefixo de unidade (`C:`), barra invertida, segmento vazio,
caractere proibido no Windows (`< > : " / \ | ? *`), caractere de controle, nome
reservado (`CON`, `NUL`, `COM1`…, com ou sem extensão) e nome terminando em espaço
ou ponto. Depois de montado, o caminho é canonicalizado com `GetFullPath` e
reconferido contra a raiz do bucket.

**Nada é renomeado em silêncio.** Um objeto que não possa ser representado com
segurança no filesystem do Windows derruba a execução — restaurar com nome diferente
do original seria pior do que falhar.

O download usa `curl.exe` com `--fail --location --silent --show-error`. Cada
**segmento** do nome do objeto é codificado separadamente e as barras são preservadas —
codificar o nome inteiro transformaria `/` em `%2F` e o endpoint devolveria 404. Cobre
espaço, `#`, `%`, acento e Unicode. O caminho original é preservado no disco.

---

## 8. Ferramentas nativas — exit code e stderr

**PowerShell 5.1 não transforma `exit != 0` de executável nativo em erro terminante,
e `$ErrorActionPreference` não muda isso.** Pior: redirecionar o stderr de um nativo
(`2>` ou `2>&1`) faz o 5.1 embrulhar cada linha num `ErrorRecord`
(`NativeCommandError`) — sob `$ErrorActionPreference = 'Stop'` isso derruba a execução
mesmo quando o processo terminou com `0`. Um `pg_dump` que emitisse um único aviso
mataria um backup perfeitamente bom.

Por isso **toda** invocação de `pg_dump`, `pg_dumpall`, `psql`, `curl`, `tar` e `gpg`
passa por um wrapper único, `Invoke-NativeCommand`, sobre
`System.Diagnostics.Process`:

- o exit code é lido **do processo**, não de `$LASTEXITCODE`;
- `stdout` e `stderr` são capturados **separadamente** e de forma assíncrona (ler um
  até o fim antes do outro trava quando o buffer do que ficou parado enche);
- stderr **nunca** contamina o resultado parseado do `psql`;
- nada depende de preferência global — o comportamento é o mesmo em qualquer host.

Cada estágio mapeia a falha para o seu próprio código de saída, e **nenhum arquivo
parcial segue adiante**: quem chama só continua se o wrapper retornar. Duas guardas
extras onde o exit code sozinho não bastaria: `curl` e `gpg` que retornem `0` sem
produzir o arquivo também derrubam a execução.

A linha de comando é montada com escaping do MSVCRT — `.NET Framework 4.x`, o runtime
do 5.1, não tem `ProcessStartInfo.ArgumentList`.

---

## 9. Task Scheduler

**Continua NÃO configurado — a execução diária automática ainda NÃO está ativa.**
Hoje a rotina só roda se alguém a disparar.

**A precondição, porém, foi cumprida.** O primeiro ciclo manual real terminou com
sucesso em **2026-08-26, exit 0** (set `2026-08-26T144106`): o conjunto local foi
selado e verificado por fora, e a **cópia externa cifrada desse ciclo foi
descriptografada, extraída e validada** — byte a byte igual ao set local. Ver
`docs/A9-ROTINA-BACKUP.md` §8.

**Próximo passo operacional: configurar e validar o Task Scheduler.** Enquanto isso
não acontecer, o RPO real é o intervalo entre execuções lembradas à mão, e não as
24 h da política.

A tarefa agendada não herda **nada** da sua sessão: nem `PATH`, nem diretório
corrente, nem perfil do PowerShell, nem `%APPDATA%` (se rodar como SYSTEM). O script
já se defende disso:

| Dependência | Como é neutralizada |
|---|---|
| diretório corrente | tudo resolve a partir de `$PSScriptRoot`; `-ConfigPath` relativo resolve contra o diretório do script, não contra o CWD; `WorkingDirectory` de todo processo filho é fixado |
| `PATH` | `Tools` na config; o fallback `Get-Command` existe para uso manual |
| variáveis `PG*` herdadas | `PGPASSWORD`, `PGSERVICE`, `PGSERVICEFILE`, `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` são **removidas** antes de qualquer conexão — `PGPASSWORD` herdado teria precedência sobre o `.pgpass` e trocaria a fonte da senha em silêncio |
| perfil do PowerShell | rode com `-NoProfile` |
| caminho relativo na config | recusado com `exit 80` |

**Antes de agendar, preencha na config real:**

1. **`Tools`** — os seis caminhos absolutos;
2. **`PgpassFile`** — absoluto. Se a tarefa rodar como SYSTEM, o `%APPDATA%` é outro
   e o default apontaria para o arquivo errado;
3. **`BackupRoot`**, **`ExternalBackupRoot`**, **`GpgPassphraseFile`** — absolutos.

Na tarefa: caminho absoluto para o `powershell.exe` e para o script, `-NoProfile`, e
`Start in` definido.

---

## 10. Limitações conhecidas

**Comentários dentro de funções somem do `.sql`.** O passo 12 das transformações apaga
toda linha iniciada por `--`, inclusive as de dentro de corpos de função. As funções
restauram sintaticamente válidas, mas sem comentários — é o comportamento do pipeline
original do Supabase CLI, reproduzido de propósito. **O `.raw.sql` preservado é a única
cópia com o código-fonte íntegro. Nunca apague os `.raw.sql`.**

**Roles restauram sem senha** — `--no-role-passwords`, como no backup validado.

**`--use-copy` é opção do Supabase CLI, NÃO do `pg_dump` nativo.** O `pg_dump` 18.6
rejeita esse argumento — e não precisa dele: `COPY` já é o formato padrão do
`--data-only`. A flag aparece em `docs/BACKUP-MANUAL.md` porque aquele procedimento de
contingência usa `supabase db dump`; **nunca** deve ser copiada para cá. O dump nativo
de dados usa `--data-only --quote-all-identifiers --role <role> --exclude-schema …
--exclude-table … --schema *`.

**Isto não é backup da plataforma Supabase.** `auth` e `storage` são schemas
gerenciados; o restore integral deles nunca foi testado. O que está provado é o restore
de **schema e dados da aplicação `public`**.

**`API_MAX_ROWS` × `Max rows` do painel** não se aplica aqui, mas vale o alerta análogo:
se o `Max rows` do Data API mudar, a paginação de outras partes do sistema muda junto —
ver `src/constants/apiLimits.ts`.

---
