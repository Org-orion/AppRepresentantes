# E2 — Plano técnico da primeira RPC de negócio

> ✅ **E2 APLICADA e E3 VALIDADA em 2026-08-21.** Migration
> `supabase/migrations/20260819000400_rpc_dashboard_serie_diaria.sql` em produção.
> Resultados abaixo. Frontend **ainda não migrado** — isso é a E5.
>
> Base: E1 aplicada e validada (`app_escopo_atual()` em produção, owner `postgres`,
> `search_path=""`, sem EXECUTE para PUBLIC/`anon`/`authenticated`; **`service_role` tem EXECUTE**).

---

## Resultados — E2 aplicada, E3 validada (2026-08-21)

### T6 · RPC nova — propriedades e ACL · **OK**

| owner | SECURITY DEFINER | volatilidade | `search_path` | PUBLIC | `anon` | `authenticated` | `service_role` |
|---|---|---|---|---|---|---|---|
| `postgres` | true | `s` (STABLE) | `""` | — | — | **EXECUTE** | — |

### T6-b · E1 preservada · **OK**

| owner | SECURITY DEFINER | volatilidade | `search_path` | PUBLIC | `anon` | `authenticated` | `service_role` |
|---|---|---|---|---|---|---|---|
| `postgres` | true | `s` (STABLE) | `""` | — | — | — | **EXECUTE** |

A migration da E2 **não alterou** a ACL da E1. A assimetria em `service_role` é deliberada — ver
`supabase/migrations/README.md`.

> A verificação usa inspeção de `proacl` com `aclexplode`, tratando `proacl is null` como
> "PUBLIC tem EXECUTE". `proconfig` é conferido extraindo o **valor** de `search_path`, porque a forma
> realmente armazenada é `search_path=""` — o teste antigo com `@> array['search_path=']` dava falso
> positivo e não validava nada.

### T1 · Aggregate pushdown pós-migration · **5/5 PASSOU**

| Ramo | Medido em | T1 |
|---|---|---|
| A1 · global sem `p_representante` | **N9** | ✅ |
| A2 · global com `p_representante` | N6 | ✅ |
| B · somente rep codes | N7c | ✅ |
| C · rep codes + grupos (`OR`) | N5b | ✅ |
| B-grupos · somente grupos | **N8** | ✅ |

Todos com `Relations: Aggregate on (erp.concrem_pedidos_venda)` e a agregação dentro do `Remote SQL`.

### T2 · Equivalência RPC × view atual · **zero divergências em 7 cenários**

| Cenário | Ramo | Divergências |
|---|---|---|
| representante Danilo | B | **0** |
| diretor só `DAG COMERCIO` | B-grupos | **0** |
| admin global | A1 | **0** |
| admin com `p_representante` | A2 | **0** |
| diretor_geral global | A1 | **0** |
| operador sem escopo | — | **0** |
| diretor artificial `DAG COMERCIO` + Danilo | C | **0** |

O vínculo artificial do último caso foi criado dentro da transação e **desfeito pelo rollback**;
residual conferido = 0. **Este era o teste que decidia a E2** — fecha a hipótese H-2, de que o `OR` do
ramo C reproduzisse mesmo o que a view faz para o diretor.

### T3 · Fail-closed · **4/4**

| Cenário | Linhas |
|---|---|
| operador sem escopo | **0** |
| UUID inexistente | **0** |
| sem JWT | **0** |
| Danilo temporariamente inativo | **0** |

`rollback` confirmou `ativo = true` para o Danilo depois do teste.

### T4 · Não-global com `p_representante` alheio · **ignorado, como projetado**

| | sem parâmetro | com representante da Valarini |
|---|---|---|
| status | 200 | 200 |
| linhas | 37 | 37 |

`resultadosIdenticos = true`, na API real com o JWT do Danilo. O parâmetro **não estreita nem amplia**
para quem não é global — preserva a UX atual (D-5) sem abrir caminho de escalação.

