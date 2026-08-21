-- ============================================================================
-- E3 — Verificação de public.app_dashboard_serie_diaria(date, date, text)
-- ----------------------------------------------------------------------------
-- Registro REEXECUTÁVEL dos testes que validaram a E2. Executado no SQL Editor
-- do Supabase, como `postgres`, em 21/08/2026.
--
-- Migration verificada:
--   supabase/migrations/20260819000400_rpc_dashboard_serie_diaria.sql
--
-- ── COMO USAR ───────────────────────────────────────────────────────────────
-- Rode UM BLOCO POR VEZ. O SQL Editor mostra o resultado da ÚLTIMA instrução,
-- e vários blocos têm mais de um `select`. Cada bloco é autossuficiente: abre
-- transação, faz o que precisa e termina em `rollback`.
--
-- ⚠️ No SQL Editor o botão Run executa apenas o trecho SELECIONADO quando há
-- seleção. Selecione o bloco inteiro, ou nada.
--
-- ── SUJEITOS DE TESTE ───────────────────────────────────────────────────────
-- Onde aparecer «SUJEITO …», substitua pelo UUID correspondente, obtido no
-- PASSO 0. Nenhum UUID foi gravado neste arquivo de propósito: eles mudam entre
-- ambientes e não são o que o teste prova.
--
-- ⚠️ NÃO cole aqui token, JWT de sessão, `anon key`, `publishable key`, senha
-- nem connection string. Os blocos abaixo impersonam via `request.jwt.claims`,
-- que só precisa do `sub` — não de um token assinado.
--
-- ── ESCRITA ─────────────────────────────────────────────────────────────────
-- Dois blocos escrevem (T2.G e T3.4). Ambos em transação, ambos desfeitos pelo
-- `rollback`. Nenhum dado permanente é criado. Execute cada um de uma vez só:
-- enquanto a transação estiver aberta, há lock na linha alterada.
--
-- ── EXPLAIN ANALYZE ─────────────────────────────────────────────────────────
-- Autorizado UMA ÚNICA VEZ neste arquivo, em T8.1, sobre a CHAMADA da RPC.
-- Em nenhum outro lugar. Os testes de pushdown (T1) usam `EXPLAIN` puro.
--
-- ============================================================================
-- RESULTADOS OBSERVADOS EM 2026-08-21
-- ----------------------------------------------------------------------------
-- ⚠️ ISTO É EVIDÊNCIA HISTÓRICA, NÃO CRITÉRIO DE APROVAÇÃO.
--
-- Contagens, tempos e volumes dependem dos dados do ERP na data, do vínculo dos
-- usuários e da latência da rede até o ERP. Numa reexecução futura os números
-- SERÃO diferentes — e isso não é falha.
--
-- O que deve continuar valendo em qualquer reexecução é o CRITÉRIO de cada
-- teste, escrito junto dele. Em resumo:
--   • T1 — os cinco ramos com agregação empurrada ao ERP
--   • T2 — ZERO divergências contra o caminho atual
--   • T3 — sem escopo ⇒ EXATAMENTE zero linhas
--   • T4 — não-global: resultado idêntico com e sem `p_representante`
--   • T5 — entrada inválida levanta exceção; 730 dias é aceito
--   • T6/T6-b — veredito OK nas duas funções
--   • T7 — resposta abaixo do `Max rows` do PostgREST
--   • T8 — conclui dentro do `statement_timeout`, sem degradar na 6ª execução
--
-- ── Valores medidos na execução de 2026-08-21 ───────────────────────────────
--   T1     5/5 pushdown PASSOU (A1, A2, B, C, B-grupos)
--   T2     zero divergências nos 7 cenários
--   T3     fail-closed PASSOU nos 4 cenários
--   T4     PASSOU
--   T5     5/5 PASSOU
--   T6     veredito OK
--   T6-b   veredito OK
--   T7     SQL = 366 linhas
--   T7     API = Content-Range 0-365/366, sem truncamento
--   T8.1   Execution Time = 117,496 ms
--   T8.2   153, 50, 50, 50, 50, 52 ms — mesmos 366 dias e 4.898 pedidos nas seis
--
--   API real
--     authenticated (admin) ................. 200
--     anon .................................. 401, code 42501, permission denied
--     global + representante inexistente .... 200, 0 linhas
--     Danilo + p_representante da Valarini .. resultados idênticos (37/37 linhas)
-- ============================================================================


