import { supabase } from '@/lib/supabase/client';
import { VALID_ID_NOTA_CONF } from '@/constants/orderFilters';
import { API_MAX_ROWS } from '@/constants/apiLimits';
import { mapStatus } from '@/services/acompanhamento';
import type { PedidoVenda, PedidoDadosTabela, PedidoItemERP, PedidoAnexo } from '@/types';

export const PAGE_SIZE = 50;

// Teto de linhas carregadas na Central de Pedidos (modo client-side).
// Cobre com folga a carteira de um representante; admin sem filtro pode truncar.
// NOTA: o Data API corta em API_MAX_ROWS (1.000), então este teto só valeria se
// fosse MENOR que ele. Hoje é decorativo — mantido porque a Etapa 7 do
// docs/PLANO-SANEAMENTO.md vai mover os agregados para o banco e redefinir isto.
export const CENTRAL_CAP = Math.min(1500, API_MAX_ROWS);

// Representantes excluídos de todas as consultas (vendas diretas)
export const REP_EXCLUIDOS = ['40001498 - JANDERSON LEROY MERLIN'];

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Enriquecimento (status pipeline + anexos NF/boleto) em lotes de 200 para
// não estourar o limite de URL do PostgREST quando há muitos pedidos.
async function enriquecerPedidos(pedidos: PedidoVenda[]): Promise<void> {
  const numeros = pedidos.map(p => p.numero_pedido).filter(Boolean);
  if (numeros.length === 0) return;

  const statusMap: Record<string, string> = {};
  const anexosMap: Record<string, PedidoAnexo[]> = {};

  for (const batch of chunk(numeros, 200)) {
    const [{ data: statusRows }, { data: anexosData }] = await Promise.all([
      supabase.from('concrem_pedidos_status').select('numero_pedido, status_atual').in('numero_pedido', batch),
      supabase.from('relatorio_entrega_anexos').select('pedido_id, tipo, arquivo_nome, arquivo_url').in('pedido_id', batch).order('criado_em', { ascending: false }),
    ]);
    for (const s of (statusRows ?? []) as { numero_pedido: string; status_atual: string }[]) {
      statusMap[s.numero_pedido] = s.status_atual;
    }
    for (const a of (anexosData ?? []) as { pedido_id: string; tipo: string; arquivo_nome: string; arquivo_url: string }[]) {
      if (!anexosMap[a.pedido_id]) anexosMap[a.pedido_id] = [];
      anexosMap[a.pedido_id].push({ tipo: a.tipo, arquivo_nome: a.arquivo_nome, arquivo_url: a.arquivo_url });
    }
  }

  for (const p of pedidos) {
    p.status_pipeline = mapStatus(statusMap[p.numero_pedido] ?? null);
    p.anexos = anexosMap[p.numero_pedido] ?? [];
  }
}

export interface FetchPedidosParams {
  repCodes?: string[];   // vazio = admin (todos)
  admin?: boolean;
  grupos?: string[] | null;   // diretor: filtra por grupo_cliente (null = não-diretor)
  page?: number;
  search?: string;      // nº pedido / CNPJ
  cliente?: string;     // nome/fantasia do cliente
  representante?: string;
  dataInicio?: string;
  dataFim?: string;
  ano?: number;
  mes?: number;
  situacaoEntrega?: string;
}

export interface FetchPedidosResult {
  data: PedidoVenda[];
  total: number;
}

