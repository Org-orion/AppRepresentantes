# Plano — Dashboard por agregação diária remota

> **Estado: E0 a E3 concluídas.** `app_escopo_atual()` (E1) e `app_dashboard_serie_diaria()` (E2) estão
> em produção e validadas — ver `docs/E2-PLANO-RPC-DASHBOARD.md` §Resultados.
> **Frontend intocado**: E4 a E8 continuam abertas. Nenhuma alteração de RLS, FDW, cron ou plano.
> Base: rodada M do C0-ter, medida em 2026-08-19.

---

## 1. Conclusão final da rodada M

| Teste | Agrupamento | Resultado |
|---|---|---|
| A3 | `GROUP BY representante`, sem filtro de data | ✅ remoto |
| **M0** | `GROUP BY representante`, **com** filtro de data | ✅ **remoto** |
| **M1** | `GROUP BY data_emissao` | ✅ **remoto** |
| A5 | `GROUP BY date_trunc(...)` (duas variantes) | ❌ local |
| **M2** | `GROUP BY extract(...)` | ❌ **local** |
| **M3** | `date_trunc` com `enable_hashagg` e `enable_sort` desligados | ❌ **local** |

### O que ficou provado

1. **O filtro de data é inocente** — M0 elimina essa variável.
2. **`GROUP BY` por coluna simples desce**, inclusive por `data_emissao` (M1).
3. **`GROUP BY` por expressão não desce** — nem `date_trunc`, nem `extract`.
4. **Não é decisão de custo.** M3 penalizou os caminhos locais em ~10¹⁰ e **nenhum caminho de agregação
   remota apareceu**. Se existisse, teria sido escolhido. É **capacidade**, não preferência.

### Por que exatamente, não sabemos

`count`, `sum`, `date_trunc` e `extract` são todos built-in e, pelo que se documenta, *shippable*. Ainda
assim o `postgres_fdw` desta instalação **não gera caminho de agregação remota quando a chave de
agrupamento é expressão**.

**Não vou investigar mais.** Três hipóteses minhas já foram derrubadas por medição nesta investigação —
`LIMIT`, `security_barrier` e o cast do `date_trunc`. O padrão é claro: **erro quando raciocino sobre o
mecanismo em vez de medir**. E o M1 já entrega uma solução completa, então o custo de continuar não se
paga.

### Existe solução simples que estamos deixando passar?

Avaliadas e descartadas:

| Alternativa | Por que não |
|---|---|
| View no ERP com coluna `mes` pronta | **altera o banco do ERP** — fora de escopo, e cria dependência entre times |
| Coluna gerada no ERP | mesmo problema, e mais invasivo |
| `use_remote_estimate = true` | é sobre custo; M3 provou que o problema **não** é custo |
| Aceitar o cálculo local | é o que existe hoje, e é o problema |

**A agregação diária (M1) é a solução, não um contorno.**

---

## 2. Arquitetura recomendada

```
Frontend
   ↓  (uma chamada)
RPC no Portal — security definer
   ↓  resolve escopo do usuário em valores concretos
consulta erp.concrem_pedidos_venda
   ↓  GROUP BY data_emissao  →  empurrado ao ERP
ERP agrega e devolve ~300 linhas/ano
   ↓
Portal/frontend consolida dias em meses
```

### Números

| Métrica | Hoje | Proposto |
|---|---|---|
| Linhas por ano | até **1.000** (cortadas — e **erradas**) | **≤ 366**, medido ~284/ano¹ |
| Linhas se hoje estivesse correto | **~15.800** | ~284 |
| Redução de tráfego | — | **~98%** contra o correto · ~50× menos linhas |
| Colunas por linha | 5 | 3 |
| Cálculo no Portal | `reduce`/`filter` sobre milhares | `reduce` sobre ~284 |
| Correção do número | ❌ recorte enviesado | ✅ conjunto completo |

¹ `pg_stats` mediu `n_distinct = 568` para `data_emissao` sobre ~2 anos.