-- ############################################################################
-- PASSO 0 — localizar os sujeitos de teste
-- ############################################################################
-- Some leitura. Anote os UUIDs e use nos blocos seguintes.
select u.id                                                     as sujeito,
       u.email,
       coalesce(nullif(btrim(u.perfil), ''),
                case when u.admin    then 'admin'
                     when u.operador then 'operador'
                     else 'representante' end)                  as perfil_efetivo,
       u.ativo,
       (select count(*) from public.concremapprep_usuario_representantes ur
         where ur.usuario_id = u.id)                            as qtd_reps,
       (select count(*) from public.user_client_groups ucg
          join public.client_groups cg on cg.id = ucg.client_group_id
         where ucg.user_id = u.id and cg.is_active is true)     as qtd_grupos
from public.concremapprep_usuarios u
where u.ativo is true
order by 3, 5 desc, 6 desc;

-- Grupos ativos disponíveis, para o ramo do diretor.
select cg.id, cg.normalized_name, cg.is_active
from public.client_groups cg
where cg.is_active is true
order by cg.normalized_name;


-- ############################################################################
-- T1 — Aggregate pushdown dos cinco ramos, pós-migration
-- ############################################################################
-- Reproduz o SQL EXATO de cada ramo da RPC, parametrizado e com
-- `force_generic_plan` — que é como o plpgsql acaba planejando depois de
-- algumas execuções. `EXPLAIN` puro: nada é executado contra o ERP.
--
-- PASSA quando o plano tem AS DUAS COISAS:
--   1. `Relations: Aggregate on (erp.concrem_pedidos_venda)`
--   2. `Remote SQL:` com count(*), sum(total_pedido_venda), GROUP BY e TODOS os
--      predicados do ramo
--
-- FALHA com `HashAggregate`/`GroupAggregate` acima do `Foreign Scan`, ou com
-- predicado sobrando em `Filter:` local, ou com Remote SQL trazendo colunas cruas.
--
-- ⚠️ NENHUM ramo tem `order by`. Foi ele que derrubou o pushdown em N5 — achado
--    A16. Não acrescentar "só para ver ordenado".


-- ── T1.A1 — global, sem p_representante ── (forma medida em N9) ──
begin;
set local plan_cache_mode = force_generic_plan;
prepare t1_a1 (date, date) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf   = any (array[307,309,613,665])
  and v.data_emissao  >= $1
  and v.data_emissao  <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
group by v.data_emissao;
explain (verbose, costs, format text) execute t1_a1('2026-01-01','2026-08-20');
deallocate t1_a1;
rollback;


-- ── T1.A2 — global, com p_representante ── (forma medida em N6) ──
begin;
set local plan_cache_mode = force_generic_plan;
prepare t1_a2 (date, date, text) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf   = any (array[307,309,613,665])
  and v.data_emissao  >= $1
  and v.data_emissao  <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and v.representante  = $3
group by v.data_emissao;
explain (verbose, costs, format text)
execute t1_a2('2026-01-01','2026-08-20','«SUJEITO REPRESENTANTE — código do ERP»');
deallocate t1_a2;
rollback;


-- ── T1.B — somente rep codes ── (forma medida em N7c) ──
begin;
set local plan_cache_mode = force_generic_plan;
prepare t1_b (date, date, text[]) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf   = any (array[307,309,613,665])
  and v.data_emissao  >= $1
  and v.data_emissao  <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and v.representante  = any ($3)
group by v.data_emissao;
explain (verbose, costs, format text)
execute t1_b('2026-01-01','2026-08-20',
             array['«CÓDIGO ERP 1»','«CÓDIGO ERP 2»']);
deallocate t1_b;
rollback;


-- ── T1.C — rep codes + grupos, com OR ── (forma medida em N5b) ──
-- O `CASE` é a normalização MEDIDA. `nullif`/`coalesce` no lugar dele DERRUBA o
-- pushdown — achado A15, medido em N1e. Não trocar.
begin;
set local plan_cache_mode = force_generic_plan;
prepare t1_c (date, date, text[], text[]) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf   = any (array[307,309,613,665])
  and v.data_emissao  >= $1
  and v.data_emissao  <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and ( v.representante = any ($3)
        or case
             when v.grupo_cliente is null or btrim(v.grupo_cliente) = ''
               then 'SEM GRUPO'
             else upper(btrim(v.grupo_cliente))
           end = any ($4) )
group by v.data_emissao;
explain (verbose, costs, format text)
execute t1_c('2026-01-01','2026-08-20',
             array['«CÓDIGO ERP 1»'],
             array['«GRUPO NORMALIZADO»']);
deallocate t1_c;
rollback;


-- ── T1.Bg — somente grupos ── (forma medida em N8) ──
begin;
set local plan_cache_mode = force_generic_plan;
prepare t1_bg (date, date, text[]) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf   = any (array[307,309,613,665])
  and v.data_emissao  >= $1
  and v.data_emissao  <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and case
        when v.grupo_cliente is null or btrim(v.grupo_cliente) = ''
          then 'SEM GRUPO'
        else upper(btrim(v.grupo_cliente))
      end = any ($3)
