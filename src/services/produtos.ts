import { supabase } from '@/lib/supabase/client';
import { API_MAX_ROWS, marcarComo, type ListaTruncavel } from '@/constants/apiLimits';
import type { Produto } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// O catálogo INTEIRO, sem depender do teto do Data API.
//
// Antes esta função fazia UMA leitura sem `range`. O Data API corta em
// `Max rows = 1000`, então o que chegava era um PREFIXO por `codigo` — e o app
// tratava esse prefixo como se fosse o catálogo. Três consequências, todas
// silenciosas:
//
//   1. produtos de código mais alto simplesmente NÃO EXISTIAM para o app —
//      nem por filtro, nem pela busca por código, que também roda em memória
//      sobre esta lista. Um representante não conseguia orçar um item ativo;
//   2. as opções dos filtros (Cor, Linha, Altura…) saem de `new Set()` sobre
//      esta lista, nas duas telas de orçamento. Cor que só existia depois da
//      linha 1.000 nunca aparecia no dropdown — foi assim que o problema
//      apareceu: KIT PORTA + CORRER + Sarrafo 6mm + Lacca Touch sem a cor VELAR,
//      que existe no catálogo;
//   3. a tela exibia "1000 no catálogo", número que era o teto e não o total.
//
// É a mesma classe do achado A19 (seletor de representantes), e a cura é a
// mesma: percorrer em páginas de API_MAX_ROWS via `.range()` até uma página vir
// incompleta.
//
// ORDENAÇÃO TOTAL, de propósito. `order('codigo')` sozinho não garante ordem
// estável entre requisições se houver códigos repetidos — e com paginação isso
// faria linhas trocarem de página, perdendo umas e duplicando outras. O
// desempate por `id` (PK) fecha essa porta: a ordem passa a ser total e
// determinística, então cada linha cai em exatamente uma página.
//
// ⚠️ API_MAX_ROWS precisa refletir o `Max rows` do painel. Se o painel for
// REDUZIDO abaixo desta constante, a primeira página vem curta, o laço para cedo
// e o truncamento silencioso volta. Ver src/constants/apiLimits.ts.
// ─────────────────────────────────────────────────────────────────────────────

const CAMPOS =
  'id,codigo,descricao,unidade,tipo_produto,movimento,enchimento,linha,perfil,' +
  'revestimento,cor,altura_cm,largura_cm,espessura_cm,batente_cm,protect_plus,' +
  'veneziana,visor,situacao';

/**
 * Teto defensivo de páginas — 50 × 1.000 = 50.000 produtos.
 *
 * O laço já termina sozinho na primeira página incompleta, e o catálogo é
 * finito. Isto existe só para que um defeito futuro (servidor devolvendo sempre
 * página cheia) não trave o navegador num laço infinito. Se for atingido, a
 * lista volta marcada como truncada em vez de mentir que está completa.
 */
const MAX_PAGINAS = 50;

/**
 * Todos os produtos do catálogo, de todos os tipos.
 *
 * Nenhum filtro é aplicado aqui — nem por `situacao`. As telas filtram em
 * memória, e tirar linhas nesta camada mudaria o que o usuário vê hoje.
 *
 * O retorno é `ListaTruncavel`, que é um `Produto[]` com um `truncado` opcional:
 * quem só quer a lista continua usando normalmente.
 */
export async function fetchProdutos(): Promise<ListaTruncavel<Produto>> {
  const todos: Produto[] = [];
  let truncado = false;

  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINAS) {
      truncado = true;
      if (import.meta.env.DEV) {
        console.warn(
          `[produtos] teto de ${MAX_PAGINAS} páginas atingido (${todos.length} linhas). ` +
          'A lista está incompleta e foi marcada como truncada.',
        );
      }
      break;
    }

    const de = pagina * API_MAX_ROWS;
    const { data, error } = await supabase
      .from('concremprodutos_produtos')
      .select(CAMPOS)
      .order('codigo')
      .order('id')
      .range(de, de + API_MAX_ROWS - 1);

    if (error) throw error;

    const recebidas = data?.length ?? 0;
    if (recebidas > 0) todos.push(...(data as unknown as Produto[]));

    // Página menor que o tamanho pedido é a última. Página vazia encerra pelo
    // mesmo teste, então o laço termina sempre.
    if (recebidas < API_MAX_ROWS) break;
  }

  return marcarComo(todos, truncado);
}
