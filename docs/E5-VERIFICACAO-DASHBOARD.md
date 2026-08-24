# E5 — Dashboard consumindo a RPC de série diária

> ✅ **CONCLUÍDA em 2026-08-21.** Sub-etapas E5-0 a E5-6, sem lacuna conhecida de validação.
>
> Base: E1 (`app_escopo_atual`) e E2/E3 (`app_dashboard_serie_diaria`) em produção — ver
> `docs/E2-PLANO-RPC-DASHBOARD.md`.
>
> **Nenhuma migration, nenhuma alteração de banco.** A E5 é inteiramente frontend.

---

## 1. O que mudou, em uma frase

Quatro números do dashboard deixaram de ser calculados sobre um **recorte arbitrário de 1.000 pedidos**
e passaram a vir agregados do ERP.

O quanto isso importa fica claro no que a consulta antiga era: `select` sem `order by`, sem `limit`,
cortado em 1.000 linhas pelo Data API — ou seja, o dashboard agregava sobre **uma fatia de ordem
indefinida**. Dois carregamentos podiam devolver conjuntos diferentes.

---

## 2. Arquitetura final

```
filtros { periodo, ano, mes, representante }
        │
        ▼
dashboardJanelas(filtros)          ── fonte ÚNICA das datas
        │   mesIni/mesFim · mesAntIni/mesAntFim · serieIni/serieFim
        ▼
dashboardRpcRange(filtros)         ── janela única que cobre as três
        │   { ini, fim, dias, excedeTeto }
        ▼
fetchDashboardSerieDiaria(ini, fim, representante?)
        │   valida → supabase.rpc('app_dashboard_serie_diaria') → coage tipos → ORDENA
        ▼
consolidarDashboardSerie(serie, janelas)     ── função PURA
        │   totalVendidoMes · totalVendidoMesAnt · pedidosNoPeriodo · vendasMensais
        ▼
fetchDashboardStats(...)           ── junta com a lista bruta (pipeline, faturado, ticket)
        │   contrato DashboardStats INALTERADO
        ▼
useDashboardStats  →  DashboardPage · useExecutiveSummary · OverviewPage
```

**Nenhum componente, página ou hook foi alterado.** Preservar o contrato `DashboardStats` fez a E5 caber
inteira dentro de `src/services/dashboard.ts` — o menor raio de impacto possível numa tela de 1.080
linhas sem teste de renderização.

`periodoRange()` passou a derivar de `dashboardJanelas()`. Antes a mesma regra de período existia em dois
lugares; agora existe em um.

---

## 3. Campos migrados para a RPC

| Campo | Como sai da série |
|---|---|
| `totalVendidoMes` | soma de `valor_total` em `[mesIni, mesFim]`, inclusive nas duas pontas |
| `totalVendidoMesAnt` | soma de `valor_total` em `[mesAntIni, mesAntFim]` |
| `pedidosNoPeriodo` | soma do **campo** `pedidos` — **não** a contagem de linhas |
| `vendasMensais` | 6 baldes mensais terminando no mês de `mesFim`, sempre presentes |

> `pedidosNoPeriodo` somar o campo e não contar linhas é o ponto mais fácil de errar: **uma linha diária
> representa vários pedidos**. Contar linhas subestimaria o número silenciosamente.

## 4. Campos que permanecem na consulta bruta

| Campo | Por quê |
|---|---|
| `totalPedidos` | `pedidos.length` |
| `ticketMedio` | soma bruta ÷ contagem — hoje **sem filtro de data**, o que a RPC não reproduz |
| `pipeline` | precisa de `numero_pedido` para cruzar com `concrem_pedidos_status` |
| `totalFaturadoMes` · `faturadosNoPeriodo` | precisam de `numero_pedido` para cruzar com `relatorio_entrega_anexos` |
| `truncado` | `atingiuTeto(pedidos.length)` |

**Consequência direta: o `TruncationNotice` continua na tela.** Ele mudou de significado — antes falava
do vendido, agora fala do ticket médio, do pipeline e do faturado. Removê-lo (etapa E6) esconderia um
recorte que ainda existe.

---

## 5. E5-0 — a DIV-1, medida antes de escrever código

O service antigo filtrava o diretor **apenas por grupo**; a RPC usa `reps OR grupos`, como a view. A
diferença nunca tinha sido medida — o T2 da E3 comparou a RPC com a **view**, não com o **service**.

Sujeito: diretor de teste, grupo `DAG COMERCIO`, com `10008082 - DANILO AUGUSTO REHNEIN` vinculado
**temporariamente**, em transação. Janela `2026-01-01 → 2026-08-20`.

