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

const MES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Intervalo [ini, fim] (YYYY-MM-DD) do período selecionado — reutilizado por
// outros serviços (performance por rep/grupo) para respeitar o filtro de período.
export function periodoRange(filtros: DashboardFiltros = {}): { ini: string; fim: string } {
  const periodo = filtros.periodo ?? 'mes';
  const now = new Date();
  const ano = filtros.ano ?? now.getFullYear();
  if (periodo === 'trimestre') {
    // Últimos 3 meses (janela móvel) terminando no mês atual (dezembro, se ano passado).
    const mFim = ano === now.getFullYear() ? now.getMonth() : 11;
    return { ini: startOf(ano, mFim - 2), fim: endOf(ano, mFim) };
  }
  if (periodo === 'ano') {
    return { ini: startOf(ano, 0), fim: endOf(ano, 11) };
  }
  const m = (filtros.mes ?? (now.getMonth() + 1)) - 1;
  return { ini: startOf(ano, m), fim: endOf(ano, m) };
}

// ─── Fetch principal ──────────────────────────────────────────
export async function fetchDashboardStats(
  repCodes: string[],
  isAdmin: boolean,
  filtros: DashboardFiltros = {},
  grupos: string[] | null = null,
): Promise<DashboardStats> {
  const periodo = filtros.periodo ?? 'mes';
  const now   = new Date();
  const ano   = filtros.ano ?? now.getFullYear();

  // ── 1. Buscar pedidos do representante (id + valor + data) ──
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

  const { data: pedidosData, error: pedidosErr } = await pedidosQuery;
  if (pedidosErr || !pedidosData?.length) return EMPTY_STATS;

  const totalPedidos = pedidosData.length;
  const totalGeral   = pedidosData.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
  const ticketMedio  = totalPedidos > 0 ? totalGeral / totalPedidos : 0;

  // ── 2. Intervalo do período selecionado (e do período anterior) ──
  let mesIni: string, mesFim: string, mesAntIni: string, mesAntFim: string;
  if (periodo === 'trimestre') {
    // Últimos 3 meses (janela móvel) terminando no mês atual (dezembro, se ano passado).
    const mFim = ano === now.getFullYear() ? now.getMonth() : 11;
    mesIni    = startOf(ano, mFim - 2);  mesFim    = endOf(ano, mFim);
    mesAntIni = startOf(ano, mFim - 5);  mesAntFim = endOf(ano, mFim - 3);
  } else if (periodo === 'ano') {
    mesIni    = startOf(ano, 0);      mesFim    = endOf(ano, 11);
    mesAntIni = startOf(ano - 1, 0);  mesAntFim = endOf(ano - 1, 11);
  } else {
    const m = (filtros.mes ?? (now.getMonth() + 1)) - 1;  // 0-based
    mesIni    = startOf(ano, m);      mesFim    = endOf(ano, m);
    mesAntIni = startOf(ano, m - 1);  mesAntFim = endOf(ano, m - 1);
  }

  const pedidosMes = pedidosData.filter(
    p => p.data_emissao >= mesIni && p.data_emissao <= mesFim,
  );
  const pedidosMesAnt = pedidosData.filter(
    p => p.data_emissao >= mesAntIni && p.data_emissao <= mesAntFim,
  );

  const totalVendidoMes    = pedidosMes.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
  const totalVendidoMesAnt = pedidosMesAnt.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);

  // ── 3. Status do pipeline (concrem_pedidos_status) ──
  const numeros = pedidosData.map(p => p.numero_pedido).filter(Boolean);

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
  for (const p of pedidosData) {
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

  // ── 5. Vendas mensais — 6 meses terminando no fim do período selecionado ──
  const refDate  = new Date(`${mesFim}T00:00:00`);
  const refYear  = refDate.getFullYear();
  const refMonth = refDate.getMonth();
  const vendasMensais: { mes: string; valor: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const m   = refMonth - i;
    const y   = m < 0 ? refYear - 1 : refYear;
    const mi  = ((m % 12) + 12) % 12;
    const ini = startOf(y, mi);
    const fim = endOf(y, mi);
    const valor = pedidosData
      .filter(p => p.data_emissao >= ini && p.data_emissao <= fim)
      .reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
    vendasMensais.push({ mes: MES_ABREV[mi], valor });
  }

  return {
    pipeline,
    totalVendidoMes,
    totalVendidoMesAnt,
    totalFaturadoMes,
    faturadosNoPeriodo,
    ticketMedio,
    totalPedidos,
    pedidosNoPeriodo: pedidosMes.length,
    vendasMensais,
    // Bateu no teto do Data API → tudo acima é recorte, não o conjunto.
    truncado: atingiuTeto(pedidosData.length),
  };
}
