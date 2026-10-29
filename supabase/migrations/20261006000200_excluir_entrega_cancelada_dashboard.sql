-- ============================================================================
-- Pedido com entrega cancelada sai tambem do dashboard (RPC)
-- ============================================================================
-- Mesma regra do Power BI ja aplicada na view em 20261006000100_excluir_entrega_cancelada.sql
-- (06/10/2026: "SITUACAOENTREGA não é Cancelado"). Achado durante a
-- investigacao da tarefa T-001c: app_dashboard_serie_diaria() le
-- `erp.concrem_pedidos_venda` DIRETO pelo FDW, pulando a view -- nenhum dos
-- ramos tinha o filtro, entao o dashboard seguia somando o pedido cancelado em
-- `totalVendidoMes`, `totalVendidoMesAnt` e `vendasMensais`.
--
-- Esta migration e o complemento previsto desde 20261006000100 (comentario
-- "a RPC ... e ajustada em separado -- ver 20261006000200") e so chega agora.
--
-- O QUE MUDA: em cada ramo de public.app_dashboard_serie_diaria() que agrega
-- sobre erp.concrem_pedidos_venda (A1, A2, C, B, B-grupos), acrescenta-se
-- exatamente a mesma condicao usada na view:
--
--     and (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
--
-- NULL PERMANECE visivel, pelo mesmo motivo da view: a maior parte dos
-- pedidos nao tem situacao preenchida, e descarta-los apagaria metade da
-- base. O casamento e por conteudo (`ilike '%cancelado%'`), nao por
-- igualdade, porque o valor existente no ERP e "Parcialmente Entregue e
-- Cancelado", nao "Cancelado" puro -- ver medicao em 20261006000100.
--
-- NENHUMA OUTRA LOGICA MUDA. Escopo, parametros, ramificacao, colunas
-- devolvidas, ORDER BY (nao ha) e as demais condicoes de cada ramo continuam
-- identicos a 20260819000400_rpc_dashboard_serie_diaria.sql.
--
-- DUAS PROIBICOES QUE CONTINUAM VALENDO (ja documentadas em 20260819000400):
--   1. NUNCA nullif/coalesce sobre coluna do ERP dentro do WHERE -- a condicao
--      acima usa `is null or not ilike`, nao nullif/coalesce, pelo mesmo
--      motivo que a view evitou nullif (achado A15).
--   2. NUNCA order by na mesma consulta agregada (achado A16) -- esta
--      migration nao adiciona order by nenhum.
--
-- ⚠️ NAO MEDIDO VIA EXPLAIN: ao contrario de 20260819000400 (que tem a tabela
-- completa de medicoes N1-N9 que sustentou cada forma), esta migration NAO
-- foi reexecutada com EXPLAIN contra o ERP -- nao ha, hoje, acesso de Backend
-- a um banco de verificacao fora de producao (mesma pergunta em aberto que o
-- Maestro levou a Kaio sobre ambiente de teste). A condicao adicionada e
-- estruturalmente identica a que ja roda na view (mesmo operador, mesma
-- coluna, sem nullif/coalesce), entao o risco de derrubar o pushdown e baixo,
-- mas isso e inferencia, nao medicao. Recomendado reconfirmar com EXPLAIN
-- (generic plan, sem order by) quando esta migration for aplicada num banco
-- de verificacao, antes ou junto da aplicacao em producao.
--
-- Nao aplicar em producao sem autorizacao explicita (Kaio, via Maestro).
-- ============================================================================

begin;

create or replace function public.app_dashboard_serie_diaria(
  p_data_inicio   date,
  p_data_fim      date,
  p_representante text default null
)
returns table (
  dia         date,
  pedidos     bigint,
  valor_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_perfil     text;
  v_is_global  boolean;
  v_reps       text[];
  v_grupos     text[];
  v_tem_escopo boolean;
  v_rep        text;
  v_tem_reps   boolean;
  v_tem_grupos boolean;
begin
  -- ══ 1. VALIDAÇÃO DE ENTRADA — antes de qualquer coisa tocar o ERP ═════════
  if p_data_inicio is null or p_data_fim is null then
    raise exception 'app_dashboard_serie_diaria: p_data_inicio e p_data_fim são obrigatórios'
      using errcode = '22004';
  end if;

  if p_data_inicio > p_data_fim then
    raise exception 'app_dashboard_serie_diaria: p_data_inicio (%) maior que p_data_fim (%)',
      p_data_inicio, p_data_fim using errcode = '22007';
  end if;

  -- TETO DE JANELA — derivado do `Max rows = 1000` do PostgREST (achado A17).
  if p_data_fim - p_data_inicio > 730 then
    raise exception
      'app_dashboard_serie_diaria: janela de % dias excede o máximo de 730 (limite Max rows do PostgREST)',
      p_data_fim - p_data_inicio using errcode = '22023';
  end if;

  v_rep := nullif(btrim(p_representante), '');

  -- ══ 2. ESCOPO — fonte única, sem reimplementação ══════════════════════════
  select e.perfil, e.is_global, e.representantes, e.grupos, e.tem_escopo
    into v_perfil, v_is_global, v_reps, v_grupos, v_tem_escopo
  from public.app_escopo_atual() e;

  if v_tem_escopo is not true then
    return;
  end if;

  -- ══ 3. RAMO A — global (admin, diretor_geral) ═════════════════════════════
  if v_is_global is true then

    if v_rep is null then
      -- ── A1 — global, sem filtro de representante ── medido em N9 ──
      return query
      select v.data_emissao, count(*), sum(v.total_pedido_venda)
      from erp.concrem_pedidos_venda v
      where v.id_nota_conf   = any (array[307,309,613,665])
        and v.data_emissao  >= p_data_inicio
        and v.data_emissao  <= p_data_fim
        and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
        -- Pedido com entrega cancelada sai do dashboard, mesma regra da view
        -- (20261006000100 / achado T-001c).
        and (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
      group by v.data_emissao;
    else
      -- ── A2 — global, estreitado por p_representante ── medido em N6 ──
      return query
      select v.data_emissao, count(*), sum(v.total_pedido_venda)
      from erp.concrem_pedidos_venda v
      where v.id_nota_conf   = any (array[307,309,613,665])
        and v.data_emissao  >= p_data_inicio
        and v.data_emissao  <= p_data_fim
        and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
        and (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
        and v.representante  = v_rep
      group by v.data_emissao;
    end if;

    return;
  end if;

  -- ══ 4. NÃO-GLOBAL ═════════════════════════════════════════════════════════
  -- Daqui para baixo p_representante é IGNORADO, deliberadamente.
  -- Aceitá-lo não ampliaria escopo (o filtro é sempre ADICIONAL), mas a UX atual
  -- só oferece o seletor a perfis globais (DashboardPage.tsx:797, verificado em
  -- D-5). Ignorar preserva o comportamento exato de hoje.
  --
  -- Ramificação EXPLÍCITA por conteúdo dos arrays. Nunca `= any('{}')` para
  -- decidir fluxo: é semanticamente seguro (dá FALSE, nunca TRUE, inclusive
  -- para NULL), mas gera round-trip ao ERP que não pode casar com nada, e numa
  -- FORMA NÃO MEDIDA. Cada ramo abaixo é exatamente uma forma medida.
  v_tem_reps   := coalesce(array_length(v_reps,   1), 0) > 0;
  v_tem_grupos := coalesce(array_length(v_grupos, 1), 0) > 0;

  if v_tem_reps and v_tem_grupos then
    -- ── C — diretor com rep codes E grupos ── medido em N5b (e N4 com literais) ──
    -- O OR reproduz o que a view faz hoje: o diretor enxerga os pedidos dos
    -- seus rep codes OU os pedidos dos seus grupos.
    --
    -- O CASE é a normalização MEDIDA (N1f, N2, N4, N5b). Trocar por
    -- `nullif`/`coalesce` DERRUBA o pushdown — medido em N1e. NÃO TROCAR.
    return query
    select v.data_emissao, count(*), sum(v.total_pedido_venda)
    from erp.concrem_pedidos_venda v
    where v.id_nota_conf   = any (array[307,309,613,665])
      and v.data_emissao  >= p_data_inicio
      and v.data_emissao  <= p_data_fim
      and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
      and (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
      and ( v.representante = any (v_reps)
            or case
                 when v.grupo_cliente is null or btrim(v.grupo_cliente) = ''
                   then 'SEM GRUPO'
                 else upper(btrim(v.grupo_cliente))
               end = any (v_grupos) )
    group by v.data_emissao;

  elsif v_tem_reps then
    -- ── B — representante, operador, ou diretor só com rep codes ── medido em N7c ──
    return query
    select v.data_emissao, count(*), sum(v.total_pedido_venda)
    from erp.concrem_pedidos_venda v
    where v.id_nota_conf   = any (array[307,309,613,665])
      and v.data_emissao  >= p_data_inicio
      and v.data_emissao  <= p_data_fim
      and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
      and (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
      and v.representante  = any (v_reps)
    group by v.data_emissao;

  elsif v_tem_grupos then
    -- ── B-grupos — diretor SÓ com grupos, nenhum rep code ── medido em N8 ──
    -- Aggregate pushdown remoto confirmado em generic plan, sem order by.
    return query
    select v.data_emissao, count(*), sum(v.total_pedido_venda)
    from erp.concrem_pedidos_venda v
    where v.id_nota_conf   = any (array[307,309,613,665])
      and v.data_emissao  >= p_data_inicio
      and v.data_emissao  <= p_data_fim
      and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
      and (v.situacao_entrega is null or v.situacao_entrega not ilike '%cancelado%')
      and case
            when v.grupo_cliente is null or btrim(v.grupo_cliente) = ''
              then 'SEM GRUPO'
            else upper(btrim(v.grupo_cliente))
          end = any (v_grupos)
    group by v.data_emissao;

  else
    -- INALCANÇÁVEL hoje: tem_escopo=true exige reps OU grupos.
    return;
  end if;

end;
$$;

-- ============================================================================
-- OWNER, COMENTÁRIO E PRIVILÉGIOS — repetidos por completo, de proposito
-- ----------------------------------------------------------------------------
-- `create or replace function` PRESERVA dono e ACL da versao anterior; sem
-- repetir estes blocos o estado final dependeria do que ja estava la, o
-- oposto de uma migration deterministica. Mesmo padrao de 20260819000400.
-- ============================================================================

alter function public.app_dashboard_serie_diaria(date, date, text) owner to postgres;

comment on function public.app_dashboard_serie_diaria(date, date, text) is
  'Série diária agregada de pedidos do ERP, com escopo aplicado no servidor. '
  'Exclui pedidos com entrega cancelada (situacao_entrega ilike ''%cancelado%''), '
  'mesma regra aplicada na view concrem_pedidos_venda — ver 20261006000200. '
  'NÃO garante ordenação das linhas: `order by` derruba o aggregate pushdown do '
  'postgres_fdw sob generic plan (medido no E2-0/N5). Ordene no cliente. '
  'Janela máxima 730 dias por causa do Max rows=1000 do PostgREST. '
  'Escopo vem exclusivamente de app_escopo_atual() — o cliente não fornece escopo.';

revoke all on function public.app_dashboard_serie_diaria(date, date, text) from public;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from anon;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from authenticated;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from service_role;

grant execute on function public.app_dashboard_serie_diaria(date, date, text) to authenticated;

commit;

-- Recarrega o cache de schema do PostgREST para a RPC aparecer na API.
notify pgrst, 'reload schema';

-- ROLLBACK
--   Reaplicar o CREATE OR REPLACE FUNCTION de
--   20260819000400_rpc_dashboard_serie_diaria.sql (sem o filtro de
--   situacao_entrega) restaura o comportamento anterior.
