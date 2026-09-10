-- ============================================================================
-- Escopo do representante passa a casar por CODIGO, nao por grafia do nome
-- ============================================================================
-- PROBLEMA
-- A coluna `representante` do ERP nao e normalizada: o MESMO codigo aparece
-- com mais de uma grafia. Medido em 10/09/2026 sobre erp.concrem_pedidos_venda:
-- 258 grafias distintas para 223 codigos -- 34 codigos partidos em 2 grafias.
-- Exemplos reais:
--   40004965 - DISTRIBUIDORA / DANILO - 15%   e  40004965 - DISTRIBUIDORA / DANILO 15
--   40058170 - DAG COMERCIO E REPRESENTACAO   e  40058170 - DAG COMERGIO E RPE. (erro de digitacao)
--   40054565 - ... THIAGO BORGES 15           e  40054565 - ... THIAGO BORGES 18%
--
-- Como o escopo casava por igualdade da string inteira, o representante via
-- APENAS a grafia cadastrada no Portal e perdia a outra por completo, sem erro
-- e sem aviso. Um usuario media 289 pedidos visiveis de 600 -- 52% invisivel.
--
-- ABORDAGEM
-- Nao derivar o codigo dentro do WHERE. `substring(...)` sobre coluna do ERP
-- derruba o pushdown do postgres_fdw (achados A15/A16) e faria cada consulta de
-- cada tela arrastar ~29 mil linhas. Em vez disso EXPANDIMOS a lista de grafias:
-- o filtro continua `representante in (<strings>)`, igualdade exata, pushdown
-- intacto -- so que a lista chega completa.
--
-- As grafias ficam materializadas numa tabela de apoio. Medido: o
-- `select distinct representante` custa 2.124 ms e NAO e empurrado ao ERP
-- (Remote SQL vem sem DISTINCT), entao esse custo e pago no sync, jamais por
-- consulta.
--
-- NAO MEXE em REP_EXCLUIDOS nem em app_dashboard_serie_diaria(): o
-- '40001498 - JANDERSON LEROY MERLIN' tem grafia UNICA no ERP (verificado), a
-- exclusao por string segue exata e as duas copias da regra continuam iguais.
-- ============================================================================

-- ─── 1. Guarda de integridade ───────────────────────────────────────────────
-- O escopo passa a depender da coluna `codigo`. Hoje ela e confiavel (os 8
-- cadastros conferem), mas nada impedia cadastrar um codigo que nao pertence ao
-- representante -- o que, daqui em diante, AMPLIARIA escopo indevidamente.
-- Se esta migration abortar aqui, ha cadastro inconsistente para corrigir ANTES.
alter table public.concremapprep_representantes
  drop constraint if exists rep_codigo_prefixo_chk;
alter table public.concremapprep_representantes
  add constraint rep_codigo_prefixo_chk
  check (starts_with(representante_erp, codigo));

-- ─── 2. Tabela de apoio: mapa codigo -> grafia ──────────────────────────────
create table if not exists public.concremapprep_rep_grafias (
  representante_erp text primary key,
  codigo            text not null,
  sincronizado_em   timestamptz not null default now()
);

create index if not exists idx_rep_grafias_codigo
  on public.concremapprep_rep_grafias(codigo);

-- Tabela tecnica: ninguem a acessa direto. As duas funcoes abaixo sao
-- `security definer` e chegam nela como owner. Sem grant para authenticated ou
-- anon, e com RLS ligada para o caso de algum grant aparecer no futuro.
alter table public.concremapprep_rep_grafias enable row level security;
revoke all on public.concremapprep_rep_grafias from authenticated, anon;

-- ─── 3. Sincronizacao das grafias ───────────────────────────────────────────
create or replace function public.app_sync_rep_grafias()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  -- Chamada pela API sempre traz auth.uid(); exigimos admin.
  -- Chamada por migration, psql ou service_role vem sem uid -- ja e confiavel.
  if auth.uid() is not null and not public.app_is_admin() then
    raise exception 'app_sync_rep_grafias: apenas admin';
  end if;

  with fonte as (
    select distinct
           v.representante                                    as representante_erp,
           substring(v.representante from '^\s*(\d+)')        as codigo
    from erp.concrem_pedidos_venda v
    where v.representante is not null
  ),
  validas as (
    -- Grafia sem numero na frente nunca entra: viraria codigo nulo e casaria
    -- por acidente. Os 1.443 pedidos com `representante` nulo tambem ficam fora.
    select * from fonte
    where codigo is not null and btrim(codigo) <> ''
  ),
  removidas as (
    delete from public.concremapprep_rep_grafias g
     where not exists (select 1 from validas t
                        where t.representante_erp = g.representante_erp)
    returning 1
  )
  insert into public.concremapprep_rep_grafias (representante_erp, codigo, sincronizado_em)
  select v.representante_erp, v.codigo, now()
  from validas v
  on conflict (representante_erp) do update
    set codigo = excluded.codigo, sincronizado_em = now();

  select count(*) into v_total from public.concremapprep_rep_grafias;
  return v_total;
end;
$$;

grant execute on function public.app_sync_rep_grafias() to authenticated;

-- ─── 4. app_my_rep_codes() passa a expandir por codigo ──────────────────────
-- O UNION garante que a mudanca so pode AMPLIAR: o primeiro ramo reproduz o
-- comportamento historico (a grafia cadastrada), o segundo acrescenta as demais
-- grafias do MESMO codigo. Se a tabela de apoio estiver vazia, o resultado e
-- identico ao de antes -- nenhuma regressao possivel.
create or replace function public.app_my_rep_codes()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select r.representante_erp
  from public.concremapprep_usuario_representantes ur
  join public.concremapprep_representantes r on r.id = ur.representante_id
  where ur.usuario_id = auth.uid()
    and r.representante_erp is not null
    and btrim(r.representante_erp) <> ''
  union
  select g.representante_erp
  from public.concremapprep_usuario_representantes ur
  join public.concremapprep_representantes r on r.id = ur.representante_id
  join public.concremapprep_rep_grafias g on g.codigo = r.codigo
  where ur.usuario_id = auth.uid()
    and r.codigo is not null
    and btrim(r.codigo) <> '';
$$;

grant execute on function public.app_my_rep_codes() to authenticated;

-- ─── 5. Primeira carga ──────────────────────────────────────────────────────
select public.app_sync_rep_grafias();
