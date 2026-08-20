-- ============================================================================
-- 20260819000300 — Fonte única de escopo do usuário autenticado
-- ----------------------------------------------------------------------------
-- Etapa E1 do docs/PLANO-DASHBOARD-RPC.md.
--
-- POR QUE EXISTE
-- As futuras RPCs vão consultar `erp.*` DIRETAMENTE, para que os predicados
-- fiquem puramente empurráveis e o FDW mande filtro e agregação ao ERP (medido
-- em A4, M0, M1 e E0). Ao pular a view, elas perdem a única proteção de escopo
-- existente — foreign table NÃO tem RLS.
--
-- Esta função passa a ser a ÚNICA fonte de verdade sobre "o que este usuário
-- pode ver". Nenhuma RPC deve reimplementar essa lógica.
--
-- REGRA DE FALHA SEGURA
-- Ausência de vínculo NUNCA significa "sem filtro". Sem escopo → tem_escopo
-- falso → a RPC chamadora devolve conjunto vazio.
--
-- SUPERFÍCIE DE ATAQUE
-- A função NÃO recebe parâmetro nenhum. Não há entrada do cliente para validar,
-- escapar ou desconfiar: o escopo vem inteiramente do JWT da sessão.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ
-- Não altera a view `public.concrem_pedidos_venda`, não altera RLS, não altera
-- policy, não cria RPC de negócio, não mexe no frontend. As divergências A12,
-- A13 e A14 continuam valendo para a view — ver docs/PLANO-SANEAMENTO.md.
--
-- ROLLBACK
--   drop function if exists public.app_escopo_atual();
-- ============================================================================

