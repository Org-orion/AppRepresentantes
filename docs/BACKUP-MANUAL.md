# Backup manual do banco do Portal

> ⚠️ **ESTE É O PROCEDIMENTO DE CONTINGÊNCIA.** O caminho preferencial é o script de
> `scripts/backup/` — ver `scripts/backup/README.md` e `docs/A9-ROTINA-BACKUP.md`. Ele **já executou
> contra produção com sucesso** em 26/08/2026 (exit 0) e roda **automaticamente todo dia às 10:30**
> pelo Task Scheduler. Use este documento quando
> o script falhar, quando as ferramentas dele não estiverem disponíveis, ou quando for preciso um
> backup fora do fluxo.
>
> **Executor: humano.** Motivo: achado **A9** — o projeto está no plano Free e **não tem backup
> gerenciado** (nem diário, nem PITR).
>
> ✅ **Executado pela primeira vez em 2026-08-25**, com verificação por hash e ensaio de restauração da
> aplicação. Ver o Registro no fim deste arquivo e `docs/A9-BACKUP-RESTORE.md`.
> **O A9 continua aberto:** existe cópia verificada, não existe automação nem retenção definida.
>
> ⚠️ O arquivo gerado contém **dados pessoais** (usuários, clientes, orçamentos). Guarde como segredo:
> nada de repositório, e-mail ou pasta compartilhada aberta. O `.gitignore` já bloqueia `backup-*.sql`,
> mas o bloqueio é rede de segurança, não permissão.

## Quando fazer

- **Sempre antes de aplicar qualquer migration.**
- Periodicamente enquanto o projeto estiver no plano Free. Uma vez por semana é pouco para um sistema de
  uso diário — mas é infinitamente mais que zero.

## Ferramentas

Já instaladas nesta máquina: `supabase` 2.114.0, `pg_dump` e `psql` 18.6. **Docker não está instalado.**

## Passo 1 — montar a URL de conexão

Pegue a *connection string* em
🔗 https://supabase.com/dashboard/project/ikjeyaxfciferyezxskh/settings/database
(seção **Connection string** → aba **Session pooler**), no formato:

```
postgresql://postgres.ikjeyaxfciferyezxskh:[SENHA]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

A senha é a que você rotacionou hoje (Etapa 1.1, passo 2).

> Prefira colocá-la numa variável de ambiente da sessão a digitá-la no meio do comando — o histórico do
> terminal guarda linha de comando.

## Passo 2 — os três dumps

O Supabase separa em três porque restaurar exige essa ordem: papéis, depois estrutura, depois dados.

```bash
# 1) papéis e permissões
supabase db dump --db-url "$DB_URL" --role-only -f "backup-portal-roles-$(date +%Y%m%d).sql"

# 2) estrutura (tabelas, views, funções, policies)
supabase db dump --db-url "$DB_URL"             -f "backup-portal-schema-$(date +%Y%m%d).sql"

# 3) dados
supabase db dump --db-url "$DB_URL" --data-only --use-copy -f "backup-portal-dados-$(date +%Y%m%d).sql"
```

No PowerShell, troque `$(date +%Y%m%d)` por `$(Get-Date -Format yyyyMMdd)`.

> ⚠️ **`--use-copy` é opção do `supabase db dump`, NÃO do `pg_dump` nativo.** Os
> comandos acima usam o Supabase CLI, onde a flag existe. O `pg_dump` 18.6 rejeita esse
> argumento — e não precisa dele, porque `COPY` já é o formato padrão de `--data-only`.
> O script de `scripts/backup/` usa `pg_dump` nativo e **não** passa
> `--use-copy`. Não copie a flag de um procedimento para o outro.

## Passo 3 — conferir que o backup não é uma casca

Backup não verificado não é backup. No mínimo:

```bash
ls -lh backup-portal-*.sql          # nenhum arquivo pode estar com poucos KB

