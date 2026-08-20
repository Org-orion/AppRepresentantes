# C0-bis — `LIMIT`, `ORDER BY` e agregações no FDW

> **Executor: humano.** Somente leitura, **somente `EXPLAIN`, sem `ANALYZE`**.
> Objetivo: revisar duas conclusões do C0 **antes** de virarem decisão de arquitetura.
>
> 🔗 https://supabase.com/dashboard/project/ikjeyaxfciferyezxskh/sql/new

## Hipóteses em teste — declaradas antes, para poderem ser derrubadas

| # | Hipótese | Como cai |
|---|---|---|
| H1 | O `postgres_fdw` **não implementa** pushdown de `LIMIT` (limitação do driver, não desta instalação) | qualquer `Remote SQL` com `LIMIT` derruba |
| H2 | `ORDER BY` **é** empurrável em `data_emissao`, mas o planejador escolhe ordenar local **por falta de estatística** (`reltuples = -1` → estimou `rows=1` no caso G; ordenar 1 linha localmente é grátis) | um `Remote SQL` com `ORDER BY` confirma que é empurrável; a ausência em todos os casos aponta custo/estatística |
| H3 | Agregação **é** empurrável quando **não sobra condição local** — a disjunção de escopo da view é o que impede | A1–A3 direto na foreign table devem mostrar `count`/`sum`/`GROUP BY` no `Remote SQL` |
| H4 | Escopo resolvido em **array constante** mantém a agregação empurrável | A4/A5 decidem a viabilidade da RPC |

| H5 | **`LIMIT` sem `ORDER BY` local já economiza tráfego**, mesmo sem pushdown de `LIMIT`: o `postgres_fdw` lê por **cursor** em lotes de `fetch_size`, e o nó `Limit` interrompe a busca quando tem linhas suficientes. Com `Sort` local no meio, a interrupção não acontece — o `Sort` precisa consumir tudo antes de devolver a primeira linha | só `EXPLAIN ANALYZE` prova (linhas efetivamente lidas). O `EXPLAIN` puro **não** decide |

**H1 é a que eu afirmei sem medir no C0.** Se cair, minha conclusão sobre paginação muda.

**H5 corrige um erro meu no C0.** Eu escrevi que "o ERP devolve tudo que casa com o `WHERE`". Isso vale
para a *consulta*, não necessariamente para o *tráfego*: o cursor pode parar antes. O que torna o caso E
caro não é o `LIMIT` não descer — é o **`Sort` local**, que obriga a ler tudo antes de ordenar.

### A cadeia que realmente decide a arquitetura

```
ORDER BY desce?  ──não──►  Sort local  ──►  lê TODAS as linhas do WHERE  ──►  paginação cara
       │
       └──sim──►  sem Sort  ──►  Limit interrompe o cursor  ──►  ~fetch_size linhas  ──►  paginação barata
```

Repare: **o pushdown de `LIMIT` deixa de ser necessário** se o `ORDER BY` descer. É por isso que L5 e L6
passaram a ser os testes mais importantes deste roteiro — mais que L1.

---

## PASSO 0 — Catálogo local (não toca no ERP)

```sql
-- 0.1 Versão exata do PostgreSQL do Portal
select version();
show server_version;
```

```sql
-- 0.2 Tipo, collation e nulidade das colunas que participam de filtro e ordenação
select a.attname                                as coluna,
       format_type(a.atttypid, a.atttypmod)     as tipo,
       coalesce(col.collname, '(sem collation)') as collation,
       a.attnotnull                             as not_null
from pg_attribute a
join pg_class c      on c.oid = a.attrelid
join pg_namespace n  on n.oid = c.relnamespace
left join pg_collation col on col.oid = a.attcollation
where n.nspname = 'erp'
  and c.relname = 'concrem_pedidos_venda'
  and a.attnum > 0 and not a.attisdropped
  and a.attname in ('data_emissao','id_nota_conf','representante',
                    'grupo_cliente','total_pedido_venda','numero_pedido')
order by a.attnum;
```

```sql
-- 0.3 Definição completa da foreign table (colunas + opções por coluna)
select a.attname, format_type(a.atttypid, a.atttypmod) as tipo, a.attfdwoptions
from pg_attribute a
join pg_class c     on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'erp' and c.relname = 'concrem_pedidos_venda'
  and a.attnum > 0 and not a.attisdropped
order by a.attnum;
```

```sql
-- 0.4 Collation padrão do banco do Portal
select datname, datcollate, datctype
from pg_database where datname = current_database();
```

