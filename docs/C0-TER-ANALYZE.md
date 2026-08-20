# C0-ter — atualizar estatísticas das foreign tables

> **Executor: humano.** Preparação apenas — **nada executado**.
> Motivo: o C0-bis mostrou que o planejador estima `rows=4` onde há ~7.600, e por isso desiste de
> empurrar `ORDER BY` e `LIMIT` nas consultas filtradas — que são todas as do app.
>
> 🔗 https://supabase.com/dashboard/project/ikjeyaxfciferyezxskh/sql/new

---

## PASSO 1 — `analyze_sampling` (catálogo local, não toca no ERP)

```sql
select 'server: ' || s.srvname as onde,
       coalesce(
         (select o from unnest(s.srvoptions) o where o like 'analyze_sampling%'),
         'não definido (padrão = auto)'
       ) as analyze_sampling
from pg_foreign_server s
where s.srvname = 'erp_test'
union all
select 'table: ' || n.nspname || '.' || c.relname,
       coalesce(
         (select o from unnest(ft.ftoptions) o where o like 'analyze_sampling%'),
         'não definido (herda do server)'
       )
from pg_foreign_table ft
join pg_class c     on c.oid = ft.ftrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'erp' and c.relname = 'concrem_pedidos_venda';
```

**Valores possíveis:** `auto` (padrão) · `off` · `random` · `system` · `bernoulli`.

**Por que importa:** é a opção que decide **onde a amostragem acontece** — e, com ela, quanto dado
atravessa o FDW. Ver PASSO 3.

---

## PASSO 2 — Registrar o "antes"

```sql
-- 2.1 Contagem e páginas conhecidas pelo planejador
select n.nspname as schema, c.relname as tabela,
       c.reltuples, c.relpages, c.relkind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'erp'
order by c.relname;
```

```sql
-- 2.2 Estatísticas por coluna (deve vir VAZIO antes do ANALYZE)
select tablename, attname, null_frac, n_distinct,
       array_length(most_common_vals::text::text[], 1) as qtd_mcv,
       array_length(histogram_bounds::text::text[], 1) as qtd_histograma,
       correlation
from pg_stats
where schemaname = 'erp'
  and tablename  = 'concrem_pedidos_venda'
  and attname in ('id_nota_conf','data_emissao','representante','grupo_cliente')
order by attname;
```

**Guarde as duas saídas.** São o "antes" da comparação.

---

## PASSO 3 — O que o `ANALYZE` faz aqui, e quanto custa

### 3.1 Como funciona

`ANALYZE` numa foreign table não lê disco local: o `postgres_fdw` **busca uma amostra de linhas no ERP**
e calcula as estatísticas **no Portal**. O resultado (`reltuples`, `pg_stats`) fica **só no Portal** —
o ERP não é alterado de forma alguma.

### 3.2 Onde a amostragem acontece — depende do PASSO 1

| `analyze_sampling` | Comportamento | Tráfego |
|---|---|---|
| `off` | **traz a tabela inteira** e amostra localmente | 🔴 máximo |
| `system` / `bernoulli` | `TABLESAMPLE` **no ERP** — só a amostra viaja | 🟢 reduzido |
| `random` | filtro aleatório no ERP | 🟢 reduzido |
| `auto` (padrão) | escolhe `TABLESAMPLE` se o remoto suportar; senão, `random` | 🟢 reduzido |

O ERP é PostgreSQL recente, então com `auto` a amostragem deve ocorrer **no ERP**. Confirmar no PASSO 1.

### 3.3 Quanto dado pode ser lido — **o ponto que exige atenção**

O tamanho da amostra é **300 × `default_statistics_target`**. Com o padrão de 100:

```
300 × 100 = 30.000 linhas amostradas
```

A tabela tem **~31.906 linhas**. Ou seja: **a amostra padrão é praticamente a tabela inteira.**

E há um agravante: `dados_tabela` é `jsonb` e carrega os itens do pedido. O planejador estima
`width=880`, mas jsonb costuma pesar bem mais. **Estimativa grosseira: dezenas a mais de cem MB**,
numa única execução.

> ⚠️ **NÃO VERIFICADO:** não confirmei se o `postgres_fdw` poda colunas ao amostrar. Se **não** podar,
> `dados_tabela` viaja junto mesmo que a gente peça estatística só de quatro colunas — e é ela que pesa.

**Mitigação recomendada — reduzir a amostra, não as colunas:**

```sql
begin;
set local default_statistics_target = 20;   -- 300 × 20 = 6.000 linhas
analyze erp.concrem_pedidos_venda;
commit;
```