| Conjunto | Pedidos | Valor |
|---|---|---|
| Service antigo — só grupo | 3 | R$ 203.542,70 |
| Só representantes, fora do grupo | 12 | R$ 61.979,72 |
| Interseção reps ∩ grupos | 0 | R$ 0,00 |
| **União esperada** | **15** | **R$ 265.522,42** |
| **RPC real** | **15** | **R$ 265.522,42** |

**`rpc_igual_uniao = true`.** Delta: **+12 pedidos**, **+R$ 61.979,72**, **+400 % em quantidade**.

`rollback` executado; **residual do vínculo temporário = 0**.

**Decisão registrada:** `reps OR grupos` é o contrato correto. A semântica antiga do service, que
ignorava os rep codes do diretor, **não** foi preservada.

> Isto **muda o número que o diretor vê**, para mais. Não é efeito colateral: é correção. A comunicação
> disso é a etapa **E7**, ainda aberta.

**DIV-2 e DIV-5 medidas junto, ambas sem efeito no caso real:** para `DAG COMERCIO`, `name` e
`normalized_name` são a mesma string e as duas regras selecionam os mesmos 3 pedidos; o grupo está ativo.
Permanece a diferença estrutural — o frontend lê `client_groups.name` sem filtrar `is_active`, a E1 lê
`normalized_name` só dos ativos — que não se manifesta hoje.

## 6. E5-0b — tipos reais do PostgREST

| Campo | Tipo em JS |
|---|---|
| `pedidos` | `number` |
| `valor_total` | `number` |
| `dia` | `string`, `YYYY-MM-DD` |

Mesmo assim `fetchDashboardSerieDiaria` coage e valida na fronteira — ver E5-2.

---

## 7. E5-1 — a janela única

`dashboardRpcRange` devolve a menor janela que contém as três de `dashboardJanelas`.

| `periodo` | Janela | Dias |
|---|---|---|
| `mes` | 6 meses | ~180-184 |
| `trimestre` | 6 meses | ~183 |
| **`ano`** | 1º/jan (Y-1) → 31/dez (Y) | **729 ou 730** |

**Máximo real: 730** — exatamente o teto da RPC. Não é coincidência, é aritmética: a união anual vale
`diasDoAno(ano-1) + diasDoAno(ano) − 1`, e dois anos consecutivos **nunca** são ambos bissextos no
calendário gregoriano.

Varredura de **2000 a 2100**, três períodos, doze meses — **3.636 combinações**, máximo **730**, nenhum
excedente.

| `ano` | Janela | Dias |
|---|---|---|
| 2024 | 2023-01-01 → 2024-12-31 | **730** |
| 2025 | 2024-01-01 → 2025-12-31 | **730** |
| 2026 | 2025-01-01 → 2026-12-31 | 729 |
| 2101 | 2100-01-01 → 2101-12-31 | 729 (2100 não é bissexto) |

⚠️ **Margem zero.** `dashboardRpcRange` expõe `excedeTeto` e **não corta a janela em silêncio** — cortar
mudaria os números da tela sem ninguém perceber, que é o defeito que a E5 combate.

`diffDias()` usa `Date.UTC` para dar o mesmo resultado que `p_data_fim - p_data_inicio` no PostgreSQL.
Aritmética local devolveria 0,958 dia em transições de horário de verão.

## 8. E5-2 — a fronteira com a RPC

`fetchDashboardSerieDiaria(ini, fim, representante?)`:

1. **Valida antes da rede** — datas obrigatórias, formato `YYYY-MM-DD`, `ini ≤ fim`, janela ≤ 730. O ERP
   é PRO e compartilhado; consulta malformada não chega lá.
2. **Erro NUNCA vira lista vazia** — o objeto do PostgREST é propagado inteiro, preservando `code`
   (`42501`, `22023`). Lista vazia significa "não vendeu nada", e confundir as duas coisas é o defeito
   D-2.
3. **Valor inválido NUNCA vira zero** — `Number(null)`, `Number('')` e `Number('   ')` valem **0**. Os
   tipos são checados **antes** da conversão; lixo levanta erro com o campo e o dia na mensagem.
4. **Ordena no cliente** — a RPC não ordena de propósito (A16).
5. **Não preenche dias ausentes** — só os dias que a RPC devolveu.
6. **Não reimplementa regra de perfil** — `representante` é repassado como veio; quem ignora o parâmetro
   para não-globais é a RPC. Duplicar aqui criaria uma segunda verdade para divergir da primeira.

## 9. E5-3 — a consolidação

`consolidarDashboardSerie(serie, janelas)` — **pura**: sem rede, sem `new Date()`, sem usuário, sem
mutar a entrada.

**Zero uso de `Date`.** Os baldes saem de aritmética `ano * 12 + mes` sobre os dígitos da string.
`new Date('2026-01-01')` é lido como UTC e `getMonth()` devolve o mês **local** — em fuso positivo isso
vira dezembro/2025 e o balde inteiro cai no mês errado. Sem `Date`, janeiro, dezembro, virada de ano e
29/02 saem certos por construção.