### T5 · Validação de entrada · **5/5**

| Entrada | `errcode` |
|---|---|
| data inicial nula | `22004` |
| data final nula | `22004` |
| datas invertidas | `22007` |
| janela de 731 dias | `22023` |
| janela de 730 dias | **aceita** |

### T7 · Truncamento · **não ocorre**

Janela máxima com admin: 366 linhas no SQL e na API — `status 200`, `Content-Range: 0-365/366`,
**sem corte**. O teto de 730 dias faz o que foi projetado para fazer (achado A17).

### T8 · Desempenho · **117 ms contra teto de 8 s**

`Execution Time = 117,496 ms` com `statement_timeout = 8s`.

Seis execuções consecutivas: **153 · 50 · 50 · 50 · 50 · 52 ms**, sempre os mesmos 366 dias,
4.898 pedidos e o mesmo valor.

**Nenhuma degradação na 6ª** — a transição de plano customizado para genérico do plpgsql **não** derruba
o pushdown. É a melhor evidência disponível para a hipótese H-1: se a agregação tivesse voltado para
local, seriam ~31 mil linhas atravessando o FDW com `fetch_size=100`, e o tempo denunciaria.

### API real

| Chamada | Resultado |
|---|---|
| `authenticated` admin | 200, com dados |
| `anon` | **401**, `code 42501`, permission denied |
| admin com representante inexistente | 200, **0 linhas** |
| Danilo passando representante da Valarini | 200/200, 37/37, idênticos |

### Hipóteses fechadas

| | Hipótese | Fechada por |
|---|---|---|
| H-1 | pushdown vale dentro da função | T8 — 117 ms, sem degradação na 6ª |
| H-2 | o `OR` do ramo C reproduz a view | **T2** — 7 cenários, zero divergência |
| H-3 | plano customizado × genérico | T8, seis execuções |
| H-5 | duração contra o teto de 8 s | T8 |
| H-6 | linhas com `data_emissao` nula | T2, sem divergência |

**Aberta:** H-4 — foreign table nunca recebe `autoanalyze`. Virou achado **A18** em
`docs/PLANO-SANEAMENTO.md`. Não bloqueia a E5.

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

Sete testes em `supabase/tests/e2_medicao_pushdown.sql`, **só `EXPLAIN`**, com valores reais e sem
placeholder. Depois de errar três vezes nesta investigação por raciocinar em vez de medir, os predicados
novos vão para o `EXPLAIN` primeiro.

| # | O que prova |
|---|---|
| N1 | normalização de grupo com built-ins é empurrável — **a que pode derrubar o ramo do diretor** |
| N2 | `OR` entre dois predicados de array é empurrável |
| N3 | exclusão de vendas diretas é empurrável |
| N4 | ramo C **completo**, com literais |
| N5 | ramo C **completo**, parametrizado com `force_generic_plan` |
| N6 | ramo global com `p_representante`, parametrizado |
| N7 | ramo B, parametrizado |

**N4 e N5 são os decisivos.** Se N1 falhar, o desenho do ramo do diretor muda antes de existir código.

### 🔴 N1 REPROVADO — 2026-08-20

```
GroupAggregate
  -> Sort
       -> Foreign Scan on erp.concrem_pedidos_venda

Filter local: COALESCE(NULLIF(upper(btrim(v.grupo_cliente)), ''), 'SEM GRUPO') = ANY ('{"DAG COMERCIO"}')
Remote SQL levou só: id_nota_conf = ANY ('{307,309,613,665}')
```

A normalização de grupo **não desce ao ERP** e a agregação volta a ser local — mesma assinatura de A5,
M2 e M3. **O ramo C está reprovado.** N2, N4 e N5 ficam suspensos: todos dependem desta expressão.

