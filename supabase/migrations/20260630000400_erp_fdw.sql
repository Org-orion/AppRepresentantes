-- ============================================================================
-- 03_erp_fdw.sql — Acesso seguro ao ERP via FDW + RLS (rodar no banco NOVO)
-- ----------------------------------------------------------------------------
-- Os dados do ERP CONTINUAM no banco antigo (alimentados por outra app). O banco
-- novo apenas LÊ ao vivo via postgres_fdw (foreign tables = ponteiros, sem cópia).
-- As views em `public` aplicam RLS: cada representante só vê os próprios pedidos.
-- O app passa a ler tudo do banco novo (1 client) — a anon key antiga sai do front.
--
-- Pré-requisito: o teste de conectividade já passou (server erp_test + user
-- mapping com a senha correta do postgres antigo).
--
-- Reusa o server `erp_test` criado no teste. Se quiser um nome melhor, troque
-- todas as ocorrências de erp_test por erp_server e recrie o server+mapping.
-- ============================================================================

-- ─── 0. Limpeza do teste ────────────────────────────────────────────────────
drop foreign table if exists erp_ping;

-- ─── 1. Foreign tables (schema erp) — importadas do banco antigo ────────────
-- Remove as views dependentes antes de recriar o schema (idempotência).
drop view if exists public.concrem_pedidos_venda            cascade;
drop view if exists public.concrem_pedidos_status           cascade;
drop view if exists public.concrem_pedidos_status_historico cascade;
drop view if exists public.relatorio_entrega_anexos         cascade;
drop view if exists public.concremprodutos_produtos         cascade;

drop schema if exists erp cascade;
create schema erp;

import foreign schema public
  limit to (
    concrem_pedidos_venda,
    concrem_pedidos_status,
    concrem_pedidos_status_historico,
    concrem_relatorio_entrega_anexos,   -- nome real no ERP (o app consulta como relatorio_entrega_anexos)
    concremprodutos_produtos
  )
  from server erp_test into erp;

-- Sanity check (rodar separado): deve retornar ~29269
--   select count(*) from erp.concrem_pedidos_venda;

-- ─── 2. Função auxiliar: rep codes do usuário logado ────────────────────────
create or replace function app_my_rep_codes()
returns setof text
language sql stable security definer set search_path = public as $$
  select r.representante_erp
  from concremapprep_representantes r
  join concremapprep_usuario_representantes ur on ur.representante_id = r.id
  where ur.usuario_id = auth.uid();
$$;
grant execute on function app_my_rep_codes() to authenticated;

-- ─── 3. Views com RLS em public ─────────────────────────────────────────────
-- (app_is_admin() já existe do schema_v2.sql)

-- Pedidos: escopo por representante
create view public.concrem_pedidos_venda with (security_barrier = true) as
  select * from erp.concrem_pedidos_venda v
  where app_is_admin() or v.representante in (select app_my_rep_codes());

-- Status atual: escopo pelos pedidos do usuário (por numero_pedido)
create view public.concrem_pedidos_status with (security_barrier = true) as
  select * from erp.concrem_pedidos_status s
  where app_is_admin() or s.numero_pedido in (
    select v.numero_pedido from erp.concrem_pedidos_venda v
    where v.representante in (select app_my_rep_codes())
  );

-- Histórico de status: idem
create view public.concrem_pedidos_status_historico with (security_barrier = true) as
  select * from erp.concrem_pedidos_status_historico h
  where app_is_admin() or h.numero_pedido in (
    select v.numero_pedido from erp.concrem_pedidos_venda v
    where v.representante in (select app_my_rep_codes())
  );

-- Anexos (NF/boleto): a tabela real no ERP é concrem_relatorio_entrega_anexos;
-- a view mantém o nome que o app consulta (relatorio_entrega_anexos).
-- Escopo por pedido_id (= numero_pedido) do usuário.
create view public.relatorio_entrega_anexos with (security_barrier = true) as
  select * from erp.concrem_relatorio_entrega_anexos a
  where app_is_admin() or a.pedido_id in (
    select v.numero_pedido from erp.concrem_pedidos_venda v
    where v.representante in (select app_my_rep_codes())
  );

-- Produtos: catálogo — qualquer autenticado
create view public.concremprodutos_produtos with (security_barrier = true) as
  select * from erp.concremprodutos_produtos;

-- ─── 4. Grants ──────────────────────────────────────────────────────────────
-- Só as VIEWS são expostas a authenticated. O schema erp (foreign tables) NÃO
-- é concedido a ninguém além do owner — ninguém lê o ERP sem passar pelas views.
grant usage on schema public to authenticated;

grant select on public.concrem_pedidos_venda            to authenticated;
grant select on public.concrem_pedidos_status           to authenticated;
grant select on public.concrem_pedidos_status_historico to authenticated;
grant select on public.relatorio_entrega_anexos         to authenticated;
grant select on public.concremprodutos_produtos         to authenticated;

-- Defensivo: nada de ERP para anon
revoke all on public.concrem_pedidos_venda            from anon;
revoke all on public.concrem_pedidos_status           from anon;
revoke all on public.concrem_pedidos_status_historico from anon;
revoke all on public.relatorio_entrega_anexos         from anon;
revoke all on public.concremprodutos_produtos         from anon;

-- ─── 5. Recarregar o cache de schema do PostgREST ───────────────────────────
notify pgrst, 'reload schema';

-- ============================================================================
-- NOTAS
-- - As views rodam com direitos do OWNER (postgres), que enxerga as foreign
--   tables; `authenticated` só precisa de SELECT nas views. RLS é aplicada pelo
--   filtro auth.uid() dentro das views (não dá pra burlar: erp.* não é exposto).
-- - Não dá pra testar a RLS como `postgres` no SQL Editor (auth.uid() é null →
--   a view retorna 0 linhas). Teste pelo APP, logado como rep e como admin.
-- - Operador (não-admin, sem rep codes) vê 0 pedidos — mesmo comportamento de
--   hoje. Se quiser que operador veja tudo, adicione `or app_is_operador()` nas
--   views de pedidos/status.
-- - Performance: o COUNT exato e os filtros rodam via FDW no banco antigo.
--   Para volumes grandes pode ficar mais lento que ler local; dá pra otimizar
--   depois (índices remotos já existem em representante/data_emissao).
-- ============================================================================