### Carga no ERP

O ERP passa a **fazer o trabalho** (varrer e agregar) em vez de **entregar o trabalho**. Varredura
semelhante à de hoje, mas devolve ~284 linhas em vez de milhares. Rede e CPU do Portal despencam.

### Escalabilidade — a propriedade que importa

**O volume de resposta cresce com o número de DIAS, não com o número de pedidos.** Dez vezes mais
pedidos continuam cabendo em ~284 linhas/ano. É o que separa esta arquitetura da atual, que piora
linearmente.

---

## 3. Desenho da RPC

### Regra central

> **Parâmetro só pode ESTREITAR o escopo, nunca ampliar.**

O escopo vem de quem o usuário **é**, resolvido dentro da função. Parâmetro que chegue de fora é
**intersectado** com esse escopo, jamais somado.

### Assinatura proposta

```sql
-- ESBOÇO — não criar ainda
create function app_dashboard_serie_diaria(
  p_data_inicio  date,
  p_data_fim     date,
  p_representante text default null   -- só ESTREITA; ignorado para quem não é global
)
returns table (dia date, pedidos bigint, valor_total numeric)
language plpgsql
stable
security definer
set search_path = public
as $$ … $$;
```

### Lógica interna, em ordem

1. `v_perfil := app_perfil()` — identifica o usuário pelo JWT, **não** por parâmetro.
2. Resolve o escopo em **valores concretos**:
   - global (admin/diretor_geral) → sem filtro de representante;
   - diretor → `v_grupos text[] := array(select …)`;
   - representante/operador → `v_codes text[] := array(select app_my_rep_codes())`.
3. **Sem escopo ⇒ `return;`** (conjunto vazio). Nunca "sem filtro".
4. Aplica `p_representante` **apenas** se o usuário for global; caso contrário **ignora**.
5. Consulta `erp.concrem_pedidos_venda` com predicados **puramente empurráveis**:
   `id_nota_conf = any(...)`, `data_emissao between $1 and $2`, `representante = any(v_codes)`,
   `grupo_cliente = any(v_grupos)`, e a exclusão de vendas diretas.
6. `GROUP BY data_emissao` — provado empurrável em M1.

### ⚠️ Restrições de projeto que nascem das medições

| Restrição | Motivo medido |
|---|---|
| **Nada de `count(distinct …)`** | agregado com `DISTINCT` não é empurrável — derrubaria todo o pushdown |
| **Nada de `date_trunc`/`extract` no `GROUP BY`** | M2 e M3 |
| **Nenhuma função local no `WHERE`** | A6 — basta uma para a agregação virar local |
| **Escopo em array, resolvido antes** | A4 |
| **Regras de negócio dentro da função** | `id_nota_conf` e `REP_EXCLUIDOS` hoje vivem só no TypeScript; se ficarem de fora, o cliente contorna |

### 🔴 O risco de segurança que isto cria

Ao consultar `erp.*`, a função **pula a view — e foreign table não tem RLS**. Hoje a única proteção de
escopo é a cláusula da view. A função assume essa responsabilidade **sozinha**: um `and` esquecido vaza
os dados de todos os representantes.

**Mitigação obrigatória:** o escopo é resolvido por **uma única função auxiliar** reutilizada por todas as
RPCs. Nunca copiado.

---

## 4. Contrato de retorno

### Mínimo (recomendado)

```
dia            date
pedidos        bigint
valor_total    numeric
```

### O que **pode** entrar sem inchar a função

| Campo | Empurrável? | Vale a pena |
|---|---|---|
| `valor_min`, `valor_max` | ✅ `min`/`max` são built-in | talvez |
| `ticket_medio` | — | ❌ **não**: derivar no cliente (`valor_total / pedidos`) |
| `clientes_distintos` | ❌ `count(distinct)` **quebra o pushdown** | ❌ nunca aqui |
| faturado / com NF | exige join com `concrem_pedidos_status` e `_anexos` | ❌ **RPC própria**, depois |

