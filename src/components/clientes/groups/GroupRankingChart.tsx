import { cn } from '@/utils/cn';
import { STATUS_COLOR, type ClientStat } from '@/hooks/useGroupClientVisualAnalytics';

export interface RankRow { stat: ClientStat; bar: number; valueText: string; subText?: string; }

// Ranking premium em barras horizontais (leve, sem Recharts). Reusado 6x:
// maiores/menores compradores, mais/menos ativos, maiores/menores médias por pedido.
export default function GroupRankingChart({ title, subtitle, icon: Icon, accent = '#10b981', colorByStatus = false, rows, onOpen }: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  accent?: string;
  colorByStatus?: boolean;
  rows: RankRow[];
  onOpen?: (s: ClientStat) => void;
}) {
  const max = Math.max(1, ...rows.map(r => r.bar));
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{title}</p>
      {subtitle && <p className="text-[11px] text-gray-400 mb-2 mt-0.5">{subtitle}</p>}
      <div className={cn('space-y-1.5', !subtitle && 'mt-2')}>
        {rows.length === 0 ? <p className="text-xs text-gray-400 py-3">Sem dados suficientes.</p> : rows.map((r, i) => {
          const cor = colorByStatus ? STATUS_COLOR[r.stat.status] : accent;
          return (
            <button key={r.stat.cnpj + i} type="button" disabled={!onOpen} onClick={() => onOpen?.(r.stat)}
              className={cn('w-full text-left flex items-center gap-2.5 min-w-0 rounded-lg px-1 py-0.5', onOpen && 'hover:bg-gray-50 cursor-pointer')}>
              <span className="w-4 text-[10px] font-bold text-gray-300 flex-shrink-0 text-right">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-[12px] text-gray-700 truncate">{r.stat.nome}</span>
                  <span className="text-[12px] font-bold text-gray-900 tabular-nums flex-shrink-0">{r.valueText}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((r.bar / max) * 100, 3)}%`, backgroundColor: cor }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