**A entrada é copiada e ordenada antes de somar.** Soma de ponto flutuante depende da ordem —
`0.1+0.2+0.3` e `0.3+0.2+0.1` não dão o mesmo bit. Ordenar torna o resultado determinístico qualquer que
seja a ordem em que a RPC devolveu.

**Seis baldes sempre**, em ordem cronológica, com `0` nos meses sem venda. Dia fora dos seis baldes é
ignorado, sem criar balde novo.

## 10. E5-4 — a integração

Em `fetchDashboardStats`:

- `dashboardJanelas` e `dashboardRpcRange` calculados **uma vez**; a cópia própria da regra de período
  que existia dentro da função foi removida;
- a consulta bruta continua **byte a byte idêntica** — mesmos campos, `VALID_ID_NOTA_CONF`, mesma regra
  grupos/reps, `filtros.representante`, `REP_EXCLUIDOS`, sem `order`/`limit`/`range`;
- as duas leituras vão em `Promise.all` — são independentes;
- **o early-return por lista vazia foi REMOVIDO.**

O early-return era `if (pedidosErr || !pedidosData?.length) return EMPTY_STATS`. A parte da lista vazia
zerava a série sempre que o filtro bruto não achasse nada — e o filtro bruto do diretor é só por grupo,
enquanto a RPC usa `reps OR grupos`. **Com ele, o diretor da DIV-1 veria zero.**

### ⚠️ Dívida assumida — `pedidosErr` ainda devolve `EMPTY_STATS`

O tratamento de erro da consulta bruta ficou como estava, de propósito: a E5 não redesenharia erro.

**Isto ficou pior com a E5.** Antes não havia série a perder; agora um erro na consulta bruta **descarta
uma série válida** que a RPC já entregou. Há comentário no código e teste fixando o comportamento atual.
Registrado como dívida **D-a** em `docs/PLANO-SANEAMENTO.md`.

Junto dela, **D-b**: erros dos lotes de status e de anexos continuam silenciosos — `fetchDashboardStats`
desestrutura só `data`. Falha ali zera pipeline/faturado sem aviso. Pré-existente.

---

## 11. E5-5 — verificação automatizada

| | |
|---|---|
| `src/services/dashboard.test.ts` | **115 passed** (27 E5-1 + 42 E5-2 + 26 E5-3 + 20 E5-4) |
| Suíte completa | **171 passed**, 7 arquivos |
| `tsc --noEmit` | exit 0 |
| `eslint . --max-warnings 0` | exit 0 |

Mock apenas da fronteira: `supabase.rpc` e `supabase.from`. Nenhum teste de React.

---

## 12. E5-6 — verificação manual

**Método:** para cada cenário, comparar a tela contra a RPC executada **no mesmo instante**. Não ordem de
grandeza — valor exato, e a tendência conferida até a casa decimal, porque ela só bate se numerador e
denominador vierem da mesma fonte.

### Admin global — todos os representantes

| Período | Tela | RPC |
|---|---|---|
| Mês · Ago/2026 | R$ 10,1M · 219 · −19,1 % | **10.118.560,31** · 219 · Jul **12.501.600,66** · **−19,061881 %** |
| Trimestre · 2026 | R$ 30,3M · 846 · −47,8 % | **30.348.635,30** · 846 · anterior **58.147.125,49** |
| Ano · 2026 | R$ 117,4M · 2.766 · −27,1 % | **117.411.783,45** · 2.766 · 2025 **161.025.239,30** · **−27,084857 %** |

Série mensal da RPC no cenário do mês, conferida balde a balde:

| Mar | Abr | Mai | Jun | Jul | Ago |
|---|---|---|---|---|---|
| 16.474.275,63 | 21.849.475,44 | 19.823.374,42 | 7.728.474,33 | 12.501.600,66 | 10.118.560,31 |

**Trimestre confirmou a semântica preservada:** período atual **Jun–Ago**, anterior **Mar–Mai**. Janela
móvel, não trimestre civil — ver achado A20.

### Admin global + `p_representante` — ramo A2

Representante: `1000325 - CEDRO REPRESENTAÇÕES LTDA - ME`

| Tela | RPC |
|---|---|
| R$ 277,0k · 14 · −10,1 % | **277.009,48** · 14 · Jul **308.217,72** · **−10,125387 %** |

> ⚠️ **Uma medição anterior deste cenário divergiu** — o ERP recebeu dados novos entre as duas leituras.
> Comparando tela e RPC **no mesmo instante**, os valores fecharam. **Não é bug da E5.** Vale como
> lembrete de método: contra fonte viva, medições em instantes diferentes não são comparáveis.

### Representante não-global — ramo B