`set local` morre com a transação; **nenhuma configuração persiste**. 6.000 linhas de ~31.900 é amostra
de ~19% — mais que suficiente para `reltuples` e para a seletividade de `id_nota_conf`, que é o que
precisamos. Se as estimativas ficarem ruins, sobe-se o alvo e repete.

### 3.4 Bloqueio

- **No Portal:** `ANALYZE` toma `ShareUpdateExclusiveLock` na entrada da foreign table. **Não bloqueia
  leitura.** Só conflita com outro `ANALYZE`/DDL na mesma tabela.
- **No ERP:** chega como um `SELECT` comum. Sem lock além do de leitura, sem escrita.

### 3.5 Pooler

A conexão do FDW usa o pooler do ERP em modo sessão. O `ANALYZE` ocupa **uma** conexão durante a
amostragem. Com amostra reduzida (3.3), a janela é curta. Sem redução, é uma conexão presa por mais
tempo, transferindo volume — o argumento mais forte para reduzir.

### 3.6 Horário

**Sim, fora de pico.** O ERP é compartilhado com outra aplicação e a leitura é volumosa. Não é
destrutivo, mas é a maior operação de leitura que este projeto já fez contra o ERP.

### 3.7 Só esta tabela?

**Sim, começar só por ela.** Menor raio de impacto, e é a tabela de todos os testes. `concrem_pedidos_status`,
`_historico` e `_anexos` também importam para o app — mas entram **depois**, quando soubermos o efeito
e o custo reais. Uma variável por vez.

### 3.8 Limitar colunas?

`ANALYZE tabela (col1, col2)` é sintaxe válida e **calcularia** estatística só dessas colunas. Duas
razões para **não** usar agora:

1. **Provavelmente não reduz o tráfego** (ver 3.3) — o que pesa é a amostra de linhas, não o número de
   colunas analisadas.
2. As quatro colunas de interesse (`id_nota_conf`, `data_emissao`, `representante`, `grupo_cliente`) já
   são as que o app filtra, mas estatística sobre **todas** não custa nada a mais e evita repetir a
   operação quando surgir um filtro novo.

**Reduzir a amostra é a alavanca certa; reduzir colunas não é.**

---

## PASSO 4 — `ANALYZE` × `use_remote_estimate` (conceitual, nada será alterado)

| Critério | **A** — `ANALYZE` + estatística local | **B** — `use_remote_estimate = true` |
|---|---|---|
| Precisão | boa no momento do `ANALYZE`; **degrada** conforme a tabela cresce | **sempre atual** — pergunta ao ERP no planejamento |
| Custo de planejamento | **zero** — estatística é local | **1+ `EXPLAIN` remoto por caminho candidato**, em toda consulta |
| Carga no ERP | um pico ocasional | **contínua e proporcional ao uso do app** |
| Manutenção | **precisa reexecutar periodicamente** | nenhuma |
| Tabela que cresce | estatística envelhece; precisa de agenda | acompanha sozinha |
| Latência por requisição | inalterada | **+ round-trip ao ERP a cada planejamento** |

### O detalhe que decide

**Autovacuum não analisa foreign table.** Não existe `ANALYZE` automático aqui — se a estatística não for
reexecutada de tempos em tempos, ela envelhece e o problema volta. Isso é dívida de manutenção real
(candidata a `pg_cron`, no futuro).

### Recomendação para este projeto

**A**, e não B. O Portal faz **muitas consultas pequenas** — pagar um `EXPLAIN` remoto em cada
planejamento sairia mais caro que o pico ocasional do `ANALYZE`, e a carga cairia toda no ERP, que é
compartilhado.

**B continua sendo opção**, e pode ser ligada **por tabela**, se um dia alguma consulta analítica pesada
justificar. Não agora.

---

## PASSO 5 — Comando proposto (**não executar sem aprovação**)

### Versão recomendada, com amostra reduzida

```sql
begin;
set local default_statistics_target = 20;
analyze erp.concrem_pedidos_venda;
commit;
```

### Versão padrão (só se a reduzida não der estimativa boa)

```sql
analyze erp.concrem_pedidos_venda;
```

### Verificações imediatas depois

```sql
-- V1 — reltuples deve deixar de ser -1 e ficar próximo de ~31.900
select c.relname, c.reltuples, c.relpages
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'erp' and c.relname = 'concrem_pedidos_venda';
```

