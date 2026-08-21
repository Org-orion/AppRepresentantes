-- ============================================================================
-- 20260819000400 — RPC de série diária do dashboard
-- ----------------------------------------------------------------------------
-- Etapa E2 do docs/PLANO-DASHBOARD-RPC.md. Primeira RPC de negócio a consultar
-- `erp.*` DIRETAMENTE, pulando a view — para que filtro e agregação desçam ao
-- ERP pelo FDW, em vez de trafegar 31 mil linhas e agregar no navegador.
--
-- ════════════════════════════════════════════════════════════════════════════
-- MEDIÇÕES QUE SUSTENTAM ESTE ARQUIVO (E2-0, somente EXPLAIN, sem ANALYZE)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── Normalização de grupo ───────────────────────────────────────────────────
--   N1   coalesce(nullif(upper(btrim(grupo_cliente)),''),'SEM GRUPO')  REPROVADO
--        Filtro caiu em `Filter` local, GroupAggregate local, Remote SQL trouxe
--        linhas cruas.
--   N1a  grupo_cliente cru .......................................... PASSOU
--   N1b  btrim(grupo_cliente) ...................................... PASSOU
--   N1c  upper(grupo_cliente) ...................................... PASSOU
--   N1d  upper(btrim(grupo_cliente)) ............................... PASSOU
--   N1e  nullif(upper(btrim(grupo_cliente)),'') .................... REPROVADO
--   N1f  CASE equivalente .......................................... PASSOU
--
--   CONCLUSÃO: o bloqueio é do NULLIF, NÃO das funções de texto. As três
--   funções descem sozinhas e compostas. Achado A15.
--
-- ── Efeito do ORDER BY sob generic plan ─────────────────────────────────────
--   N5   ramo C completo, parametrizado, COM order by ............... REPROVADO
--        Filtros continuaram remotos; SÓ a agregação voltou para local.
--   N5b  o MESMO, SEM order by ..................................... PASSOU
--
--   CONCLUSÃO: `order by` na mesma consulta agregada contra foreign table
--   derruba o aggregate pushdown. Achado A16.
--
-- ── Forma final de cada ramo (todos generic plan, todos SEM order by) ───────
--   A1  global sem p_representante ....................... N9  PASSOU
--   A2  global com p_representante ....................... N6  PASSOU
--   B   somente rep codes ................................ N7c PASSOU
--   C   rep codes + grupos (OR) .......................... N5b PASSOU
--   Bg  somente grupos ................................... N8  PASSOU
--   N2  OR entre rep-array e CASE-grupo .................. PASSOU
--   N3  REP_EXCLUIDOS via `<> ALL` ....................... PASSOU
--   N4  ramo C completo com literais ..................... PASSOU
--
-- ── Pré-checks (executados antes desta migration) ───────────────────────────
--   P-A  TIPOS confirmados em information_schema:
--          total_pedido_venda = numeric   → `sum()` devolve numeric ✔ contrato
--          data_emissao       = date      → `dia` sai cru, sem cast ✔
--          id_nota_conf       = integer   → casa com array[int] ✔
--          representante      = text      ✔
--          grupo_cliente      = text      ✔
--        Sem cast em lugar nenhum. Cast alteraria a forma medida.
--
--   P-B  Os 10 client_groups ATIVOS já estão em upper/trim E casam com valores
--        existentes no ERP. Era o risco mais grave da E2: formato divergente
--        faria o ramo do diretor devolver ZERO em silêncio, indistinguível de
--        zero legítimo. NÃO ocorre.
--
--   P-C  Existe EXATAMENTE 1 grupo chamado 'SEM GRUPO'. Portanto o ramo `else`
--        do CASE NÃO é decorativo: pedidos com grupo_cliente nulo ou em branco
--        são de fato visíveis ao diretor vinculado a esse grupo. Comportamento
--        DELIBERADO e conferido.
--
--   P-D  statement_timeout por papel:
--          authenticated .... 8s
--          anon ............. 3s
--          postgres ......... sem valor explícito em rolconfig
--        `SECURITY DEFINER` NÃO troca GUC de sessão: o timeout do papel que
--        CONECTOU continua valendo. O frontend conecta como `authenticated`,
--        logo o teto real é 8s.
--        DECISÃO DESTA ETAPA: NÃO mexer em statement_timeout aqui. Só
--        documentar. Duração real é medida na E3 (teste T8).
--
-- ════════════════════════════════════════════════════════════════════════════
-- DUAS PROIBIÇÕES QUE NÃO PODEM SER VIOLADAS EM NENHUMA RPC CONTRA `erp.*`
-- ════════════════════════════════════════════════════════════════════════════
--   1. NUNCA `nullif`/`coalesce` sobre coluna do ERP dentro do WHERE. Use CASE.
--   2. NUNCA `order by` na mesma consulta agregada. Quem ordena é o cliente.
--
-- ── APLICAÇÃO ATÔMICA ───────────────────────────────────────────────────────
-- Tudo entre BEGIN e COMMIT: função, owner, comentário, revokes e grant entram
-- juntos ou não entram. Elimina o estado perigoso de função criada com EXECUTE
-- ainda em PUBLIC. No SQL Editor, SELECIONE TUDO antes do Run — ele executa
-- apenas o trecho selecionado quando há seleção.
--
-- ROLLBACK
--   drop function if exists public.app_dashboard_serie_diaria(date, date, text);
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
  -- O ERP é PRO e COMPARTILHADO com outra aplicação. Consulta malformada não
  -- chega lá.
  --
  -- Entrada inválida LEVANTA EXCEÇÃO em vez de devolver vazio, de propósito:
  -- vazio vira R$ 0,00 na tela, INDISTINGUÍVEL de zero legítimo — que é a
  -- assinatura exata do defeito D-2. Erro de programação tem que aparecer.
  if p_data_inicio is null or p_data_fim is null then
    raise exception 'app_dashboard_serie_diaria: p_data_inicio e p_data_fim são obrigatórios'
      using errcode = '22004';
  end if;

  if p_data_inicio > p_data_fim then
    raise exception 'app_dashboard_serie_diaria: p_data_inicio (%) maior que p_data_fim (%)',
      p_data_inicio, p_data_fim using errcode = '22007';
  end if;

  -- TETO DE JANELA — derivado do `Max rows = 1000` do PostgREST, não arbitrário.
  -- O limite vale TAMBÉM para RPC `returns setof`. Esta função devolve até uma
  -- linha por dia; acima de ~1000 dias o PostgREST TRUNCA em silêncio e a RPC
  -- reintroduz exatamente a pendência que veio matar.
  -- 730 dias = 2 anos = no máximo 731 linhas. Achado A17.
  if p_data_fim - p_data_inicio > 730 then
    raise exception
      'app_dashboard_serie_diaria: janela de % dias excede o máximo de 730 (limite Max rows do PostgREST)',
      p_data_fim - p_data_inicio using errcode = '22023';
  end if;

  -- Normalização do parâmetro em VARIÁVEL LOCAL, nunca sobre coluna do ERP.
  -- `nullif` aqui é inofensivo: não entra no WHERE contra a foreign table,
  -- então não afeta pushdown (a proibição vale para coluna, não para parâmetro).
  v_rep := nullif(btrim(p_representante), '');

  -- ══ 2. ESCOPO — fonte única, sem reimplementação ══════════════════════════
  -- O cliente NÃO fornece escopo. A assinatura não tem parâmetro de array de
  -- representante nem de grupo: não há o que injetar. Tudo vem do JWT.
  --
  -- Esta função é `security definer` de dono `postgres`; app_escopo_atual()
  -- também é de `postgres`. O DONO conserva EXECUTE mesmo depois dos revokes
  -- da E1 — é por isso que a chamada funciona daqui.
  --
  -- ACL REAL DA E1 (validada quando a migration 20260819000300 foi aplicada):
  --     postgres ....... EXECUTE (owner)
  --     service_role ... EXECUTE
  --     authenticated .. SEM EXECUTE
  --     anon ........... SEM EXECUTE
  --     PUBLIC ......... SEM EXECUTE
  --
  -- Ou seja: o cliente do FRONTEND (`anon`/`authenticated`) não alcança
  -- app_escopo_atual(); `service_role` alcança. Isso é inofensivo — a função
  -- deriva tudo de `auth.uid()`, que lê a claim `sub` do JWT da sessão. Uma
  -- chamada com a chave de serviço não carrega `sub`, logo `auth.uid()` é nulo
  -- e o retorno é 'sem_acesso'. Não há como service_role obter o escopo de
  -- terceiros por essa via.
  select e.perfil, e.is_global, e.representantes, e.grupos, e.tem_escopo
    into v_perfil, v_is_global, v_reps, v_grupos, v_tem_escopo
  from public.app_escopo_atual() e;

  -- `is not true` cobre false E null. Sem escopo ⇒ vazio, ERP nem é tocado.
  if v_tem_escopo is not true then
    return;
  end if;

  -- ══ 3. RAMO A — global (admin, diretor_geral) ═════════════════════════════
  -- Único ramo em que p_representante é considerado, e mesmo assim só ESTREITA.
  --
  -- Dois sub-ramos EXPLÍCITOS em vez de `(v_rep is null or v.representante = v_rep)`:
  -- sob generic plan o `is null` NÃO é dobrado como constante, e as formas
  -- medidas (N9 e N6) são as INCONDICIONAIS. Não se implementa forma não medida.
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
      and case
            when v.grupo_cliente is null or btrim(v.grupo_cliente) = ''
              then 'SEM GRUPO'
            else upper(btrim(v.grupo_cliente))
          end = any (v_grupos)
    group by v.data_emissao;

  else
    -- INALCANÇÁVEL hoje: tem_escopo=true exige reps OU grupos.
    -- Existe mesmo assim. Se o contrato da E1 mudar um dia, o padrão continua
    -- sendo NEGAR — e não cair sem querer num ramo mais amplo.
    return;
  end if;

