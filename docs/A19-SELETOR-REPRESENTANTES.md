# A19 — Seletor de representantes devolvia lista incompleta

> ✅ **RESOLVIDO em 2026-08-21.** Duas correções, ambas em `src/`. Sem migration, sem SQL, sem alteração
> de configuração do Supabase, sem mudança de RLS, escopo ou backend.
>
> Defeito **anterior** à E5 — encontrado durante a verificação manual dela, corrigido em etapa própria.

---

## A. Sintoma

Logado como **admin**, o seletor "Todos os representantes" do Dashboard **não continha**
`10008082 - DANILO AUGUSTO REHNEIN`, embora ele tenha pedidos válidos — 12 medidos na E5-0, no mesmo
período.

No console aparecia um `HTTP 400` contra `concrem_pedidos_venda`, com mensagem sobre agregação. A tela
não quebrava: o código capturava o erro e seguia por outro caminho. **Falhava em silêncio.**

O impacto prático foi imediato: sem o Danilo na lista, não dava para testar o filtro por representante
do admin justamente com o representante usado nas medições da E5-0. O contorno foi usar
`1000325 - CEDRO REPRESENTAÇÕES LTDA - ME`.

## B. Fluxo afetado

```
DashboardPage:797   ← {isAdmin && <Select …>}          admin e diretor_geral
PedidosPage:881     ← <Select …>                       TODOS os perfis, sem guarda
        │
        └─→ useRepresentantesUnicos()                  src/hooks/usePedidosVenda.ts
                └─→ fetchRepresentantesUnicos()        src/services/pedidosVenda.ts
                        └─→ valoresDistintos('representante')
```

`valoresDistintos` é privada e tem **dois** consumidores: `fetchRepresentantesUnicos` e
`fetchSituacoesEntrega`. **Toda correção ali vale para as duas colunas** — o filtro de situação de
entrega sofria do mesmo defeito.

## C. Causa 1 — o agregado não é utilizável neste projeto

O caminho preferido resolvia o problema no banco: `select=coluna,count()` faz `GROUP BY` implícito pela
coluna não agregada, então o `DISTINCT` sai pronto e trafegam dezenas de linhas em vez de milhares.

**Ele não funciona aqui.** Resposta medida:

```
HTTP 400
code:    PGRST123
message: Use of aggregate functions is not allowed
```

Funções de agregação estão **desabilitadas** no PostgREST (`db-aggregates-enabled`). Não é erro de
sintaxe nem defeito do código — é configuração de plataforma. O próprio código já antecipava essa
possibilidade e trazia um caminho alternativo; o problema é que **esse caminho alternativo era o
defeituoso**.

`count()` aparece em **um único lugar** no projeto inteiro, o que tornou a atribuição do 400 imediata.

## D. Causa 2 — o corte de 1.000, e por que ele era alfabético

O fallback fazia **uma leitura só**:

```ts
.select(coluna)
.in('id_nota_conf', VALID_ID_NOTA_CONF)
.not(coluna, 'is', null)
.order(coluna)                    // ← ordena pela PRÓPRIA coluna
.not('representante', 'in', '(…)')
// ❌ sem .limit(), sem .range()
```

O Data API corta em **1.000 linhas** (`Max rows`), e a ordenação acontece **no banco, antes do corte**.

Como a ordem é pela **própria coluna que se quer coletar**, o resultado não é uma amostra: é um
**PREFIXO alfabético**. Todos os valores que ordenam primeiro trazem suas centenas de linhas, enchem a
cota, e tudo que viria depois **desaparece**.

> O comentário do código dizia que o corte pegava "as 1.000 linhas **mais recentes**". **Descrição
> errada do mesmo mecanismo** — com `order(coluna)` o corte é **alfabético**. Corrigido junto.

## E. Medição

Somente `SELECT`, sobre os mesmos filtros da consulta real.

| | |
|---|---|
| Linhas elegíveis | **7.682** |
| Representantes distintos | **243** |
| Distintos presentes nas primeiras 1.000 linhas | **14** |
| Último antes do corte | `1000325 - CEDRO REPRESENTAÇÕES LTDA - ME` |
| Danilo aparecia no fallback | **não** |

**14 de 243 — 5,8 %.** O corte era severo, não marginal. E o admin não tinha nenhum sinal de que a lista
estava incompleta.

## F. Risco de cache

Defeito independente, encontrado na mesma auditoria.

| | Antes |
|---|---|
| `queryKey` | `['representantes-unicos']` — **sem `uid`, sem `scopeKey`** |
| `staleTime` | 30 min (60 min para situações) |
| `gcTime` | não configurado → padrão de 5 min |
| `logout` | só `supabase.auth.signOut()`; **nenhuma limpeza de cache** |

