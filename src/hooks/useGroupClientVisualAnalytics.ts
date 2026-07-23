import { useMemo } from 'react';
import { movimentacaoCliente, type Movimentacao } from '@/pages/ClientesPage';
import type { ClienteCarteira } from '@/services/carteira';

const DAY = 86_400_000;
function parseISO(d?: string | null): Date | null {
  const s = (d ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : null;
}

export interface ClientStat {
  c: ClienteCarteira;
  cnpj: string;
  nome: string;
  cidadeUf: string;
  total: number;
  pedidos: number;
  ticket: number;
  ultimo: string | null;
  intervalo: number | null;   // dias médios entre compras (null se < 2 pedidos)
  diasDesde: number | null;   // dias desde a última compra
  status: Movimentacao;
  pct: number;                // % do valor total do grupo
}

export interface StatusSlice { status: Movimentacao; label: string; n: number; color: string; }

export const STATUS_COLOR: Record<Movimentacao, string> = {
  ativo: '#10b981', atencao: '#f59e0b', atrasado: '#ef4444', dormente: '#64748b', sem_historico: '#cbd5e1',
};
const STATUS_LABEL: Record<Movimentacao, string> = {
  ativo: 'Ativo', atencao: 'Atenção', atrasado: 'Atrasado', dormente: 'Dormente', sem_historico: 'Sem histórico',
};
const STATUS_ORDER: Movimentacao[] = ['ativo', 'atencao', 'atrasado', 'dormente', 'sem_historico'];

function nomeDe(c: ClienteCarteira) { return c.cliente_fantasia?.trim() || c.cliente_nome?.trim() || 'Sem nome'; }

// Datasets prontos para a Análise Visual dos clientes de um grupo.
// Tudo derivado da carteira já escopada (sem query extra) e memoizado.
export function useGroupClientVisualAnalytics(clientes: ClienteCarteira[], receitaGrupo: number, today: Date) {
  return useMemo(() => {
    const stats: ClientStat[] = clientes.map(c => {
      const total = c.total_comprado || 0;
      const pedidos = c.total_pedidos || 0;
      const ult = parseISO(c.ultimo_pedido);
      const prim = parseISO(c.primeiro_pedido);
      const intervalo = pedidos >= 2 && ult && prim ? Math.max(1, Math.round(((ult.getTime() - prim.getTime()) / DAY) / (pedidos - 1))) : null;
      const diasDesde = ult ? Math.floor((today.getTime() - ult.getTime()) / DAY) : null;
      return {
        c, cnpj: c.cliente_cnpj, nome: nomeDe(c),
        cidadeUf: [c.cliente_cidade, c.cliente_uf].filter(Boolean).join('/'),
        total, pedidos, ticket: pedidos > 0 ? total / pedidos : 0,
        ultimo: c.ultimo_pedido || null, intervalo, diasDesde,
        status: movimentacaoCliente(c, today),
        pct: receitaGrupo > 0 ? (total / receitaGrupo) * 100 : 0,
      };
    });

    const comHistorico = stats.filter(s => s.total > 0);
    const comPedidos = stats.filter(s => s.pedidos > 0);
    const comIntervalo = stats.filter(s => s.intervalo != null);
    const N = 10;

    const topBuyers = [...comHistorico].sort((a, b) => b.total - a.total).slice(0, N);
    const lowestBuyers = [...comHistorico].sort((a, b) => a.total - b.total).slice(0, N);
    const mostActive = [...comIntervalo].sort((a, b) => (a.intervalo! - b.intervalo!)).slice(0, N);
    const leastActive = [...comIntervalo].sort((a, b) => (b.intervalo! - a.intervalo!)).slice(0, N);
    const highestTicket = [...comPedidos].sort((a, b) => b.ticket - a.ticket).slice(0, N);
    const lowestTicket = [...comPedidos].sort((a, b) => a.ticket - b.ticket).slice(0, N);

    const counts = new Map<Movimentacao, number>();
    for (const s of stats) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    const statusCounts: StatusSlice[] = STATUS_ORDER
      .map(st => ({ status: st, label: STATUS_LABEL[st], n: counts.get(st) ?? 0, color: STATUS_COLOR[st] }))
      .filter(s => s.n > 0);

    const scatter = comIntervalo.map(s => ({ ...s }));

    const highlights = {
      maiorComprador: topBuyers[0] ?? null,
      menorComprador: lowestBuyers[0] ?? null,
      maisAtivo: mostActive[0] ?? null,
      menosAtivo: leastActive[0] ?? null,
      maiorTicket: highestTicket[0] ?? null,
      menorTicket: lowestTicket[0] ?? null,
    };

    const top5 = topBuyers.slice(0, 5);

    return { stats, topBuyers, lowestBuyers, mostActive, leastActive, highestTicket, lowestTicket, statusCounts, scatter, highlights, top5 };
  }, [clientes, receitaGrupo, today]);
}