Sujeito: `10008082 - DANILO AUGUSTO REHNEIN`, Ago/2026.

| Tela | RPC |
|---|---|
| R$ 671,05 · 1 · −87,5 % | **671,05** · 1 · Jul **5.388,92** · **−87,547597 %** |

Confirmado também: **não existe seletor de representante** para ele — o guarda `{isAdmin && …}` da
`DashboardPage` funciona.

### Diretor — ramo B-grupos

Grupo `DAG COMERCIO`.

| Mês | Tela | RPC |
|---|---|---|
| Ago/2026 | R$ 0 · 0 pedidos | R$ 0 · 0 pedidos |
| Abr/2026 | R$ 203,2k · 1 pedido · tendência **"—"** | **203.215,96** · 1 · Mar = 0 |

**O caso de agosto é o mais importante da bateria:** zero na tela **e** zero na RPC. Zero legítimo
continua distinguível de falha. E em abril a tendência aparece como **"—"** porque março foi zero —
comportamento correto de `totalVendidoMesAnt === 0`, e não "0 %".

**Gráfico executivo:** seis meses **Nov/2025 – Abr/2026**, com Abr ≈ R$ 203,2k e Jan/Fev/Mar zerados.
Atravessa a virada de ano, e é a verificação visual de `OverviewPage`, que consome `vendasMensais`
direto.

### Diretor geral — ramo A1

| Período | Tela | RPC |
|---|---|---|
| Mês · Ago/2026 | R$ 10,5M · 238 · −16,1 % | **10.481.432,19** · 238 · Jul **12.491.504,42** · **−16,091514 %** |
| Trimestre · 2026 | R$ 30,7M · 865 · −47,2 % | **30.701.410,94** · 865 · anterior **58.147.125,49** · **−47,200466 %** |
| Ano · 2026 | R$ 117,6M · 2.777 · −27,0 % | **117.625.144,94** · 2.777 · **−26,952355 %** · **445 linhas** |

As **445 linhas** para um ano inteiro confirmam na prática o achado A17: a série cabe folgada abaixo do
`Max rows = 1000`. O teto de 730 dias faz o que foi projetado para fazer.

### O limite exato de 730 dias, no navegador

Perfil `diretor_geral`, período **Ano**, ano **2025** → janela `2024-01-01 → 2025-12-31`,
**diferença = 730 dias**, atravessando 29/02/2024.

| | |
|---|---|
| Tela | **R$ 161,0M · 3.874 pedidos · +285,9 %** |
| Erro `22023` | **nenhum** |
| Erro da RPC | **nenhum** |

Confere por cruzamento: R$ 161,0M é exatamente o `valor2025 = 161.025.239,30` que serviu de denominador
à tendência do cenário Ano/2026, medido em outra sessão e por outro caminho.

### Cobertura

| Ramo da RPC | Onde apareceu |
|---|---|
| **A1** — global sem representante | admin (mês, trimestre, ano) · diretor_geral (mês, trimestre, ano ×2) |
| **A2** — global com representante | admin + CEDRO |
| **B** — só rep codes | Danilo |
| **B-grupos** — só grupos | diretor DAG COMERCIO |
| **C** — reps + grupos | ⚠️ **sem verificação de UI** — não existe diretor real nessa condição. Provado no T2.G da E3 com vínculo transacional, e é a base da DIV-1 |

Os três consumidores foram exercitados: `DashboardPage`, `useExecutiveSummary` e `OverviewPage`.

---

## 13. Achados abertos por esta verificação

| | Achado | Situação |
|---|---|---|
| **A19** | Seletor de representantes devolve lista incompleta | **Pré-existente, fora da E5.** `queryKey` sem escopo · agregado responde **400** · fallback truncado em 1.000, cortado alfabeticamente. Danilo não aparecia. Contornado usando CEDRO |
| **A20** | "Trimestre" na UI não é o trimestre civil | `dashboardJanelas` ignora `filtros.trimestre`. Semântica **preservada de propósito** pela E5 |
| **D-a** | `pedidosErr` devolve `EMPTY_STATS` e descarta série válida | Dívida assumida; piorou com a E5 |
| **D-b** | Erros de status/anexos silenciosos | Pré-existente |

Detalhamento em `docs/PLANO-SANEAMENTO.md`.

## 14. O que a E5 **não** fez

- não criou migration nem tocou no banco;
- não alterou `DashboardStats`, `useDashboardStats`, páginas ou componentes;
- não removeu o `TruncationNotice` — isso é a E6, e **não deve ser feito agora**;
- não corrigiu A19, A20, D-a nem D-b;
- não comunicou a mudança de números do diretor — isso é a **E7**, aberta e mais urgente do que o plano
  original previa, porque a DIV-1 muda o **valor**, não só a precisão.