**O que observar:** se `data_emissao` for `date` ou `timestamp`, **não há collation envolvida** — e a
hipótese "collation impede o `ORDER BY` remoto" morre aqui, antes de qualquer teste. Se for `text`,
collation passa a ser candidata a causa.

### RESULTADO do PASSO 0 (2026-08-19)

| Item | Valor | Efeito nos testes |
|---|---|---|
| PostgreSQL do Portal | **17.6** | versão recente; suporta pushdown de `WHERE`, `ORDER BY`, `JOIN` e agregação |
| `data_emissao` | **`date`** | **sem collation** → hipótese de collation **descartada** para o `ORDER BY` testado |
| `id_nota_conf` | `integer` | sem collation |
| `total_pedido_venda` | `numeric` | sem collation |
| `representante`, `numero_pedido`, `grupo_cliente` | `text`, collation `default` | igualdade é empurrável (confirmado no C0); **ordenação por texto** é outra história — ver ressalva |
| Opções de coluna do FDW | só `column_name=` | mapeamento de nome; **nada que afete pushdown** |
| Collation do banco do Portal | `en_US.UTF-8` | ver ressalva |

**Ressalva NÃO VERIFICADA — collation do ERP.** O Portal usa `en_US.UTF-8`. **Não sabemos a do ERP** —
não dá para consultar de fora sem conectar lá. Se forem diferentes, comparações e ordenações de **texto**
empurradas podem ordenar diferente do esperado. Não afeta os testes deste roteiro (`data_emissao` é
`date`), mas afeta qualquer decisão futura de ordenar por `cliente_nome` ou `representante` no remoto.

---

## PARTE A — `LIMIT` e `ORDER BY`

### L1 — `LIMIT` sozinho

```sql
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
limit 50;
```

### L2 — `ORDER BY` sozinho

```sql
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
order by data_emissao desc;
```

### L3 — `ORDER BY` + `LIMIT`

```sql
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
order by data_emissao desc
limit 50;
```

### L4 — `WHERE` + `LIMIT`

```sql
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665)
limit 50;
```

### L5 — `WHERE` + `ORDER BY` + `LIMIT`

```sql
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665)
order by data_emissao desc
limit 50;
```

### L6 — controle: força o planejador a considerar a ordenação remota

Só desabilita métodos locais **na sessão**, para ver se existe caminho ordenado remoto. Não altera nada
no banco e vale só para esta consulta.

```sql
set local enable_sort = off;
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665)
order by data_emissao desc
limit 50;
reset enable_sort;
```

**Por que L6 importa:** se com `enable_sort = off` aparecer `ORDER BY` no `Remote SQL`, então o caminho
ordenado remoto **existe** e o planejador simplesmente não o escolheu — ou seja, é **decisão de custo**
(H2), não incapacidade. Se continuar local mesmo assim, é limitação de verdade.

> Se o editor não aceitar `set local` fora de transação, envolva em `begin; … commit;`.

---

## PARTE B — Agregações

### A1 — `count(*)`

```sql
explain (verbose, costs, format text)
select count(*) from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665);
```

### A2 — `sum`

```sql
explain (verbose, costs, format text)
select sum(total_pedido_venda) from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665);
```

### A3 — `GROUP BY`

```sql
explain (verbose, costs, format text)
select representante, count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665)
group by representante;
```

### A4 — **o teste que decide a RPC**: escopo como array constante

Simula exatamente o que uma função faria depois de resolver `app_my_rep_codes()` num array. Substitua
pelos códigos reais obtidos de `concremapprep_representantes`.

```sql
explain (verbose, costs, format text)
select count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda
where id_nota_conf = any (array[307,309,613,665])
  and representante = any (array['<COD_REP_1>','<COD_REP_2>']);
```

### A5 — agregação por mês, como o dashboard precisaria

```sql
explain (verbose, costs, format text)
select date_trunc('month', data_emissao) as mes,
       count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda
where id_nota_conf = any (array[307,309,613,665])
  and data_emissao >= '2026-01-01' and data_emissao <= '2026-12-31'
group by 1;
```

### A6 — contraprova: a mesma agregação **com função local no `WHERE`**

```sql
explain (verbose, costs, format text)
select count(*) from erp.concrem_pedidos_venda
where id_nota_conf = any (array[307,309,613,665])
  and (app_is_admin() or representante in (select app_my_rep_codes()));
```