**Princípio:** a RPC devolve o que o banco agrega barato. Derivação aritmética é do cliente.

---

## 5. Arquivos do frontend que mudariam

| Arquivo | Mudança |
|---|---|
| `src/services/dashboard.ts` | `fetchDashboardStats` deixa de buscar pedidos e passa a chamar a RPC + consolidar meses |
| `src/hooks/useDashboardStats.ts` | assinatura mantida — as telas não mudam |
| `src/pages/DashboardPage.tsx` | some o `TruncationNotice` deste caminho (deixa de haver truncamento) |
| `src/services/dashboard.ts` (`truncado`) | campo perde sentido no dashboard |
| **novo** `src/utils/consolidarMeses.ts` | função **pura** dia → mês, com teste próprio |
| `src/constants/apiLimits.ts` | só quando **todas** as telas saírem do truncamento |

**Fora deste escopo:** `carteira.ts`, `performance.ts`, `clientGroups.ts`, Central de Pedidos.

### ⚠️ Armadilha de fuso na consolidação

`data_emissao` é `date`, sem fuso. `new Date('2026-01-01')` no JavaScript vira **meia-noite UTC** — que
em `America/Sao_Paulo` é **31/12/2025**. Consolidar assim **joga o primeiro dia de cada mês para o mês
anterior**.

A consolidação deve trabalhar sobre a **string** (`'2026-01-01'.slice(0, 7)`), ou usar o padrão que o
projeto já tem em `parseAppDate` (meio-dia local). **Teste obrigatório para o dia 1º.**

---

## 6. Testes de segurança (obrigatórios, antes de qualquer uso)

| # | Cenário | Esperado |
|---|---|---|
| S1 | Representante A consulta | só os pedidos dos códigos de A |
| S2 | Representante A passa o código de B em `p_representante` | **parâmetro ignorado** — resultado de A |
| S3 | Diretor consulta | só os grupos vinculados |
| S4 | Diretor tenta representante de fora do grupo | ignorado |
| S5 | Admin consulta | escopo completo |
| S6 | Admin filtra por representante | estreita corretamente |
| S7 | Usuário **sem vínculo** | **conjunto vazio**, não erro e não "tudo" |
| S8 | `anon` chama a função | **permission denied** |
| S9 | Datas invertidas / nulas | vazio ou erro claro, nunca escopo ampliado |
| S10 | `search_path` | fixo em `public`; função não resolve objeto de outro schema |

**S2 e S7 são os que pegam o erro clássico.** Sem eles, não subir.

---

## 7. Testes funcionais

| # | Verificação |
|---|---|
| F1 | Soma dos dias == `count`/`sum` do período inteiro (consulta de controle) |
| F2 | Meses consolidados == soma dos dias correspondentes |
| F3 | **Dia 1º de cada mês cai no mês certo** (armadilha de fuso) |
| F4 | Período sem pedidos → zero linhas; tela mostra zero, não erro |
| F5 | Ano completo devolve ≤ 366 linhas |
| F6 | Números do dashboard **mudam** em relação a hoje — e a diferença é explicável pelo fim do truncamento |
| F7 | `EXPLAIN` da consulta interna continua mostrando `Relations: Aggregate on (…)` |

**F6 merece aviso ao usuário final:** os números vão mudar porque hoje estão errados. Isso precisa ser
comunicado, não descoberto.

---

## 8. Manutenção das estatísticas

`ANALYZE erp.concrem_pedidos_venda` foi **necessário** para o planejador escolher os planos certos —
sem ele, `ORDER BY` e `LIMIT` ficavam locais e a listagem paginada lia tudo.

### Quando repetir

A tabela foi de **29.269** (junho) para **31.949** (agosto) — **~9% em 2 meses**. Como regra:

- **mensal** enquanto o crescimento estiver nesse ritmo;
- **ou** sempre que a divergência abaixo passar de ~15%.

