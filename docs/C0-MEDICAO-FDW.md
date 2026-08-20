# C0 — Medição do FDW (predicate pushdown)

> **Executor: humano.** O MCP do Supabase nega acesso nesta sessão, e não tenho a senha do banco.
> Tudo aqui é **somente leitura**. Nesta rodada, **apenas `EXPLAIN` sem `ANALYZE`**.
>
> 🔗 SQL Editor do Portal: https://supabase.com/dashboard/project/ikjeyaxfciferyezxskh/sql/new

## Segurança — `EXPLAIN` sozinho toca o ERP?

Resposta precisa, porque depende de uma opção:

| `use_remote_estimate` | O que o `EXPLAIN` faz |
|---|---|
| **`false`** (padrão do `postgres_fdw`) | **Nenhum contato com o ERP.** O planejador usa estatísticas locais e apenas *deparsa* a consulta remota. A conexão só é aberta na execução — que não acontece sem `ANALYZE` |
| **`true`** | O planejador abre conexão e roda **um `EXPLAIN` no ERP** para estimar custo |

Mesmo no pior caso (`true`), o que vai para o ERP é **um pedido de plano, não um pedido de dados**: nenhuma linha é lida nem transferida. Custo desprezível, inclusive num banco compartilhado.

**O que gera carga de verdade é `EXPLAIN ANALYZE`** — esse executa. Por isso ele fica de fora desta rodada. O PASSO 1 diz em qual dos dois casos você está antes de qualquer coisa.

> ⚠️ **Não rode `EXPLAIN ANALYZE` agora.** Se não houver pushdown, cada execução puxa ~31 mil linhas de
> um banco compartilhado com outra aplicação.

---

## PASSO 1 — Configuração do FDW

Tudo lê catálogo local. Não encosta no ERP.

```sql
-- 1.1 Foreign servers e suas opções (host, porta, dbname, use_remote_estimate…)
select s.srvname            as server,
       f.fdwname            as driver,
       s.srvoptions         as opcoes_do_server
from pg_foreign_server s
join pg_foreign_data_wrapper f on f.oid = s.srvfdw;

-- 1.2 Foreign tables: qual server cada uma usa + opções próprias
select n.nspname            as schema,
       c.relname            as foreign_table,
       s.srvname            as server,
       ft.ftoptions         as opcoes_da_table
from pg_foreign_table ft
join pg_class c        on c.oid = ft.ftrelid
join pg_namespace n    on n.oid = c.relnamespace
join pg_foreign_server s on s.oid = ft.ftserver
order by n.nspname, c.relname;

-- 1.3 use_remote_estimate: server e tabela, lado a lado.
--     A opção da TABELA vence a do SERVER quando as duas existem.
select 'server: ' || s.srvname as onde,
       coalesce(
         (select o from unnest(s.srvoptions) o where o like 'use_remote_estimate%'),
         'não definido (padrão = false)'
       ) as use_remote_estimate
from pg_foreign_server s
union all
select 'table: ' || n.nspname || '.' || c.relname,
       coalesce(
         (select o from unnest(ft.ftoptions) o where o like 'use_remote_estimate%'),
         'não definido (herda do server)'
       )
from pg_foreign_table ft
join pg_class c     on c.oid = ft.ftrelid
join pg_namespace n on n.oid = c.relnamespace
where c.relname = 'concrem_pedidos_venda';

-- 1.4 Versão da extensão
select extname, extversion from pg_extension where extname = 'postgres_fdw';

-- 1.5 Definição da view que o frontend usa (confirma security_barrier e o filtro de escopo)
select c.relname,
       c.reloptions                        as opcoes_da_view,
       pg_get_viewdef(c.oid, true)         as definicao
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'concrem_pedidos_venda';
```

**O que observar:**

- Em **1.1**, o `host` deve apontar para o pooler do ERP. **Não cole a saída de user mapping em lugar
  nenhum** — ela contém senha. As queries acima não tocam em user mapping de propósito.
- Em **1.3**, se aparecer `não definido`, então `use_remote_estimate = false` → o `EXPLAIN` desta rodada
  **não conversa com o ERP**.
- Em **1.5**, confirme `security_barrier=true` em `opcoes_da_view` e a presença de `app_is_admin()` /
  `app_my_rep_codes()` na definição. É a peça central da hipótese.

---

## PASSO 2 — Pegar um representante real (sem tocar no ERP)

`concremapprep_representantes` é tabela **local** do Portal.

```sql
select representante_erp
from concremapprep_representantes
where ativo is true
order by representante_erp
limit 10;
```

Escolha um valor e use no lugar de `<CODIGO_REPRESENTANTE>` nos casos C, E e G.

> Alternativa sem SQL: copiar da coluna **Representante** na Central de Pedidos.

Para `<DATA_INICIAL>` / `<DATA_FINAL>`, use um mês que tenha pedidos — o formato é `AAAA-MM-DD`.

---

## PASSO 3 — Caso A · sem filtro

```sql
explain (verbose, costs, format text)
select * from concrem_pedidos_venda;
```

## PASSO 4 — Caso B · só o filtro obrigatório

`id_nota_conf` vem de `src/constants/orderFilters.ts` — valor real do código, não inventado.

