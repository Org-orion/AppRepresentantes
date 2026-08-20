# E2 — Plano técnico da primeira RPC de negócio

> **Nada implementado.** Documento para revisão. Nenhuma migration, RPC, view, RLS, frontend, FDW
> ou configuração foi tocada.
>
> Base: E1 aplicada e validada (`app_escopo_atual()` em produção, owner `postgres`,
> `search_path=''`, sem EXECUTE para PUBLIC/anon/authenticated).

---

## 3. Objetivo da E2

Criar **uma** RPC — `app_dashboard_serie_diaria` — que devolve a **série diária agregada** de pedidos
dentro do escopo do usuário, com filtro e agregação **executados no ERP**.

**O que a E2 resolve:** hoje o Dashboard baixa até 1.000 pedidos (de ~15.800 que casam com o filtro) e
soma em JavaScript. Além de caro, está **errado** — o recorte é enviesado para os mais recentes, e
selecionar um ano antigo devolve `R$ 0,00` porque o período é filtrado no cliente, depois do corte.

**O que a E2 NÃO faz:**

- não altera o frontend (isso é E5);
- não remove o `TruncationNotice` (E6);
- não toca a view, RLS, policies ou FDW;
- não cria RPC de paginação, financeiro, carteira ou performance;
- não consolida meses — isso é do cliente, por decisão medida (M2/M3).

---

## ⚠️ E2-0 — Uma medição ANTES de escrever a RPC

Três predicados que a RPC precisa **ainda não foram medidos**. Depois de errar três vezes nesta
investigação por raciocinar em vez de medir, eles vão para o `EXPLAIN` primeiro.

### N1 — normalização de grupo é empurrável?

`app_escopo_atual()` devolve grupos **normalizados** (`upper` + `btrim`). O ERP guarda
`grupo_cliente` cru. Para casar, é preciso normalizar do lado do ERP — e **só com built-ins**, porque
`app_norm_grupo()` é função local e quebraria o pushdown (medido em A6).

```sql
explain (verbose, costs, format text)
select data_emissao, count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['DAG COMERCIO'])
group by v.data_emissao;
```

**Confirma se:** `Relations: Aggregate on (…)` e o `Remote SQL` contiver a expressão **e** o `GROUP BY`.
**Se não empurrar**, o caminho do diretor precisa de outro desenho — e a RPC não deve ser escrita antes
disso.

### N2 — `OR` entre dois predicados de array é empurrável?

O diretor enxerga **grupos vinculados OU seus próprios rep codes** (é o que a view faz hoje).

```sql
explain (verbose, costs, format text)
select data_emissao, count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and ( v.representante = any (array['<COD_REP_1>'])
        or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = any (array['DAG COMERCIO']) )
group by v.data_emissao;
```

### N3 — a exclusão de vendas diretas é empurrável?

```sql
explain (verbose, costs, format text)
select data_emissao, count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda v
where v.id_nota_conf = any (array[307,309,613,665])
  and v.representante <> all (array['40001498 - JANDERSON LEROY MERLIN'])
group by v.data_emissao;
```

> **Só depois de N1, N2 e N3 confirmarem é que a RPC deve ser escrita.** Se algum falhar, o desenho muda.

---

## 4. Arquivos que pretendo criar ou alterar

| Arquivo | Ação | Conteúdo |
|---|---|---|
| `supabase/tests/e2_medicao_pushdown.sql` | **criar** | N1, N2, N3 — só `EXPLAIN`, nada executado |
| `supabase/migrations/20260819000400_rpc_dashboard_serie_diaria.sql` | **criar** | a RPC, em transação única, com grants |
| `supabase/tests/rpc_dashboard_serie_diaria.sql` | **criar** | testes de segurança e funcionais (executados na E3) |
| `supabase/migrations/README.md` | alterar | registrar a migration nova como **pendente** |
| `docs/PLANO-DASHBOARD-RPC.md` | alterar | marcar E1 concluída e E2 em revisão |

