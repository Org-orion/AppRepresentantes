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
-- ── APLICAÇÃO ATÔMICA ───────────────────────────────────────────────────────
-- Todo o conteúdo executável está entre BEGIN e COMMIT. `create or replace
-- function`, `comment on` e `revoke` são DDL transacional no PostgreSQL, então
-- ou tudo entra, ou nada entra. Isso elimina o estado parcial mais perigoso:
-- função criada e EXECUTE ainda concedido a PUBLIC por padrão.
--
-- No SQL Editor, SELECIONE TUDO antes do Run — ele executa apenas o trecho
-- selecionado quando há seleção.
--
-- ── CONTRATO DE CONSUMO (obrigatório) ───────────────────────────────────────
-- O chamador DEVE avaliar nesta ordem:
--   1. tem_escopo = false  → devolver conjunto VAZIO. Fim.
--   2. is_global  = true   → NÃO filtrar por representante nem por grupo.
--   3. senão               → filtrar por `representantes` E/OU `grupos`.
--
-- Para perfis globais os arrays voltam VAZIOS de propósito: quem esquecer de
-- checar `is_global` e filtrar pelos arrays devolve NADA, não devolve TUDO.
-- A falha, se houver, é para o lado seguro.
--
-- Os arrays saem ORDENADOS. Não é capricho: torna o retorno determinístico,
-- permite comparar escopos entre execuções e entre usuários, e faz os testes de
-- isolamento poderem afirmar igualdade sem depender da ordem de agregação.
--
-- ── SUPERFÍCIE DE ATAQUE ────────────────────────────────────────────────────
-- A função NÃO recebe parâmetro nenhum. Não há entrada do cliente para validar
-- ou desconfiar: o escopo vem inteiramente do JWT da sessão.
--
-- `search_path = ''` em vez de `public`. O que de fato protege esta função é,
-- em ordem de importância:
--   1. TODAS as tabelas referenciadas com schema completo (`public.…`);
--   2. `auth.uid()` também qualificado;
--   3. nenhum schema controlável por papel não confiável no `search_path`
--      (auditado: PUBLIC, anon e authenticated não têm CREATE em `public`);
--   4. built-ins (`coalesce`, `btrim`, `array_agg`…) resolvidos pelo PostgreSQL
--      via `pg_catalog`, que é pesquisado implicitamente e não é sequestrável
--      por quem não é superusuário.
--
-- CORREÇÃO DE UM COMENTÁRIO ANTERIOR: `search_path = ''` **não** remove
-- `pg_temp` da resolução. O PostgreSQL continua consultando o schema temporário
-- implicitamente para RELAÇÕES e TIPOS (nunca para funções e operadores). Quem
-- fecha essa porta aqui é a qualificação completa das tabelas — não o caminho
-- vazio por si só.
--
-- ── OWNER ───────────────────────────────────────────────────────────────────
-- `SECURITY DEFINER` executa com os privilégios do DONO, então o dono importa.
-- Esta migration NÃO fixa o owner com `alter function … owner to postgres`
-- porque:
--   • no SQL Editor do Supabase ela roda como `postgres`, e o `alter` seria
--     um no-op;
--   • se um dia for aplicada por outro papel, o `alter` FALHARIA (o papel
--     precisaria ser membro de `postgres`), trocando um problema por outro;
--   • o owner é VERIFICADO explicitamente na validação B3, o que transforma a
--     suposição em fato conferido.
-- Se a validação B3 mostrar dono diferente de `postgres`, PARE: a função estará
-- rodando com privilégios errados.
--
-- ── O QUE ESTA MIGRATION **NÃO** FAZ ────────────────────────────────────────
-- Não altera a view `public.concrem_pedidos_venda`, RLS, policy, privilégio de
-- schema, RPC de negócio ou frontend. As divergências A12, A13 e A14 continuam
-- valendo para a view — ver docs/PLANO-SANEAMENTO.md.
--
-- ROLLBACK
--   drop function if exists public.app_escopo_atual();
-- ============================================================================

begin;

