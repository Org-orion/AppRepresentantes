import { useMemo } from 'react';
import { BarChart3, Crown, TrendingDown, Zap, Moon, ArrowUpNarrowWide, ArrowDownNarrowWide } from 'lucide-react';
import { formatCurrencyK } from '@/utils/formatters';
import { useGroupClientVisualAnalytics, type ClientStat } from '@/hooks/useGroupClientVisualAnalytics';
import type { ClienteCarteira } from '@/services/carteira';
import GroupClientHighlights from './GroupClientHighlights';
import GroupRankingChart, { type RankRow } from './GroupRankingChart';
import GroupClientStatusDonut from './GroupClientStatusDonut';
import GroupClientValueFrequencyScatter from './GroupClientValueFrequencyScatter';
import GroupTop5Radar from './GroupTop5Radar';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-2 mt-1">{children}</p>;
}

// "Análise Visual dos Clientes do Grupo" — primeiro enxergar, depois analisar, depois detalhar.
export default function GroupClientVisualAnalytics({ clientes, receitaGrupo, today, onOpenCliente }: {
  clientes: ClienteCarteira[];
  receitaGrupo: number;
  today: Date;
  onOpenCliente?: (c: ClienteCarteira) => void;
}) {
  const a = useGroupClientVisualAnalytics(clientes, receitaGrupo, today);
  const open = onOpenCliente ? (s: ClientStat) => onOpenCliente(s.c) : undefined;

  const rows = useMemo(() => ({
    top: a.topBuyers.map<RankRow>(s => ({ stat: s, bar: s.total, valueText: formatCurrencyK(s.total) })),
    low: a.lowestBuyers.map<RankRow>(s => ({ stat: s, bar: s.total, valueText: formatCurrencyK(s.total) })),
    ativo: a.mostActive.map<RankRow>(s => ({ stat: s, bar: 1 / (s.intervalo || 1), valueText: `${s.intervalo}d` })),
    inativo: a.leastActive.map<RankRow>(s => ({ stat: s, bar: s.intervalo || 0, valueText: `${s.intervalo}d` })),
    tkHigh: a.highestTicket.map<RankRow>(s => ({ stat: s, bar: s.ticket, valueText: `${formatCurrencyK(s.ticket)}/ped.` })),
    tkLow: a.lowestTicket.map<RankRow>(s => ({ stat: s, bar: s.ticket, valueText: `${formatCurrencyK(s.ticket)}/ped.` })),
  }), [a]);

  if (clientes.length === 0) return null;

  return (
    <div className="rounded-2xl bg-gray-50/60 border border-gray-200/70 p-3.5 sm:p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-emerald-500" />
        <h3 className="text-sm font-bold text-gray-900">Análise Visual dos Clientes do Grupo</h3>
      </div>

      {/* 1. Destaques rápidos */}
      <div>
        <Eyebrow>Destaques rápidos</Eyebrow>
        <GroupClientHighlights h={a.highlights} onOpen={open} />
      </div>

      {/* 2. Rankings visuais */}
      <div>
        <Eyebrow>Rankings</Eyebrow>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <GroupRankingChart title="Maiores compradores" subtitle="Top 10 por valor total" icon={Crown} accent="#10b981" rows={rows.top} onOpen={open} />
          <GroupRankingChart title="Menores compradores" subtitle="Bottom 10 (com histórico)" icon={TrendingDown} colorByStatus rows={rows.low} onOpen={open} />
          <GroupRankingChart title="Mais ativos" subtitle="Menor intervalo entre compras" icon={Zap} accent="#10b981" rows={rows.ativo} onOpen={open} />
          <GroupRankingChart title="Menos ativos" subtitle="Maior intervalo (com histórico)" icon={Moon} colorByStatus rows={rows.inativo} onOpen={open} />
          <GroupRankingChart title="Maiores médias por pedido" subtitle="Top 10 por média/pedido" icon={ArrowUpNarrowWide} accent="#3b82f6" rows={rows.tkHigh} onOpen={open} />
          <GroupRankingChart title="Menores médias por pedido" subtitle="Bottom 10 por média/pedido" icon={ArrowDownNarrowWide} accent="#64748b" rows={rows.tkLow} onOpen={open} />
        </div>
      </div>

      {/* 3. Análise estratégica */}
      <div>
        <Eyebrow>Análise estratégica</Eyebrow>
        <div className="space-y-3">
          <GroupClientValueFrequencyScatter data={a.scatter} onOpen={open} />
          <div className="grid gap-3 lg:grid-cols-2">
            <GroupClientStatusDonut data={a.statusCounts} />
            <GroupTop5Radar top5={a.top5} />
          </div>
        </div>
      </div>
    </div>
  );
}