group by v.data_emissao;
explain (verbose, costs, format text)
execute t1_bg('2026-01-01','2026-08-20', array['«GRUPO NORMALIZADO»']);
deallocate t1_bg;
rollback;


-- ############################################################################
-- T2 — Equivalência: RPC × caminho atual (a view)
-- ############################################################################
-- ESTE É O TESTE QUE DECIDE. Comparar a RPC contra a view existente, com
-- usuários reais, prova de uma vez escopo, regras de negócio e agregação — sem
-- depender de ninguém ler corretamente a DDL da view.
--
-- Fecha a hipótese H-2: que o `OR` do ramo C reproduza mesmo o que a view faz
-- para o diretor.
--
-- CRITÉRIO: ZERO LINHAS. Qualquer linha devolvida é uma divergência.
--
-- Nota: o `select` sobre a view roda dentro do SQL, não pelo PostgREST — o
-- `Max rows = 1000` não se aplica aqui, então a comparação é sobre o total.

-- ── TEMPLATE — trocar apenas o UUID e o rótulo ──
begin;
set local request.jwt.claims = '{"sub":"«SUJEITO»","role":"authenticated"}';
set local role authenticated;

with rpc as (
  select dia, pedidos, valor_total
  from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20')
),
atual as (
  select v.data_emissao            as dia,
         count(*)                  as pedidos,
         sum(v.total_pedido_venda) as valor_total
  from public.concrem_pedidos_venda v          -- a VIEW com RLS: o caminho de hoje
  where v.id_nota_conf   = any (array[307,309,613,665])
    and v.data_emissao  >= date '2026-01-01'
    and v.data_emissao  <= date '2026-08-20'
    and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  group by v.data_emissao
)
select coalesce(r.dia, a.dia)                        as dia,
       r.pedidos     as rpc_pedidos, a.pedidos     as view_pedidos,
       r.valor_total as rpc_valor,   a.valor_total as view_valor,
       case when r.dia is null then 'SÓ NA VIEW'
            when a.dia is null then 'SÓ NA RPC'
            else 'DIVERGENTE' end                    as tipo_divergencia
from rpc r
full outer join atual a on a.dia = r.dia
where r.dia is null
   or a.dia is null
   or r.pedidos     is distinct from a.pedidos
   or r.valor_total is distinct from a.valor_total
order by 1;

rollback;

-- ── Cenários efetivamente validados em 2026-08-21 ───────────────────────────
--   | # | Sujeito                                    | Ramo      | Divergências |
--   |---|--------------------------------------------|-----------|--------------|
--   | A | representante com rep codes                | B         | 0            |
--   | B | diretor só com grupo                       | B-grupos  | 0            |
--   | C | admin, global                              | A1        | 0            |
--   | D | admin com p_representante                  | A2        | 0            |
--   | E | diretor_geral, global                      | A1        | 0            |
--   | F | operador sem escopo                        | nenhum    | 0            |
--   | G | diretor com grupo + rep, criado na transação | C       | 0            |
--
-- O cenário D usa o mesmo template, trocando a chamada da RPC por
--   public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20',
--                                     '«CÓDIGO ERP»')
-- e acrescentando ao CTE `atual` o predicado
--   and v.representante = '«CÓDIGO ERP»'
--
-- O cenário F é degenerado de propósito: os dois lados devolvem vazio, e a
-- ausência de divergência confirma que a RPC não inventa dado onde a view não
-- mostra nada.


-- ── T2.G — diretor com reps + grupos, construído NA TRANSAÇÃO ───────────────
-- Não havia usuário real na combinação reps+grupos, e o ramo C não podia ficar
-- sem prova de equivalência. O vínculo é criado, testado e DESFEITO.
-- ⚠️ ESCREVE. Rode o bloco inteiro de uma vez; termina em `rollback`.
begin;

-- (a) vincula um grupo ativo a um usuário que JÁ é diretor e JÁ tem rep codes
insert into public.user_client_groups (user_id, client_group_id)
select '«SUJEITO DIRETOR»'::uuid, cg.id
from public.client_groups cg
where cg.is_active is true
  and cg.normalized_name = '«GRUPO NORMALIZADO»'
  and not exists (
        select 1 from public.user_client_groups x
         where x.user_id = '«SUJEITO DIRETOR»'::uuid
           and x.client_group_id = cg.id);

-- (b) confirma que o escopo virou reps + grupos, ou seja, ramo C
set local request.jwt.claims = '{"sub":"«SUJEITO DIRETOR»","role":"authenticated"}';
select e.perfil, e.is_global,
       coalesce(array_length(e.representantes,1),0) as qtd_reps,
       coalesce(array_length(e.grupos,1),0)         as qtd_grupos
