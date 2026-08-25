# Análise técnica — arquitetura de consultas do Portal

> Diagnóstico de leitura, **sem alteração de código, banco, FDW, RLS ou plano**.
> Data: 2026-08-19 · Base: 31.906 pedidos no ERP, ~7.600 dentro da regra `id_nota_conf`.
> Contexto: Portal ainda **sem usuários reais**; dados do ERP são consulta, orçamentos são criação.

---

## 1. Diagnóstico atual

### 1.1 Inventário completo das consultas a `concrem_pedidos_venda`

| # | Arquivo · função | Limite pedido | Recebe | Problema |
|---|---|---|---|---|
| Q1 | `pedidosVenda.ts` · `fetchPedidosVenda` | `range(from,to)` 50/pág + `count exact` | 50 | ✅ **única com paginação real** — mas dispara Q3 |
| Q2 | `pedidosVenda.ts` · `fetchPedidosCompleto` | `.limit(1500)` | **1.000** | Central de Pedidos opera 100% no cliente |
| Q3 | `pedidosVenda.ts` · `enriquecerPedidos` | lotes de 200 | — | **2 requisições a cada 200 pedidos** (status + anexos) |
| Q4 | `pedidosVenda.ts` · `fetchSituacoesEntrega` | nenhum | **1.000** | `DISTINCT` feito em JS sobre recorte |
| Q5 | `pedidosVenda.ts` · `fetchRepresentantesUnicos` | nenhum | **1.000** | idem — **o filtro de representante fica incompleto** |
| Q6 | `acompanhamento.ts` · `fetchAcompanhamento` | nenhum | **1.000** | + status, histórico e anexos em lotes de 200 (**3 séries**) |
| Q7 | `dashboard.ts` · `fetchDashboardStats` | nenhum | **1.000** | totais e recorte de período calculados em JS |
| Q8 | `carteira.ts` · `fetchCarteira` | `.limit(5000)` | **1.000** | dedup por CNPJ em JS |
| Q9 | `financeiro.ts` · `fetchFinanceiro` | nenhum (×2) | **1.000** | anexos e status, ambos cortados |
| Q10 | `performance.ts` · `fetchRepPerformance` | `.limit(50000)` | **1.000** | ranking de representantes sobre 3% da base |
| Q11 | `clientGroups.ts` · `fetchCnpjsDosGrupos` | `.limit(50000)` | **1.000** | mapa cliente→grupo incompleto |

### 1.2 Defeitos concretos que isso produz hoje

**D-1 · Filtro de representante incompleto (Q5).** O `select` traz `representante` das 1.000 linhas mais
recentes e faz `new Set(...)` em JS. Representante que não vendeu recentemente **não aparece no filtro** —
o admin não consegue filtrar por ele. Mesmo defeito em Q4 para situação de entrega.

**D-2 · Dashboard zera períodos antigos (Q7).** A consulta **não filtra por data**: traz as 1.000 mais
recentes e recorta o período em JavaScript. Selecionar **Ano 2025** filtra 2025 dentro de um conjunto que
só tem 2026 → **R$ 0,00**. Não é "número impreciso": é zero onde deveria haver o ano inteiro.

**D-3 · Ranking de representantes sobre 3% da base (Q10).** Pede 50.000, recebe 1.000.

**D-4 · Indicadores operacionais enviesados (Q6).** Ordenação `data_emissao desc` faz o corte descartar
sempre o mais antigo — exatamente onde estão os pedidos parados e atrasados. "266 parados" é piso.

**D-5 · N+1 em lote (Q3, Q6, Q9).** Para 1.000 pedidos: Central de Pedidos faz 1 + (5×2) = **11
requisições**; Acompanhamento faz 1 + 5 + 5 + 5 = **16**. Cada uma atravessa PostgREST → Postgres do
Portal → FDW → Postgres do ERP.

**D-6 · Consultas duplicadas na mesma tela.** O Dashboard carrega, em paralelo, `useDashboardStats`
(pedidos), `useCarteira` (pedidos de novo, outras colunas) e `useRepresentantesUnicos` (pedidos de novo,
uma coluna) — **três varreduras da mesma tabela remota** para montar uma tela.

### 1.3 O que já está correto

- `fetchPedidosVenda` (Q1) usa `range()` + `count: 'exact'` — o padrão certo, presente e não usado nas
  telas que mais doem.
