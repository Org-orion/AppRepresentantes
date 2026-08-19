import { supabase } from '@/lib/supabase/client';
import { VALID_ID_NOTA_CONF } from '@/constants/orderFilters';
import { atingiuTeto, marcarComo, type ListaTruncavel } from '@/constants/apiLimits';
import { REP_EXCLUIDOS } from '@/services/pedidosVenda';

// A tela Financeiro mostra os documentos (NF/boleto) de cada pedido.
// Os anexos vêm de relatorio_entrega_anexos (FDW + RLS): cada representante
// só recebe os anexos dos pedidos dos seus clientes — o escopo é garantido no banco.

export interface AnexoItem {
  tipo: string;
  arquivo_nome: string;
  arquivo_url: string;
  criado_em?: string | null;   // quando o documento foi anexado (timeline/histórico)
}

export interface PedidoComAnexos {
  numero_pedido: string;
  cliente_nome: string;
  cliente_fantasia: string | null;
  data_emissao: string;
  anexos: AnexoItem[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function fetchPedidosComAnexos(grupos: string[] | null = null): Promise<PedidoComAnexos[]> {
  // 1. Anexos — a RLS já filtra pelos pedidos do representante logado
  const { data: anexos, error } = await supabase
    .from('relatorio_entrega_anexos')
    .select('pedido_id, tipo, arquivo_nome, arquivo_url');
  if (error) throw error;
  if (!anexos?.length) return [];

  const anexosByPedido = new Map<string, AnexoItem[]>();
  for (const a of anexos as { pedido_id: string; tipo: string; arquivo_nome: string; arquivo_url: string }[]) {
    if (!a.pedido_id) continue;
    if (!anexosByPedido.has(a.pedido_id)) anexosByPedido.set(a.pedido_id, []);
    anexosByPedido.get(a.pedido_id)!.push({
      tipo: a.tipo,
      arquivo_nome: a.arquivo_nome,
      arquivo_url: a.arquivo_url,
    });
  }

  // 2. Dados dos pedidos correspondentes (cliente, data) — em lotes p/ não estourar URL
  const numeros = [...anexosByPedido.keys()];
  const info = new Map<string, { cliente_nome: string; cliente_fantasia: string | null; data_emissao: string }>();

  for (const batch of chunk(numeros, 200)) {
    let pq = supabase
      .from('concrem_pedidos_venda')
      .select('numero_pedido, cliente_nome, cliente_fantasia, data_emissao')
      .in('numero_pedido', batch)
      .in('id_nota_conf', VALID_ID_NOTA_CONF);
    if (grupos != null) pq = pq.in('grupo_cliente', grupos); // diretor: só seus grupos
    const { data: pedidos } = await pq;
    for (const p of (pedidos ?? []) as { numero_pedido: string; cliente_nome: string; cliente_fantasia: string | null; data_emissao: string }[]) {
      info.set(p.numero_pedido, {
        cliente_nome: p.cliente_nome,
        cliente_fantasia: p.cliente_fantasia,
        data_emissao: p.data_emissao,
      });
    }
  }

  return numeros
    // Só pedidos válidos (id_nota_conf permitido): descarta anexos de pedidos fora da regra
    .filter(numero => info.has(numero))
    .map(numero => {
      const i = info.get(numero);
      return {
        numero_pedido: numero,
        cliente_nome: i?.cliente_nome ?? '',
        cliente_fantasia: i?.cliente_fantasia ?? null,
        data_emissao: i?.data_emissao ?? '',
        anexos: anexosByPedido.get(numero) ?? [],
      };
    })
    .sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// Central Financeira: além dos pedidos com anexos, inclui pedidos FATURADOS
// (ou além) mesmo sem documentação, para revelar pendências ("faturado sem NF/
// boleto"). Escopo por representante garantido via concrem_pedidos_venda.
// ─────────────────────────────────────────────────────────────────────────────
export interface PedidoFinanceiro {
  numero_pedido: string;
  cliente_nome: string;
  cliente_fantasia: string | null;
  cliente_cnpj: string;
  cliente_cidade: string | null;
  cliente_uf: string | null;
  data_emissao: string;
  situacao_entrega: string | null;
  representante: string | null;
  total_pedido_venda: number;
  faturado: boolean;
  anexos: AnexoItem[];
}

export interface FetchFinanceiroParams { repCodes?: string[]; admin?: boolean; grupos?: string[] | null; }

// Valores brutos do ERP que indicam "faturado ou além"
const FATURADO_RAW = ['faturado', 'em_entrega', 'entregue', 'finalizado'];

export async function fetchFinanceiro(params: FetchFinanceiroParams): Promise<ListaTruncavel<PedidoFinanceiro>> {
  const { repCodes = [], admin = false, grupos = null } = params;
  if (grupos == null && !admin && repCodes.length === 0) return [];

  // 1. Anexos (RLS já filtra por representante)
  const { data: anexos, error: anexosErr } = await supabase
    .from('relatorio_entrega_anexos')
    .select('pedido_id, tipo, arquivo_nome, arquivo_url, criado_em');
  if (anexosErr) throw anexosErr;

  const anexosByPedido = new Map<string, AnexoItem[]>();
  for (const a of (anexos ?? []) as { pedido_id: string; tipo: string; arquivo_nome: string; arquivo_url: string; criado_em: string | null }[]) {
    if (!a.pedido_id) continue;
    const arr = anexosByPedido.get(a.pedido_id) ?? [];
    arr.push({ tipo: a.tipo, arquivo_nome: a.arquivo_nome, arquivo_url: a.arquivo_url, criado_em: a.criado_em });
    anexosByPedido.set(a.pedido_id, arr);
  }

  // 2. Pedidos faturados (status) — global; o escopo é aplicado no passo 3
  const faturadoNumeros = new Set<string>();
  const { data: statusFat } = await supabase
    .from('concrem_pedidos_status')
    .select('numero_pedido, status_atual')
    .in('status_atual', FATURADO_RAW);
  for (const s of (statusFat ?? []) as { numero_pedido: string; status_atual: string }[]) {
    faturadoNumeros.add(s.numero_pedido);
  }

  // 3. Info dos pedidos (com anexos ∪ faturados), escopo por representante
  const numeros = [...new Set([...anexosByPedido.keys(), ...faturadoNumeros])];
  if (numeros.length === 0) return [];

  type Info = {
    numero_pedido: string; cliente_nome: string; cliente_fantasia: string | null;
    cliente_cnpj: string; cliente_cidade: string | null; cliente_uf: string | null;
    data_emissao: string; situacao_entrega: string | null; representante: string | null; total_pedido_venda: number;
  };
  const info = new Map<string, Info>();

  for (const batch of chunk(numeros, 200)) {
    let q = supabase
      .from('concrem_pedidos_venda')
      .select('numero_pedido, cliente_nome, cliente_fantasia, cliente_cnpj, cliente_cidade, cliente_uf, data_emissao, situacao_entrega, representante, total_pedido_venda')
      .in('numero_pedido', batch)
      .in('id_nota_conf', VALID_ID_NOTA_CONF)
      .not('representante', 'in', `(${REP_EXCLUIDOS.map(r => `"${r}"`).join(',')})`);
    if (grupos != null) q = q.in('grupo_cliente', grupos);
    else if (!admin) q = q.in('representante', repCodes);
    const { data } = await q;
    for (const row of (data ?? []) as Info[]) info.set(row.numero_pedido, row);
  }

  // Duas consultas desta função podem ser cortadas pelo teto do Data API: os
  // anexos e os status faturados. Qualquer uma das duas invalida a contagem.
  const truncado = atingiuTeto(anexos?.length ?? 0) || atingiuTeto(statusFat?.length ?? 0);

  // 4. Monta — apenas pedidos no escopo (info presente)
  const lista = numeros
    .map(numero => {
      const i = info.get(numero);
      if (!i) return null;
      return {
        numero_pedido: numero,
        cliente_nome: i.cliente_nome ?? '',
        cliente_fantasia: i.cliente_fantasia ?? null,
        cliente_cnpj: i.cliente_cnpj ?? '',
        cliente_cidade: i.cliente_cidade ?? null,
        cliente_uf: i.cliente_uf ?? null,
        data_emissao: i.data_emissao ?? '',
        situacao_entrega: i.situacao_entrega ?? null,
        representante: i.representante ?? null,
        total_pedido_venda: i.total_pedido_venda ?? 0,
        faturado: faturadoNumeros.has(numero),
        anexos: anexosByPedido.get(numero) ?? [],
      } as PedidoFinanceiro;
    })
    .filter((p): p is PedidoFinanceiro => p !== null)
    .sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || ''));

  return marcarComo(lista, truncado);
}