from public.app_escopo_atual() e;

-- (c) equivalência, agora como authenticated
set local role authenticated;
with rpc as (
  select dia, pedidos, valor_total
  from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20')
),
atual as (
  select v.data_emissao, count(*), sum(v.total_pedido_venda)
  from public.concrem_pedidos_venda v
  where v.id_nota_conf   = any (array[307,309,613,665])
    and v.data_emissao  >= date '2026-01-01'
    and v.data_emissao  <= date '2026-08-20'
    and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  group by v.data_emissao
)
select count(*) as divergencias
from rpc r
full outer join atual a on a.data_emissao = r.dia
where r.dia is null or a.data_emissao is null
   or r.pedidos     is distinct from a.count
   or r.valor_total is distinct from a.sum;

rollback;   -- ← desfaz o vínculo artificial

-- (d) DEPOIS do rollback, confirmar que não sobrou nada:
--     select count(*) as residual
--     from public.user_client_groups
--     where user_id = '«SUJEITO DIRETOR»'::uuid;
--     Em 2026-08-21: residual = 0.


-- ############################################################################
-- T3 — Fail-closed
-- ############################################################################
-- CRITÉRIO: quem NÃO tem escopo recebe EXATAMENTE zero linhas.
--
-- ⚠️ `tem_escopo = true` NÃO implica `dias > 0`. Um usuário pode ter escopo
--    legítimo e simplesmente não ter pedidos no período. Correção de dados é
--    problema do T2; T3 testa isolamento.
--
-- ⚠️ `authenticated` NÃO tem EXECUTE em `app_escopo_atual()` — decisão da E1.
--    Por isso o diagnóstico de escopo roda ANTES da troca de papel, como
--    `postgres`. `auth.uid()` lê a claim do GUC, não o papel corrente.


-- ── T3.1 — operador sem escopo ──
begin;
set local request.jwt.claims = '{"sub":"«SUJEITO OPERADOR SEM REP»","role":"authenticated"}';

-- diagnóstico, como postgres
select e.perfil, e.is_global, e.tem_escopo,
       coalesce(array_length(e.representantes,1),0) as qtd_reps,
       coalesce(array_length(e.grupos,1),0)         as qtd_grupos
from public.app_escopo_atual() e;
-- esperado: tem_escopo = false

set local role authenticated;
select count(*) as dias
from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20');
-- ASSERÇÃO: dias = 0
rollback;


-- ── T3.2 — UUID inexistente ──
begin;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
set local role authenticated;
select count(*) as dias
from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20');
-- ASSERÇÃO: dias = 0
rollback;


-- ── T3.3 — sem JWT nenhum ──
begin;
set local role authenticated;   -- request.jwt.claims deliberadamente NÃO setado
select count(*) as dias
from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20');
-- ASSERÇÃO: dias = 0
-- auth.uid() é nulo ⇒ tem_escopo = false ⇒ retorna antes de tocar o ERP.
rollback;


-- ── T3.4 — usuário temporariamente inativo ──
-- Não há garantia de existir usuário inativo real, e o teste não pode depender
-- disso. O sujeito é seu próprio controle: mesmo usuário, mesmo período, antes
-- e depois de ser desativado.
--
-- PRÉ-REQUISITO: escolher um sujeito ATIVO que, no período abaixo, tenha
-- devolvido dias > 0. Se nenhum devolver, registre "não executável" — não
-- ajuste o critério.
--
-- ⚠️ ESCREVE. Rode o bloco inteiro de uma vez; termina em `rollback`.
begin;

update public.concremapprep_usuarios
   set ativo = false
 where id = '«SUJEITO ATIVO COM PEDIDOS»'::uuid;

select id, email, ativo from public.concremapprep_usuarios
 where id = '«SUJEITO ATIVO COM PEDIDOS»'::uuid;
-- esperado: ativo = false dentro da transação

set local request.jwt.claims = '{"sub":"«SUJEITO ATIVO COM PEDIDOS»","role":"authenticated"}';
set local role authenticated;

select count(*) as dias_com_usuario_inativo
from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20');
-- ASSERÇÃO: 0 — achado A13 da E1: desativado no portal perde o escopo.

rollback;   -- ← devolve ativo = true

-- DEPOIS do rollback, confirmar:
--   select id, ativo from public.concremapprep_usuarios
--    where id = '«SUJEITO ATIVO COM PEDIDOS»'::uuid;
--   Em 2026-08-21: ativo = true, restaurado.