export async function fetchPedidosVenda(params: FetchPedidosParams): Promise<FetchPedidosResult> {
  const { repCodes = [], admin = false, grupos = null, page = 1, search, cliente, representante, dataInicio, dataFim, ano, mes, situacaoEntrega } = params;

  if (!admin && repCodes.length === 0) return { data: [], total: 0 };

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('concrem_pedidos_venda')
    .select('*', { count: 'exact' })
    .in('id_nota_conf', VALID_ID_NOTA_CONF)
    .order('data_emissao', { ascending: false })
    .not('representante', 'in', `(${REP_EXCLUIDOS.map(r => `"${r}"`).join(',')})`)
    .range(from, to);

  if (grupos != null) {
    query = query.in('grupo_cliente', grupos);
  } else if (!admin) {
    query = query.in('representante', repCodes);
  }

  if (representante) {
    query = query.ilike('representante', `%${representante}%`);
  }

  if (search) {
    query = query.or(`numero_pedido.ilike.%${search}%,cliente_cnpj.ilike.%${search}%`);
  }

  if (cliente) {
    query = query.or(`cliente_nome.ilike.%${cliente}%,cliente_fantasia.ilike.%${cliente}%`);
  }

  // Filtro por ano/mês — sobrepõe dataInicio/dataFim se definido
  if (ano) {
    const mStart = mes ?? 1;
    const mEnd   = mes ?? 12;
    const lastDay = new Date(ano, mEnd, 0).getDate();
    const ini = `${ano}-${String(mStart).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(mEnd).padStart(2, '0')}-${lastDay}`;
    query = query.gte('data_emissao', ini).lte('data_emissao', fim);
  } else {
    if (dataInicio) query = query.gte('data_emissao', dataInicio);
    if (dataFim)    query = query.lte('data_emissao', dataFim);
  }

  if (situacaoEntrega) {
    query = query.eq('situacao_entrega', situacaoEntrega);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const pedidos = (data ?? []) as PedidoVenda[];

  // Enriquecer com status_pipeline de pedidos_status
  if (pedidos.length > 0) {
    const numeros = pedidos.map(p => p.numero_pedido).filter(Boolean);

    const { data: statusRows } = await supabase
      .from('concrem_pedidos_status')
      .select('numero_pedido, status_atual')
      .in('numero_pedido', numeros);

    if (statusRows) {
      const statusMap: Record<string, string> = {};
      for (const s of statusRows as { numero_pedido: string; status_atual: string }[]) {
        statusMap[s.numero_pedido] = s.status_atual;
      }
      for (const p of pedidos) {
        p.status_pipeline = mapStatus(statusMap[p.numero_pedido] ?? null);
      }
    }
  }

  // Enriquecer com anexos (notas fiscais e boletos) de relatorio_entrega_anexos
  if (pedidos.length > 0) {
    const numeros = pedidos.map(p => p.numero_pedido).filter(Boolean);
    const { data: anexosData } = await supabase
      .from('relatorio_entrega_anexos')
      .select('pedido_id, tipo, arquivo_nome, arquivo_url')
      .in('pedido_id', numeros)
      .order('criado_em', { ascending: false });

    if (anexosData) {
      const anexosMap: Record<string, PedidoAnexo[]> = {};
      for (const a of anexosData as { pedido_id: string; tipo: string; arquivo_nome: string; arquivo_url: string }[]) {
        if (!anexosMap[a.pedido_id]) anexosMap[a.pedido_id] = [];
        anexosMap[a.pedido_id].push({ tipo: a.tipo, arquivo_nome: a.arquivo_nome, arquivo_url: a.arquivo_url });
      }
      for (const p of pedidos) {
        p.anexos = anexosMap[p.numero_pedido] ?? [];
      }
    }
  }

  return { data: pedidos, total: count ?? 0 };
}

export interface FetchPedidosCompletoResult {
  data: PedidoVenda[];
  total: number;
  /**
   * true quando a lista devolvida NÃO é o conjunto filtrado inteiro.
   *
   * Antes isto era `total > CENTRAL_CAP`, o que descrevia a intenção do código e
   * não a realidade: o Data API corta em API_MAX_ROWS (1.000) e o `.limit(1500)`
   * nunca foi respeitado. Agora sai do que de fato chegou.
   */
  truncated: boolean;
}

// Carrega o conjunto filtrado inteiro (até CENTRAL_CAP) para a Central de
// Pedidos operar 100% client-side: KPIs, gráficos, quick-filters e as 3 visões
// (Cards / Tabela / Pipeline) sem refetch a cada interação.
export async function fetchPedidosCompleto(params: FetchPedidosParams): Promise<FetchPedidosCompletoResult> {
  const { repCodes = [], admin = false, grupos = null, search, cliente, representante, ano, mes, situacaoEntrega } = params;
  if (grupos == null && !admin && repCodes.length === 0) return { data: [], total: 0, truncated: false };

  let query = supabase
    .from('concrem_pedidos_venda')
    .select('*', { count: 'exact' })
    .in('id_nota_conf', VALID_ID_NOTA_CONF)
    .order('data_emissao', { ascending: false })
    .not('representante', 'in', `(${REP_EXCLUIDOS.map(r => `"${r}"`).join(',')})`)
    .limit(CENTRAL_CAP);

  if (grupos != null) query = query.in('grupo_cliente', grupos);
  else if (!admin)   query = query.in('representante', repCodes);
  if (representante) query = query.ilike('representante', `%${representante}%`);
  if (search)        query = query.or(`numero_pedido.ilike.%${search}%,cliente_cnpj.ilike.%${search}%`);
  if (cliente)       query = query.or(`cliente_nome.ilike.%${cliente}%,cliente_fantasia.ilike.%${cliente}%`);

  if (ano) {
    const mStart = mes ?? 1;
    const mEnd   = mes ?? 12;
    const lastDay = new Date(ano, mEnd, 0).getDate();
    query = query
      .gte('data_emissao', `${ano}-${String(mStart).padStart(2, '0')}-01`)
      .lte('data_emissao', `${ano}-${String(mEnd).padStart(2, '0')}-${lastDay}`);
  }
  if (situacaoEntrega) query = query.eq('situacao_entrega', situacaoEntrega);

  const { data, error, count } = await query;
  if (error) throw error;

  const pedidos = (data ?? []) as PedidoVenda[];
  await enriquecerPedidos(pedidos);

  const total = count ?? pedidos.length;
  return { data: pedidos, total, truncated: pedidos.length < total };
}

export async function fetchSituacoesEntrega(): Promise<string[]> {
  const { data, error } = await supabase
    .from('concrem_pedidos_venda')
    .select('situacao_entrega')
    .in('id_nota_conf', VALID_ID_NOTA_CONF)
    .not('situacao_entrega', 'is', null)
    .order('situacao_entrega');

  if (error) throw error;

  return [...new Set((data ?? []).map(r => r.situacao_entrega as string))];
}

export async function fetchRepresentantesUnicos(): Promise<string[]> {
  const { data, error } = await supabase
    .from('concrem_pedidos_venda')
    .select('representante')
    .in('id_nota_conf', VALID_ID_NOTA_CONF)
    .not('representante', 'is', null)
    .not('representante', 'in', `(${REP_EXCLUIDOS.map(r => `"${r}"`).join(',')})`)
    .order('representante');

  if (error) throw error;

  const unicos = [...new Set((data ?? []).map(r => r.representante as string))];
  return unicos;
}

export interface PedidoHistoricoItem {
  status: string;
  observacao: string | null;
  responsavel: string | null;
  created_at: string;
}

// Histórico de transições de status de um pedido (concrem_pedidos_status_historico).
export async function fetchPedidoHistorico(numeroPedido: string): Promise<PedidoHistoricoItem[]> {
  const { data, error } = await supabase
    .from('concrem_pedidos_status_historico')
    .select('status, observacao, responsavel, created_at')
    .eq('numero_pedido', numeroPedido)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PedidoHistoricoItem[];
}

// ─── Helpers ──────────────────────────────────────────────

export function parseDadosTabela(dados_tabela: string): PedidoDadosTabela {
  try {
    const parsed = JSON.parse(dados_tabela);
    return { itens: Array.isArray(parsed?.itens) ? parsed.itens : [] };
  } catch {
    return { itens: [] };
  }
}

export function getPedidoItens(pedido: PedidoVenda): PedidoItemERP[] {
  return parseDadosTabela(pedido.dados_tabela).itens;
}

export function calcularComissao(pedido: PedidoVenda, percentual: number): number {
  return pedido.total_pedido_venda * (percentual / 100);
}
