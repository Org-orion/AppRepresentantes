# A9 — Rotina operacional de backup

> **Estado: código pronto, rotina NÃO ativa.** O A9 permanece 🟡 **PARCIALMENTE
> TRATADO**. Ver §8 para o que ainda falta.
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

**O RPO de 24 h só se cumpre com a rotina agendada rodando.** Executada à mão, na
prática o RPO vira semanal — e é isso que dispara o gatilho 3 de reavaliação do plano.

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

## 8. O que falta para A9 deixar de ser parcial

| | Item | Estado |
|---|---|---|
| 1 | `.pgpass` real configurado e ACL validada | ❌ |
| 2 | Destino externo real configurado | ❌ |
| 3 | Passphrase do GPG configurada | ❌ |
| 4 | Primeiro ciclo automático completo executado e verificado | ❌ |
| 5 | Política de retenção observada em execução real | ❌ |
| 6 | Permanência no Free registrada como aceitação de risco | ✅ **§1.1** |
| 7 | Task Scheduler | ❌ — só depois do item 4 |

**Enquanto 1 a 5 e 7 estiverem abertos, a rotina é código, não operação.** Código de
backup que nunca rodou não protege nada.

---

## 9. Testes offline executados

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

### Três defeitos reais encontrados e corrigidos pelos testes

1. **`Verify` não detectava a falta do dump final de dados.** O glob
   `backup-portal-dados-*.sql` também casa `backup-portal-dados-*.raw.sql`, então a
   checagem de estrutura passava. Corrigido com regex e `(?<!\.raw)`.
2. **`@(<List[object]>)` dentro de `[ordered]@{}` lança exceção no PowerShell 5.1.**
   Quebrava `Get-RetentionPlan`, `New-Manifest`, `Test-Manifest` e `Test-BackupSet`.
   Corrigido com `.ToArray()`.
3. **Variáveis do PowerShell são case-insensitive** — `$SRC` e `$src` eram a mesma
   variável e o teste sobrescrevia o próprio caminho. Erro do teste, não do código.
