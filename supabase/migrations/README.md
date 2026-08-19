# Migrations — Concrem Connect

Diretório **único** do SQL do projeto. Antes deste ponto o SQL vivia em três lugares (`migration/`,
`src/lib/supabase/` e um `ALTER TABLE` dentro de um comentário de código), sem numeração e sem registro
do que estava aplicado.

## Convenção

`AAAAMMDDHHMMSS_descricao.sql` — a ordem do nome é a ordem de aplicação.

## Estado real no banco de produção (`ikjeyaxfciferyezxskh`)

| Arquivo | Aplicado? | Como |
|---|---|---|
| `20260630000100_schema_v2.sql` | ✅ sim | SQL Editor, junho/2026 |
| `20260630000200_migrate_auth_users.sql` | ✅ sim | SQL Editor — migrou usuários para `auth.users` reaproveitando o hash bcrypt |
| `20260630000300_migrate_data.sql` | ✅ sim | SQL Editor — geradores de `INSERT`, na ordem das FKs |
| `20260630000400_erp_fdw.sql` | ✅ sim | SQL Editor — `postgres_fdw` + views com RLS |
| `20260706000100_diretores_e_grupos.sql` | ✅ sim | SQL Editor — perfis diretor/diretor geral e grupos de cliente |
| `20260819000100_telefone_usuarios.sql` | ⬜ **não** | pendente — Etapa 7.2 |
| `20260819000200_pedidos_conferidos.sql` | ⬜ **não** | pendente — Etapa 7.3 |

> As cinco primeiras são **histórico**. Estão aqui para o schema ser reconstituível e auditável —
> **não** devem ser reexecutadas em produção. As duas últimas são idempotentes e ainda não rodaram.

## Como aplicar

Não há pipeline de migration. A aplicação é **manual, pelo SQL Editor**, com autorização explícita.

⚠️ **Armadilha conhecida:** no SQL Editor do Supabase, o botão **Run** executa apenas o trecho
**selecionado** quando existe seleção. Várias falhas da migração de junho foram execução parcial
(ver `docs/MIGRACAO-2026-06-RESUMO.md` §8), e o mesmo atrito reapareceu no incidente de agosto.
**Selecione tudo, ou não selecione nada, antes de rodar.**

Depois de aplicar, marque o arquivo como aplicado na tabela acima, na mesma alteração.

## O que NÃO está aqui

- **Rotação de segredos e user mapping do FDW** — operação de painel, não migration.
  Ver `docs/ETAPA-1-ROTACAO-SEGREDOS.md`.
- **Edge Functions** — `supabase/functions/`, com deploy próprio.
- **Configuração de Auth** (CAPTCHA, política de senha) — painel. Ver `docs/ETAPA-5-CAPTCHA-NATIVO.md`.

## Removido

`src/lib/supabase/schema.sql` descrevia o modelo **anterior** à migração de junho — autenticação por RPC
própria, acesso como `anon`, `grant select ... to anon`. Foi apagado por descrever um sistema que não
existe mais: mantido no repositório, era a documentação errada mais perigosa do projeto, porque parecia
oficial.
