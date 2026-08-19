import { supabase } from '@/lib/supabase/client';
import { VALID_ID_NOTA_CONF } from '@/constants/orderFilters';
import { API_MAX_ROWS, marcarTruncamento, type ListaTruncavel } from '@/constants/apiLimits';

export interface ClienteCarteira {
  cliente_codigo: string;
  cliente_cnpj: string;
  cliente_nome: string;
  cliente_fantasia: string | null;
  cliente_cidade: string;
  cliente_uf: string;
  cliente_telefone: string;
  cliente_email: string | null;
  grupo_cliente: string;   // normalizado; null/vazio → 'SEM GRUPO'
  total_pedidos: number;
  total_comprado: number;
  ultimo_pedido: string;   // data_emissao ISO (mais recente)
  primeiro_pedido: string; // data_emissao ISO (mais antigo) — p/ ciclo médio de recompra
}

export interface FetchCarteiraParams {
  repCodes?: string[];
  admin?: boolean;
  grupos?: string[] | null;   // diretor: filtra por grupo_cliente (null = não-diretor)
  representante?: string; // filtro extra para admin
}

const CAMPOS = [
  'cliente_codigo',
  'cliente_cnpj',
  'cliente_nome',
  'cliente_fantasia',
  'cliente_cidade',
  'cliente_uf',
  'cliente_telefone',
  'cliente_email',
  'grupo_cliente',
  'data_emissao',
  'total_pedido_venda',
].join(',');

export async function fetchCarteira(params: FetchCarteiraParams): Promise<ListaTruncavel<ClienteCarteira>> {
  const { repCodes = [], admin = false, grupos = null, representante } = params;

  if (grupos == null && !admin && repCodes.length === 0) return [];

  let query = supabase
    .from('concrem_pedidos_venda')
    .select(CAMPOS)
    .in('id_nota_conf', VALID_ID_NOTA_CONF)
    .limit(API_MAX_ROWS);

  if (grupos != null) {
    query = query.in('grupo_cliente', grupos);
  } else if (!admin) {
    query = query.in('representante', repCodes);
  } else if (representante) {
    query = query.ilike('representante', `%${representante}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Deduplica por CNPJ, acumulando métricas
  const map = new Map<string, ClienteCarteira>();

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const cnpj: string = (row.cliente_cnpj as string) ?? '';
    const existing = map.get(cnpj);
    const valor: number = (row.total_pedido_venda as number) ?? 0;
    const data_emissao: string = (row.data_emissao as string) ?? '';

    if (!existing) {
      map.set(cnpj, {
        cliente_codigo:   (row.cliente_codigo as string) ?? '',
        cliente_cnpj:     cnpj,
        cliente_nome:     (row.cliente_nome as string) ?? '',
        cliente_fantasia: (row.cliente_fantasia as string | null) ?? null,
        cliente_cidade:   (row.cliente_cidade as string) ?? '',
        cliente_uf:       (row.cliente_uf as string) ?? '',
        cliente_telefone: (row.cliente_telefone as string) ?? '',
        cliente_email:    (row.cliente_email as string | null) ?? null,
        grupo_cliente:    (((row.grupo_cliente as string | null) ?? '').trim() || 'SEM GRUPO'),
        total_pedidos:    1,
        total_comprado:   valor,
        ultimo_pedido:    data_emissao,
        primeiro_pedido:  data_emissao,
      });
    } else {
      existing.total_pedidos  += 1;
      existing.total_comprado += valor;
      if (data_emissao > existing.ultimo_pedido) {
        existing.ultimo_pedido = data_emissao;
      }
      if (data_emissao && (!existing.primeiro_pedido || data_emissao < existing.primeiro_pedido)) {
        existing.primeiro_pedido = data_emissao;
      }
    }
  }

  const clientes = Array.from(map.values())
    .sort((a, b) => {
      const nomeA = (a.cliente_fantasia?.trim() || a.cliente_nome).toLowerCase();
      const nomeB = (b.cliente_fantasia?.trim() || b.cliente_nome).toLowerCase();
      return nomeA.localeCompare(nomeB, 'pt-BR');
    });

  // Quem foi cortado pelo teto foram os PEDIDOS que originaram estes clientes —
  // por isso a marca vem do nº de linhas cruas, não do tamanho da lista devolvida.
  return marcarTruncamento(clientes, data?.length ?? 0);
}

// ─── Pedidos de um cliente (para o painel de inteligência) ──────────────────
export interface ClientePedido {
  numero_pedido: string;
  data_emissao: string;        // ISO
  total_pedido_venda: number;
  dados_tabela: string;        // JSON com { itens: [...] }
}

export async function fetchClientePedidos(
  params: FetchCarteiraParams & { cnpj: string }
): Promise<ClientePedido[]> {
  const { cnpj, repCodes = [], admin = false, grupos = null, representante } = params;
  if (!cnpj || (grupos == null && !admin && repCodes.length === 0)) return [];

  let query = supabase
    .from('concrem_pedidos_venda')
    .select('numero_pedido, data_emissao, total_pedido_venda, dados_tabela')
    .in('id_nota_conf', VALID_ID_NOTA_CONF)
    .eq('cliente_cnpj', cnpj)
    .order('data_emissao', { ascending: true })
    .limit(1000);

  if (grupos != null) {
    query = query.in('grupo_cliente', grupos);
  } else if (!admin) {
    query = query.in('representante', repCodes);
  } else if (representante) {
    query = query.ilike('representante', `%${representante}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ClientePedido[];
}
