# C0 — Medição do FDW (predicate pushdown)

> **Executor: humano.** O MCP do Supabase nega acesso nesta sessão
> (`You do not have permission to perform this action`), e não tenho a senha do banco para usar `psql`.
> O roteiro abaixo é **somente leitura** e não altera nada.
>
> Objetivo: confirmar ou derrubar a hipótese da **camada 3** — o FDW estaria trazendo a tabela remota
> inteira antes de filtrar localmente.

🔗 SQL Editor do Portal: https://supabase.com/dashboard/project/ikjeyaxfciferyezxskh/sql/new

## Por que começar sem `ANALYZE`

`EXPLAIN` puro **não executa** a consulta: o planejador mostra a intenção, inclusive o `Remote SQL` que
seria enviado ao ERP. Custo zero para o ERP. É o suficiente para responder a pergunta principal.

`EXPLAIN ANALYZE` **executa de verdade** — e, se o pushdown não estiver acontecendo, isso significa puxar
~31 mil linhas do ERP por consulta. Como o ERP é compartilhado com outra aplicação, **só rode a segunda
parte depois de olhar a primeira**, e de preferência fora do horário de pico.

---

## Parte 1 — `EXPLAIN` puro (seguro, não executa)

Rode **um bloco por vez** e guarde a saída inteira de cada um.

```sql
-- A) Sem filtro nenhum
explain (verbose, costs)
select * from concrem_pedidos_venda;
```

```sql
-- B) Filtro de negócio (o que TODA leitura do app aplica)
explain (verbose, costs)
select * from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665);
```

```sql
-- C) Filtro por representante
explain (verbose, costs)
select * from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665)
   and representante = '40055415 - TF GUIMARAES REPRESENTACOES';
```

```sql
-- D) Filtro por período
explain (verbose, costs)
select * from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665)
   and data_emissao >= '2026-08-01' and data_emissao <= '2026-08-31';
```

```sql
-- E) Representante + período (o caso real de uso)
explain (verbose, costs)
select * from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665)
   and representante = '40055415 - TF GUIMARAES REPRESENTACOES'
   and data_emissao >= '2026-08-01' and data_emissao <= '2026-08-31'
 order by data_emissao desc
 limit 50;
```

```sql
-- F) Contagem — é o que alimenta o "7.600 pedidos" da tela
explain (verbose, costs)
select count(*) from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665);
```

```sql
-- G) Controle: a MESMA consulta direto na foreign table, sem passar pela view.
--    Compare com (C). Se aqui o filtro é empurrado e lá não, a culpa é da view.
explain (verbose, costs)
select * from erp.concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665)
   and representante = '40055415 - TF GUIMARAES REPRESENTACOES';
```

> Ajuste o nome do representante em (C), (E) e (G) para um que exista de verdade — pegue um da coluna
> "Representante" na Central de Pedidos.

### Como ler a saída

Procure a linha `Remote SQL:` dentro do `Foreign Scan`.

| O que aparece | Significa |
|---|---|
| `Remote SQL: SELECT ... FROM public.concrem_pedidos_venda WHERE ((id_nota_conf = ANY (...))) AND ((representante = '...'))` | ✅ **pushdown funcionando** — o ERP filtra |
| `Remote SQL: SELECT ... FROM public.concrem_pedidos_venda` **sem `WHERE`** | ❌ **puxa tudo** — o Portal filtra depois |
| `Filter:` acima do `Foreign Scan` | a condição ficou **local** |
| `rows=31906` (ou próximo) na estimativa do Foreign Scan | o planejador espera a tabela inteira |

O caso (G) é o desempate: **a view é `security_barrier` e filtra por `app_is_admin()` /
`app_my_rep_codes()`**, funções locais que o FDW não consegue enviar. Se (G) empurrar e (C) não, a
barreira é a causa — e isso é conserto de arquitetura, não de plano.

---

## Parte 2 — `EXPLAIN ANALYZE` (**só depois de me mostrar a Parte 1**)

⚠️ **Executa de verdade.** Se a Parte 1 mostrar que não há pushdown, esta parte puxa ~31 mil linhas do
ERP a cada execução. Rode fora do horário comercial, e só nos casos (E) e (F).

```sql
explain (analyze, buffers, verbose)
select * from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665)
   and representante = '40055415 - TF GUIMARAES REPRESENTACOES'
   and data_emissao >= '2026-08-01' and data_emissao <= '2026-08-31'
 order by data_emissao desc
 limit 50;
```

Anotar: `actual rows` do Foreign Scan (**lidas do ERP**) × linhas do resultado final (**retornadas**),
`Execution Time` e `Planning Time`.

---

## Registro dos resultados

| Caso | `Remote SQL` tem `WHERE`? | Filtros enviados ao ERP | Filtros locais | Linhas estimadas | Linhas lidas (ANALYZE) | Retornadas | Tempo |
|---|---|---|---|---|---|---|---|
| A — sem filtro | | | | | | | |
| B — `id_nota_conf` | | | | | | | |
| C — representante | | | | | | | |
| D — período | | | | | | | |
| E — rep + período | | | | | | | |
| F — count | | | | | | | |
| G — foreign table direta | | | | | | | |

### Conclusão (preencher ao final)

> O FDW **está** / **não está** fazendo predicate pushdown corretamente.
> Evidência decisiva: _______________________________________________

### Impacto da conclusão

- **Se houver pushdown:** o Modelo A (consulta ao vivo corrigida) volta a ser viável e mais barato — sem
  sync, sem defasagem, sem reconciliação. O cache local passa a ser opcional.
- **Se não houver:** o cache local deixa de ser preferência e vira necessidade — cada interação de cada
  usuário está varrendo a tabela remota inteira, e isso piora linearmente com usuários simultâneos.
