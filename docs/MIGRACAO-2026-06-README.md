# Migração — Banco dedicado + Supabase Auth + RLS

Guia de execução da migração do Concrem Connect: do banco antigo (compartilhado, acesso via `anon`) para um banco novo dedicado, trocando o modelo de segurança para **Supabase Auth + RLS**.

> ⚠️ Faça tudo primeiro num **projeto de staging** (cópia descartável). Só rode em produção depois de validar o login e o escopo de dados.

## O que muda

| | Antes | Depois |
|---|---|---|
| Autenticação | RPC `login` custom + `localStorage` | Supabase Auth (JWT por usuário) |
| Acesso ao banco | tudo como `anon` | como `authenticated`, filtrado por RLS |
| Segurança | `GRANT ... TO anon` | RLS + policies com `auth.uid()` |
| Criar usuário / reset senha | RPC no front | Edge Functions com `service_role` |

## Arquivos

| Arquivo | Papel |
|---|---|
| `schema_v2.sql` | Estrutura + funções auxiliares + RLS + policies + grants + índices |
| `01_migrate_auth_users.sql` | Cria usuários em `auth.users` preservando o hash bcrypt |
| `../supabase/functions/admin-criar-usuario/` | Edge Function: criar usuário (admin) |
| `../supabase/functions/admin-reset-senha/` | Edge Function: reset de senha (admin) |

---

## ⚠️ Escopo: o que NÃO está coberto (ERP parqueado)

As tabelas do ERP (`concrem_pedidos_venda`, `concrem_pedidos_status`, `concrem_pedidos_status_historico`, `relatorio_entrega_anexos`, `concremprodutos_produtos`) **não vão para o banco novo** — a estratégia de acesso ao ERP foi adiada. Consequência: **Pedidos, Acompanhamento, Dashboard, Carteira e Produtos não funcionarão** no banco novo até essa decisão. Login, Orçamentos, Notificações, Clientes (cadastro) e a administração de usuários/representantes funcionam.

Tabelas migradas (portal): `concremapprep_usuarios`, `concremapprep_representantes`, `concremapprep_usuario_representantes`, `concremapprep_notificacoes`, `concremapprep_orcamentos`, `concremapprep_orcamento_itens`, `pedidos_status_historico`.

> As tabelas `clientes` e `titulos` (sem prefixo) são usadas por código legado/mock. Confirme se têm dados reais; se tiverem, inclua-as nos dumps abaixo.

---

## Passo 0 — Variáveis

```bash
export OLD_DB="postgresql://postgres:<senha>@db.<ref-antigo>.supabase.co:5432/postgres"
export NEW_DB="postgresql://postgres:<senha>@db.<ref-novo>.supabase.co:5432/postgres"
```

> Use `~/.pgpass` em vez de senha na URI quando possível. Se o host `db.<ref>...` não resolver, use a connection string do **pooler em session mode (porta 5432)** que aparece em Project Settings → Database.

Teste:
```bash
psql "$OLD_DB" -c "select count(*) from concremapprep_usuarios;"
psql "$NEW_DB" -c "select 1;"
```

## Passo 1 — Estrutura + RLS no banco NOVO

```bash
psql "$NEW_DB" -f schema_v2.sql
```
O `schema_v2.sql` já faz `create extension pgcrypto`, cria tabelas/funções/policies, revoga `anon` e concede a `authenticated`.

## Passo 2 — Migrar usuários para `auth.users`

> **Usando o SQL Editor do Supabase (web)?** `\copy`/`\i` e `create temp table` não funcionam lá. Siga a **VIA 1** descrita no topo de `01_migrate_auth_users.sql` (tabela `_import_usuarios` normal + INSERT gerado a partir do banco antigo). Os comandos `psql` abaixo são a **VIA 2** (terminal).

Primeiro confira o schema do Auth no banco novo (varia por versão do GoTrue):
```bash
psql "$NEW_DB" -c "\d auth.users"
psql "$NEW_DB" -c "\d auth.identities"
```

Exportar do antigo e carregar no novo (rode B+C numa só sessão por causa da tabela temp):
```bash
# A) exportar
psql "$OLD_DB" -c "\copy (select id, nome, lower(trim(email)) email, senha, coalesce(admin,false) admin, coalesce(operador,false) operador, coalesce(ativo,true) ativo, coalesce(created_at,now()) created_at from concremapprep_usuarios) to 'usuarios_export.csv' with (format csv, header true)"

# B+C) carregar e inserir (here-doc mantém a temp table viva entre os comandos)
psql "$NEW_DB" <<'EOF'
create temp table _import_usuarios (id uuid, nome text, email text, senha text, admin boolean, operador boolean, ativo boolean, created_at timestamptz);
\copy _import_usuarios from 'usuarios_export.csv' with (format csv, header true)
\i 01_migrate_auth_users.sql
EOF
```

> O `01_migrate_auth_users.sql` contém apenas o bloco transacional do PASSO C (insert em `auth.users` + `auth.identities` + perfil). Os passos A/B estão comentados como referência no topo dele.