### Como detectar estatística envelhecida — barato

```sql
-- ESBOÇO — count é empurrado (A1), custa UMA linha de resposta
select (select reltuples::bigint from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='erp' and c.relname='concrem_pedidos_venda') as estimado,
       (select count(*) from erp.concrem_pedidos_venda)              as real;
```

Divergência acima de ~15% ⇒ hora de reanalisar.

### Vale aumentar `statistics_target`?

| Coluna | Hoje (alvo 20) | Quando aumentar |
|---|---|---|
| `data_emissao` | 20 baldes em ~2 anos (~5 semanas cada) | se filtro por **mês específico** gerar plano ruim — o balde é maior que o filtro |
| `representante` | 20 MCVs de **189** distintos | se filtro por representante **fora do top-20** gerar plano ruim |
| `id_nota_conf` | 18 MCVs de 36, **os 4 do filtro dentro** | não precisa |
| `grupo_cliente` | 14 de 14 | não precisa |

**Como detectar:** `EXPLAIN` da consulta real com esses filtros; se a estimativa destoar em ordem de
grandeza do que a tela mostra, subir o alvo **daquelas colunas** (não global) e reanalisar.

**Não criar `pg_cron` agora.** Primeiro estabilizar; depois automatizar.

---

## 9. Plano de implementação — etapas pequenas

| # | Etapa | Toca banco? | Reversível | Estado |
|---|---|---|---|---|
| **E0** | **Medir pushdown com PARÂMETROS** via `PREPARE`/`EXPLAIN EXECUTE` — só `EXPLAIN`, nada criado | não | — |
| E1 | Função auxiliar única de escopo + testes de isolamento | sim (migration) | `drop function` | ✅ **APLICADA e validada em 2026-08-19** — owner `postgres`, `search_path=''`, sem EXECUTE para PUBLIC/anon/authenticated; S1–S9, S11, S12 e S16 aprovados |
| E2 | RPC `app_dashboard_serie_diaria` + grants + revoke de `anon` | sim | `drop function` | ✅ **APLICADA em 2026-08-21** — `20260819000400`; owner `postgres`, `search_path=""`, EXECUTE só para `authenticated` |
| E3 | Testes T1–T8 contra a RPC + API real | não | — | ✅ **VALIDADA em 2026-08-21** — pushdown nos 5 ramos, equivalência sem divergência, fail-closed, 117 ms |
| E4 | Função pura de consolidação + testes | não | commit | ✅ **CONCLUÍDA em 2026-08-21** — saiu como `consolidarDashboardSerie()`, não `consolidarMeses`: consolida a série DIÁRIA da RPC, não meses já agregados |
| E5 | `dashboard.ts` passa a usar a RPC, atrás do hook existente | não | commit | ✅ **CONCLUÍDA em 2026-08-21** — E5-0 a E5-6. Evidência em `docs/E5-VERIFICACAO-DASHBOARD.md` |
| E6 | Remover `TruncationNotice` do dashboard | não | commit | 🔴 **NÃO EXECUTAR** — ver abaixo |
| E7 | Comunicar que os números do dashboard mudaram | não | — | 🔵 **ABERTA e mais urgente que o previsto** — a DIV-1 muda o número do DIRETOR, não só a precisão |
| E8 | Decidir manutenção do `ANALYZE` | — | — | 🔵 aberta — virou o achado **A18** em `docs/PLANO-SANEAMENTO.md`. `autovacuum` não analisa foreign table |

### E5 — sub-etapas, todas concluídas em 2026-08-21

