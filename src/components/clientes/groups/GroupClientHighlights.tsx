import { Crown, TrendingDown, Zap, Moon, ArrowUpNarrowWide, ArrowDownNarrowWide } from 'lucide-react';
import { formatCurrencyK, formatDate } from '@/utils/formatters';
import { MOV_META } from '@/pages/ClientesPage';
import { cn } from '@/utils/cn';
import type { ClientStat } from '@/hooks/useGroupClientVisualAnalytics';

function Card({ eyebrow, icon: Icon, tone, stat, valor, contexto, onOpen }: {
  eyebrow: string; icon: React.ElementType; tone: string; stat: ClientStat | null; valor: string; contexto: string;
  onOpen?: (s: ClientStat) => void;
}) {
  if (!stat) return null;
  const meta = MOV_META[stat.status];
  return (
    <button type="button" disabled={!onOpen} onClick={() => onOpen?.(stat)}
      className={cn('text-left rounded-2xl border border-gray-200/70 bg-white p-3 min-w-0 transition-shadow', onOpen && 'hover:shadow-md cursor-pointer')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider', tone)}>
          <Icon className="w-3.5 h-3.5" />{eyebrow}
        </span>
        <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0', meta.chip)}>{meta.label}</span>
      </div>
      <p className="text-[13px] font-semibold text-gray-900 truncate mt-1.5">{stat.nome}</p>
      <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{valor}</p>
      <p className="text-[11px] text-gray-400 truncate">{contexto}</p>
    </button>
  );
}

// Destaques rápidos: os 6 clientes-chave do grupo.
export default function GroupClientHighlights({ h, onOpen }: {
  h: {
    maiorComprador: ClientStat | null; menorComprador: ClientStat | null;
    maisAtivo: ClientStat | null; menosAtivo: ClientStat | null;
    maiorTicket: ClientStat | null; menorTicket: ClientStat | null;
  };
  onOpen?: (s: ClientStat) => void;
}) {
  const ctxCidade = (s: ClientStat | null) => s?.cidadeUf || '—';
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
      <Card eyebrow="Maior comprador" icon={Crown} tone="text-emerald-600" stat={h.maiorComprador} onOpen={onOpen}
        valor={h.maiorComprador ? formatCurrencyK(h.maiorComprador.total) : '—'} contexto={h.maiorComprador ? `${h.maiorComprador.pct.toFixed(0)}% do grupo · ${ctxCidade(h.maiorComprador)}` : ''} />
      <Card eyebrow="Menor comprador" icon={TrendingDown} tone="text-slate-500" stat={h.menorComprador} onOpen={onOpen}
        valor={h.menorComprador ? formatCurrencyK(h.menorComprador.total) : '—'} contexto={h.menorComprador ? `${h.menorComprador.pedidos} pedido(s) · ${ctxCidade(h.menorComprador)}` : ''} />
      <Card eyebrow="Mais ativo" icon={Zap} tone="text-emerald-600" stat={h.maisAtivo} onOpen={onOpen}
        valor={h.maisAtivo?.intervalo != null ? `a cada ${h.maisAtivo.intervalo} dias` : '—'} contexto={h.maisAtivo ? `${h.maisAtivo.pedidos} pedidos · ${ctxCidade(h.maisAtivo)}` : ''} />
      <Card eyebrow="Menos ativo" icon={Moon} tone="text-slate-500" stat={h.menosAtivo} onOpen={onOpen}
        valor={h.menosAtivo?.intervalo != null ? `a cada ${h.menosAtivo.intervalo} dias` : '—'} contexto={h.menosAtivo?.ultimo ? `última ${formatDate(h.menosAtivo.ultimo)}` : ctxCidade(h.menosAtivo)} />
      <Card eyebrow="Maior média/pedido" icon={ArrowUpNarrowWide} tone="text-blue-600" stat={h.maiorTicket} onOpen={onOpen}
        valor={h.maiorTicket ? `${formatCurrencyK(h.maiorTicket.ticket)}/ped.` : '—'} contexto={h.maiorTicket ? `${h.maiorTicket.pedidos} pedidos · ${formatCurrencyK(h.maiorTicket.total)}` : ''} />
      <Card eyebrow="Menor média/pedido" icon={ArrowDownNarrowWide} tone="text-slate-500" stat={h.menorTicket} onOpen={onOpen}
        valor={h.menorTicket ? `${formatCurrencyK(h.menorTicket.ticket)}/ped.` : '—'} contexto={h.menorTicket ? `${h.menorTicket.pedidos} pedidos · ${formatCurrencyK(h.menorTicket.total)}` : ''} />
    </div>
  );
}