**Nenhum arquivo de `src/` é tocado na E2.** O frontend só muda na E5.

---

## 5. Contrato da primeira RPC

```sql
public.app_dashboard_serie_diaria(
  p_data_inicio   date,
  p_data_fim      date,
  p_representante text default null
)
returns table (
  dia          date,
  pedidos      bigint,
  valor_total  numeric
)
```

### Regras do contrato

| Regra | Comportamento |
|---|---|
| **Parâmetro só ESTREITA** | `p_representante` é aplicado **apenas** para usuário global. Para os demais é **ignorado**, nunca somado |
| Datas nulas ou invertidas | devolve **vazio**, não erro e não período aberto |
| Sem escopo | devolve **vazio** |
| Ordenação | `order by dia` — determinístico |
| Sem linhas no período | zero linhas (a tela mostra zero, não erro) |

### O que **não** entra, e por quê

| Campo | Motivo |
|---|---|
| `ticket_medio` | derivável no cliente (`valor_total / pedidos`); calcular aqui não agrega |
| `clientes_distintos` | `count(distinct)` **não é empurrável** — derrubaria toda a agregação remota |
| `mes` | `date_trunc`/`extract` no `GROUP BY` **não descem** (M2, M3). Consolidação mensal é do cliente |
| faturado / com NF | exige join com `concrem_pedidos_status` e `_anexos` — **RPC própria**, depois |

---

## 6. Como a RPC consome `app_escopo_atual()`

Na ordem obrigatória do contrato, e **saindo cedo** em cada porta:

```
select * into v_escopo from public.app_escopo_atual();

1.  if not v_escopo.tem_escopo      → return;              (vazio)
2.  if v_escopo.is_global           → consulta SEM filtro de escopo
3.  senão                           → consulta COM filtro pelos arrays
```

### Três consultas, não uma

Cada ramo tem **exatamente** os predicados que precisa. Não uso uma consulta única com condições
sempre-verdadeiras (`v_is_global or …`) por dois motivos:

1. **Desempenho:** uma condição sempre-verdadeira atravessa o FDW e é avaliada linha a linha no ERP.
   Pior ainda com a expressão de normalização de grupo, que seria calculada para todos os pedidos mesmo
   quando o usuário não tem grupo nenhum.
2. **Auditoria:** cada ramo é lido e conferido isoladamente. Num ponto onde um `and` esquecido vaza a
   base inteira, isso vale mais que economizar linhas.

| Ramo | Quem cai aqui | Predicado de escopo |
|---|---|---|
| **A** | admin, diretor_geral | *(nenhum)* + `p_representante` se informado |
| **B** | representante, operador, e diretor **sem grupo** | `representante = any(v_reps)` |
| **C** | diretor **com grupo** | `representante = any(v_reps) OR grupo_norm = any(v_grupos)` |

O ramo B evita a expressão de grupo quando ela não serve para nada — que é o caso da maioria dos
usuários.

---

## 7. Arquitetura preservada

| Exigência | Como fica |
|---|---|
| Consultar `erp.concrem_pedidos_venda` direto | sim — a RPC **não** passa pela view |
| Filtros empurráveis | `id_nota_conf = any(...)`, `data_emissao >= / <=`, `representante = any(...)`, exclusão de vendas diretas |
| Agregação remota por `data_emissao` | `group by v.data_emissao` — provado em M1 |
| Sem `date_trunc` no FDW | confirmado: o mês é montado no cliente |
| Escopo em array constante | vem de `app_escopo_atual()` e é atribuído a variáveis antes da consulta (A4/E0) |
| Nenhuma função local no `WHERE` | só built-ins: `coalesce`, `nullif`, `upper`, `btrim`, `any`, `all` |

---

## SQL proposto (esboço para revisão — **não aplicar**)

