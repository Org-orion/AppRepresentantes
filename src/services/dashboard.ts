import { supabase } from '@/lib/supabase/client';
import { VALID_ID_NOTA_CONF } from '@/constants/orderFilters';
import { atingiuTeto } from '@/constants/apiLimits';
import { mapStatus } from '@/services/acompanhamento';
import { REP_EXCLUIDOS } from '@/services/pedidosVenda';
import type { PedidoStatus } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────
export interface PipelineCounts {
  aprovado:   number;
  liberado:   number;
  mapeamento: number;
  ferragem:   number;
  comercial:  number;
  producao:   number;
  faturado:   number;
  entrega:    number;
  finalizado: number;
  total:      number;
}

export interface DashboardStats {
  pipeline:              PipelineCounts;
  totalVendidoMes:       number;   // vendido no período selecionado
  totalVendidoMesAnt:    number;   // vendido no período anterior (p/ tendência)
  totalFaturadoMes:      number;   // faturado no período (pedidos com NF + boleto anexados)
  faturadosNoPeriodo:    number;   // nº de pedidos do período com NF + boleto anexados
  ticketMedio:           number;
  totalPedidos:          number;   // total de pedidos (todos)
  pedidosNoPeriodo:      number;   // pedidos emitidos no período selecionado
  // Financeiro por mês (últimos 6 meses) para o gráfico
  vendasMensais: { mes: string; valor: number }[];
  /** true quando a leitura de pedidos bateu no teto do Data API (ver constants/apiLimits). */
  truncado: boolean;
}

export type PeriodoFiltro = 'mes' | 'trimestre' | 'ano';

export interface DashboardFiltros {
  periodo?: PeriodoFiltro;
  ano?: number;            // ano selecionado (padrão: atual)
  mes?: number;            // 1-12, quando periodo = 'mes'
  trimestre?: number;      // 1-4, quando periodo = 'trimestre'
  representante?: string;  // filtra por um representante específico (admin)
}

const EMPTY_PIPELINE: PipelineCounts = {
  aprovado: 0, liberado: 0, mapeamento: 0, ferragem: 0, comercial: 0,
  producao: 0, faturado: 0, entrega: 0, finalizado: 0, total: 0,
};

const EMPTY_STATS: DashboardStats = {
  pipeline:           { ...EMPTY_PIPELINE },
  totalVendidoMes:    0,
  totalVendidoMesAnt: 0,
  totalFaturadoMes:   0,
  faturadosNoPeriodo: 0,
  ticketMedio:        0,
  totalPedidos:       0,
  pedidosNoPeriodo:   0,
  vendasMensais:      [],
  truncado:           false,
};

// ─── Helpers de data ──────────────────────────────────────────
function startOf(year: number, month: number) {
  return new Date(year, month, 1).toISOString().slice(0, 10);
}
function endOf(year: number, month: number) {
  return new Date(year, month + 1, 0).toISOString().slice(0, 10);
}

/**
 * Diferença em dias entre duas datas `YYYY-MM-DD`.
 *
 * Usa `Date.UTC` de propósito: fuso e horário de verão não podem entrar na
 * conta. O resultado tem que ser o MESMO que o PostgreSQL calcula em
 * `p_data_fim - p_data_inicio`, que é a expressão usada pela RPC para decidir
 * se a janela cabe. Contar com `new Date(...)` local daria 729,958… em dias de
 * transição de DST e arredondaria errado.
 */
export function diffDias(ini: string, fim: string): number {
  const ts = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ts(fim) - ts(ini)) / 86_400_000);
}

const MES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ─── Janelas de data do dashboard ─────────────────────────────
//
// Fonte ÚNICA das datas do dashboard. Antes desta função a mesma regra de
// período existia em dois lugares (`periodoRange` e o miolo de
// `fetchDashboardStats`); qualquer divergência entre eles produziria números
// diferentes para o mesmo filtro. `periodoRange` passa a derivar daqui.