**A6 é o par de A4.** Se A4 empurra a agregação e A6 não, fica **provado** que o problema é a condição
local — e não a agregação em si. É a evidência que sustenta ou derruba a proposta de RPC.

---

## O que observar em cada plano

| Sinal | Significado |
|---|---|
| `LIMIT 50` dentro do `Remote SQL` | H1 derrubada — o driver empurra `LIMIT` |
| `ORDER BY data_emissao DESC` dentro do `Remote SQL` | `ORDER BY` é empurrável |
| Nó `Sort` **acima** do `Foreign Scan` | ordenação local |
| `Remote SQL: SELECT count(*), sum(...) FROM …` | ✅ agregação empurrada — só a linha do resultado atravessa |
| `Aggregate` acima do `Foreign Scan` | ❌ agregação local — uma linha por registro atravessa |
| `GROUP BY` dentro do `Remote SQL` | agrupamento empurrado |
| `Foreign Scan on … (cost=…)` com `Output:` de poucas colunas | poda de colunas funcionando |

---

## Registro dos resultados

| Teste | `Remote SQL` (trecho relevante) | `LIMIT` remoto | `ORDER BY` remoto | Agregação remota | Nós locais |
|---|---|---|---|---|---|
| L1 | | | | — | |
| L2 | | — | | — | |
| L3 | | | | — | |
| L4 | | | — | — | |
| L5 | | | | — | |
| L6 (`enable_sort=off`) | | | | — | |
| A1 | | — | — | | |
| A2 | | — | — | | |
| A3 | | — | — | | |
| A4 | | — | — | | |
| A5 | | — | — | | |
| A6 | | — | — | | |

---

## PARTE C — Condições para a RPC funcionar (análise, sem criar nada)

Para o desenho `RPC → FDW → ERP` produzir pushdown de verdade, **todas** estas condições precisam valer:

| # | Condição | Por quê | Como confirmar |
|---|---|---|---|
| C-1 | **Nenhuma condição local sobra** na consulta | Basta uma para o agregado ter de ser calculado no Portal | A4 × A6 |
| C-2 | Escopo resolvido **antes**, em array/variável | `app_my_rep_codes()` no `WHERE` é função local e quebra C-1 | A4 |
| C-3 | Parâmetros são enviados como valores | Se o `Param` não for avaliado, o predicado não desce | testar a função depois de criada |
| C-4 | Funções de agregação **shippable** | `count`/`sum`/`avg`/`min`/`max` são built-in e shippable; função própria não é | A1–A3 |
| C-5 | Colunas de `GROUP BY` shippable | `representante`, `date_trunc(data_emissao)` — `date_trunc` é built-in | A3, A5 |
| C-6 | A função lê `erp.*` diretamente, **fora** da view | A view reintroduz a disjunção local | por construção |

### ⚠️ E a condição que não é técnica, é de segurança

**C-7 — ao pular a view, a função perde a rede de proteção.** As foreign tables **não têm RLS**. Hoje,
quem protege é a cláusula da view. Uma RPC `security definer` que consulte `erp.*` direto assume
**sozinha** a responsabilidade pelo escopo: um `and` esquecido vira vazamento de dados de todos os
representantes.

Isso é aceitável **se e somente se**:

- o escopo for aplicado numa única função auxiliar, não copiado em cada RPC;
- houver **teste automatizado de isolamento** (representante A não enxerga dados de B) — o teste de
  integração de RLS que ficou pendente na Etapa 6;
- `execute` concedido a `authenticated` e **revogado de `anon`**;
- a função seja `stable` com `set search_path = public`.

Sem esses quatro, a RPC troca um problema de desempenho por um risco de segurança — mau negócio.

### Limitação honesta desta análise

Os testes A4/A5 usam **literais**. Dentro de uma função PL/pgSQL, os valores chegam como **parâmetros**, e
o plano pode ser genérico. **A evidência de A4 é forte, mas não é prova definitiva** para o caso da
função — só medir a função pronta prova. Registro isso agora para não repetir o erro de transformar
hipótese em decisão.

---

## Conclusão (a preencher com as evidências)

- **LIMIT:** empurrável / não empurrável — evidência: ______
- **ORDER BY:** empurrável / não empurrável / empurrável mas preterido por custo — evidência: ______
- **Agregações:** empurráveis direto na foreign table? ______
- **View:** as condições locais são exatamente o impedimento? (A4 × A6) ______
- **RPC:** há evidência técnica de que melhora? ______
- **Arquitetura:** `Frontend → RPC/paginação → FDW → ERP` × `ERP → cache → frontend` ______