As duas listas saem da view `concrem_pedidos_venda`, que aplica **RLS** — o conteúdo **depende de quem
está logado**. Um representante vê só os próprios códigos; um admin, todos.

**O cenário:** admin carrega a lista completa; faz logout; outro usuário loga **na mesma aba** — a
sessão vive em `sessionStorage`, então logout e login não recarregam a página. Chave idêntica e cache
ainda quente ⇒ a lista do admin era servida ao novo usuário, sem refetch.

**Janela real:** cerca de 5 minutos após o logout, limitada pelo `gcTime`. `F5` cria um `QueryClient`
novo e limpa tudo.

**Gravidade: não é falha de acesso a dado.** A RLS continua valendo — escolher um representante alheio
devolve zero pedidos. **Mas era exibição indevida:** como o seletor de `PedidosPage` **não tem guarda de
perfil**, um representante veria no dropdown os nomes de todos os representantes carregados na sessão do
admin.

`['situacoes-entrega']` tinha a mesma chave sem escopo. `['produtos']` também — mas catálogo não é
escopado, e ficou fora desta correção.

## G. Implementação adotada

**1. Fallback paginado** — `src/services/pedidosVenda.ts`

```ts
const valores: string[] = [];
for (let offset = 0; ; offset += API_MAX_ROWS) {
  const { data: pagina, error: erroPagina } =
    await montar(false).range(offset, offset + API_MAX_ROWS - 1);

  if (erroPagina) throw erroPagina;

  const recebidas = pagina?.length ?? 0;
  valores.push(...extrair(pagina ?? []));

  if (recebidas < API_MAX_ROWS) break;
}
return [...new Set(valores)];
```

A tentativa agregada **continua primeiro**, de propósito: se a agregação for habilitada um dia, o
caminho barato volta a valer sozinho, sem novo código.

**Três detalhes que decidem a correção:**

- **A parada usa `recebidas`, o total de linhas CRUAS** — não o de valores extraídos. `extrair` descarta
  vazios; uma página de 1.000 linhas com dois brancos viraria 998 e o laço pararia cedo, reintroduzindo
  o truncamento por outra porta.
- **Deduplicação só no fim.** O mesmo valor aparece em centenas de linhas e cruza a fronteira entre
  páginas. O `Set` preserva a ordem de inserção, que é a ordem do banco — **nada é reordenado no
  cliente**, o que trocaria a *collation* do Postgres pela do navegador.
- **Paginar com empates é seguro aqui.** `order(coluna)` sobre milhares de linhas repetidas não define
  ordem total estável entre requisições, então uma linha pode trocar de página. Mas a troca só ocorre
  **dentro do grupo de linhas com o mesmo valor** — e é o valor que estamos coletando. Um grupo nunca
  some inteiro: sua posição depende só de quantas linhas têm valor menor, que é fixo. O conjunto de
  distintos é imune ao rearranjo.

**Terminação:** o offset avança por um valor fixo e a view é finita, então uma página curta ou vazia
sempre chega. Sem teto artificial.

⚠️ `API_MAX_ROWS` precisa refletir o `Max rows` do painel. Se o painel for **reduzido** abaixo dessa
constante, a primeira página vem curta e o laço para cedo — o mesmo truncamento silencioso, por outra
causa. O alerta já está em `src/constants/apiLimits.ts`.

**2. `queryKey` com escopo** — `src/hooks/usePedidosVenda.ts`

```ts
queryKey: ['representantes-unicos', scopeKey]
queryKey: ['situacoes-entrega', scopeKey]
```

`scopeKey` vem de `useDataScope()`, já usado pelos hooks vizinhos no mesmo arquivo. É o padrão dos
demais: `['dashboard-stats', scopeKey, …]`, `['carteira', { scopeKey, rep }]`,
`['acompanhamento', { scopeKey }]`. `staleTime` e `enabled` preservados.

## H. Por que paginação

| Alternativa | Resolve truncamento | Migration | Semântica | Decisão |
|---|---|---|---|---|
| **Paginar o fallback** | ✅ | não | **idêntica** | **adotada** |
| Habilitar agregações no painel | ✅ | não | idêntica | **descartada nesta mudança** — é alteração de configuração de plataforma, com efeito em toda a API, e exige autorização própria |
| RPC dedicada | ✅ | **sim** | idêntica | descartada — migration, ACL e ciclo de verificação para um dropdown é desproporcional |
| Trocar a fonte para `concremapprep_representantes` | ✅ | não | **diferente** | descartada — ver I |

**Paginação preserva exatamente a semântica atual:** a lista continua sendo "representantes que aparecem
em `concrem_pedidos_venda` dentro do escopo do usuário", com os mesmos filtros de negócio e o mesmo
escopo por RLS. **Nenhuma decisão de negócio embutida na correção de um defeito.**

O custo é round-trips: 8 requisições para 7.682 linhas, contra 1 antes. Aceitável para uma lista com
`staleTime` de 30 minutos.