create or replace function public.app_escopo_atual()
returns table (
  perfil          text,     -- perfil efetivo; 'sem_acesso' quando não há escopo válido
  is_global       boolean,  -- admin ou diretor_geral
  representantes  text[],   -- códigos do ERP, ORDENADOS; VAZIO para perfis globais
  grupos          text[],   -- grupos NORMALIZADOS e ORDENADOS; VAZIO para quem não é diretor
  tem_escopo      boolean   -- false ⇒ o chamador DEVE devolver vazio
)
language plpgsql
stable
security definer
set search_path = ''
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
  --   perfil='diretor'  + admin=true    → 'diretor'  (a coluna vence)
  --   perfil='admin'    + admin=false   → 'admin'    (a coluna vence)
  --   perfil=NULL       + admin=true    → 'admin'    (fallback de migração)
  --   perfil=NULL       + operador=true → 'operador' (fallback de migração)
  --   perfil=NULL       + nenhum flag   → 'representante'
  --
  -- É exatamente `perfilDoUsuario` de src/constants/perfis.ts, fonte de verdade
  -- do aplicativo e coberta por teste. DIFERE de `app_is_admin()`, que lê só o
  -- flag — achado A12.
  --
  -- `u.ativo is true` é deliberado (achado A13): usuário desativado no portal
  -- não tem escopo, qualquer que seja perfil, flag, representante ou grupo.
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

  -- Usuário inexistente OU inativo → nenhuma linha → sem escopo.
  if v_perfil is null then
    return next;
    return;
  end if;

  -- ── WHITELIST DE PERFIS (fail-closed) ────────────────────────────────────
  -- Perfil não vazio porém desconhecido NÃO recebe escopo, mesmo tendo
  -- representantes ou grupos vinculados. Hoje a constraint
  -- `usuarios_perfil_chk` já impede valores fora da lista, mas a whitelist é
  -- defesa em profundidade: se a constraint for relaxada, ou se um perfil novo
  -- for adicionado ao banco sem atualizar esta função, o padrão é NEGAR.
  if v_perfil not in ('representante', 'operador', 'admin', 'diretor', 'diretor_geral') then
    perfil := 'sem_acesso';
    return next;
    return;
  end if;

  -- ── ESCOPO POR PERFIL ────────────────────────────────────────────────────
  -- Cada perfil carrega SOMENTE o que pode usar. Vínculo residual em tabela que
  -- o perfil não usa é IGNORADO — não vira escopo por acidente.
  if v_perfil in ('admin', 'diretor_geral') then
    -- Global: não filtra por nada. Arrays ficam vazios de propósito (ver
    -- CONTRATO DE CONSUMO no topo).
    perfil     := v_perfil;
    is_global  := true;
    tem_escopo := true;
    return next;
    return;
  end if;

  -- Daqui para baixo: representante, operador ou diretor.

  -- Códigos de representante vinculados — valem para os três.
  -- Ordenados para o retorno ser determinístico.
  -- NÃO filtra por `r.ativo` DE PROPÓSITO: preserva o comportamento de
  -- `app_my_rep_codes()`. Mudar isso é decisão de negócio — achado A14.
  select coalesce(
           array_agg(distinct r.representante_erp order by r.representante_erp),
           '{}')
    into v_reps
  from public.concremapprep_usuario_representantes ur
  join public.concremapprep_representantes r on r.id = ur.representante_id
  where ur.usuario_id = v_uid
    and r.representante_erp is not null
    and btrim(r.representante_erp) <> '';

  -- Grupos: SOMENTE para diretor.
  --
  -- A view pública já faz assim — a cláusula de grupo é
  -- `app_perfil() = 'diretor' AND app_diretor_ve_grupo(grupo_cliente)`.
  -- Carregar grupos para representante ou operador seria AMPLIAR escopo em
  -- relação ao comportamento atual, por causa de cadastro residual em
  -- `user_client_groups`. Não se presume base limpa.
  --
  -- Nome nulo ou em branco é descartado: grupo inválido não pode virar escopo,
  -- e um '' no array casaria com `grupo_cliente` vazio do ERP por acidente.
  if v_perfil = 'diretor' then
    select coalesce(
             array_agg(distinct cg.normalized_name order by cg.normalized_name),
             '{}')
      into v_grupos
    from public.user_client_groups ucg
    join public.client_groups cg on cg.id = ucg.client_group_id
    where ucg.user_id = v_uid
      and cg.is_active is true
      and cg.normalized_name is not null
      and btrim(cg.normalized_name) <> '';
  end if;

  perfil         := v_perfil;
  is_global      := false;
  representantes := v_reps;
  grupos         := v_grupos;

  -- Comportamento por perfil:
  --   diretor       → grupos ativos + rep codes próprios; sem nenhum ⇒ VAZIO
  --   representante → só rep codes;  sem rep ⇒ VAZIO (grupos sempre {})
  --   operador      → idem representante (decisão D3: sem rep codes ⇒ 0 pedidos)
  --
  -- Em NENHUM caso a ausência de vínculo produz acesso global.
  tem_escopo := coalesce(array_length(v_reps, 1), 0) > 0
                or coalesce(array_length(v_grupos, 1), 0) > 0;

  return next;
end;
$$;

comment on function public.app_escopo_atual() is
  'Fonte única do escopo do usuário autenticado. Nenhuma RPC deve reimplementar esta lógica. '
  'Ordem de consumo: tem_escopo=false => vazio; is_global=true => sem filtro; senão filtra por arrays.';

-- ============================================================================
-- PRIVILÉGIOS — mínimo possível
-- ----------------------------------------------------------------------------
-- No PostgreSQL, EXECUTE é concedido a PUBLIC por padrão em toda função nova.
-- Revogar é OBRIGATÓRIO, não zelo extra — e é justamente por isso que está
-- dentro da mesma transação da criação.
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

commit;
