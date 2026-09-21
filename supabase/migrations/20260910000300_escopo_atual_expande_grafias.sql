-- ============================================================================
-- app_escopo_atual() passa a expandir as grafias do representante
-- ============================================================================
-- Complemento obrigatorio de 20260910000200. Aquela migration corrigiu
-- `app_my_rep_codes()`, que serve as VIEWS do ERP -- mas nao tocou em
-- `app_escopo_atual()`, que e a fonte de escopo de `app_dashboard_serie_diaria()`.
--
-- Sem esta correcao o Dashboard fica internamente inconsistente: os quatro
-- campos da serie (totalVendidoMes, totalVendidoMesAnt, pedidosNoPeriodo,
-- vendasMensais) sairiam da RPC com o escopo ANTIGO, estreito, enquanto
-- carteira, pipeline e faturado -- que vem da consulta bruta sobre a view --
-- ja usariam o escopo novo, ampliado. Dois numeros diferentes para o mesmo
-- usuario, na mesma tela.
--
-- A funcao e recriada inteira porque `create or replace` exige o corpo
-- completo; a UNICA mudanca em relacao a 20260819000300 e o bloco que popula
-- `v_reps`. Nada mais foi alterado: perfil efetivo, regra A13, tratamento de
-- diretor, privilegios e comentario seguem identicos.
--
-- ROLLBACK: reaplicar o bloco `create or replace function public.app_escopo_atual()`
-- de 20260819000300_escopo_centralizado.sql.
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
  -- Inclui TODAS as grafias que o ERP usa para os mesmos codigos (10/09/2026).
  -- A coluna `representante` do ERP nao e normalizada: o mesmo codigo aparece
  -- com mais de uma grafia, e casar so pela grafia cadastrada no Portal
  -- escondia metade dos pedidos. Espelha `app_my_rep_codes()`, que ja expande
  -- assim desde 20260910000200 -- sem isto, a RPC do dashboard ficaria com
  -- escopo MAIS ESTREITO que as views, e a mesma tela mostraria dois totais
  -- diferentes para o mesmo usuario.
  --
  -- O `union` interno preserva o comportamento historico no primeiro ramo:
  -- com `concremapprep_rep_grafias` vazia o resultado e identico ao anterior.
  select coalesce(array_agg(distinct t.rep order by t.rep), '{}')
    into v_reps
  from (
    select r.representante_erp as rep
    from public.concremapprep_usuario_representantes ur
    join public.concremapprep_representantes r on r.id = ur.representante_id
    where ur.usuario_id = v_uid
      and r.representante_erp is not null
      and btrim(r.representante_erp) <> ''
    union
    select g.representante_erp
    from public.concremapprep_usuario_representantes ur
    join public.concremapprep_representantes r on r.id = ur.representante_id
    join public.concremapprep_rep_grafias g on g.codigo = r.codigo
    where ur.usuario_id = v_uid
      and r.codigo is not null
      and btrim(r.codigo) <> ''
  ) t;

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
  'Ordem de consumo: tem_escopo=false => vazio; is_global=true => sem filtro; senão filtra por arrays. '
  'Expande as grafias do ERP por código (20260910000300), espelhando app_my_rep_codes().';

-- Privilegios: `create or replace` PRESERVA os grants existentes, entao o
-- contrato de ACL de 20260819000300 continua valendo (owner + service_role,
-- sem `authenticated`). Revogamos de PUBLIC de novo por seguranca -- e barato
-- e protege caso a funcao tenha sido recriada a mao em algum momento.
revoke all on function public.app_escopo_atual() from public;

commit;