## I. Por que NÃO a tabela `concremapprep_representantes`

Era a opção mais barata — `fetchRepresentantes()` já existe, lê uma linha por representante e nunca
chega perto do teto. **Foi descartada porque muda a semântica**, e isso é decisão de negócio, não de
implementação:

| | Hoje (`DISTINCT` sobre pedidos) | Tabela do Portal |
|---|---|---|
| Conteúdo | representantes **com pedido** no ERP | representantes **cadastrados no Portal** |
| Rep sem pedido | não aparece | **aparece** — filtro que devolve vazio |
| Rep com pedido, não cadastrado | aparece | **some** |
| Escopo | herda a RLS da view | policy `using (true)` — **todo autenticado vê todos** |

A última linha é decisiva: para um representante em `PedidosPage`, a lista passaria de "só o meu código"
para **todos os representantes cadastrados**. Isso **pioraria** exatamente a exposição que a correção da
`queryKey` veio fechar.

**Só considerar essa troca com decisão explícita de negócio, e junto de uma guarda de perfil no seletor
de `PedidosPage`.**

## J. Validação automatizada

| | |
|---|---|
| `src/services/pedidosVenda.test.ts` | **17 testes** |
| `src/hooks/usePedidosVenda.test.ts` | **9 testes** |
| Novos | **26/26** |
| Suíte completa | **212/212** |
| `tsc --noEmit` | exit 0 |
| `eslint . --max-warnings 0` | exit 0 |

Cobertura: agregado sem paginar · fallback ao falhar com `PGRST123` · página única · três páginas com os
ranges `[0,999]`, `[1000,1999]`, `[2000,2999]` · duplicados entre páginas · página cheia seguida de
vazia · `data: null` · **valores em branco não param o laço cedo** · erro na 1ª, 2ª e 3ª páginas ·
filtros preservados em toda página · `situacao_entrega` sem a exclusão de representante e paginando ·
**regressão do cenário real**, com 243 distintos em 7.682 linhas, todos recuperados.

Do lado do hook: chave com `scopeKey` nos dois · `staleTime` e `enabled` preservados · cinco escopos
produzem cinco chaves distintas · admin e representante não compartilham entrada · **mesmo escopo
continua reaproveitando o cache**, porque a correção não deve desligar o cache.

## K. Validação manual — 2026-08-21

**1. Admin, no Dashboard**

| Antes | Depois |
|---|---|
| Danilo **não aparecia** no seletor | Danilo **aparece** e pode ser selecionado |
| — | ao selecioná-lo, a tela carregou **R$ 671,05 · 1 pedido · −87,5 %** |

Os valores batem com o que a RPC já havia devolvido na verificação da E5-6.

**2. Troca de escopo na mesma aba**

Admin carregou a lista global → logout → login como representante → Pedidos → Filtros → Representante.

O dropdown mostrou **apenas os três códigos do próprio escopo**, mais a opção "Todos". **Nenhum
representante alheio.**

É o cenário exato do risco descrito em F, e ele deixou de ocorrer.

## L. Deliberadamente fora do escopo

Nenhum destes foi tocado, e nenhum era tecnicamente necessário para corrigir A19:

| | Item | Por quê |
|---|---|---|
| ❌ | `queryClient.clear()` no logout | *hardening* estrutural, fecharia o problema para **todas** as chaves — mas é mudança de comportamento global. Merece etapa própria |
| ❌ | Guarda de perfil no seletor de `PedidosPage` | hoje ele renderiza para todos os perfis. Não é falha de escopo (a RLS limita a lista), mas vale revisar |
| ❌ | Habilitar agregações no painel | alteração de configuração de plataforma, com efeito em toda a API |
| ❌ | Trocar a fonte para `concremapprep_representantes` | muda a semântica — ver I |
| ❌ | RPC dedicada | desproporcional |
| ❌ | `['produtos']`, que também tem chave sem escopo | catálogo não é escopado |
| ❌ | **A20** — "Trimestre" na UI não é o trimestre civil | não relacionado |
| ❌ | **D-a** — `pedidosErr` devolve `EMPTY_STATS` e descarta série válida | não relacionado |
| ❌ | **D-b** — erros de status/anexos silenciosos | não relacionado |

---

## Arquivos alterados

| Arquivo | O quê |
|---|---|
| `src/services/pedidosVenda.ts` | fallback paginado + comentário corrigido |
| `src/hooks/usePedidosVenda.ts` | `scopeKey` nas duas `queryKey` |
| `src/services/pedidosVenda.test.ts` | criado |
| `src/hooks/usePedidosVenda.test.ts` | criado |

**Nenhuma migration, nenhum SQL de escrita, nenhuma alteração de configuração.** As consultas usadas na
medição foram exclusivamente de leitura.