/** Máximo aceito por `app_dashboard_serie_diaria`: `p_data_fim - p_data_inicio <= 730`. */
export const RPC_JANELA_MAX_DIAS = 730;

export interface JanelasDashboard {
  /** Período selecionado. */
  mesIni: string;
  mesFim: string;
  /** Período imediatamente anterior — base da tendência (`totalVendidoMesAnt`). */
  mesAntIni: string;
  mesAntFim: string;
  /** Seis meses terminando no fim do período — base de `vendasMensais`. */
  serieIni: string;
  serieFim: string;
}

export interface RpcRange {
  ini: string;
  fim: string;
  /** `fim - ini`, na mesma aritmética que a RPC usa. */
  dias: number;
  /**
   * `true` quando a janela estoura o teto da RPC, que responderia `22023`.
   *
   * ⚠️ Hoje é SEMPRE `false` — ver a prova no comentário de `dashboardRpcRange`.
   * O campo existe para que a E5-2 tenha o que checar antes de chamar a RPC, em
   * vez de descobrir por exceção em produção. NÃO cortar a janela em silêncio se
   * um dia for `true`: isso mudaria os números da tela sem ninguém perceber.
   */
  excedeTeto: boolean;
}

/**
 * As três janelas que o dashboard usa, com a semântica ATUAL preservada
 * integralmente — inclusive a janela móvel do trimestre, que não é o trimestre
 * civil e sim os últimos 3 meses terminando no mês corrente (dezembro, quando
 * o ano selecionado não é o atual).
 */
export function dashboardJanelas(filtros: DashboardFiltros = {}): JanelasDashboard {
  const periodo = filtros.periodo ?? 'mes';
  const now = new Date();
  const ano = filtros.ano ?? now.getFullYear();

  let mesIni: string, mesFim: string, mesAntIni: string, mesAntFim: string;
  // Índice do ÚLTIMO mês do período — é dele que os 6 meses da série contam
  // para trás. Pode ficar negativo em `refMes - 5`; `new Date` normaliza para o
  // ano anterior, que é exatamente o que o laço de `vendasMensais` faz hoje.
  let refMes: number;

  if (periodo === 'trimestre') {
    // Últimos 3 meses (janela móvel) terminando no mês atual (dezembro, se ano passado).
    const mFim = ano === now.getFullYear() ? now.getMonth() : 11;
    mesIni    = startOf(ano, mFim - 2);  mesFim    = endOf(ano, mFim);
    mesAntIni = startOf(ano, mFim - 5);  mesAntFim = endOf(ano, mFim - 3);
    refMes    = mFim;
  } else if (periodo === 'ano') {
    mesIni    = startOf(ano, 0);      mesFim    = endOf(ano, 11);
    mesAntIni = startOf(ano - 1, 0);  mesAntFim = endOf(ano - 1, 11);
    refMes    = 11;
  } else {
    const m = (filtros.mes ?? (now.getMonth() + 1)) - 1;  // 0-based
    mesIni    = startOf(ano, m);      mesFim    = endOf(ano, m);
    mesAntIni = startOf(ano, m - 1);  mesAntFim = endOf(ano, m - 1);
    refMes    = m;
  }

  return {
    mesIni, mesFim,
    mesAntIni, mesAntFim,
    serieIni: startOf(ano, refMes - 5),
    serieFim: mesFim,
  };
}

/**
 * Janela ÚNICA que cobre as três de `dashboardJanelas`, para uma só chamada da
 * RPC `app_dashboard_serie_diaria`.
 *
 * Comparação lexicográfica é segura aqui: `YYYY-MM-DD` ordena igual a
 * cronológico.
 *
 * ── POR QUE SEMPRE CABE NO TETO ─────────────────────────────────────────────
 * O pior caso é `periodo='ano'`: de 1º/jan do ano anterior a 31/dez do ano
 * selecionado. Em dias, isso é
 *
 *     diasDoAno(ano-1) + diasDoAno(ano) - 1
 *
 * Como dois anos consecutivos NUNCA são ambos bissextos no calendário
 * gregoriano, o máximo é `366 + 365 - 1 = 730` — exatamente o teto, nunca
 * acima. Varrido de 2000 a 2100 nos três períodos: máximo 730.
 *
 * ⚠️ MARGEM ZERO. Alargar a série de 6 para 12 meses, ou criar um período de
 * 2 anos, estoura o teto e a RPC passa a responder `22023`. O teste
 * `dashboard.test.ts` trava esse limite.
 */
