-- ============================================================================
-- 20260819000300 — Fonte única de escopo do usuário autenticado
-- ----------------------------------------------------------------------------
-- Etapa E1 do docs/PLANO-DASHBOARD-RPC.md.
--
-- POR QUE EXISTE
-- As futuras RPCs vão consultar `erp.*` DIRETAMENTE, para que os predicados
-- fiquem puramente empurráveis e o FDW consiga mandar filtro e agregação ao ERP
-- (medido em A4, M0, M1 e E0). Só que, ao pular a view, elas perdem a única
-- proteção de escopo que existe hoje — foreign table NÃO tem RLS.
--
-- Esta função passa a ser a ÚNICA fonte de verdade sobre "o que este usuário
-- pode ver". Nenhuma RPC deve reimplementar essa lógica.
--
-- REGRA DE FALHA SEGURA
-- Ausência de vínculo NUNCA significa "sem filtro". Sem escopo → `tem_escopo`
-- falso → a RPC chamadora devolve conjunto vazio.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ
-- Não altera a view `public.concrem_pedidos_venda`, não altera RLS, não altera
-- policy, não cria RPC de negócio. As divergências que ela corrige continuam
-- valendo para a view — ver docs/PLANO-SANEAMENTO.md, achados A12 a A14.
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
  -- Padrão restritivo: se qualquer coisa der errado no caminho, é isto que sai.
  perfil         := 'sem_acesso';
  is_global      := false;
  representantes := '{}';
  grupos         := '{}';
  tem_escopo     := false;

  -- Sem JWT (ex.: anon) → sem escopo.
  if v_uid is null then
    return next;
    return;
  end if;

  -- Perfil efetivo. A coluna `perfil` é a fonte de verdade; os flags
  -- admin/operador são FALLBACK de compatibilidade da migração de junho.
  -- Esta é exatamente a regra de src/constants/perfis.ts (perfilDoUsuario),
  -- e é DIFERENTE do que app_is_admin() faz hoje — ver achado A12.
  --
  -- `ativo is true` é deliberado: usuário desativado no portal perde o escopo.
  -- Hoje nada faz isso, nem no app nem no banco — ver achado A13.
  select coalesce(
           nullif(btrim(u.perfil), ''),
           case when u.admin    then 'admin'
                when u.operador then 'operador'
                else 'representante'
           end)
    into v_perfil
  from concremapprep_usuarios u
  where u.id = v_uid
    and u.ativo is true;

  -- Usuário inexistente, inativo, ou sem linha de perfil → sem escopo.
  if v_perfil is null then
    return next;
    return;
  end if;

  -- Códigos de representante vinculados.
  -- NÃO filtra por `r.ativo` de propósito: preservar o comportamento atual.
  -- Se representante inativo deve perder o escopo, é decisão de negócio — A14.
  select coalesce(array_agg(distinct r.representante_erp), '{}')
    into v_reps
  from concremapprep_usuario_representantes ur
  join concremapprep_representantes r on r.id = ur.representante_id
  where ur.usuario_id = v_uid
    and r.representante_erp is not null
    and btrim(r.representante_erp) <> '';

  -- Grupos do diretor, já NORMALIZADOS (upper + btrim), como em client_groups.
  -- Só grupos ativos.
  select coalesce(array_agg(distinct cg.normalized_name), '{}')
    into v_grupos
  from user_client_groups ucg
  join client_groups cg on cg.id = ucg.client_group_id
  where ucg.user_id = v_uid
    and cg.is_active is true;

  perfil         := v_perfil;
  is_global      := v_perfil in ('admin', 'diretor_geral');
  representantes := v_reps;
  grupos         := v_grupos;

  -- Tem escopo quem enxerga tudo, quem tem representante, ou quem tem grupo.
  -- Um 'representante' sem vínculo nenhum cai aqui como FALSE — e é o correto.
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
-- Revogar é OBRIGATÓRIO, não opcional.
--
-- O frontend NÃO precisa chamar esta função: ela é infraestrutura interna. As
-- RPCs de negócio serão `security definer` de dono `postgres`, então executam
-- esta aqui com os privilégios do dono — sem precisar de grant para o cliente.
--
-- Nota: `auth.uid()` continua funcionando dentro de SECURITY DEFINER porque lê
-- a claim do JWT da SESSÃO (request.jwt.claims), não o papel corrente.
-- ============================================================================

revoke all on function public.app_escopo_atual() from public;
revoke all on function public.app_escopo_atual() from anon;
revoke all on function public.app_escopo_atual() from authenticated;

-- Validação (rodar depois de aplicar):
--   select proname, proacl, prosecdef, provolatile, proconfig
--     from pg_proc where proname = 'app_escopo_atual';
--   Esperado: prosecdef = true · provolatile = 's' · proconfig = {search_path=public}
--             proacl SEM anon e SEM authenticated