-- ############################################################################
-- T4 — Não-global passando p_representante alheio
-- ############################################################################
-- `p_representante` só é considerado no ramo global. Para quem não é global ele
-- é IGNORADO — aceitá-lo não ampliaria escopo (o filtro é sempre ADICIONAL),
-- mas a UX atual só oferece o seletor a perfis globais, e ignorar preserva o
-- comportamento exato de hoje.
--
-- CRITÉRIO: resultado IDÊNTICO com e sem o parâmetro. Zero linhas de diferença.
begin;
set local request.jwt.claims = '{"sub":"«SUJEITO REPRESENTANTE»","role":"authenticated"}';
set local role authenticated;

with sem_param as (
  select dia, pedidos, valor_total
  from public.app_dashboard_serie_diaria(date '2026-01-01', date '2026-08-20')
),
com_param_alheio as (
  select dia, pedidos, valor_total
  from public.app_dashboard_serie_diaria(
         date '2026-01-01', date '2026-08-20',
         '«CÓDIGO ERP DE OUTRO REPRESENTANTE»')
)
select coalesce(s.dia, c.dia) as dia,
       s.pedidos as sem_param, c.pedidos as com_param
from sem_param s
full outer join com_param_alheio c on c.dia = s.dia
where s.dia is null or c.dia is null
   or s.pedidos     is distinct from c.pedidos
   or s.valor_total is distinct from c.valor_total;
-- ASSERÇÃO: zero linhas.

rollback;

-- Em 2026-08-21, o mesmo teste pela API real, com o JWT de um representante:
--   status sem parâmetro .... 200
--   status com parâmetro .... 200
--   linhas sem parâmetro .... 37
--   linhas com parâmetro .... 37
--   resultados idênticos .... true


-- ############################################################################
-- T5 — Validação de entrada
-- ############################################################################
-- Entrada inválida LEVANTA EXCEÇÃO em vez de devolver vazio: vazio vira
-- R$ 0,00 na tela, indistinguível de zero legítimo — a assinatura exata do
-- defeito D-2. Erro de programação tem que aparecer.
--
-- CRITÉRIO: os quatro primeiros casos levantam exceção; o quinto NÃO pode.
do $$
declare
  v_falhas int := 0;
  v_pegou  boolean;
begin
  -- T5.1 — data inicial nula ⇒ 22004
  v_pegou := false;
  begin
    perform 1 from public.app_dashboard_serie_diaria(null, date '2026-08-20');
  exception when others then
    v_pegou := true; raise notice 'T5.1 OK — % (%)', sqlerrm, sqlstate;
  end;
  if not v_pegou then v_falhas := v_falhas + 1; raise warning 'T5.1 FALHOU'; end if;

  -- T5.2 — data final nula ⇒ 22004
  v_pegou := false;
  begin
    perform 1 from public.app_dashboard_serie_diaria(date '2026-01-01', null);
  exception when others then
    v_pegou := true; raise notice 'T5.2 OK — % (%)', sqlerrm, sqlstate;
  end;
  if not v_pegou then v_falhas := v_falhas + 1; raise warning 'T5.2 FALHOU'; end if;

  -- T5.3 — datas invertidas ⇒ 22007
  v_pegou := false;
  begin
    perform 1 from public.app_dashboard_serie_diaria(date '2026-08-20', date '2026-01-01');
  exception when others then
    v_pegou := true; raise notice 'T5.3 OK — % (%)', sqlerrm, sqlstate;
  end;
  if not v_pegou then v_falhas := v_falhas + 1; raise warning 'T5.3 FALHOU'; end if;

  -- T5.4 — 731 dias, um a mais que o teto ⇒ 22023
  v_pegou := false;
  begin
    perform 1 from public.app_dashboard_serie_diaria(date '2024-01-01', date '2024-01-01' + 731);
  exception when others then
    v_pegou := true; raise notice 'T5.4 OK — % (%)', sqlerrm, sqlstate;
  end;
  if not v_pegou then v_falhas := v_falhas + 1; raise warning 'T5.4 FALHOU'; end if;

  -- T5.5 — 730 dias, o teto exato ⇒ NÃO pode falhar
  v_pegou := false;
  begin
    perform 1 from public.app_dashboard_serie_diaria(date '2024-01-01', date '2024-01-01' + 730);
  exception when others then
    v_pegou := true; raise warning 'T5.5 FALHOU — 730 dias deveria ser aceito: %', sqlerrm;
  end;
  if v_pegou then v_falhas := v_falhas + 1; else raise notice 'T5.5 OK'; end if;

  if v_falhas > 0 then
    raise exception 'T5 REPROVADO — % caso(s) com resultado errado', v_falhas;
  end if;
  raise notice 'T5 PASSOU — 5/5';
end $$;