export function dashboardRpcRange(filtros: DashboardFiltros = {}): RpcRange {
  const j = dashboardJanelas(filtros);
  const ini = [j.mesIni, j.mesAntIni, j.serieIni].reduce((a, b) => (b < a ? b : a));
  const fim = [j.mesFim, j.mesAntFim, j.serieFim].reduce((a, b) => (b > a ? b : a));
  const dias = diffDias(ini, fim);
  return { ini, fim, dias, excedeTeto: dias > RPC_JANELA_MAX_DIAS };
}

// Intervalo [ini, fim] (YYYY-MM-DD) do período selecionado — reutilizado por
// outros serviços (performance por rep/grupo) para respeitar o filtro de período.
export function periodoRange(filtros: DashboardFiltros = {}): { ini: string; fim: string } {
  const { mesIni, mesFim } = dashboardJanelas(filtros);
  return { ini: mesIni, fim: mesFim };
}

// ─── Série diária vinda do banco (RPC) ────────────────────────
//
// `public.app_dashboard_serie_diaria` faz filtro e agregação DENTRO do ERP, via
// FDW. É o que substitui a leitura bruta de pedidos para efeito de série — e o
// que tira os números do dashboard de cima do recorte de 1.000 linhas.
//
// ⚠️ Ainda NÃO está ligada a `fetchDashboardStats`. Isso é a etapa E5-4.

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface DashboardSerieDiariaRow {
  /** `YYYY-MM-DD`. */
  dia: string;
  pedidos: number;
  valor_total: number;
}

/**
 * Converte um campo numérico vindo da RPC, recusando lixo em vez de virar zero.
 *
 * `Number()` sozinho não serve como defesa de fronteira: `Number(null)`,
 * `Number('')` e `Number('   ')` valem **0**, e um zero silencioso aqui vira
 * "não vendeu nada" na tela — indistinguível de venda zero real. É o defeito
 * D-2 outra vez. Por isso os tipos são checados ANTES da conversão.
 */
function numeroDaRpc(valor: unknown, campo: string, dia: string): number {
  if (typeof valor !== 'number' && typeof valor !== 'string') {
    throw new Error(
      `app_dashboard_serie_diaria: campo "${campo}" do dia ${dia} veio como ` +
      `${valor === null ? 'null' : typeof valor} — esperado number ou string numérica`,
    );
  }
  if (typeof valor === 'string' && valor.trim() === '') {
    throw new Error(`app_dashboard_serie_diaria: campo "${campo}" do dia ${dia} veio vazio`);
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new Error(
      `app_dashboard_serie_diaria: campo "${campo}" do dia ${dia} não é finito ` +
      `— recebido ${JSON.stringify(valor)}`,
    );
  }
  return n;
}

/**
 * Série diária agregada de pedidos, já dentro do escopo do usuário.
 *
 * O escopo NÃO é enviado por aqui. A RPC o resolve sozinha, a partir do JWT,
 * via `app_escopo_atual()`. Não existe parâmetro de representante-array nem de
 * grupo: não há o que o cliente injete.
 *
 * `representante` só ESTREITA, e só para perfil global — a própria RPC ignora o
 * parâmetro para quem não é `admin`/`diretor_geral`. Esta função **não**
 * reimplementa essa regra: a segurança é do banco, e duplicá-la aqui só criaria
 * uma segunda verdade para divergir da primeira.
 *
 * ⚠️ Devolve SOMENTE os dias com pedido — dias vazios não vêm. Preencher lacunas
 * e montar baldes mensais é a E5-3.
 */