create or replace function public.app_escopo_atual()
returns table (
  perfil          text,     -- perfil efetivo; 'sem_acesso' quando não há usuário válido
  is_global       boolean,  -- admin ou diretor_geral
  representantes  text[],   -- códigos do ERP vinculados (vazio quando não houver)
  grupos          text[],   -- nomes NORMALIZADOS dos grupos (upper + btrim)
  tem_escopo      boolean   -- false ⇒ o chamador DEVE devolver vazio
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_perfil text;
  v_reps   text[] := '{}';
  v_grupos text[] := '{}';
begin
  -- Padrão restritivo: é isto que sai se qualquer coisa falhar no caminho.
  perfil         := 'sem_acesso';
  is_global      := false;
  representantes := '{}';
  grupos         := '{}';
  tem_escopo     := false;

  -- Sem JWT (ex.: anon, ou chamada sem sessão) → sem escopo.
  if v_uid is null then
    return next;
    return;
  end if;

  -- ── PERFIL EFETIVO (regra A12, sem ambiguidade) ──────────────────────────
  -- A coluna `perfil` DECIDE. Os flags `admin`/`operador` só são consultados
  -- quando `perfil` é NULL ou string vazia — nunca competem com ela.
  --
  --   perfil='diretor'  + admin=true   → 'diretor'  (a coluna vence)
  --   perfil='admin'    + admin=false  → 'admin'    (a coluna vence)
  --   perfil=NULL       + admin=true   → 'admin'    (fallback de migração)
  --   perfil=NULL       + operador=true→ 'operador' (fallback de migração)
  --   perfil=NULL       + nenhum flag  → 'representante'
  --
  -- É exatamente `perfilDoUsuario` de src/constants/perfis.ts, que é a fonte de
  -- verdade do aplicativo e está coberta por teste automatizado.
  -- DIFERE de `app_is_admin()`, que lê só o flag — ver achado A12.
  --
  -- `u.ativo is true` é deliberado (achado A13): usuário desativado no portal
  -- não tem escopo, qualquer que seja o perfil, o flag, os representantes ou os
  -- grupos. `ativo` é NOT NULL, então `is true` cobre todos os casos possíveis.
  select coalesce(
           nullif(btrim(u.perfil), ''),
           case when u.admin    then 'admin'
                when u.operador then 'operador'
                else 'representante'
           end)
    into v_perfil
  from public.concremapprep_usuarios u
  where u.id = v_uid
    and u.ativo is true;

  -- Usuário inexistente OU inativo → nenhuma linha → v_perfil nulo → sem escopo.
  if v_perfil is null then
    return next;
    return;
  end if;

  -- ── REPRESENTANTES VINCULADOS ────────────────────────────────────────────
  -- NÃO filtra por `r.ativo` DE PROPÓSITO: preserva o comportamento atual de
  -- `app_my_rep_codes()`. Se representante inativo deve perder escopo, é
  -- decisão de negócio — achado A14, registrado e não alterado aqui.
  select coalesce(array_agg(distinct r.representante_erp), '{}')
    into v_reps
  from public.concremapprep_usuario_representantes ur
  join public.concremapprep_representantes r on r.id = ur.representante_id
  where ur.usuario_id = v_uid
    and r.representante_erp is not null
    and btrim(r.representante_erp) <> '';

  -- ── GRUPOS DO DIRETOR ────────────────────────────────────────────────────
  -- Nomes já NORMALIZADOS (upper + btrim), como em client_groups.normalized_name.
  -- Quem consumir deve normalizar `grupo_cliente` do mesmo jeito — e usando
  -- funções BUILT-IN (upper/btrim/coalesce), nunca `app_norm_grupo()`, que é
  -- local e quebraria o pushdown do FDW.
  -- Só grupos ativos.
  select coalesce(array_agg(distinct cg.normalized_name), '{}')
    into v_grupos
  from public.user_client_groups ucg
  join public.client_groups cg on cg.id = ucg.client_group_id
  where ucg.user_id = v_uid
    and cg.is_active is true;

  -- ── RESULTADO ────────────────────────────────────────────────────────────
  perfil         := v_perfil;
  is_global      := v_perfil in ('admin', 'diretor_geral');
  representantes := v_reps;
  grupos         := v_grupos;

  -- Tem escopo quem enxerga tudo, quem tem representante, ou quem tem grupo.
  --
  -- Comportamento por perfil:
  --   admin / diretor_geral → is_global=true,  tem_escopo=true
  --   diretor               → grupos vinculados; sem grupo e sem rep ⇒ VAZIO
  --   representante         → seus rep codes;   sem rep            ⇒ VAZIO
  --   operador              → tratado como representante (decisão D3:
  --                           operador sem rep codes vê 0 pedidos) ⇒ VAZIO
  --
  -- Em NENHUM caso a ausência de vínculo produz acesso global.
  tem_escopo := is_global
                or coalesce(array_length(v_reps, 1), 0) > 0
                or coalesce(array_length(v_grupos, 1), 0) > 0;

  return next;
end;
$$;

comment on function public.app_escopo_atual() is
  'Fonte única do escopo do usuário autenticado. Nenhuma RPC deve reimplementar esta lógica. '
  'tem_escopo=false obriga o chamador a devolver conjunto vazio.';

-- ============================================================================
-- PRIVILÉGIOS — mínimo possível
-- ----------------------------------------------------------------------------
-- No PostgreSQL, EXECUTE é concedido a PUBLIC por padrão em toda função nova.
-- Revogar é OBRIGATÓRIO, não zelo extra.
--
-- O frontend NÃO chama esta função: ela é infraestrutura interna. As RPCs de
-- negócio serão `security definer` de dono `postgres` e a executam com os
-- privilégios do dono — sem precisar de grant para o cliente.
--
-- `auth.uid()` continua funcionando dentro de SECURITY DEFINER porque lê a claim
-- do JWT da SESSÃO (request.jwt.claims), não o papel corrente.
-- ============================================================================

revoke all on function public.app_escopo_atual() from public;
revoke all on function public.app_escopo_atual() from anon;
revoke all on function public.app_escopo_atual() from authenticated;