end;
$$;

-- ============================================================================
-- OWNER — explícito, não herdado
-- ----------------------------------------------------------------------------
-- `SECURITY DEFINER` executa com os privilégios do DONO. Numa função que lê
-- `erp.*` SEM RLS, o dono é parte do modelo de segurança, não detalhe
-- administrativo.
--
-- `create or replace` PRESERVA o dono de uma versão anterior. Sem este `alter`,
-- reaplicar a migration sobre uma função criada por outro papel deixaria o dono
-- errado — silenciosamente, e sem aparecer no arquivo.
--
-- MUDANÇA DELIBERADA EM RELAÇÃO À E1, onde eu argumentei o contrário: lá o
-- receio era o `alter` FALHAR se aplicado por papel não-membro de `postgres`.
-- Aqui isso é a VANTAGEM. Uma migration que falha alto é melhor do que uma
-- função que roda com privilégios errados em silêncio. No SQL Editor do
-- Supabase roda como `postgres` e o `alter` é no-op.
-- ============================================================================

alter function public.app_dashboard_serie_diaria(date, date, text) owner to postgres;

comment on function public.app_dashboard_serie_diaria(date, date, text) is
  'Série diária agregada de pedidos do ERP, com escopo aplicado no servidor. '
  'NÃO garante ordenação das linhas: `order by` derruba o aggregate pushdown do '
  'postgres_fdw sob generic plan (medido no E2-0/N5). Ordene no cliente. '
  'Janela máxima 730 dias por causa do Max rows=1000 do PostgREST. '
  'Escopo vem exclusivamente de app_escopo_atual() — o cliente não fornece escopo.';