export async function fetchDashboardSerieDiaria(
  ini: string,
  fim: string,
  representante?: string,
): Promise<DashboardSerieDiariaRow[]> {
  // ── Validação LOCAL, antes de qualquer rede ──
  // A RPC também valida e responde 22004/22007/22023, mas errar aqui custa um
  // round-trip até o ERP — que é PRO e compartilhado com outra aplicação.
  // Nada é cortado nem ajustado em silêncio: entrada inválida é erro.
  if (!ini || !ini.trim()) throw new Error('fetchDashboardSerieDiaria: `ini` é obrigatório');
  if (!fim || !fim.trim()) throw new Error('fetchDashboardSerieDiaria: `fim` é obrigatório');
  if (!FORMATO_DATA.test(ini) || !FORMATO_DATA.test(fim)) {
    throw new Error(
      `fetchDashboardSerieDiaria: datas devem estar em YYYY-MM-DD — recebido "${ini}" e "${fim}"`,
    );
  }
  if (ini > fim) {
    throw new Error(`fetchDashboardSerieDiaria: início (${ini}) é posterior ao fim (${fim})`);
  }
  const dias = diffDias(ini, fim);
  if (dias > RPC_JANELA_MAX_DIAS) {
    throw new Error(
      `fetchDashboardSerieDiaria: janela de ${dias} dias excede o máximo de ` +
      `${RPC_JANELA_MAX_DIAS} aceito pela RPC (${ini} → ${fim})`,
    );
  }

  const { data, error } = await supabase.rpc('app_dashboard_serie_diaria', {
    p_data_inicio:   ini,
    p_data_fim:      fim,
    p_representante: representante ?? null,
  });

  // Erro NUNCA vira lista vazia: lista vazia é "não vendeu nada", e a diferença
  // entre as duas coisas é o que faz um diretor decidir errado. O objeto do
  // PostgREST é propagado inteiro para preservar `code` (42501, 22023, …).
  if (error) throw error;
  if (data == null) return [];

  const linhas = (data as unknown[]).map((bruto): DashboardSerieDiariaRow => {
    const row = bruto as Record<string, unknown>;
    const dia = String(row.dia ?? '');
    if (!FORMATO_DATA.test(dia)) {
      throw new Error(
        `app_dashboard_serie_diaria: campo "dia" fora do formato YYYY-MM-DD — recebido ${JSON.stringify(row.dia)}`,
      );
    }
    return {
      dia,
      pedidos:     numeroDaRpc(row.pedidos,     'pedidos',     dia),
      valor_total: numeroDaRpc(row.valor_total, 'valor_total', dia),
    };
  });

  // A RPC NÃO ordena de propósito: `order by` derruba o aggregate pushdown do
  // postgres_fdw sob generic plan (achado A16). A ordenação é responsabilidade
  // do cliente, e é aqui que ela acontece — uma vez só.
  linhas.sort((a, b) => a.dia.localeCompare(b.dia));
  return linhas;
}

// ─── Consolidação da série diária ─────────────────────────────
//
// Transforma a série que a RPC devolve nos quatro números que hoje nascem da
// lista bruta de pedidos. Função PURA: sem rede, sem `new Date()`, sem usuário,
// sem mutação da entrada.
//
// ⚠️ Ainda NÃO está ligada a `fetchDashboardStats`. Isso é a etapa E5-4.

export interface DashboardSerieConsolidada {
  totalVendidoMes: number;
  totalVendidoMesAnt: number;
  pedidosNoPeriodo: number;
  vendasMensais: { mes: string; valor: number }[];
}

/** Quantos baldes mensais o gráfico de vendas mostra. Contrato atual da tela. */
const VENDAS_MENSAIS_BALDES = 6;

/** `'2026-08-31'` → `{ ano: 2026, mes: 7 }` (mês 0-based), sem tocar em `Date`. */
function anoMesDe(data: string): { ano: number; mes: number } {
  return { ano: Number(data.slice(0, 4)), mes: Number(data.slice(5, 7)) - 1 };
}