**Valide com UM usuário antes do lote** e teste o login pelo app. Se o hash não for aceito, use o Plano B (reset de senha) descrito no fim do `01_migrate_auth_users.sql`.

## Passo 3 — Migrar os dados do portal

Dump filtrado **apenas** das tabelas do portal (note `pedidos_status_historico`, sem prefixo).
**`concremapprep_usuarios` é excluída de propósito** — ela já foi migrada no Passo 2 e, no banco novo, não tem mais a coluna `senha` (carregar o dump dela aqui dá erro "coluna senha não existe"):

```bash
pg_dump "$OLD_DB" \
  --data-only --no-owner \
  -t 'public.concremapprep_*' \
  -t 'public.pedidos_status_historico' \
  --exclude-table-data 'public.concremapprep_usuarios' \
  -f dados.sql
```

Carregar no novo, na ordem de dependência (pg_dump já ordena por FK):
```bash
psql "$NEW_DB" -f dados.sql
```

> Não usamos `--disable-triggers` (exige superuser, falha no Supabase gerenciado). Se aparecer erro de FK, confira a ordem; o caminho confiável é carregar pais antes de filhos (o pg_dump faz isso).

## Passo 4 — Edge Functions

```bash
supabase link --project-ref <ref-novo>
# TODAS com --no-verify-jwt: o turnstile é pré-login; as de admin fazem a
# checagem de admin DENTRO da função (getUser). Sem isso, o preflight OPTIONS
# (que não manda Authorization) é barrado e o CORS quebra.
supabase functions deploy verificar-turnstile --no-verify-jwt --project-ref <ref-novo>
supabase functions deploy admin-criar-usuario --no-verify-jwt --project-ref <ref-novo>
supabase functions deploy admin-reset-senha   --no-verify-jwt --project-ref <ref-novo>
supabase secrets set TURNSTILE_SECRET_KEY=<valor> --project-ref <ref-novo>
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem no runtime das Edge Functions — não precisa setar.

> **Segurança:** como as funções de admin sobem com `--no-verify-jwt`, a verificação de quem é admin acontece dentro do código (valida o JWT via `getUser` e confere `admin`). Quem não estiver logado / não for admin recebe 401/403. A plataforma só deixa de barrar o preflight — não abre a função.

## Passo 5 — Apontar o app

No `.env` (e depois na Vercel/build):
```
VITE_SUPABASE_URL=https://<ref-novo>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key do projeto NOVO>
```
A anon key nova: Project Settings → API → Project API keys → `anon` / `public`.

## Passo 6 — Verificação

```bash
# Contagem nas tabelas migradas
for t in usuarios representantes usuario_representantes orcamentos orcamento_itens notificacoes; do
  echo -n "concremapprep_$t: "; psql "$NEW_DB" -t -c "select count(*) from concremapprep_$t;"
done
echo -n "pedidos_status_historico: "; psql "$NEW_DB" -t -c "select count(*) from pedidos_status_historico;"

# RLS habilitado (deve ser t em todas)
psql "$NEW_DB" -c "select tablename, rowsecurity from pg_tables where schemaname='public' and (tablename like 'concremapprep_%' or tablename='pedidos_status_historico') order by 1;"

# Policies criadas
psql "$NEW_DB" -c "select tablename, policyname, cmd from pg_policies where schemaname='public' order by 1,2;"

# anon NÃO deve ter grants em tabela nenhuma (resultado deve ser vazio)
psql "$NEW_DB" -c "select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public';"

# auth.users povoado
psql "$NEW_DB" -c "select count(*) from auth.users;"
```

**Teste funcional no app** (o que realmente importa):
1. Login com um usuário real → deve entrar.
2. Representante A **não** vê orçamentos do representante B.
3. Admin cria usuário (Edge Function) e reseta senha.
4. Representante cria/edita orçamento em rascunho; não consegue editar um já enviado.

---

## Rollback

A migração **não altera o banco antigo** (só faz dump/leitura) — o rollback é simplesmente **manter o `.env` apontando para o banco antigo** com o código da branch anterior. Para reverter o código:

```bash
git checkout <commit-anterior> -- src/lib/supabase/client.ts src/contexts/AuthContext.tsx src/services/usuarios.ts
```

Guarde `usuarios_export.csv` e `dados.sql` como backup. Para descartar o banco novo, basta não apontar o app para ele (ou pausar/excluir o projeto de staging).

## Pendências após esta migração

- [ ] Decidir o acesso ao ERP (2 clients lendo do antigo, ou replicar/sincronizar) e religar Pedidos/Acompanhamento/Dashboard/Carteira/Produtos.
- [ ] Confirmar se `clientes`/`titulos` têm dados reais e migrá-las se necessário.
- [ ] Ajustar a `UsuariosPage` para tratar as mensagens de erro das Edge Functions, se quiser feedback mais detalhado.
- [ ] Após validar tudo, **rotacionar as senhas** dos bancos que apareceram em texto claro.
