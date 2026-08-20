-- ============================================================================
-- E2-0 — Medição de pushdown dos predicados que a RPC vai usar
-- ----------------------------------------------------------------------------
-- SOMENTE `EXPLAIN`, sem `ANALYZE`. Nada é criado, alterado ou persistido.
-- `PREPARE` (N5) vive só na sessão e é liberado com `deallocate`.
--
-- Objetivo: provar, ANTES de escrever a RPC, que cada predicado do desenho
-- desce ao ERP. Se algum falhar, o desenho muda antes de existir código.
--
-- Rode como `postgres` no SQL Editor.
-- ============================================================================


-- ############################################################################
-- PASSO 0 — Valores reais para substituir nos testes (somente leitura, local)
-- ############################################################################

-- 0.1 — Códigos de representante (tabela local do Portal)
select representante_erp
from public.concremapprep_representantes
where ativo is true
order by representante_erp
limit 5;
-- → <COD_REP_1>, <COD_REP_2>

-- 0.2 — Grupos normalizados existentes (tabela local do Portal)
select normalized_name
from public.client_groups
where is_active is true
order by normalized_name;
-- → <GRUPO_1>  (ex.: o grupo do diretor de teste)

-- Datas: use um intervalo com pedidos, formato AAAA-MM-DD.
-- → <DATA_INICIO>, <DATA_FIM>


-- ############################################################################
-- COMO LER TODOS OS TESTES
-- ############################################################################
--
--  PASSA quando o plano tem AS DUAS COISAS:
--    1. `Foreign Scan` com a linha `Relations: Aggregate on (erp.concrem_pedidos_venda)`
--    2. `Remote SQL:` contendo `count(*)`, `sum(total_pedido_venda)`, `GROUP BY`
--       E todos os predicados do teste
--
--  FALHA quando aparece QUALQUER uma destas:
--    • nó `HashAggregate` ou `GroupAggregate` ACIMA do `Foreign Scan`
--    • nó `Sort` acima do `Foreign Scan` para agrupar
--    • `Filter:` acima do `Foreign Scan` com um predicado que deveria ter descido
--    • `Remote SQL` trazendo COLUNAS CRUAS (ex.: `SELECT data_emissao,
--      total_pedido_venda FROM …`) em vez do agregado
--
--  A linha `Relations: Aggregate on (...)` é o sinal decisivo: ela só aparece
--  quando o PostgreSQL empurrou a agregação inteira.