-- ============================================================================
-- PRIVILÉGIOS — estado final DETERMINÍSTICO
-- ----------------------------------------------------------------------------
-- `create or replace function` PRESERVA a ACL de uma versão anterior. Sem os
-- revokes explícitos abaixo, reaplicar esta migration deixaria privilégios
-- herdados invisíveis no arquivo — o oposto de uma migration idempotente.
--
-- Zerar TUDO primeiro, conceder depois. O estado final não depende do anterior.
-- Os revokes vêm DEPOIS do `alter owner` para que o grantor seja `postgres`.
--
-- ── DUAS FUNÇÕES, DOIS CONTRATOS DE ACL. NÃO HARMONIZAR. ────────────────────
--
--   public.app_escopo_atual()            — E1, JÁ APLICADA E VALIDADA
--     postgres ....... EXECUTE (owner)
--     service_role ... EXECUTE
--     authenticated .. SEM EXECUTE
--     anon ........... SEM EXECUTE
--     PUBLIC ......... SEM EXECUTE
--
--   public.app_dashboard_serie_diaria()  — E2, esta migration
--     postgres ....... EXECUTE (owner)
--     service_role ... SEM EXECUTE      ← decisão específica da E2
--     authenticated .. EXECUTE          ← é o papel do JWT do frontend
--     anon ........... SEM EXECUTE
--     PUBLIC ......... SEM EXECUTE
--
-- A assimetria em `service_role` é DELIBERADA, não descuido:
--   • na E1, `service_role` tem EXECUTE porque ela é infraestrutura e pode ser
--     necessária a uma Edge Function futura;
--   • na E2, NÃO tem, porque hoje nenhuma Edge Function chama esta RPC. Grant
--     se concede quando aparece o consumidor, não por antecipação.
--
-- Esta migration NÃO altera a ACL da E1.
--
-- A propriedade que interessa e que vale nas duas: o cliente do FRONTEND
-- (`anon`/`authenticated`) NÃO consegue chamar app_escopo_atual() para
-- descobrir o próprio escopo — só consumi-lo através de RPCs que já aplicaram
-- o filtro.
-- ============================================================================

revoke all on function public.app_dashboard_serie_diaria(date, date, text) from public;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from anon;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from authenticated;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from service_role;

grant execute on function public.app_dashboard_serie_diaria(date, date, text) to authenticated;

commit;

-- Recarrega o cache de schema do PostgREST para a RPC aparecer na API.
notify pgrst, 'reload schema';