```sql
-- V2 — agora deve haver linhas (antes vinha vazio)
select tablename, attname, null_frac, n_distinct,
       array_length(most_common_vals::text::text[], 1) as qtd_mcv,
       array_length(histogram_bounds::text::text[], 1) as qtd_histograma,
       correlation
from pg_stats
where schemaname = 'erp' and tablename = 'concrem_pedidos_venda'
  and attname in ('id_nota_conf','data_emissao','representante','grupo_cliente')
order by attname;
```

```sql
-- V3 — nenhuma configuração do FDW mudou (deve ser IDÊNTICO ao C0/C0-bis)
select s.srvname, s.srvoptions from pg_foreign_server s where s.srvname = 'erp_test';

select n.nspname, c.relname, ft.ftoptions
from pg_foreign_table ft
join pg_class c     on c.oid = ft.ftrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'erp' order by c.relname;
```

```sql
-- V4 — nenhum GUC de sessão vazou
show default_statistics_target;   -- esperado: 100
show enable_sort;                 -- esperado: on
```

---

## PASSO 6 — Testes depois do `ANALYZE` (preparados, **não executar ainda**)

### L4-pós — `WHERE` + `LIMIT`

```sql
explain (verbose, costs, format text)
select *
from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665)
limit 50;
```

**Confirma a correção se:** a estimativa deixar de ser `rows=4` e passar para milhares, **e**
`LIMIT 50::bigint` aparecer no `Remote SQL`.

### L5-pós — `WHERE` + `ORDER BY` + `LIMIT`

```sql
explain (verbose, costs, format text)
select *
from erp.concrem_pedidos_venda
where id_nota_conf in (307,309,613,665)
order by data_emissao desc
limit 50;
```

**Confirma a correção se:** o nó `Sort` **desaparecer** e o `Remote SQL` trouxer
`ORDER BY data_emissao DESC NULLS FIRST LIMIT 50::bigint` — ou seja, L5 passa a ser o que L6 era.

**Este é o teste mais importante do C0-ter.** É o padrão de toda listagem paginada do app.

### A5-pós — agregação mensal com a variante empurrável

```sql
explain (verbose, costs, format text)
select date_trunc('month', data_emissao::timestamp) as mes,
       count(*),
       sum(total_pedido_venda)
from erp.concrem_pedidos_venda
where id_nota_conf = any (array[307,309,613,665])
  and data_emissao >= '2026-01-01'
  and data_emissao <= '2026-12-31'
group by 1;
```

Diferença para o A5 original: `data_emissao::timestamp` **explícito**, para forçar a variante
`IMMUTABLE` de `date_trunc` em vez da `timestamptz` (`STABLE`), que o C0-bis mostrou não ser empurrável.

**Confirma a correção se:** aparecer `Relations: Aggregate on (erp.concrem_pedidos_venda)` e o
`Remote SQL` contiver `date_trunc(...)`, `count(*)`, `sum(...)` e `GROUP BY`, **sem** `GroupAggregate`
nem `Sort` locais.

> ⚠️ Este teste mistura **duas** mudanças (estatística nova + cast novo). Se ele passar, não saberemos
> qual das duas resolveu. **Rode o A5 original também**, para isolar: se o original continuar local e o
> corrigido descer, a causa é o cast — como o C0-bis previu.

---

## Registro dos resultados

| Item | Antes | Depois |
|---|---|---|
| `analyze_sampling` efetivo | | *(não muda)* |
| `reltuples` | `-1` | |
| `relpages` | `0` | |
| `pg_stats` (4 colunas) | vazio | |
| L4 — estimativa / `LIMIT` remoto | `rows=4` / ❌ | |
| L5 — `Sort` local / `ORDER BY` remoto | presente / ❌ | |
| A5 original — agregação | local | |
| A5 corrigido — agregação | — | |
| Opções do FDW | *(registradas no C0)* | devem ser **idênticas** |

### Se o `ANALYZE` **não** resolver

Cenário possível: estimativas corretas e o planejador **ainda** preferindo `Sort`/`Limit` locais. Aí a
conclusão muda — passaria a ser decisão do modelo de custo, não falta de informação, e a alternativa
seria avaliar `use_remote_estimate` **para esta tabela**. Não antecipar; medir primeiro.


---

# RESULTADO dos PASSOS 1 e 2 — 2026-08-19

| Item | Valor |
|---|---|
| `analyze_sampling` no server `erp_test` | **não definido → `auto`** |
| `analyze_sampling` na foreign table | não definido → herda do server |
| `reltuples` (todas as 5 foreign tables) | **`-1`** |
| `relpages` | `0` |
| `relkind` | `f` (foreign table) |
| `pg_stats` para as 4 colunas | **vazio** — `Success. No rows returned.` |