/**
 * Consolida a série diária nos números do dashboard.
 *
 * ── POR QUE NÃO USA `Date` ──────────────────────────────────────────────────
 * Todo o trabalho é feito sobre strings `YYYY-MM-DD`, que ordenam
 * lexicograficamente igual a cronologicamente, e sobre aritmética de
 * `ano * 12 + mes`. `new Date('2026-01-01')` é interpretado como UTC e
 * `getMonth()` devolve o mês LOCAL — em fuso negativo isso vira dezembro/2025 e
 * o balde inteiro cai no mês errado. Sem `Date`, o problema não existe: janeiro,
 * dezembro, virada de ano e 29/02 saem certos por construção.
 *
 * ── ORDEM E SOMA ────────────────────────────────────────────────────────────
 * A entrada é copiada e ordenada antes de somar. Não é capricho: soma de ponto
 * flutuante DEPENDE da ordem — `0.1+0.2+0.3` e `0.3+0.2+0.1` não dão o mesmo
 * bit. Ordenar torna o resultado determinístico qualquer que seja a ordem em
 * que a RPC devolveu. (Hoje o service soma na ordem arbitrária do PostgREST,
 * que não ordena nada.) A cópia também garante que o array do chamador não é
 * mexido.
 *
 * ── O QUE NÃO FAZ ───────────────────────────────────────────────────────────
 * Não preenche dias ausentes na série diária, não arredonda valor e não conta
 * linhas: `pedidosNoPeriodo` soma o campo `pedidos`, porque uma linha diária
 * representa VÁRIOS pedidos.
 */
export function consolidarDashboardSerie(
  serie: DashboardSerieDiariaRow[],
  janelas: JanelasDashboard,
): DashboardSerieConsolidada {
  // Cópia ordenada — determinismo da soma + entrada intocada.
  const linhas = [...serie].sort((a, b) => a.dia.localeCompare(b.dia));

  // ── Os 6 baldes mensais, sempre presentes, sempre em ordem cronológica ──
  // O último balde é o mês de `mesFim`; os outros cinco são os anteriores.
  // Aritmética em "meses absolutos" (ano*12+mes) atravessa a virada de ano sem
  // caso especial.
  const ref = anoMesDe(janelas.mesFim);
  const refAbs = ref.ano * 12 + ref.mes;

  const vendasMensais: { mes: string; valor: number }[] = [];
  const indicePorChave = new Map<string, number>();

  for (let i = VENDAS_MENSAIS_BALDES - 1; i >= 0; i--) {
    const abs = refAbs - i;
    const ano = Math.floor(abs / 12);
    const mes = abs - ano * 12;                       // 0..11, sem módulo negativo
    const chave = `${ano}-${String(mes + 1).padStart(2, '0')}`;   // 'YYYY-MM'
    indicePorChave.set(chave, vendasMensais.length);
    vendasMensais.push({ mes: MES_ABREV[mes], valor: 0 });
  }

  let totalVendidoMes = 0;
  let totalVendidoMesAnt = 0;
  let pedidosNoPeriodo = 0;

  for (const linha of linhas) {
    // Janelas inclusivas nas duas pontas; comparação lexical é segura em
    // `YYYY-MM-DD`.
    if (linha.dia >= janelas.mesIni && linha.dia <= janelas.mesFim) {
      totalVendidoMes  += linha.valor_total;
      pedidosNoPeriodo += linha.pedidos;
    }
    if (linha.dia >= janelas.mesAntIni && linha.dia <= janelas.mesAntFim) {
      totalVendidoMesAnt += linha.valor_total;
    }

    // Um dia fora dos 6 baldes simplesmente não tem índice: é ignorado, sem
    // criar balde novo nem estourar o contrato de 6 posições.
    const indice = indicePorChave.get(linha.dia.slice(0, 7));
    if (indice !== undefined) vendasMensais[indice].valor += linha.valor_total;
  }

  return { totalVendidoMes, totalVendidoMesAnt, pedidosNoPeriodo, vendasMensais };
}

