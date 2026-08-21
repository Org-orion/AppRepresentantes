-- ============================================================================
-- E2-0 — Medição de pushdown dos predicados que a RPC vai usar
-- ----------------------------------------------------------------------------
-- SOMENTE `EXPLAIN`, sem `ANALYZE`. Nada é criado, alterado ou persistido.
-- Os blocos com `PREPARE` rodam em transação e terminam em `ROLLBACK`.
--
-- Objetivo: provar, ANTES de escrever a RPC, que cada predicado do desenho
-- desce ao ERP. Se algum falhar, o desenho muda antes de existir código.
--
-- Rode como `postgres` no SQL Editor. Sem placeholders: todos os valores são
-- reais e podem ser executados como estão.
-- ============================================================================
--
-- REGRAS DE NEGÓCIO REPRODUZIDAS (conferidas no código em 2026-08-19)
--
--   id_nota_conf → src/constants/orderFilters.ts:11
--     export const VALID_ID_NOTA_CONF: number[] = [307, 309, 613, 665];
--     Aplicado como `.in('id_nota_conf', VALID_ID_NOTA_CONF)` → `IN (...)`.
--     SÃO EXATAMENTE ESSES QUATRO VALORES. Não há outros.
--
--   REP_EXCLUIDOS → src/services/pedidosVenda.ts:17
--     export const REP_EXCLUIDOS = ['40001498 - JANDERSON LEROY MERLIN'];
--     UM ÚNICO VALOR. Confirmado: não há segunda lista de exclusão no projeto.
--     Aplicado como `.not('representante','in', '("...")')`, que o PostgREST
--     traduz para `NOT (representante IN (...))`.
--
--     Equivalência usada aqui: `representante <> ALL (array[...])` é idêntico a
--     `NOT (representante = ANY (array[...]))`. Mesma semântica, inclusive para
--     NULL — que em ambos os casos resulta em NULL e DESCARTA a linha.
--     É o comportamento atual, preservado por decisão D-1.
--
--   Consumidores de REP_EXCLUIDOS: pedidosVenda.ts (4×), dashboard.ts,
--   acompanhamento.ts, financeiro.ts, performance.ts (2×).
--   Consumidores de VALID_ID_NOTA_CONF: os mesmos, mais carteira.ts e
--   clientGroups.ts.
--
-- VALORES DE TESTE
--   REP 1  = '10008082 - DANILO AUGUSTO REHNEIN'
--   REP 2  = '10006795 - VALARINI REPRESENTACOES DE MOVEIS LTDA.'
--   GRUPO  = 'DAG COMERCIO'
--   PERÍODO = 2026-01-01 a 2026-08-20
-- ============================================================================


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
--    • nó `Sort` acima do `Foreign Scan` servindo para AGRUPAR
--    • `Filter:` acima do `Foreign Scan` com predicado que deveria ter descido
--    • `Remote SQL` trazendo COLUNAS CRUAS (ex.: `SELECT data_emissao,
--      total_pedido_venda FROM …`) em vez do agregado
--
--  A linha `Relations: Aggregate on (...)` é o sinal decisivo: só aparece
--  quando o PostgreSQL empurrou a agregação inteira.
--
--  Nos testes com `order by` (N4–N7), um nó `Sort` ACIMA do agregado remoto é
--  aceitável: ordena ~300 linhas JÁ AGREGADAS. O que não pode ficar local é a
--  AGREGAÇÃO.