- O filtro `id_nota_conf` é aplicado **na origem** em todas as consultas.
- O escopo por perfil é aplicado na consulta **e** garantido por RLS.
- As telas já **avisam** quando o corte acontece (mitigação de hoje).

---

## 2. Causa raiz

São **três camadas**, e só a primeira é a que aparece:

**Camada 1 — o corte (sintoma).** `Max rows = 1000` no Data API. Confirmado por
`Content-Range: 0-999/*` numa consulta sem `limit`. É teto **global**: `.limit(1500)`, `.limit(5000)` e
`.limit(50000)` são todos ficção.

**Camada 2 — a arquitetura (causa real).** O app foi desenhado para **baixar e processar no cliente**:
filtro de período, agregação, dedup, `DISTINCT` e ranking acontecem em JavaScript. O teto de 1.000 não
criou esse desenho — só tornou visível. **Sem o teto, o app baixaria 31 mil linhas para contar.**

**Camada 3 — o FDW sem empurrar filtro (hipótese forte, a medir).** As views são
`security_barrier` e filtram por funções locais:

```sql
where app_is_admin() or v.representante in (select app_my_rep_codes())
```

`app_is_admin()` e `app_my_rep_codes()` são funções **locais** `security definer` — o `postgres_fdw`
não tem como enviá-las ao ERP. E `security_barrier` **impede** que condições externas desçam abaixo da
barreira quando não são *leakproof* (`ilike` não é). A consequência provável: **o Postgres do Portal puxa
a tabela remota inteira e filtra depois**, a cada requisição de cada usuário.

⚠️ **NÃO VERIFICADO.** É a explicação que melhor casa com os sintomas, mas exige `EXPLAIN ANALYZE` —
comando de medição no §7.

### O que **não** é a causa

| Suspeita | Veredito |
|---|---|
| Limitação do plano Free | ❌ **Não.** `Max rows` é configuração de projeto, existe em qualquer plano |
| Limite do FDW | ❌ Não. O FDW não impõe teto de linhas |
| Falta de índice no Portal | ❌ Não se aplica — *foreign tables* não têm índice local |
| RLS bloqueando linhas | ❌ Não. Como admin, o escopo é global e o corte acontece igual |

---

## 3. Arquitetura recomendada

### 3.1 Princípio

> O banco decide **o que** e **quanto** volta. O frontend recebe **a página que vai desenhar** e os
> **números já calculados**. Nada de baixar conjunto para contar.

### 3.2 Modelo A — consulta ao vivo, corrigida

Mantém o FDW e conserta o resto: paginação por `range()` em todas as listas, filtros em SQL, agregados
por RPC, enriquecimento por `join` numa view (mata o N+1).

**Ganha:** dado sempre fresco; sem sincronização para manter.
**Não resolve:** cada interação continua consultando o ERP ao vivo; se o pushdown não acontecer (camada
3), a agregação puxa a tabela remota inteira — pode ficar **mais lento** que hoje.

### 3.3 Modelo B — cache local sincronizado ✅ **recomendado**

```
ERP  ──(pg_cron, incremental por updated_at)──►  tabelas locais do Portal  ──►  RLS  ──►  frontend
```

Réplica local de `concrem_pedidos_venda`, `concrem_pedidos_status`,
`concrem_pedidos_status_historico` e `concrem_relatorio_entrega_anexos` — só as colunas usadas e só
`id_nota_conf in (307,309,613,665)`, o que reduz de 31.906 para ~7.600 linhas.

**Por que este, e não o A:**

1. **Índices.** *Foreign table* não aceita índice. Tabela local aceita — e é o que faz paginação, busca
   e agregação ficarem baratas de verdade.
2. **O pushdown deixa de importar.** O problema da camada 3 evapora: a consulta do usuário nunca sai do
   Portal.
3. **Carga no ERP cai.** Hoje: N usuários × M interações × consulta remota. Depois: uma sincronização a
   cada poucos minutos, independente de quantos representantes estiverem online. É a diferença entre
   escalar com usuários e escalar com o relógio.
4. **Resiliência — e isto não é teórico.** No incidente de hoje o FDW caiu e o portal exibiu **zero
   pedidos**. Com cache local, teria exibido os dados da última sincronização, com aviso de defasagem.
   Falha de integração viraria dado velho, não sistema vazio.
5. **Agregados viram triviais.** `count`, `sum`, `group by` sobre tabela local com índice.

**Custos, sem maquiagem:**