```sql
explain (verbose, costs, format text)
select * from concrem_pedidos_venda
 where id_nota_conf in (307, 309, 613, 665);
```

## PASSO 5 — Caso C · por representante

```sql
explain (verbose, costs, format text)
select * from concrem_pedidos_venda
 where id_nota_conf in (307, 309, 613, 665)
   and representante = '<CODIGO_REPRESENTANTE>';
```

## PASSO 6 — Caso D · por período

```sql
explain (verbose, costs, format text)
select * from concrem_pedidos_venda
 where id_nota_conf in (307, 309, 613, 665)
   and data_emissao >= '<DATA_INICIAL>'
   and data_emissao <= '<DATA_FINAL>';
```

## PASSO 7 — Caso E · uso real (representante + período + ordenação + limite)

```sql
explain (verbose, costs, format text)
select * from concrem_pedidos_venda
 where id_nota_conf in (307, 309, 613, 665)
   and representante = '<CODIGO_REPRESENTANTE>'
   and data_emissao >= '<DATA_INICIAL>'
   and data_emissao <= '<DATA_FINAL>'
 order by data_emissao desc
 limit 50;
```

## PASSO 8 — Caso F · a contagem da tela

```sql
explain (verbose, costs, format text)
select count(*) from concrem_pedidos_venda
 where id_nota_conf in (307, 309, 613, 665);
```

## PASSO 9 — Caso G · direto na foreign table (o desempate)

Mesma lógica do caso E, **sem passar pela view**.

```sql
explain (verbose, costs, format text)
select * from erp.concrem_pedidos_venda
 where id_nota_conf in (307, 309, 613, 665)
   and representante = '<CODIGO_REPRESENTANTE>'
   and data_emissao >= '<DATA_INICIAL>'
   and data_emissao <= '<DATA_FINAL>'
 order by data_emissao desc
 limit 50;
```

---

## Como ler a saída

Em cada plano, procure `Foreign Scan` e a linha `Remote SQL:`.

| O que aparece | Significa |
|---|---|
| `Remote SQL: SELECT ... WHERE ((id_nota_conf = ANY (...))) AND ((representante = '...'))` | ✅ **pushdown** — o ERP filtra |
| `Remote SQL: SELECT ... FROM public.concrem_pedidos_venda` **sem `WHERE`** | ❌ **traz tudo** e filtra no Portal |
| `Filter:` **acima** do `Foreign Scan` | aquela condição ficou **local** |
| `rows=31906` (ou próximo) na estimativa | o planejador espera a tabela inteira |
| `ORDER BY` / `LIMIT` dentro do `Remote SQL` | ordenação e corte também foram empurrados ✅ |
| `Aggregate` local sobre `Foreign Scan` no caso F | a contagem traz linha por linha para contar aqui ❌ |

**Nota de leitura (importante).** No SQL Editor você roda como `postgres`, não como usuário
autenticado — `auth.uid()` é nulo. Isso **não atrapalha** esta medição: sem `ANALYZE`, as funções de
escopo não são executadas, apenas aparecem como filtro no plano. O que estamos observando é se os
filtros **de negócio** (`id_nota_conf`, `representante`, `data_emissao`) descem até o ERP.

**A comparação que decide tudo é E × G:**

- **G empurra e E não** → a culpa é da view `security_barrier` com funções locais. É conserto de
  arquitetura de view — não de plano, não de FDW.
- **Nenhum dos dois empurra** → o problema é do FDW/driver e o cache local vira necessidade.
- **Os dois empurram** → a hipótese da camada 3 cai, o Modelo A volta a ser viável e barato.

---

## O que copiar e me devolver

Para cada passo, **a saída completa em texto** (o botão de copiar do SQL Editor serve). Não resuma nem
recorte: a linha que interessa costuma ser a última do bloco do `Foreign Scan`.

1. PASSO 1 — as cinco consultas de configuração
   ⚠️ exceto qualquer coisa que contenha senha; as queries acima já evitam user mapping
2. PASSOS 3 a 9 — os sete planos, identificando **qual caso é qual**
3. Quais valores você usou em `<CODIGO_REPRESENTANTE>`, `<DATA_INICIAL>` e `<DATA_FINAL>`

Com isso eu preencho a tabela abaixo e fecho a conclusão.

## Registro dos resultados

| Caso | `Remote SQL` tem `WHERE`? | Filtros enviados ao ERP | Filtros locais | Linhas estimadas | `ORDER BY`/`LIMIT` remotos? |
|---|---|---|---|---|---|
| A — sem filtro | | | | | |
| B — `id_nota_conf` | | | | | |
| C — representante | | | | | |
| D — período | | | | | |
| E — rep + período | | | | | |
| F — count | | | | | |
| G — foreign table direta | | | | | |

### Conclusão (a preencher com as evidências)

> O FDW **está** / **não está** fazendo predicate pushdown.
> Evidência decisiva: ______________________________________

### Impacto na recomendação de cache

- **Com pushdown:** Modelo A (consulta ao vivo corrigida) volta a ser viável — sem sync, sem defasagem,
  sem reconciliação. Cache local vira opcional.
- **Sem pushdown:** cada interação de cada usuário varre a tabela remota inteira; piora linearmente com
  usuários simultâneos. Cache local deixa de ser preferência e vira necessidade.
