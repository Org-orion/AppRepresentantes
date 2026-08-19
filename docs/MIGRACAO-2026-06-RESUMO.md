# Resumo da Migração — Concrem Connect

Migração do portal para um **banco dedicado** com **Supabase Auth + RLS**, e acesso seguro aos dados do ERP via **FDW**.

## 1. Objetivo

Sair do modelo inseguro (login via RPC custom, todo acesso como `anon`, segurança só por `GRANT` e por filtros no código) para um modelo onde **cada usuário tem identidade real (JWT)** e o **banco** garante que cada representante só enxerga os próprios dados.

## 2. Antes × Depois

| | Antes | Depois |
|---|---|---|
| Banco | Compartilhado com outra app (`ctntlgvoefdbjxvfkahp`) | Dedicado (`ikjeyaxfciferyezxskh` / "apprepresentatives") |
| Login | RPC custom `login` + sessão em `localStorage` | Supabase Auth (`signInWithPassword`, JWT por usuário) |
| Acesso ao banco | Tudo como `anon` | Como `authenticated`, filtrado por RLS |
| Segurança | `GRANT ... TO anon` + escopo no código | RLS + policies com `auth.uid()` |
| Dados do ERP | Lidos como `anon` (qualquer um lia tudo) | FDW + views com RLS por representante |
| Criar usuário / reset senha | RPC no front | Edge Functions com `service_role` |

## 3. O que foi feito (por fase)

### Fase 1 — Estrutura e RLS no banco novo
- `supabase/migrations/20260630000100_schema_v2.sql`: tabelas do portal, `concremapprep_usuarios.id` ligado a `auth.users(id)`, funções auxiliares (`app_is_admin`, `app_is_operador`, `app_can_*_orcamento`), **RLS habilitado com policies por tabela**, trigger anti-elevação de privilégio, grants para `authenticated`, índices. Removida a FK quebrada `produto_id → concremprodutos_produtos`.

### Fase 2 — Migração de usuários (senhas preservadas)
- `supabase/migrations/20260630000200_migrate_auth_users.sql`: usuários migrados para `auth.users` + `auth.identities` **reaproveitando o hash bcrypt** — ninguém precisou redefinir senha.
- Feita pelo SQL Editor (gerador de `INSERT` rodado no banco antigo, colado no novo).

### Fase 3 — Migração dos dados do portal
- `supabase/migrations/20260630000300_migrate_data.sql`: representantes, vínculos, notificações, orçamentos e itens migrados via geradores de `INSERT`, na ordem de FK.

### Fase 4 — Gestão de usuários (Edge Functions)
- `supabase/functions/admin-criar-usuario` e `admin-reset-senha`: criam usuário em `auth.users` e resetam senha usando `service_role`, validando que o chamador é admin. Deployadas com **Verify JWT desligado** (auth feita dentro da função).

### Fase 5 — Acesso seguro ao ERP (FDW + RLS)
- `supabase/migrations/20260630000400_erp_fdw.sql`: como os dados do ERP **não podem sair do banco antigo** (alimentados por outra app), o banco novo os lê **ao vivo** via `postgres_fdw`:
  - Foreign tables no schema `erp` (ponteiros, sem cópia).
  - Views em `public` com `security_barrier` aplicando RLS por representante (`app_my_rep_codes()` / `app_is_admin()`).
  - `authenticated` só acessa as views; `erp.*` não é exposto.
- App voltou a usar **um único client** (banco novo); a anon key antiga saiu do frontend.

## 4. Código alterado no app

| Arquivo | Mudança |
|---|---|
| `src/lib/supabase/client.ts` | Sessão gerenciada pelo Supabase Auth (`persistSession`, `autoRefreshToken`) |
| `src/contexts/AuthContext.tsx` | `signInWithPassword` + `onAuthStateChange`; carrega perfil/rep_codes; **deferir chamadas com `setTimeout` no callback** (evita deadlock do lock do gotrue-js) |
| `src/services/usuarios.ts` | `createUsuario`/`updateSenha` via Edge Functions / `auth` |
| `src/pages/admin/UsuariosPage.tsx` | Feedback de sucesso na troca de senha |
| `src/pages/LoginPage.tsx` | Import nomeado do Turnstile (`{ Turnstile }`) — corrigia a tela branca inicial |
| `src/services/{pedidosVenda,dashboard,acompanhamento,carteira,produtos}.ts` | Leem o ERP via views do banco novo (1 client) |

## 5. Ganho de segurança

- **Identidade real**: cada usuário tem JWT; policies usam `auth.uid()`.
- **Isolamento por representante no banco**: mesmo com a anon key (que vai no bundle), não dá para ler pedidos/orçamentos de outro representante — a RLS bloqueia.
- **Privilégios de escrita travados**: criar/editar representantes, usuários e vínculos exige admin (policy + Edge Function com `service_role`).
- **ERP protegido**: leitura passa por views com RLS; a anon key do banco antigo saiu do frontend.
- **Bug corrigido de brinde**: anexos (NF/boleto) — o app consultava `relatorio_entrega_anexos` (inexistente); o nome real é `concrem_relatorio_entrega_anexos`. Agora funcionam.

## 6. Projetos e referências

- **Banco novo (portal):** `ikjeyaxfciferyezxskh` ("apprepresentatives")
- **Banco antigo (ERP, compartilhado):** `ctntlgvoefdbjxvfkahp` ("concrem")
- **Edge Functions no novo:** `verificar-turnstile`, `admin-criar-usuario`, `admin-reset-senha`
- **FDW:** server `erp_test` no novo → conecta no antigo (`postgres`)

## 7. Pendências / limpezas opcionais

- [ ] **Performance**: queries do ERP passam pelo FDW (mais lentas que local). Monitorar Dashboard e o `count` exato de Pedidos; otimizar se necessário.
- [ ] **Revogar `anon` no banco antigo**: as tabelas `concrem_*` ainda têm `grant select to anon` no antigo (de antes). Como o frontend não usa mais a anon key antiga, dá pra revogar — **conferir antes se a outra app não depende disso**.
- [ ] **Operador e pedidos**: hoje operador sem rep codes vê 0 pedidos (comportamento mantido). Se precisar que veja tudo, adicionar `or app_is_operador()` nas views de pedidos/status.
- [ ] **Aposentar o que sobrou**: tabelas/serviços legados (`clientes`, `titulos`, `pedidos` mock), e as funções/projeto antigos quando não forem mais necessários.
- [ ] **Rotacionar senhas** dos bancos que apareceram em texto claro durante a migração.

## 8. Lições (armadilhas que apareceram)

- No **SQL Editor**, "Run" executa só o texto **selecionado** — várias falhas foram execução parcial (slug `super-action`, `import` não rodado, `s` solto).
- Slug de Edge Function = nome na criação (não o "Name" exibido); é **imutável** (recriar para corrigir).
- `concremapprep_usuarios` no banco novo **não tem coluna `senha`** (senha vive em `auth.users`) → excluir do dump de dados.
- Não chamar `supabase.from(...)` **dentro** do callback de `onAuthStateChange` (deadlock do lock de auth).
- Edge Functions: subir com `--no-verify-jwt` e validar auth no código (senão o preflight CORS quebra).
- FDW Supabase↔Supabase **funciona**; precisa da senha real do `postgres` no `user mapping`.