| Desvantagem | Tamanho real |
|---|---|
| Defasagem | 5–15 min. Precisa aparecer na tela ("atualizado há X min") |
| Complexidade | Uma função de sync + agendamento + tabela de controle |
| Exclusões no ERP | O `updated_at` não detecta linha apagada — exige reconciliação periódica |
| Armazenamento | ~7.600 pedidos + status + anexos ≈ dezenas de MB. Irrelevante |
| Mais uma peça para falhar | Sync precisa de monitoramento (casa com a Etapa 11) |

**Frequência sugerida:** pedidos e status a cada **5 min** (status muda ao longo do dia e alimenta o
Acompanhamento); anexos a cada 15 min; reconciliação completa 1×/dia, fora do horário comercial.

**Consistência:** `updated_at` do ERP como marca d'água, gravada numa tabela `sync_control`;
`insert … on conflict do update`; reconciliação diária comparando `count` e conjunto de chaves para
capturar exclusões.

**Momento ideal:** agora. **Sem usuários reais**, uma troca de fonte de dados é um refactor. Com
usuários, é migração.

---

## 4. Mudanças necessárias

### 4.1 Banco — tabelas de cache

```sql
create table erp_cache_pedidos (
  numero_pedido text primary key,
  id_nota_conf int, data_emissao date, previsao_embarque date,
  cliente_cnpj text, cliente_nome text, cliente_fantasia text,
  cliente_cidade text, cliente_uf text, grupo_cliente text,
  representante text, total_pedido_venda numeric, total_qtd numeric,
  situacao_entrega text, dados_tabela jsonb,
  erp_updated_at timestamptz, sincronizado_em timestamptz default now()
);
```

(+ `erp_cache_status`, `erp_cache_status_historico`, `erp_cache_anexos`, `sync_control`)

### 4.2 Banco — índices (§ Etapa 4 do pedido)

| Índice | Serve |
|---|---|
| `(representante, data_emissao desc)` | escopo do representante + ordenação padrão — **o mais importante** |
| `(grupo_cliente, data_emissao desc)` | escopo do diretor |
| `(data_emissao desc)` | listagem global do admin |
| `(cliente_cnpj)` | carteira e deep-link `?cnpj=` |
| `numero_pedido` (PK) | busca por número e joins |
| `gin` em `(numero_pedido, cliente_nome, cliente_fantasia)` via `pg_trgm` | busca textual sem varredura |
| `(id_nota_conf)` | só se o cache **não** for pré-filtrado; se for, desnecessário |

Índice em *foreign table* **não existe** — todos estes só passam a ser possíveis com o Modelo B.

### 4.3 Banco — funções de leitura

| Função | Substitui |
|---|---|
| `app_pedidos_pagina(filtros…, limite, offset)` | Q1, Q2 |
| `app_pedidos_indicadores(filtros…)` | Q6, Q7 (parados/atrasados/docs/pipeline) |
| `app_dashboard_stats(periodo, ano, mes, rep)` | Q7 — **com filtro de data no SQL** |
| `app_carteira_clientes(filtros…)` | Q8 — `group by cliente_cnpj` |
| `app_rep_performance(range)` | Q10 |
| `app_filtros_disponiveis()` | Q4, Q5 — `DISTINCT` no banco |

Todas `security definer`, com escopo aplicado **dentro** (o cliente não escolhe o que agrega).

### 4.4 Frontend

| Arquivo | Mudança |
|---|---|
| `services/pedidosVenda.ts` | `fetchPedidosCompleto` deixa de existir; Central de Pedidos passa a paginar |
| `services/acompanhamento.ts` | lista paginada + indicadores por RPC; some o N+1 |
| `services/dashboard.ts` | vira uma chamada de RPC |
| `services/carteira.ts` | agregação sai do JS |
| `services/performance.ts` · `clientGroups.ts` | idem |
| `pages/PedidosPage.tsx` | filtros e busca passam a ir ao servidor (hoje filtram `base` em memória) |
| `constants/apiLimits.ts` · `TruncationNotice` | **removidos** quando nada mais truncar |

---

## 5. Plano de execução

Cada etapa é reversível e entrega valor sozinha.

