-- ============================================================================
-- Restaurar security_barrier nas views do ERP (achado A10)
-- ============================================================================
-- A migration 20260630000400_erp_fdw.sql criou as 5 views sobre o FDW do ERP
-- com `with (security_barrier = true)`. A migration 20260706000100_diretores_e_grupos.sql
-- recriou 4 delas com `create or replace view ... as` SEM repetir o `with (...)`,
-- e a opção não sobreviveu ao `create or replace` -- reloptions ficou `null`
-- (confirmado no catálogo para concrem_pedidos_venda). `concremprodutos_produtos`
-- não foi tocada por aquela migration nem por nenhuma depois dela, então segue
-- com a opção intacta; não precisa de correção.
--
-- Por que importa: sem security_barrier, o planejador do Postgres pode empurrar
-- (pushdown) uma função ou operador vindo de fora da view -- por exemplo um
-- operador de comparação leaky numa cláusula WHERE externa -- para rodar ANTES
-- do filtro de escopo (app_is_admin/app_perfil/app_diretor_ve_grupo/
-- app_my_rep_codes) definido dentro da view. Isso abre um canal para inferir
-- dado fora do escopo do usuário via efeito colateral (erro, tempo de resposta)
-- de uma função maliciosa aplicada a uma coluna sensível antes do filtro
-- descartar a linha. Com security_barrier = true, o planejador é obrigado a
-- resolver o WHERE da view (o filtro de escopo) antes de qualquer qualifier
-- vindo de fora -- exceto para função ou operador marcado LEAKPROOF, que o
-- Postgres sabe não ter efeito colateral observável e pode seguir empurrando
-- mesmo com a barreira; isso não é uma brecha, é a exceção documentada da
-- própria regra.
--
-- Esta migration só adiciona de volta a opção perdida nas 3 views abaixo. NÃO
-- reverte para a definição antiga de 20260630000400_erp_fdw.sql (sem os
-- perfis diretor/diretor_geral) -- as definições abaixo são cópia linha a
-- linha do SELECT e do WHERE tal como estão hoje em
-- 20260706000100_diretores_e_grupos.sql, só com `with (security_barrier = true)`
-- adicionado de volta.
--
-- `concrem_pedidos_venda` (a 4ª view afetada pelo achado A10) NÃO é tratada
-- aqui. Ela é recriada de novo, depois de 20260706000100, pela migration
-- 20261006000100_excluir_entrega_cancelada.sql (que acrescenta o filtro de
-- `situacao_entrega` e também não repete o `with (...)`) -- migration essa
-- que, no momento em que este arquivo foi escrito, ainda não tinha sido
-- aplicada nem commitada. Por decisão do
-- Kaio (29/10/2026), essa view é corrigida na origem: o `with (security_barrier
-- = true)` vai direto em 20261006000100_excluir_entrega_cancelada.sql, não
-- aqui -- assim a migration que recria a view já nasce com a opção, sem
-- depender de uma segunda migration posterior para fechar o achado.
--
-- ⚠️ ARMADILHA QUE CAUSOU O ACHADO A10: `create or replace view` NÃO preserva
-- `security_barrier` -- a opção precisa ser repetida em TODO `create or replace
-- view` futuro destas views, ou ela se perde de novo, em silêncio, sem erro
-- nem aviso. Antes de recriar qualquer uma destas 5 views, confira que o
-- `with (security_barrier = true)` está na nova definição.
--
-- Não aplicar em produção sem autorização explícita (Kaio, via Maestro).
-- ============================================================================

begin;

-- concrem_pedidos_status — definição atual: 20260706000100_diretores_e_grupos.sql (inalterada desde então)
create or replace view public.concrem_pedidos_status
  with (security_barrier = true) as
  select id, pedido_id, numero_pedido, status_atual, atualizado_em, atualizado_por,
    criado_em, mes_programacao, data_embarque_programacao
  from erp.concrem_pedidos_status s
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (numero_pedido in ( select v.numero_pedido from erp.concrem_pedidos_venda v
          where v.representante in ( select app_my_rep_codes() ) ))
     or (app_perfil() = 'diretor' and numero_pedido in ( select v.numero_pedido
          from erp.concrem_pedidos_venda v where app_diretor_ve_grupo(v.grupo_cliente) ));

-- concrem_pedidos_status_historico — definição atual: 20260706000100_diretores_e_grupos.sql (inalterada desde então)
create or replace view public.concrem_pedidos_status_historico
  with (security_barrier = true) as
  select id, pedido_id, numero_pedido, status_anterior, status_novo, alterado_em,
    alterado_por, observacao, notificado_representante, notificado_em,
    notificacao_provider_id, notificacao_erro
  from erp.concrem_pedidos_status_historico h
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (numero_pedido in ( select v.numero_pedido from erp.concrem_pedidos_venda v
          where v.representante in ( select app_my_rep_codes() ) ))
     or (app_perfil() = 'diretor' and numero_pedido in ( select v.numero_pedido
          from erp.concrem_pedidos_venda v where app_diretor_ve_grupo(v.grupo_cliente) ));

-- relatorio_entrega_anexos — definição atual: 20260706000100_diretores_e_grupos.sql (inalterada desde então)
create or replace view public.relatorio_entrega_anexos
  with (security_barrier = true) as
  select id, carregamento_id, pedido_id, tipo, arquivo_nome, arquivo_url,
    criado_em, criado_por
  from erp.concrem_relatorio_entrega_anexos a
  where app_is_admin()
     or app_perfil() = 'diretor_geral'
     or (pedido_id in ( select v.numero_pedido from erp.concrem_pedidos_venda v
          where v.representante in ( select app_my_rep_codes() ) ))
     or (app_perfil() = 'diretor' and pedido_id in ( select v.numero_pedido
          from erp.concrem_pedidos_venda v where app_diretor_ve_grupo(v.grupo_cliente) ));

-- concremprodutos_produtos: não recriada por esta migration -- nunca perdeu a
-- opção (nenhuma migration a recria desde 20260630000400_erp_fdw.sql).
--
-- concrem_pedidos_venda: não recriada por esta migration -- corrigida na
-- origem em 20261006000100_excluir_entrega_cancelada.sql (ver nota no topo
-- deste arquivo).

commit;

-- Verificação (rodar separado, como postgres, em dev/local -- nunca produção
-- sem autorização). As 5 views devem ter security_barrier=true: as 3 por esta
-- migration, concremprodutos_produtos por nunca ter perdido a opção, e
-- concrem_pedidos_venda por 20261006000100_excluir_entrega_cancelada.sql:
--   select relname, reloptions
--   from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in (
--       'concrem_pedidos_venda', 'concrem_pedidos_status',
--       'concrem_pedidos_status_historico', 'relatorio_entrega_anexos',
--       'concremprodutos_produtos'
--     );
--   -- esperado: reloptions = {security_barrier=true} nas 5 linhas
-- ============================================================================