## Confirmação documental (não de memória)

Documentação oficial do **PostgreSQL 17**, `postgres-fdw`, citada literalmente:

> *"The supported values are `off`, `random`, `system`, `bernoulli` and `auto`. `off` disables remote
> sampling, so all data are transferred and sampled locally. […] `auto` **(the default)** picks the
> recommended sampling method automatically; currently it means either `bernoulli` or `random`
> depending on the remote server version."*

E sobre o `ANALYZE`:

> *"Running ANALYZE on the foreign table is the way to update the local statistics; this will perform a
> scan of the remote table and then calculate and store statistics just as though the table were local."*

**Consequências verificadas:**

1. `auto` **é** o padrão — a amostragem acontece **no ERP**, não por transferência total.
2. Como o ERP é PostgreSQL ≥ 9.5, `auto` resolve para **`bernoulli`** (`TABLESAMPLE`).
3. **`off` seria o cenário ruim** — e não é o nosso.

## Revisão crítica da regra "300 × `default_statistics_target`"

**A regra vale**, mas com três nuances que só agora ficam explícitas:

1. **É do núcleo do `ANALYZE`, não do FDW.** O alvo de linhas (`targrows`) é `300 × statistics_target` da
   coluna com maior alvo, e é passado ao FDW. Com `20` → **~6.000 linhas**; com o padrão `100` →
   **~30.000**, de uma tabela de ~31.900.
2. **É aproximado.** Com `bernoulli`, a fração é calculada a partir de uma estimativa do tamanho da
   tabela; o número devolvido oscila em torno do alvo.
3. **Só reduz tráfego porque `analyze_sampling` ≠ `off`.** Se fosse `off`, o `postgres_fdw` traria a
   tabela **inteira** e amostraria aqui — e baixar o alvo **não economizaria nada**. Confirmado que não é
   o caso.

## O que o ERP vai fazer

`TABLESAMPLE BERNOULLI` **percorre a tabela inteira no ERP** e escolhe linhas por probabilidade — ou seja,
**uma varredura sequencial lá**, com apenas ~6.000 linhas atravessando a rede. Custo no ERP: segundos de
CPU/IO numa tabela de ~32 mil linhas, sem lock além do de leitura, sem escrita.

Resumindo: **o ERP lê tudo; só a amostra viaja.**

## Por que `default_statistics_target = 20` é adequado aqui

| Coluna | O que precisamos | 20 é suficiente? |
|---|---|---|
| `id_nota_conf` | seletividade de `IN (4 valores)` | ✅ pouquíssimos distintos; 20 MCVs cobrem tudo |
| `representante` | `n_distinct` | ✅ o A3 estimou 18 grupos; 20 MCVs cobrem |
| `data_emissao` | histograma para faixa | ✅ 20 baldes é grosseiro, mas suficiente para range |
| `grupo_cliente` | `n_distinct` | ✅ |
| `reltuples` | contagem total | ✅ independe do alvo |

Baixar para 10 economizaria pouco e pioraria o histograma de `data_emissao`. **20 está bem escolhido.**

## Nota sobre manutenção

A documentação diz que rodar `ANALYZE` "**is the way**" de atualizar a estatística e **não menciona
nenhum mecanismo automático**. Meu entendimento — de alta confiança, mas **não confirmado por esta
página** — é que o autovacuum não cobre foreign table. Se estiver certo, a estatística envelhece e
precisa de agenda.

## Classificação

**PODE EXECUTAR COMO ESTÁ.**


---

# VERIFICAÇÃO PÓS-`ANALYZE` — executado em 2026-08-19

`ANALYZE` autorizado e executado com `default_statistics_target = 20`, dentro de transação. Sem erro.

## Consultas de verificação (somente leitura)

As V1 e V2 são **idênticas** às do PASSO 2, para a comparação antes × depois ser direta. V3 e V4 são
detalhe novo; V5 e V6 são as garantias de que nada vazou nem mudou.

Ver a resposta correspondente para os SQLs e o critério de leitura de cada uma.

### Controle embutido

A V1 lista **as cinco** foreign tables. Só `concrem_pedidos_venda` foi analisada — as outras quatro
**devem continuar com `reltuples = -1`**. Se alguma delas mudar, algo aconteceu fora do combinado.

### Observação sobre rastreabilidade

Foreign table **não aparece** em `pg_stat_user_tables`/`pg_stat_all_tables`, então **não há
`last_analyze`** para consultar. A evidência de que o `ANALYZE` rodou é o próprio conteúdo de
`reltuples` e `pg_stats` — mais um motivo para ter registrado o "antes".