```sql
begin;

create or replace function public.app_dashboard_serie_diaria(
  p_data_inicio   date,
  p_data_fim      date,
  p_representante text default null
)
returns table (dia date, pedidos bigint, valor_total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_escopo record;
  -- Regras de negócio replicadas do frontend. Hoje vivem só em
  -- src/constants/orderFilters.ts e src/services/pedidosVenda.ts; se ficarem de
  -- fora daqui, o cliente contorna. Divergir das duas fontes é risco conhecido
  -- (M2 do docs/ANALISE-ARQUITETURA-CONSULTAS.md).
  v_id_nota   int[]  := array[307, 309, 613, 665];
  v_rep_excl  text[] := array['40001498 - JANDERSON LEROY MERLIN'];
begin
  -- Datas ausentes ou invertidas → vazio. Nunca período aberto.
  if p_data_inicio is null or p_data_fim is null or p_data_inicio > p_data_fim then
    return;
  end if;

  select * into v_escopo from public.app_escopo_atual();

  -- 1) Sem escopo ⇒ vazio. SEMPRE a primeira porta.
  if not v_escopo.tem_escopo then
    return;
  end if;

  -- 2) Global ⇒ sem filtro de representante/grupo.
  --    `p_representante` só ESTREITA, e só aqui.
  if v_escopo.is_global then
    return query
      select v.data_emissao, count(*), sum(v.total_pedido_venda)
      from erp.concrem_pedidos_venda v
      where v.id_nota_conf  = any (v_id_nota)
        and v.data_emissao >= p_data_inicio
        and v.data_emissao <= p_data_fim
        and v.representante <> all (v_rep_excl)
        and (p_representante is null or v.representante = p_representante)
      group by v.data_emissao
      order by v.data_emissao;
    return;
  end if;

  -- 3) Não global ⇒ filtra pelos arrays. `p_representante` é IGNORADO.

  -- 3a) Sem grupos: representante, operador, e diretor sem grupo vinculado.
  if coalesce(array_length(v_escopo.grupos, 1), 0) = 0 then
    return query
      select v.data_emissao, count(*), sum(v.total_pedido_venda)
      from erp.concrem_pedidos_venda v
      where v.id_nota_conf  = any (v_id_nota)
        and v.data_emissao >= p_data_inicio
        and v.data_emissao <= p_data_fim
        and v.representante <> all (v_rep_excl)
        and v.representante  = any (v_escopo.representantes)
      group by v.data_emissao
      order by v.data_emissao;
    return;
  end if;

  -- 3b) Diretor com grupos: grupos vinculados OU rep codes próprios.
  --     Espelha a cláusula da view. A normalização usa SÓ built-ins.
  return query
    select v.data_emissao, count(*), sum(v.total_pedido_venda)
    from erp.concrem_pedidos_venda v
    where v.id_nota_conf  = any (v_id_nota)
      and v.data_emissao >= p_data_inicio
      and v.data_emissao <= p_data_fim
      and v.representante <> all (v_rep_excl)
      and ( v.representante = any (v_escopo.representantes)
            or coalesce(nullif(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO')
               = any (v_escopo.grupos) )
    group by v.data_emissao
    order by v.data_emissao;
end;
$$;

comment on function public.app_dashboard_serie_diaria(date, date, text) is
  'Série diária agregada de pedidos, no escopo do usuário. Escopo vem de app_escopo_atual(); '
  'p_representante apenas ESTREITA e só vale para perfis globais. Consolidação mensal é do cliente.';

-- Esta RPC É chamada pelo frontend: precisa de EXECUTE para authenticated.
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from public;
revoke all on function public.app_dashboard_serie_diaria(date, date, text) from anon;
grant execute on function public.app_dashboard_serie_diaria(date, date, text) to authenticated;

commit;
```

---

## Decisões tomadas (2026-08-19)