grep -c "CREATE TABLE" backup-portal-schema-*.sql     # esperado: dezenas
grep -c "COPY public"   backup-portal-dados-*.sql     # esperado: uma por tabela com dados
```

Confira também, no dump de dados, que aparecem as tabelas que importam:
`concremapprep_orcamentos`, `concremapprep_orcamento_itens`, `concremapprep_usuarios`,
`concremapprep_representantes`, `concremapprep_usuario_representantes`, `client_groups`.

## Passo 4 — copiar os objetos do Storage

**Os dumps NÃO cobrem o Storage.** `supabase db dump` e `pg_dump` produzem dump **lógico do banco**: os
objetos binários do bucket `avatars` — os avatares do perfil — não entram em nenhum dos três arquivos.

Baixe os objetos do bucket e confira o tamanho de cada um contra `storage.objects`. Um backup do Portal
tem **duas** partes: os dumps e os objetos. Um sem o outro é backup incompleto.

## ✅ Os dois pontos antes NÃO VERIFICADOS — respondidos em 2026-08-25

1. **Usuários do Auth — RESPONDIDO: o dump de dados CONTÉM `auth.users`.** A dúvida era se um restore
   recriaria o sistema sem nenhum login possível, já que `concremapprep_usuarios.id` referencia
   `auth.users(id)`. **Não é o caso.** Este procedimento serve como está; não é preciso dump adicional
   do schema `auth`.
2. **Foreign tables do ERP.** O schema `erp` são ponteiros para o outro banco, não dados. O dump de dados
   pode tentar lê-las e ficar lento. Se travar, restrinja com `--schema public`. Na execução de
   2026-08-25 não houve necessidade.

## Restauração — ensaiada em 2026-08-25, com limites conhecidos

**Foi testada.** Em PostgreSQL **18.6 local isolado**, banco `apprepresentatives_restore_test`, sem
tocar a produção:

- **10/10 tabelas `public`** restauradas;
- dados `public` restaurados;
- **contagens comparadas com produção: 10/10 idênticas.**

> ⚠️ **Isto NÃO foi um restore integral da plataforma Supabase.** Os schemas internos gerenciados —
> `auth` e `storage` — não foram reproduzidos num PostgreSQL vanilla. Para validar o schema da aplicação
> foram necessárias adaptações **apenas nas cópias locais de teste**: não recriar o role `postgres`,
> remover `GRANTED BY supabase_admin`, contornar a ausência de `supabase_vault` e de `supabase_realtime`,
> representar `auth.users`/`auth.uid()` por stubs locais, e conviver com a assinatura diferente de
> `postgres_fdw_get_connections`.
>
> A formulação correta é: **backup de schema e dados da aplicação `public` restaurado e validado com
> sucesso.** Nada além disso foi provado.

Os `.raw.sql` de schema e dados **foram preservados** — são a saída original do banco, antes das
adaptações do ensaio. **Não apagar.**

Detalhamento em `docs/A9-BACKUP-RESTORE.md`.

## Registro

| Data | Quem | Arquivos gerados | Verificação | `auth.users` no dump? | Guardado onde |
|---|---|---|---|---|---|
| 2026-08-25 | executor humano | `backup-portal-roles-20260825.sql` · `backup-portal-schema-20260825.sql` · `backup-portal-dados-20260825.sql` · os `.raw.sql` de schema e dados · `SHA256SUMS-20260825.txt` · `BACKUP-EVIDENCE-20260825.txt` · 2 objetos do bucket `avatars` | **8/8 artefatos validados por SHA-256**; 39 blocos `COPY`; 10 tabelas `public`; restore-test com 10/10 contagens idênticas | ✅ **sim** | `C:\Users\1kmz\AppRepresentatives-Backups\2026-08-24` — **fora do repositório** |
| 2026-08-26 | **script de backup, disparado à mão** (`Invoke-PortalBackup.ps1`) | set `2026-08-26T144106`: 8 artefatos + `SHA256SUMS.txt` + `BACKUP-OK.json`; cópia externa `2026-08-26T144106.tar.gpg` (AES256) | **8/8 por SHA-256**; 39 blocos `COPY`; 10 tabelas `public`; **cópia externa descriptografada, extraída e validada**, idêntica ao set local | ✅ **sim** | `sets` local + OneDrive cifrado — **fora do repositório** |

> **Nenhuma credencial foi gravada** nos artefatos, no manifesto ou no arquivo de evidência.