-- ############################################################################
-- T6 — RPC nova: owner, propriedades e ACL
-- ############################################################################
-- Duas armadilhas que este teste evita, ambas já encontradas antes:
--
--  1. `proacl IS NULL` significa ACL PADRÃO — e o padrão do PostgreSQL é
--     EXECUTE para PUBLIC. `aclexplode(NULL)` devolve ZERO linhas, então a
--     checagem ingênua diria "PUBLIC não tem" justamente no caso em que TEM.
--
--  2. `SET search_path = ''` é armazenado como `search_path=""`, COM aspas.
--     `proconfig @> array['search_path=']` dá falso para a configuração certa
--     E para as erradas — valida nada. Aqui o valor é EXTRAÍDO e comparado.
--
-- `has_function_privilege` entra como COMPLEMENTO, não substituto: pega
-- herança de PUBLIC e de papéis, que a ACL direta não mostra.
--
-- ESTADO ESPERADO
--   dono=postgres · SECURITY DEFINER · STABLE · search_path="" · proacl não nulo
--   PUBLIC sem EXECUTE · anon sem EXECUTE · authenticated COM · service_role sem
select
  p.proname,
  p.proowner::regrole::text                                as dono,
  p.prosecdef                                              as security_definer,
  p.provolatile                                            as volatilidade,
  p.proconfig                                              as config_bruta,
  sp.item                                                  as search_path_bruto,
  sp.vazio                                                 as search_path_vazio,
  p.proacl                                                 as acl_bruta,

  case when p.proacl is null then true
       else exists (select 1 from aclexplode(p.proacl) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  end                                                      as public_tem_execute,
  case when p.proacl is null then true
       else exists (select 1 from aclexplode(p.proacl) a
                     where a.grantee = to_regrole('anon')::oid
                       and a.privilege_type = 'EXECUTE')
  end                                                      as anon_grant_direto,
  case when p.proacl is null then true
       else exists (select 1 from aclexplode(p.proacl) a
                     where a.grantee = to_regrole('authenticated')::oid
                       and a.privilege_type = 'EXECUTE')
  end                                                      as authenticated_grant_direto,
  case when p.proacl is null then true
       else exists (select 1 from aclexplode(p.proacl) a
                     where a.grantee = to_regrole('service_role')::oid
                       and a.privilege_type = 'EXECUTE')
  end                                                      as service_role_grant_direto,

  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_efetivo,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_efetivo,
  has_function_privilege('service_role',  p.oid, 'EXECUTE') as service_role_efetivo,

  case
    when p.proowner::regrole::text <> 'postgres'
      then 'REPROVADO — dono diferente de postgres; roda com privilégios errados'
    when p.prosecdef is not true       then 'REPROVADO — não é SECURITY DEFINER'
    when p.provolatile <> 's'          then 'REPROVADO — não é STABLE'
    when p.proconfig is null           then 'REPROVADO — proconfig nulo: search_path não foi fixado'
    when sp.item is null               then 'REPROVADO — proconfig sem entrada de search_path'
    when not sp.vazio                  then 'REPROVADO — search_path NÃO está vazio: ' || sp.item
    when p.proacl is null              then 'REPROVADO — proacl NULO: ACL padrão, PUBLIC tem EXECUTE'
    when exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      then 'REPROVADO — PUBLIC tem EXECUTE na ACL'
    when exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = to_regrole('anon')::oid and a.privilege_type = 'EXECUTE')
      then 'REPROVADO — anon tem grant direto de EXECUTE'
    when exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = to_regrole('service_role')::oid and a.privilege_type = 'EXECUTE')
      then 'REPROVADO — service_role tem grant direto de EXECUTE (não previsto na E2)'
    when not exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = to_regrole('authenticated')::oid and a.privilege_type = 'EXECUTE')
      then 'REPROVADO — authenticated SEM EXECUTE; o frontend não conseguirá chamar'
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'REPROVADO — anon tem EXECUTE EFETIVO por herança, apesar da ACL'
    when has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'REPROVADO — service_role tem EXECUTE EFETIVO por herança, apesar da ACL'
    when not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'REPROVADO — authenticated sem EXECUTE efetivo'
    else 'OK'
  end                                                      as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral (
  select cfg                                                       as item,
         btrim(substr(cfg, length('search_path=') + 1), '"') = ''   as vazio
  from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
  where cfg like 'search_path=%'
  limit 1
) sp on true
where n.nspname = 'public'
  and p.proname = 'app_dashboard_serie_diaria';


