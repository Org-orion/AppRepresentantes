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
| `20260819000300_escopo_centralizado.sql` | ✅ sim | SQL Editor, 20/08/2026 — E1 aplicada e validada (B1–B4, P6, S1–S8, S11, S12, S16) |
| `20260819000400_rpc_dashboard_serie_diaria.sql` | ✅ sim | SQL Editor, 21/08/2026 — E2 aplicada; E3 validada (T1–T8 + API real) |
| `20260910000100_restaurar_policy_rep_delete.sql` | ✅ sim | SQL Editor, 10/09/2026 — verificado via `pg_policy` (`rep_delete` listada, `polcmd = 'd'`) e teste funcional de exclusão (representante 40059060). Evidência: commit `2660b12` |
| `20260910000200_escopo_por_codigo_representante.sql` | ✅ sim | SQL Editor, 10/09/2026 — "Migration aplicada em produção pelo responsável, com o resultado esperado" (commit `233f69f`). Verificação funcional por perfil registrada como pendente no próprio commit. Indício indireto: `AuthContext`/`scope.ts` (em produção) dependem de `app_my_rep_codes()`, que esta migration cria/ajusta |
| `20260910000300_escopo_atual_expande_grafias.sql` | ✅ sim | SQL Editor, 29/10/2026 — `app_escopo_atual()` passa a expandir as grafias do representante (complemento de `20260910000200`, aplicado também a `app_dashboard_serie_diaria()`). Revisada por Crivo e Corvo (sem vetor de escalonamento de escopo). Verificado via `pg_get_functiondef('public.app_escopo_atual()'::regprocedure) ilike '%concremapprep_rep_grafias%'` → `true` |
| `20261006000100_excluir_entrega_cancelada.sql` | ✅ sim | SQL Editor, 29/10/2026 — view `concrem_pedidos_venda` passa a excluir pedido com entrega cancelada e nasce com `security_barrier=true` (achado A10). Aplicada e verificada em produção por Kaio; commit `c4cb79d` |
| `20261029000100_restaurar_security_barrier_views_erp.sql` | ✅ sim | SQL Editor, 29/10/2026 — restaura `security_barrier=true` em `concrem_pedidos_status`, `concrem_pedidos_status_historico` e `relatorio_entrega_anexos` (achado A10). Verificado via `pg_class.reloptions`; commit `c4cb79d` |
| `20261006000200_excluir_entrega_cancelada_dashboard.sql` | ✅ sim | SQL Editor, 29/10/2026 — `app_dashboard_serie_diaria()` passa a aplicar o mesmo filtro de entrega cancelada da view, nos 5 ramos que agregam sobre `erp.concrem_pedidos_venda`. Verificado via `pg_get_functiondef`; commit `c4cb79d` |
| `20261029000200_revogar_execute_anon_sync_grafias.sql` | ✅ sim | SQL Editor, 29/10/2026 — revoga `EXECUTE` de `public`/`anon` em `app_sync_rep_grafias()` (achado do Corvo durante a revisão de T-004: a função aceitava chamada anônima via PostgREST, disparando leitura completa de `erp.concrem_pedidos_venda` — vetor de custo/DoS contra o ERP compartilhado). Só ACL, sem mudança de lógica; `authenticated` mantido. Verificado via `has_function_privilege`: `anon` → `false`, `authenticated` → `true` |

> As cinco primeiras são **histórico**. Estão aqui para o schema ser reconstituível e auditável —
> **não** devem ser reexecutadas em produção. `20260819000300_escopo_centralizado.sql` (E1) e
> `20260819000400_rpc_dashboard_serie_diaria.sql` (E2) foram aplicadas manualmente em 20 e 21/08/2026.
> `20260819000100_telefone_usuarios.sql` e `20260819000200_pedidos_conferidos.sql` continuam pendentes.
>
> ✅ **`20260910000300_escopo_atual_expande_grafias.sql` — RESOLVIDO em 29/10/2026.** Ficou pendente de
> aplicação desde o commit `beb6884` (21/09/2026), que já registrava "esta migration AINDA NÃO FOI
> APLICADA no banco de produção" — confirmado nesse estado em 29/10/2026 por Kaio
> (`pg_get_functiondef(...) ilike '%concremapprep_rep_grafias%'` → `false`). Nesse meio tempo o bug era
> real: para representantes cujo código ERP tem mais de uma grafia, `totalVendidoMes`,
> `totalVendidoMesAnt`, `pedidosNoPeriodo` e `vendasMensais` (que vêm de `app_dashboard_serie_diaria()`,
> cujo escopo depende de `app_escopo_atual()`) saíam com escopo mais estreito do que Carteira/Pipeline/
> Faturado, que já usavam o escopo expandido — dois números diferentes na mesma tela, para o mesmo
> usuário. Migration aplicada no mesmo dia, revisada por Crivo e Corvo, e reconfirmada no banco com a
> mesma consulta agora devolvendo `true`. Bug **resolvido**.

### ACL das funções — dois contratos diferentes, de propósito

| Função | owner | PUBLIC | `anon` | `authenticated` | `service_role` |
|---|---|---|---|---|---|
| `app_escopo_atual()` (E1) | `postgres` | — | — | — | **EXECUTE** |
| `app_dashboard_serie_diaria()` (E2) | `postgres` | — | — | **EXECUTE** | — |

A assimetria em `service_role` é deliberada: a E1 é infraestrutura e pode ser necessária a uma Edge
Function futura; a E2 é chamada pela SPA e hoje não tem consumidor `service_role`. **Não uniformizar.**
Ambas verificadas por inspeção de `proacl` com `aclexplode` (T6 e T6-b), não por
`has_function_privilege` isolado.

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