| # | Etapa | Risco | Depende de |
|---|---|---|---|
| **C0** | **Medir**: `EXPLAIN ANALYZE` nas consultas reais para confirmar/derrubar a camada 3 | nenhum (só leitura) | — |
| **C1** | `DISTINCT` no banco para os filtros (Q4, Q5) — corrige D-1 | baixo | — |
| **C2** | Filtro de período no SQL do dashboard (Q7) — corrige D-2 | baixo | — |
| **C3** | Tabelas de cache + sync incremental + `sync_control`, **sem trocar o app** | médio | C0 |
| **C4** | Índices sobre o cache | baixo | C3 |
| **C5** | RPCs de leitura paginada e de indicadores | médio | C3, C4 |
| **C6** | Migrar tela por tela: Pedidos → Acompanhamento → Financeiro → Carteira → Dashboard | médio | C5 |
| **C7** | Aviso de defasagem ("atualizado há X min") | baixo | C3 |
| **C8** | Monitorar o sync (casa com a Etapa 11) | baixo | C3 |
| **C9** | Remover `TruncationNotice` e `apiLimits` quando nada mais truncar | baixo | C6 |

**C1 e C2 podem ir antes de tudo:** corrigem defeitos visíveis, são pequenos e não dependem da decisão
de arquitetura.

---

## 6. Free × Pro — resposta objetiva

> **O problema atual exige migrar para o PRO?** **Não.**

### Problemas de arquitetura — independem do plano

Agregação e filtro em JavaScript · ausência de paginação nas telas principais · `DISTINCT` no cliente ·
N+1 em lote · consultas duplicadas na mesma tela · `Max rows` (que é **configuração**, não plano) ·
provável ausência de pushdown no FDW · ausência de índices (consequência de usar *foreign table*).

**Nada disso melhora com Pro.** Migrar agora só tornaria a ineficiência mais cara e mais silenciosa.

### Limitações reais do plano Free

| Limitação | Impacto | Relação com o problema |
|---|---|---|
| **Sem backup gerenciado** (A9) | banco de produção sem backup automático. Desde 25/08/2026 há backup manual verificado, com restore da aplicação testado — mas sem automação nem retenção | **nenhuma** |
| Pausa por inatividade | portal fora do ar após dias sem uso | nenhuma |
| Sem branching | não há ambiente para ensaiar migration | indireta |
| Compute/egress menores | pioram o que já é ineficiente | agravante, não causa |

### Benefícios do Pro

Backup diário e PITR · sem pausa · branching · mais compute (o sync do Modelo B roda melhor) · logs
retidos por mais tempo.

### Conclusão

**Dois assuntos separados, e é importante não misturar:**

1. **Consulta de pedidos:** problema de arquitetura. **Resolve-se sem trocar de plano.**
2. **Continuidade:** o Portal está sem backup nenhum. **Isso justifica o Pro sozinho**, e justificaria
   mesmo que a arquitetura fosse perfeita.

Você tem razão em não querer usar o plano para esconder consulta ineficiente. E continua tendo razão em
querer backup.

---

## 7. Riscos e cuidados

| # | Risco | Cuidado |
|---|---|---|
| R-A | **Sem backup** — qualquer erro é irreversível | Dump manual antes de cada mudança (`docs/BACKUP-MANUAL.md`) |
| R-B | Cache introduz defasagem invisível | Aviso na tela + monitor de sync; sync parado precisa **gritar** |
| R-C | Exclusão no ERP não propaga | Reconciliação diária por conjunto de chaves |
| R-D | Sync pesar no ERP | Incremental por `updated_at`, fora de pico, com limite por lote |
| R-E | RLS nova sobre o cache | Replicar exatamente o escopo atual e cobrir com teste de integração |
| R-F | Regra em dois lugares (TS e SQL) | Mapa de status como **tabela** + teste comparando as duas fontes |
| R-G | Migrar tudo de uma vez | Tela por tela, com o caminho antigo ainda de pé |
| R-H | Medição pode derrubar a hipótese do pushdown | Por isso **C0 vem antes** — se o FDW empurrar bem, o Modelo A fica viável e mais barato |

### Comando de medição (C0) — só leitura, seguro

No SQL Editor do Portal:

```sql
explain (analyze, buffers, verbose)
select * from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665)
 order by data_emissao desc
 limit 50;

explain (analyze, verbose)
select count(*) from concrem_pedidos_venda
 where id_nota_conf in (307,309,613,665);
```

**O que procurar no plano:**

- `Foreign Scan` com **`Remote SQL:` contendo o `WHERE`** → o filtro foi empurrado ✅
- `Foreign Scan` com `Remote SQL: SELECT … FROM public.concrem_pedidos_venda` **sem `WHERE`**, e
  `rows=31906` no scan → **puxou tudo e filtrou aqui** ❌ — confirma a camada 3
- Tempo total e `Buffers` dão a régua de quanto custa hoje.
