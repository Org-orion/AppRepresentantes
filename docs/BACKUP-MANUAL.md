# Backup manual do banco do Portal

> **Executor: humano.** Motivo: achado **A9** — o projeto está no plano Free e **não tem backup nenhum**
> (nem diário, nem PITR). Enquanto isso não mudar, backup é rotina manual.
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

## ⚠️ Dois pontos NÃO VERIFICADOS

1. **Usuários do Auth.** Não confirmei se `supabase db dump` inclui o schema `auth` (onde vivem
   `auth.users` e os hashes de senha). Se **não** incluir, um restore recria o sistema **sem logins** —
   e o `concremapprep_usuarios.id` referencia `auth.users(id)`. Verifique com:
   `grep -c "auth.users" backup-portal-dados-*.sql`. Se der zero, precisamos de um dump adicional do
   schema `auth`, e isso muda o procedimento.
2. **Foreign tables do ERP.** O schema `erp` são ponteiros para o outro banco, não dados. O dump de dados
   pode tentar lê-las e ficar lento. Se travar, restrinja com `--schema public`.

Anote o resultado dos dois abaixo — são o que decide se este procedimento serve ou precisa mudar.

## Restauração — não testada

**Nunca foi testada.** Pelo pilar de Backup e Recuperação, backup sem restauração ensaiada **não é
recuperação garantida** — é um arquivo com nome esperançoso. O ensaio exige um destino, e hoje não há
(sem Docker e sem projeto de teste).

Enquanto isso não for feito, o estado honesto é: **existe cópia, não existe recuperação comprovada.**

## Registro

| Data | Quem | Arquivos gerados | Tamanhos | `auth.users` no dump? | Guardado onde |
|---|---|---|---|---|---|
| | | | | | |