| # | Decisão |
|---|---|
| **D-1** | Preservar o comportamento atual para `representante` NULL. `<> all(...)` com NULL resulta em NULL e a linha é **descartada** — ~1.550 pedidos, 4,85% medidos. Documentado, **não corrigido agora**; fica como decisão futura |
| **D-2** | Aceitar temporariamente a duplicação de `id_nota_conf` e `REP_EXCLUIDOS` entre TypeScript e SQL. **Sem tabela de configuração na E2.** Dívida transitória, a consolidar quando o frontend migrar na E5 |
| **D-3** | `p_representante` inexistente devolve **zero linhas**. Sem consulta de validação |
| **D-4** | A RPC resolve **apenas a série de vendas**: `pedidos`, `valor_total`, série diária. **NÃO** resolve faturado, comissão, pipeline nem carteira. **A E5 não elimina todo o truncamento do Dashboard** |

## D-5 — Quem usa o filtro de representante no Dashboard hoje

Verificado em `src/pages/DashboardPage.tsx` e `src/hooks/useDashboardStats.ts`:

```
DashboardPage.tsx:595   const isAdmin = perfil === 'admin' || perfil === 'diretor_geral';
DashboardPage.tsx:797   {isAdmin && ( <Select … repFiltro … /> )}
useDashboardStats.ts    const rep = representante && representante !== 'todos' ? representante : undefined;
```

| Perfil | Vê o filtro? | Consequência |
|---|---|---|
| representante (inclusive **com múltiplos códigos ERP**) | ❌ | não consegue filtrar por um dos próprios códigos |
| operador | ❌ | — |
| diretor | ❌ | — |
| admin | ✅ | único caminho para enviar o parâmetro |
| diretor_geral | ✅ | idem |

`isAdmin` é **exatamente** `isGlobal`. O `Select` só é renderizado para eles, e o estado nasce em
`'todos'`, que o hook converte para `undefined`.

### Conclusão: ignorar `p_representante` para não-globais **preserva a UX atual**

Nenhum não-global consegue enviar o parâmetro hoje. O contrato proposto está correto e não regride nada.

**Observação, não mudança:** hoje `dashboard.ts` aplicaria o filtro para qualquer perfil, se ele
chegasse — mas o `.in('representante', repCodes)` do escopo continua aplicado, então mesmo uma requisição
forjada só conseguiria **estreitar** dentro do próprio escopo. Ou seja: o comportamento atual já é
"só estreita", e a RPC mantém isso.

**Se um dia quiserem permitir que o representante com vários códigos filtre por um deles**, a forma
correta é um conjunto **adicional** (`and (p_representante is null or v.representante = p_representante)`)
**sobre** o predicado de escopo — nunca substituindo-o. Fora do escopo da E2.

## Pontos que já foram contestados e decididos

### D-1 · `representante` nulo é excluído silenciosamente

`v.representante <> all (v_rep_excl)` com `representante` **nulo** resulta em `null` → a linha **sai**.
A estatística mediu `null_frac = 4,85%` — cerca de **1.550 pedidos sem representante**.

Isto **preserva exatamente** o comportamento atual (`.not('representante','in',…)` no PostgREST faz o
mesmo). Mas é comportamento que ninguém decidiu — herdado. **Manter ou incluir os nulos?** Não mudo sem
sua decisão.

### D-2 · Regras de negócio duplicadas

`id_nota_conf` e `REP_EXCLUIDOS` passam a existir em **dois lugares**: TypeScript e SQL. Divergir é
questão de tempo. Opções: aceitar e documentar (proposto), ou criar tabela de configuração lida pelos
dois lados (mais correto, mais trabalho).

### D-3 · `p_representante` sem validação de existência

Se o admin passar um código inexistente, volta vazio. É o comportamento correto e seguro — mas a tela
precisa saber diferenciar "sem vendas" de "código errado".

### D-4 · A RPC não cobre o Dashboard inteiro

Ela devolve **pedidos e valor por dia**. O Dashboard também mostra faturado, comissão, pipeline e
carteira — que dependem de `concrem_pedidos_status`, `_anexos` e de agregações por outra chave.
**A E5 não elimina todas as consultas antigas do Dashboard**, só a série de vendas. Prefiro dizer isso
agora a descobrir na E5.
