// ─────────────────────────────────────────────────────────────────────────────
// Teto de linhas do Data API do Supabase.
//
// O projeto está configurado com **Max rows = 1000** (painel → Integrations →
// Data API → Settings). Esse teto é GLOBAL e vale para toda consulta: um
// `.limit(5000)` no código não muda nada, o servidor devolve 1.000 e pronto.
//
// Consequência: qualquer consulta que traga exatamente 1.000 linhas foi
// PROVAVELMENTE cortada, e o que a tela calcular em cima disso é um recorte —
// não o conjunto. Como a ordenação usual é `data_emissao desc`, o que fica de
// fora é sempre o mais antigo, justamente onde se concentram pedidos parados e
// atrasados: o corte subestima os indicadores de problema.
//
// Enquanto os agregados não forem calculados no banco (Etapa 7 do
// docs/PLANO-SANEAMENTO.md), o mínimo é **não esconder o corte do usuário**.
//
// ⚠️ Se o valor for alterado no painel do Supabase, altere aqui também — não há
// como o frontend descobrir esse número sozinho.
// ─────────────────────────────────────────────────────────────────────────────

export const API_MAX_ROWS = 1000;

/** Lista que pode ter vindo cortada pelo teto do Data API. */
export type ListaTruncavel<T> = T[] & { truncado?: boolean };

/** true quando a consulta encostou no teto — ou seja, provavelmente veio cortada. */
export function atingiuTeto(linhasRecebidas: number): boolean {
  return linhasRecebidas >= API_MAX_ROWS;
}

/** Marca a lista quando o chamador já sabe que houve corte (ex.: duas consultas cortáveis). */
export function marcarComo<T>(lista: T[], truncado: boolean): ListaTruncavel<T> {
  const out = lista as ListaTruncavel<T>;
  out.truncado = truncado;
  return out;
}

/**
 * Marca uma lista derivada como truncada com base no nº de linhas CRUAS lidas.
 *
 * Usado quando o corte acontece numa consulta intermediária e o retorno é outra
 * coisa — por exemplo: a carteira devolve clientes, mas quem foi cortado foram
 * os pedidos que originaram esses clientes.
 */
export function marcarTruncamento<T>(lista: T[], linhasCruasLidas: number): ListaTruncavel<T> {
  const out = lista as ListaTruncavel<T>;
  out.truncado = atingiuTeto(linhasCruasLidas);
  return out;
}