// ─── Fetch principal ──────────────────────────────────────────
export async function fetchDashboardStats(
  repCodes: string[],
  isAdmin: boolean,
  filtros: DashboardFiltros = {},
  grupos: string[] | null = null,
): Promise<DashboardStats> {
  // ── 0. Datas: UMA fonte só ──
  // Antes havia uma cópia da regra de período aqui dentro, além da de
  // `periodoRange`. Duas cópias da mesma regra é uma divergência esperando
  // acontecer — e ela apareceria como números diferentes para o mesmo filtro.
  const janelas  = dashboardJanelas(filtros);
  const rpcRange = dashboardRpcRange(filtros);

  // ── 1. Buscar pedidos do representante (id + valor + data) ──
  //
  // ⚠️ Esta consulta CONTINUA existindo, e continua cortada em 1.000 linhas pelo
  // Data API. Ela ainda é a fonte de `totalPedidos`, `ticketMedio`, `pipeline`,
  // `faturado` e `truncado` — todos precisam de `numero_pedido`, que a RPC não
  // devolve. Só a SÉRIE saiu daqui.
  let pedidosQuery = supabase
    .from('concrem_pedidos_venda')
    .select('id, numero_pedido, total_pedido_venda, data_emissao, representante')
    .in('id_nota_conf', VALID_ID_NOTA_CONF);

  if (grupos != null) {
    pedidosQuery = pedidosQuery.in('grupo_cliente', grupos);
  } else if (!isAdmin && repCodes.length > 0) {
    pedidosQuery = pedidosQuery.in('representante', repCodes);
  }
  // Filtro por representante específico (usado pelo admin)
  if (filtros.representante) {
    pedidosQuery = pedidosQuery.eq('representante', filtros.representante);
  }
  if (REP_EXCLUIDOS.length > 0) {
    pedidosQuery = pedidosQuery.not(
      'representante', 'in',
      `(${REP_EXCLUIDOS.map(r => `"${r}"`).join(',')})`,
    );
  }

  // ── 2. As duas leituras, em paralelo ──
  // São independentes: a série vem agregada do ERP, a lista bruta vem do Data
  // API. Em série custariam dois round-trips somados sem necessidade.
  //
  // A RPC é chamada UMA vez. Não existe fallback para a lista bruta: se ela
  // falhar, o erro sobe e o React Query marca `isError`. Transformar falha em
  // zero seria o defeito D-2 de novo — R$ 0,00 indistinguível de "não vendeu".
  const [serie, brutos] = await Promise.all([
    fetchDashboardSerieDiaria(rpcRange.ini, rpcRange.fim, filtros.representante),
    pedidosQuery,
  ]);

  const { data: pedidosData, error: pedidosErr } = brutos;

  // ⚠️ O early-return por LISTA VAZIA foi REMOVIDO.
  // Ele impedia a série de existir sempre que o filtro bruto não achasse nada —
  // e o filtro bruto do diretor é só por grupo, enquanto a RPC usa
  // `reps OR grupos` (DIV-1, medida na E5-0: +12 pedidos e +R$ 61.979,72 num
  // caso real). Com o early-return, esse diretor veria zero.
  //
  // O tratamento de ERRO desta consulta fica como estava, de propósito: a E5 não
  // redesenha erro. Consequência conhecida e aceita por ora — um erro aqui ainda
  // descarta uma série válida. Revisar na E5-6.
  if (pedidosErr) return EMPTY_STATS;

  const pedidos = pedidosData ?? [];

  const consolidado = consolidarDashboardSerie(serie, janelas);

  const totalPedidos = pedidos.length;
  const totalGeral   = pedidos.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
  const ticketMedio  = totalPedidos > 0 ? totalGeral / totalPedidos : 0;

  // Recorte do período na lista bruta — usado SOMENTE para o cálculo de
  // faturado, que precisa de `numero_pedido`. `totalVendidoMes` e
  // `pedidosNoPeriodo` NÃO saem mais daqui: vêm do consolidado.
  const pedidosMes = pedidos.filter(
    p => p.data_emissao >= janelas.mesIni && p.data_emissao <= janelas.mesFim,
  );

  // ── 3. Status do pipeline (concrem_pedidos_status) ──
  const numeros = pedidos.map(p => p.numero_pedido).filter(Boolean);

  // Busca em lotes de 200 para evitar limite de URL do PostgREST
  const statusPorNumero = new Map<string, PedidoStatus>();
  for (let i = 0; i < numeros.length; i += 200) {
    const batch = numeros.slice(i, i + 200);
    const { data: statusRows } = await supabase
      .from('concrem_pedidos_status')
      .select('numero_pedido, status_atual')
      .in('numero_pedido', batch);
    for (const row of (statusRows ?? []) as { numero_pedido: string; status_atual: string }[]) {
      statusPorNumero.set(row.numero_pedido, mapStatus(row.status_atual));
    }
  }

  const pipeline: PipelineCounts = { ...EMPTY_PIPELINE };

  // Pedidos sem status em pedidos_status = 'aprovado' (entrada no pipeline)
  for (const p of pedidos) {
    const st = statusPorNumero.get(p.numero_pedido) ?? 'aprovado';
    pipeline[st] = (pipeline[st] ?? 0) + 1;
    pipeline.total += 1;
  }

  // ── 4. Faturado do período — regra de negócio: pedido é considerado FATURADO
  // quando tem NOTA FISCAL **e** BOLETO anexados (relatorio_entrega_anexos).
  // Busca os anexos dos pedidos emitidos no período (lotes de 200) e cruza.
  const nfSet = new Set<string>();
  const boletoSet = new Set<string>();
  const numerosMes = pedidosMes.map(p => p.numero_pedido).filter(Boolean);
  for (let i = 0; i < numerosMes.length; i += 200) {
    const batch = numerosMes.slice(i, i + 200);
    const { data: anexos } = await supabase
      .from('relatorio_entrega_anexos')
      .select('pedido_id, tipo')
      .in('pedido_id', batch);
    for (const a of (anexos ?? []) as { pedido_id: string; tipo: string }[]) {
      const t = (a.tipo ?? '').toLowerCase();
      if (t.includes('boleto')) boletoSet.add(a.pedido_id);
      else if (t.includes('nota') || t.includes('nf') || t.includes('fiscal')) nfSet.add(a.pedido_id);
    }
  }

  const pedidosFaturados = pedidosMes.filter(
    p => nfSet.has(p.numero_pedido) && boletoSet.has(p.numero_pedido),
  );
  const totalFaturadoMes  = pedidosFaturados.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
  const faturadosNoPeriodo = pedidosFaturados.length;

  // ── 5. Vendas mensais — vêm do consolidado da RPC (etapa 5 antiga saiu daqui).
  //
  // O laço de 6 baldes sobre a lista bruta foi REMOVIDO: ele somava sobre o
  // recorte de 1.000 linhas e usava `new Date(...)` com getters locais, o que
  // desloca o mês em fuso positivo. Agora sai de `consolidarDashboardSerie`,
  // que trabalha só com strings.

  return {
    pipeline,
    // ── Da RPC (agregado no ERP, sem teto de 1.000) ──
    totalVendidoMes:    consolidado.totalVendidoMes,
    totalVendidoMesAnt: consolidado.totalVendidoMesAnt,
    pedidosNoPeriodo:   consolidado.pedidosNoPeriodo,
    vendasMensais:      consolidado.vendasMensais,
    // ── Da lista bruta (ainda sujeitos ao teto) ──
    totalFaturadoMes,
    faturadosNoPeriodo,
    ticketMedio,
    totalPedidos,
    // Bateu no teto do Data API → o que veio da LISTA BRUTA é recorte, não o
    // conjunto. Continua dependendo SÓ dela: a série da RPC não é truncável.
    truncado: atingiuTeto(pedidos.length),
  };
}