-- ############################################################################
-- N1 — Normalização de grupo com built-ins é empurrável?
-- ############################################################################
-- `app_escopo_atual()` devolve grupos NORMALIZADOS (upper+btrim); o ERP guarda
-- `grupo_cliente` cru. Casar exige normalizar do lado do ERP com SÓ built-ins —
-- `app_norm_grupo()` é função local e derrubaria o pushdown (medido em A6).
-- ESTE É O TESTE QUE PODE DERRUBAR O DESENHO DO RAMO DO DIRETOR.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['DAG COMERCIO'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` + a expressão de normalização e o
--        `GROUP BY` dentro do `Remote SQL`.
-- FALHA: agregação local, ou a expressão em `Filter:` acima do `Foreign Scan`.


-- ############################################################################
-- N2 — `OR` entre dois predicados de array é empurrável?
-- ############################################################################
-- O diretor enxerga grupos vinculados OU seus próprios rep codes — é o que a
-- view faz hoje. Se o `OR` não descer, o ramo C precisa de outro desenho.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and ( v.representante = any (array['10008082 - DANILO AUGUSTO REHNEIN'])
        or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['DAG COMERCIO']) )
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` + o `OR` inteiro no `Remote SQL`.
-- FALHA: o `OR` em `Filter:` local, ou agregação local.


-- ############################################################################
-- N3 — Exclusão de vendas diretas é empurrável?
-- ############################################################################
-- `REP_EXCLUIDOS` precisa ser aplicado dentro da função, senão o cliente
-- contorna a regra de negócio.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` + `<> ALL` (ou `NOT (… = ANY …)`) no
--        `Remote SQL`.
-- FALHA: a exclusão em `Filter:` local.
--
-- LEMBRETE (decisão D-1): com `representante` NULO o predicado resulta em NULL e
-- a linha é DESCARTADA. `null_frac` medido = 4,85% (~1.550 pedidos). Isto
-- PRESERVA o comportamento atual do PostgREST e está mantido de propósito.


-- ############################################################################
-- N4 — Ramo C completo, com literais
-- ############################################################################
-- Plano INTEIRO do caminho mais complexo: datas, id_nota_conf, exclusão de
-- vendas diretas, o OR com grupo normalizado, e a agregação diária.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf  = any (array[307,309,613,665])
  and v.data_emissao >= '2026-01-01'
  and v.data_emissao <= '2026-08-20'
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and ( v.representante = any (array['10008082 - DANILO AUGUSTO REHNEIN',
                                     '10006795 - VALARINI REPRESENTACOES DE MOVEIS LTDA.'])
        or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['DAG COMERCIO']) )
group by v.data_emissao
order by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` e o `Remote SQL` com TODOS os
--        predicados + `count(*)` + `sum(...)` + `GROUP BY`.
-- FALHA: qualquer predicado sobrando em `Filter:` local, ou agregação local.


-- ############################################################################
-- N5 — Ramo C completo, PARAMETRIZADO com generic plan
-- ############################################################################
-- O teste mais próximo do que a RPC fará de verdade: dentro de plpgsql os
-- valores chegam como PARÂMETROS e o plano pode ser genérico.
-- `force_generic_plan` reproduz o pior caso de propósito.
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
execute e2_ramo_c(
  '2026-01-01',
  '2026-08-20',
  array['10008082 - DANILO AUGUSTO REHNEIN',
        '10006795 - VALARINI REPRESENTACOES DE MOVEIS LTDA.'],
  array['DAG COMERCIO']
);

deallocate e2_ramo_c;

rollback;
-- PASSA: `Relations: Aggregate on (...)` + `Remote SQL` parametrizado, com
--        `$1::date`, `$2::date`, `$3::text[]`, `$4::text[]`, o `OR`, `count(*)`,
--        `sum(...)` e `GROUP BY`.
-- FALHA: agregação local, ou algum parâmetro virando `Filter:` local.


-- ############################################################################
-- N6 — Ramo A (global) com `p_representante`, PARAMETRIZADO com generic plan
-- ############################################################################
-- Predicado na forma SIMPLES (`= $3`), não `(x is null or ... = x)`, porque a
-- RPC vai ramificar em plpgsql para não mandar condição sempre-verdadeira ao
-- ERP. A forma com `is null or` exigiria teste próprio — não presumir.
begin;

set local plan_cache_mode = force_generic_plan;

prepare e2_ramo_a (date, date, text) as
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf  = any (array[307,309,613,665])
  and v.data_emissao >= $1
  and v.data_emissao <= $2
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
  and v.representante  = $3
group by v.data_emissao
order by v.data_emissao;

explain (verbose, costs, format text)
execute e2_ramo_a(
  '2026-01-01',
  '2026-08-20',
  '10008082 - DANILO AUGUSTO REHNEIN'
);

deallocate e2_ramo_a;

rollback;
-- PASSA: `Relations: Aggregate on (...)` + `representante = $3` no `Remote SQL`,
--        junto de `count(*)`, `sum(...)` e `GROUP BY`.
-- FALHA: agregação local, ou `representante = $3` em `Filter:` local.


-- ############################################################################
-- N7 — Ramo B (representante / operador / diretor sem grupo), generic plan
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
execute e2_ramo_b(
  '2026-01-01',
  '2026-08-20',
  array['10008082 - DANILO AUGUSTO REHNEIN',
        '10006795 - VALARINI REPRESENTACOES DE MOVEIS LTDA.']
);

deallocate e2_ramo_b;

rollback;
-- PASSA: `Relations: Aggregate on (...)` + `representante = ANY ($3::text[])` no
--        `Remote SQL`, junto de `count(*)`, `sum(...)` e `GROUP BY`.
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
-- N4 e N5 são os decisivos: o plano completo do caminho mais complexo, com
-- literais e com parâmetros. Se os dois passarem, a RPC pode ser escrita como
-- desenhada. Se N1 falhar, o ramo do diretor precisa de outro desenho.


-- ############################################################################
-- RESULTADO N1 — REPROVADO (2026-08-19)
-- ############################################################################
-- Plano obtido:
--   GroupAggregate
--     -> Sort
--          -> Foreign Scan on erp.concrem_pedidos_venda
--
--   Filter local:
--     COALESCE(NULLIF(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO')
--       = ANY ('{"DAG COMERCIO"}')
--
--   Remote SQL levou SOMENTE:
--     id_nota_conf = ANY ('{307,309,613,665}')
--
-- Consequências:
--   • a normalização de grupo NÃO desce ao ERP;
--   • a agregação volta a ser local, exatamente como no A5/M2/M3;
--   • o ramo C proposto está REPROVADO — não escrever a RPC com esse desenho;
--   • N2, N4 e N5 ficam suspensos: todos dependem desta expressão.
--
-- Observação: `v.representante = any (array[...])` JÁ desceu antes (caso E do C0
-- e N7 do desenho), então a comparação de texto contra array não é o problema.
-- O que muda aqui é haver FUNÇÃO aplicada sobre a coluna.


-- ############################################################################
-- N1a — coluna crua, sem função nenhuma
-- ############################################################################
-- ISOLA: a comparação de `grupo_cliente` contra array, SEM qualquer função.
-- É a linha de base. Se isto não descer, o problema não é a normalização — é a
-- própria coluna ou o tipo, e todo o desenho de grupo precisa ser repensado.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and v.grupo_cliente = any (array['DAG COMERCIO'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (erp.concrem_pedidos_venda)` e
--        `grupo_cliente = ANY (...)` dentro do `Remote SQL`.
-- FALHA: `Filter:` local com a comparação, ou `GroupAggregate`/`HashAggregate`
--        acima do `Foreign Scan`.


-- ############################################################################
-- N1b — só `btrim()`
-- ############################################################################
-- ISOLA: uma única função sobre a coluna. `btrim` remove espaços e é
-- collation-sensitive no resultado.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and btrim(v.grupo_cliente) = any (array['DAG COMERCIO'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` e `btrim(grupo_cliente) = ANY (...)`
--        dentro do `Remote SQL`.
-- FALHA: `Filter:` local com `btrim(...)`, ou agregação local.


-- ############################################################################
-- N1c — só `upper()`
-- ############################################################################
-- ISOLA: a outra função sozinha, para saber se o bloqueio é de UMA função
-- específica ou de QUALQUER função sobre a coluna.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and upper(v.grupo_cliente) = any (array['DAG COMERCIO'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` e `upper(grupo_cliente) = ANY (...)`
--        dentro do `Remote SQL`.
-- FALHA: `Filter:` local com `upper(...)`, ou agregação local.


-- ############################################################################
-- N1d — `upper(btrim())` composto
-- ############################################################################
-- ISOLA: a composição das duas, sem `coalesce`/`nullif`. Comparado com N1b e
-- N1c, mostra se o bloqueio aparece só ao aninhar funções.
explain (verbose, costs, format text)
select v.data_emissao, count(*), sum(v.total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and upper(btrim(v.grupo_cliente)) = any (array['DAG COMERCIO'])
group by v.data_emissao;
-- PASSA: `Relations: Aggregate on (...)` e `upper(btrim(grupo_cliente)) = ANY (...)`
--        dentro do `Remote SQL`.
-- FALHA: `Filter:` local com a expressão, ou agregação local.


-- ############################################################################
-- REGISTRO FINAL DO E2-0 (2026-08-21)
-- ############################################################################
--
-- ── Decomposição da normalização de grupo ───────────────────────────────────
-- | Teste | Expressão                          | Veredito  |
-- |-------|------------------------------------|-----------|
-- | N1a   | grupo_cliente (coluna crua)        | PASSOU    |
-- | N1b   | btrim(col)                         | PASSOU    |
-- | N1c   | upper(col)                         | PASSOU    |
-- | N1d   | upper(btrim(col))                  | PASSOU    |
-- | N1e   | nullif(upper(btrim(col)), '')      | REPROVADO |
-- | N1f   | CASE equivalente                   | PASSOU    |
--
-- CONCLUSÃO: o bloqueio é do NULLIF, não das funções de texto — achado A15.
-- Normalização adotada na E2:
--   case when grupo_cliente is null or btrim(grupo_cliente) = ''
--          then 'SEM GRUPO'
--        else upper(btrim(grupo_cliente))
--   end
--
-- ── Efeito do ORDER BY sob generic plan ─────────────────────────────────────
-- | Teste | Consulta                              | Veredito  |
-- |-------|---------------------------------------|-----------|
-- | N5    | ramo C parametrizado, COM order by    | REPROVADO |
-- | N5b   | o MESMO, SEM order by                 | PASSOU    |
--
-- Só a AGREGAÇÃO muda de lado; os filtros continuam remotos nos dois — achado A16.
--
-- ── Forma final adotada em cada ramo da RPC ─────────────────────────────────
-- | Ramo      | Escopo                        | Medido em | Veredito |
-- |-----------|-------------------------------|-----------|----------|
-- | A1        | global, sem p_representante   | N9        | PASSOU   |
-- | A2        | global, com p_representante   | N6        | PASSOU   |
-- | B         | somente rep codes             | N7c       | PASSOU   |
-- | C         | rep codes + grupos (OR)       | N5b       | PASSOU   |
-- | B-grupos  | somente grupos                | N8        | PASSOU   |
--
-- Todos em generic plan, todos SEM order by. Reconfirmados após a migration
-- pelo teste T1 da E3, com `Relations: Aggregate on (erp.concrem_pedidos_venda)`
-- e a agregação dentro do `Remote SQL` nos cinco.
--
-- Resultado da E2/E3 completo em docs/E2-PLANO-RPC-DASHBOARD.md §Resultados.