Nota: `representante = any (array[...])` **já desceu** antes (caso E do C0). A diferença aqui é haver
**função aplicada sobre a coluna**. Daí a decomposição N1a–N1d — uma variável por teste, sem
`coalesce`/`nullif`, para descobrir exatamente onde o pushdown morre.

| # | Expressão | O que isola |
|---|---|---|
| N1a | `grupo_cliente` | linha de base: a coluna crua, sem função |
| N1b | `btrim(col)` | uma função só |
| N1c | `upper(col)` | a outra função só |
| N1d | `upper(btrim(col))` | a composição |

Sem hipótese registrada antes do resultado — errei três vezes nesta investigação raciocinando sobre o
mecanismo em vez de medir.

### Regras de negócio conferidas no código (2026-08-19)

| Regra | Origem | Valores |
|---|---|---|
| `id_nota_conf` | `src/constants/orderFilters.ts:11` | **`[307, 309, 613, 665]`** — exatamente quatro |
| `REP_EXCLUIDOS` | `src/services/pedidosVenda.ts:17` | **`['40001498 - JANDERSON LEROY MERLIN']`** — um único valor |

Confirmado por varredura: **não há segunda lista de exclusão** no projeto. `REP_EXCLUIDOS` é consumido
por `pedidosVenda.ts` (4×), `dashboard.ts`, `acompanhamento.ts`, `financeiro.ts` e `performance.ts` (2×);
`VALID_ID_NOTA_CONF` pelos mesmos, mais `carteira.ts` e `clientGroups.ts`.

**Equivalência SQL usada nos testes:** `representante <> ALL (array[...])` é idêntico a
`NOT (representante = ANY (array[...]))`, que é o que o PostgREST gera a partir de
`.not('representante','in',…)`. Mesma semântica, **inclusive para NULL** — em ambos o resultado é NULL e
a linha é descartada (decisão D-1).

---

## 4. Arquivos — o que foi planejado e o que de fato aconteceu

> **Esta seção é histórica.** A coluna "Plano" é o que estava previsto **antes** da execução, preservada
> de propósito. A coluna "Estado real" é o que vale hoje — **é ela que descreve o repositório**.
> O estado atual da E2 e da E3 está na seção **Resultados**, no topo do documento: ambas **concluídas**,
> migration **aplicada** em 2026-08-21.

| Arquivo | Plano (antes) | Estado real (2026-08-21) |
|---|---|---|
| `supabase/tests/e2_medicao_pushdown.sql` | criar — N1, N2, N3, só `EXPLAIN` | ✅ criado, e **cresceu**: N1 foi reprovado e exigiu a decomposição N1a–N1f; depois vieram N5b, N6, N7c, N8 e N9. Registro de vereditos no rodapé |
| `supabase/migrations/20260819000400_rpc_dashboard_serie_diaria.sql` | criar | ✅ criado **e APLICADO** em produção. Não é mais "pendente" |
| `supabase/tests/rpc_dashboard_serie_diaria.sql` | criar — testes da E3 | ⚠️ **nunca criado com esse nome.** Os testes foram executados direto no SQL Editor durante a E3 e só depois versionados, como `supabase/tests/e3_rpc_dashboard_serie_diaria.sql` |
| `supabase/migrations/README.md` | alterar — registrar como **pendente** | ✅ alterado, registrando como **aplicada**, mais a tabela de ACL das duas funções |
| `docs/PLANO-DASHBOARD-RPC.md` | alterar — E1 concluída, **E2 em revisão** | ✅ alterado: **E2 aplicada e E3 validada**; E8 remete ao achado A18 |

**O que o plano não previa e a execução obrigou:** a decomposição N1a–N1f (achado A15), o abandono do
`ORDER BY` (A16), o teto de janela de 730 dias (A17), o `alter function … owner to postgres` explícito,
e a correção da validação de `search_path`, que era falso positivo.

**Nenhum arquivo de `src/` foi tocado na E2 nem na E3.** O frontend só muda na E5.

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