| | Sub-etapa | Entregue |
|---|---|---|
| **E5-0** | Medir a DIV-1 antes de escrever código | diretor com grupo + rep temporário: service antigo **3 pedidos / R$ 203.542,70**, união da RPC **15 / R$ 265.522,42**. Decisão: `reps OR grupos` é o contrato correto |
| **E5-0b** | Tipos reais do PostgREST | `pedidos` e `valor_total` chegam como `number`; `dia` como `string` `YYYY-MM-DD` |
| **E5-1** | `dashboardJanelas()` · `dashboardRpcRange()` · `diffDias()` | janela única; máximo real **730 dias**, margem zero; `periodoRange()` passa a derivar da mesma fonte |
| **E5-2** | `fetchDashboardSerieDiaria()` | valida antes da rede, propaga erro com `code`, ordena no cliente, não preenche dias |
| **E5-3** | `consolidarDashboardSerie()` | função pura, 6 baldes sempre presentes, sem `Date`, soma o campo `pedidos` |
| **E5-4** | Integração em `fetchDashboardStats` | 4 campos da RPC; early-return por lista vazia **removido** |
| **E5-5** | `tsc`, `eslint`, 171 testes | verdes |
| **E5-6** | Verificação manual | 9 cenários, 5 perfis, tela × RPC no mesmo instante |

### 🔴 E6 — NÃO remover o `TruncationNotice` agora

A E5 tirou do recorte de 1.000 linhas **apenas a série**. Continuam saindo da consulta bruta, e portanto
continuam sujeitos ao teto do Data API:

`totalPedidos` · `ticketMedio` · `pipeline` · `totalFaturadoMes` · `faturadosNoPeriodo` · `truncado`

O aviso **mudou de significado, não deixou de valer**: antes falava do vendido; agora fala do ticket
médio, do pipeline e do faturado. Removê-lo esconderia um recorte que ainda existe. A E6 só faz sentido
quando `numero_pedido` também vier agregado do banco.

### Trimestre — semântica preservada, e ela não é o trimestre civil

`dashboardJanelas` mantém, sem alteração, a regra que já existia: **janela móvel de 3 meses terminando
no mês corrente** (dezembro, quando o ano selecionado não é o atual). Não é T1/T2/T3/T4.

Foi verificado na E5-6: período atual **Jun–Ago**, anterior **Mar–Mai**. A E5 **não mexeu nisso** de
propósito — mudar seria alterar número sem pedido. A divergência entre o que a UI sugere e o que o
cálculo faz está registrada como achado **A20**.

### Limite de 730 dias — validado no navegador

O pior caso do sistema (`periodo = 'ano'` com um 29/02 na união) bate **exatamente** no teto da RPC.
Testado com `diretor_geral`, ano **2025** → janela `2024-01-01 → 2025-12-31`, **730 dias**:
tela carregou normalmente, **R$ 161,0M / 3.874 pedidos / +285,9%**, **sem `22023`**.

⚠️ **Margem zero.** Alargar a série de 6 para 12 meses, ou criar um período de 2 anos, estoura o teto.
O teste `NENHUMA combinação de período/ano/mês passa de 730 dias` em `src/services/dashboard.test.ts`
trava esse limite.

### E0 é o próximo passo, e não cria nada

A4 provou o pushdown **com literais**. Dentro de uma função os valores chegam como **parâmetros**, e o
plano pode ser genérico. Isto se testa **antes** de criar qualquer função:

```sql
-- Nada é criado no schema; PREPARE vive só na sessão
prepare t_serie(date, date, text[]) as
select data_emissao, count(*), sum(total_pedido_venda)
from erp.concrem_pedidos_venda
where id_nota_conf = any (array[307,309,613,665])
  and data_emissao >= $1
  and data_emissao <= $2
  and representante = any ($3)
group by data_emissao;

explain (verbose, costs, format text)
execute t_serie('2026-01-01', '2026-12-31', array['<COD_REP_1>','<COD_REP_2>']);

deallocate t_serie;
```

**Confirma se:** `Relations: Aggregate on (erp.concrem_pedidos_venda)` e o `Remote SQL` trouxer
`count(*)`, `sum(...)`, `GROUP BY` **e** os predicados com os valores dos parâmetros.

**Se não confirmar**, a arquitetura de RPC precisa ser repensada **antes** de existir — e é para isso
que E0 vem primeiro.