-- ############################################################################
-- T6-b — E1 preservada: o contrato de app_escopo_atual()
-- ############################################################################
-- A migration da E2 NÃO altera a ACL da E1. Este teste reprova NOS DOIS
-- SENTIDOS: se a E1 estiver aberta demais (frontend alcançando) e se estiver
-- fechada demais (service_role tendo perdido EXECUTE).
--
-- ESTADO ESPERADO — diferente do T6, DE PROPÓSITO
--   dono=postgres · SECURITY DEFINER · STABLE · search_path=""
--   PUBLIC sem EXECUTE · anon sem EXECUTE · authenticated SEM · service_role COM
--
-- A assimetria em `service_role` é deliberada: a E1 é infraestrutura e pode ser
-- necessária a uma Edge Function futura; a E2 é chamada pela SPA e hoje não tem
-- consumidor `service_role`. NÃO UNIFORMIZAR.
select
  p.proname,
  p.proowner::regrole::text                                as dono,
  p.prosecdef                                              as security_definer,
  p.provolatile                                            as volatilidade,
  sp.item                                                  as search_path_bruto,
  sp.vazio                                                 as search_path_vazio,
  p.proacl                                                 as acl_bruta,
  case when p.proacl is null then true
       else exists (select 1 from aclexplode(p.proacl) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  end                                                      as public_tem_execute,
  case when p.proacl is null then true
       else exists (select 1 from aclexplode(p.proacl) a
                     where a.grantee = to_regrole('service_role')::oid
                       and a.privilege_type = 'EXECUTE')
  end                                                      as service_role_grant_direto,
  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_efetivo,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_efetivo,
  has_function_privilege('service_role',  p.oid, 'EXECUTE') as service_role_efetivo,
  case
    when p.proowner::regrole::text <> 'postgres' then 'REPROVADO — dono diferente de postgres'
    when p.prosecdef is not true                 then 'REPROVADO — não é SECURITY DEFINER'
    when p.provolatile <> 's'                    then 'REPROVADO — não é STABLE'
    when p.proconfig is null                     then 'REPROVADO — proconfig nulo'
    when sp.item is null                         then 'REPROVADO — sem entrada de search_path'
    when not sp.vazio                            then 'REPROVADO — search_path NÃO vazio: ' || sp.item
    when p.proacl is null                        then 'REPROVADO — proacl NULO: PUBLIC tem EXECUTE'
    when exists (select 1 from aclexplode(p.proacl) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      then 'REPROVADO — PUBLIC tem EXECUTE'
    when has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'REPROVADO — authenticated alcança a função de escopo; a E1 está aberta'
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'REPROVADO — anon alcança a função de escopo; a E1 está aberta'
    when not has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'REPROVADO — service_role PERDEU EXECUTE; a ACL da E1 foi alterada'
    else 'OK'
  end                                                      as veredito
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral (
  select cfg                                                       as item,
         btrim(substr(cfg, length('search_path=') + 1), '"') = ''   as vazio
  from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
  where cfg like 'search_path=%'
  limit 1
) sp on true
where n.nspname = 'public'
  and p.proname = 'app_escopo_atual';


-- ############################################################################
-- T7 — Truncamento
-- ############################################################################
-- O `Max rows = 1000` do PostgREST vale TAMBÉM para RPC `returns setof` —
-- achado A17. Daí o teto de 730 dias: no máximo 731 linhas, com folga.
--
-- CRITÉRIO: a janela máxima permitida não pode produzir resposta acima do
-- limite do PostgREST.
begin;
set local request.jwt.claims = '{"sub":"«SUJEITO ADMIN»","role":"authenticated"}';
set local role authenticated;
select count(*) as linhas
from public.app_dashboard_serie_diaria(date '2024-01-01', date '2024-01-01' + 730);
-- ASSERÇÃO: linhas <= 731
rollback;

-- ── O TRUNCAMENTO EM SI NÃO É TESTÁVEL AQUI ─────────────────────────────────
-- `Max rows` é aplicado pelo PostgREST, na camada HTTP. Dentro do SQL ele não
-- existe, então este bloco NÃO prova ausência de truncamento — prova só que o
-- conjunto cabe no limite.
--
-- A verificação real foi feita pela API, em 2026-08-21, com JWT de um admin:
--     POST /rest/v1/rpc/app_dashboard_serie_diaria
--     Prefer: count=exact
--     body: {"p_data_inicio":"...","p_data_fim":"..."}
--   → status .......... 200
--   → linhas .......... 366
--   → Content-Range ... 0-365/366     ← sem corte em 999
--
-- NÃO tentar reproduzir HTTP dentro do SQL, e NÃO gravar aqui o token usado.


-- ############################################################################
-- T8.1 — Duração no caminho real, contra o teto de 8 s
-- ############################################################################
-- ⚠️ ÚNICA OCORRÊNCIA AUTORIZADA DE `EXPLAIN ANALYZE` NESTE ARQUIVO.
--    Sobre a CHAMADA da RPC, em transação com rollback. Em nenhum outro lugar.
--
-- `set local role` NÃO aplica o `rolconfig` do papel — o `statement_timeout` de
-- 8 s do `authenticated` só vale em conexão real. Por isso ele é reproduzido à
-- mão; sem essa linha o teste roda sem teto e não prova nada.
--
-- O plano mostrará `Function Scan`: `EXPLAIN` não enxerga o interior de uma
-- função. O número que interessa aqui é o TEMPO. O plano dos ramos é provado
-- pelo T1.
--
-- CRITÉRIO: conclui sem `canceling statement due to statement timeout`, com
-- margem confortável para variação de rede até o ERP.
begin;
set local statement_timeout = '8s';
set local request.jwt.claims = '{"sub":"«SUJEITO ADMIN»","role":"authenticated"}';
set local role authenticated;

explain (analyze, verbose, costs, buffers, timing, format text)
select * from public.app_dashboard_serie_diaria(date '2024-01-01', date '2024-01-01' + 730);

rollback;
-- Em 2026-08-21: Execution Time = 117,496 ms.


-- ############################################################################
-- T8.2 — Estabilidade entre plano customizado e genérico
-- ############################################################################
-- O plpgsql usa plano CUSTOMIZADO nas ~5 primeiras execuções da sessão e depois
-- avalia o GENÉRICO. As duas pontas foram medidas isoladamente no E2-0 (N4 com
-- literais, N5b parametrizado), mas nunca a TRANSIÇÃO. Se o pushdown caísse ao
-- virar genérico, a 6ª chamada seria drasticamente mais lenta.
--
-- Roda como `postgres`: a impersonação é feita pelo GUC, não pelo papel, e
-- assim o bloco usa tabela temporária sem lidar com privilégios.
--
-- É a melhor evidência disponível de que o pushdown vale DENTRO da função — não
-- há como dar `EXPLAIN` no interior de um plpgsql. Se a agregação tivesse
-- voltado para local, seriam ~31 mil linhas atravessando o FDW com
-- `fetch_size=100`, e o tempo denunciaria.
--
-- CRITÉRIO: resultados IDÊNTICOS nas seis, e a 6ª SEM SALTO frente às cinco
-- primeiras. Tolerância de ~2× por ruído de rede; uma ordem de grandeza é
-- reprovação.
begin;
set local statement_timeout = '30s';   -- folgado: aqui mede-se degradação, não o teto
set local request.jwt.claims = '{"sub":"«SUJEITO ADMIN»","role":"authenticated"}';

create temp table t8_execucoes (
  execucao int,
  dias     bigint,
  pedidos  bigint,
  valor    numeric,
  duracao  interval
) on commit drop;

do $$
declare
  v_t0      timestamptz;
  v_dias    bigint;
  v_pedidos bigint;
  v_valor   numeric;
  i         int;
begin
  for i in 1..6 loop
    v_t0 := clock_timestamp();

    select count(*), coalesce(sum(s.pedidos), 0), coalesce(sum(s.valor_total), 0)
      into v_dias, v_pedidos, v_valor
    from public.app_dashboard_serie_diaria(date '2024-01-01', date '2024-01-01' + 730) s;

    insert into t8_execucoes
    values (i, v_dias, v_pedidos, v_valor, clock_timestamp() - v_t0);
  end loop;
end $$;

select execucao, dias, pedidos, valor, duracao,
       round(extract(epoch from duracao) * 1000)::int as ms
from t8_execucoes
order by execucao;

rollback;
-- Em 2026-08-21: 153, 50, 50, 50, 50, 52 ms.
-- Mesmos 366 dias e 4.898 pedidos nas seis. Nenhuma degradação na 6ª.


-- ############################################################################
-- FORA DO SQL — verificações feitas pela API em 2026-08-21
-- ############################################################################
-- Registradas aqui porque fazem parte da evidência da E3, ainda que não sejam
-- reexecutáveis neste arquivo. NÃO gravar token, JWT, `anon key` nem
-- `publishable key` — os valores ficam fora do repositório.
--
--   | Chamada                                   | Resultado                          |
--   |-------------------------------------------|------------------------------------|
--   | authenticated (admin)                     | 200, com dados                     |
--   | anon                                      | 401, code 42501, permission denied |
--   | global + representante inexistente        | 200, 0 linhas                      |
--   | representante + p_representante de outro  | 200/200, 37/37, idênticos          |
--
-- O 401/42501 do `anon` é a contraparte externa do T6: a ACL nega, e a negativa
-- chega ao cliente como erro de permissão — não como conjunto vazio, que seria
-- indistinguível de "não há dados".