-- ############################################################################
-- N1 — Normalização de grupo com built-ins é empurrável?
-- ############################################################################
-- Por quê: `app_escopo_atual()` devolve grupos NORMALIZADOS (upper+btrim), e o
-- ERP guarda `grupo_cliente` cru. Casar exige normalizar do lado do ERP usando
-- SÓ built-ins — `app_norm_grupo()` é função local e derrubaria o pushdown (A6).
-- Este é o teste que pode derrubar o desenho do ramo do diretor.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['<GRUPO_1>'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` + a expressão `CASE`/`coalesce` dentro
--        do `Remote SQL`, junto de `GROUP BY`.
-- FALHA: agregação local, ou a expressão aparecendo em `Filter:` acima do scan.


-- ############################################################################
-- N2 — `OR` entre dois predicados de array é empurrável?
-- ############################################################################
-- Por quê: o diretor enxerga grupos vinculados OU seus próprios rep codes — é o
-- que a view faz hoje. Se o `OR` não descer, o ramo C precisa de outro desenho.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and ( v.representante = any (array['<COD_REP_1>'])
        or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['<GRUPO_1>']) )
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` + o `OR` inteiro dentro do `Remote SQL`.
-- FALHA: o `OR` aparecendo em `Filter:` local, ou agregação local.


-- ############################################################################
-- N3 — Exclusão de vendas diretas é empurrável?
-- ############################################################################
-- Por quê: `REP_EXCLUIDOS` precisa ser aplicado dentro da função, senão o
-- cliente contorna a regra de negócio.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` + `<> ALL` (ou `NOT (… = ANY …)`) no `Remote SQL`.
-- FALHA: a exclusão em `Filter:` local.
--
-- ⚠️ LEMBRETE (decisão D-1): `representante <> all (...)` com `representante`
-- NULO resulta em NULL, então a linha é DESCARTADA. `null_frac` medido = 4,85%
-- (~1.550 pedidos). Isto PRESERVA o comportamento atual do PostgREST e está
-- mantido de propósito nesta etapa.


-- ############################################################################
-- N4 — Ramo C completo, com literais
-- ############################################################################
-- Prova que o plano INTEIRO do caminho mais complexo continua remoto: datas,
-- id_nota_conf, exclusão, o OR com grupo normalizado, e a agregação diária.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf  = any (array[307,309,613,665])
  and v.data_emissao >= '<DATA_INICIO>'
  and v.data_emissao <= '<DATA_FIM>'
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and ( v.representante = any (array['<COD_REP_1>','<COD_REP_2>'])
        or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['<GRUPO_1>']) )
group by v.data_emissao
order by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` e o `Remote SQL` com TODOS os
--        predicados + `count(*)` + `sum(...)` + `GROUP BY`.
-- FALHA: qualquer predicado sobrando em `Filter:` local, ou agregação local.
-- NOTA: o `order by` pode aparecer como `Sort` local sem invalidar o teste —
--       são ~300 linhas já agregadas. O que não pode ficar local é a AGREGAÇÃO.


-- ############################################################################
-- N5 — Ramo C parametrizado, com GENERIC PLAN
-- ############################################################################
-- Este é o teste mais próximo do que a RPC vai fazer de verdade: dentro de
-- plpgsql os valores chegam como PARÂMETROS, e o plano pode ser genérico.
-- `force_generic_plan` reproduz o pior caso de propósito.
--
-- E0 já provou parâmetro + agregação simples. Aqui a combinação é maior:
-- datas + arrays + OR + expressão de grupo + agregação diária.
begin;

set local plan_cache_mode = force_generic_plan;

prepare e2_ramo_c (date, date, text[], text[]) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf  = any (array[307,309,613,665])
  and v.data_emissao >= $1
  and v.data_emissao <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and ( v.representante = any ($3)
        or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any ($4) )
group by v.data_emissao
order by v.data_emissao;

explain (verbose, costs, format text)
execute e2_ramo_c('<DATA_INICIO>', '<DATA_FIM>',
                  array['<COD_REP_1>','<COD_REP_2>'], array['<GRUPO_1>']);

deallocate e2_ramo_c;

rollback;
-- PASSA: `Relations: Aggregate on (...)` + `Remote SQL` parametrizado, com
--        `$1::date`, `$2::date`, `$3::text[]`, `$4::text[]`, o `OR`, `count(*)`,
--        `sum(...)` e `GROUP BY`.
-- FALHA: agregação local, ou algum parâmetro virando `Filter:` local.
--
-- Se a saída vier vazia por causa do `rollback`, troque por `commit;` — nada foi
-- alterado, e `set local` morre com a transação nos dois casos.


-- ############################################################################
-- N6 — Ramo A (global) com `p_representante` parametrizado
-- ############################################################################
begin;

set local plan_cache_mode = force_generic_plan;

prepare e2_ramo_a (date, date, text) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf  = any (array[307,309,613,665])
  and v.data_emissao >= $1
  and v.data_emissao <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and v.representante = $3
group by v.data_emissao
order by v.data_emissao;

explain (verbose, costs, format text)
execute e2_ramo_a('<DATA_INICIO>', '<DATA_FIM>', '<COD_REP_1>');

deallocate e2_ramo_a;

rollback;
-- PASSA: `Relations: Aggregate on (...)` + `representante = $3` no `Remote SQL`.
-- FALHA: agregação local.
--
-- NOTA: o esboço da RPC usa `(p_representante is null or v.representante = p_representante)`.
-- Aqui o predicado está na forma SIMPLES de propósito, porque a RPC vai ramificar
-- em plpgsql para não mandar condição sempre-verdadeira ao ERP. Se você preferir
-- a forma com `is null or`, ela precisa de um N6b próprio — não presumir.


-- ############################################################################
-- N7 — Ramo B (representante / operador / diretor sem grupo)
-- ############################################################################
begin;

set local plan_cache_mode = force_generic_plan;

prepare e2_ramo_b (date, date, text[]) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf  = any (array[307,309,613,665])
  and v.data_emissao >= $1
  and v.data_emissao <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and v.representante  = any ($3)
group by v.data_emissao
order by v.data_emissao;

explain (verbose, costs, format text)
execute e2_ramo_b('<DATA_INICIO>', '<DATA_FIM>', array['<COD_REP_1>','<COD_REP_2>']);

deallocate e2_ramo_b;

rollback;
-- PASSA: `Relations: Aggregate on (...)` + `representante = ANY ($3::text[])` no `Remote SQL`.
-- FALHA: agregação local.


-- ############################################################################
-- Registro dos resultados
-- ############################################################################
-- | Teste | `Relations: Aggregate on` ? | Predicados no Remote SQL | Nós locais | Veredito |
-- |-------|------------------------------|--------------------------|------------|----------|
-- | N1    |                              |                          |            |          |
-- | N2    |                              |                          |            |          |
-- | N3    |                              |                          |            |          |
-- | N4    |                              |                          |            |          |
-- | N5    |                              |                          |            |          |
-- | N6    |                              |                          |            |          |
-- | N7    |                              |                          |            |          |
--
-- N4 e N5 são os decisivos: são o plano completo do caminho mais complexo, com
-- literais e com parâmetros. Se os dois passarem, a RPC pode ser escrita como
-- desenhada. Se N1 falhar, o ramo do diretor precisa de outro desenho.
