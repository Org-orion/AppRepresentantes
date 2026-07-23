import { useMemo } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import type { ClientStat } from '@/hooks/useGroupClientVisualAnalytics';

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#64748b'];
const METRICAS = ['Valor', 'Pedidos', 'Média/ped.', 'Frequência', 'Recência'] as const;

// Gráfico I — Comparativo consolidado dos 5 clientes mais relevantes (radar, contornos).
// Cada eixo é normalizado 0–100 entre os 5, então maior polígono = mais forte na dimensão.
export default function GroupTop5Radar({ top5 }: { top5: ClientStat[] }) {
  const { data, legenda } = useMemo(() => {
    const cs = top5.slice(0, 5);
    const raw = cs.map(s => ({
      Valor: s.total,
      Pedidos: s.pedidos,
      'Média/ped.': s.ticket,
      Frequência: s.intervalo != null ? 1 / s.intervalo : 0,
      Recência: s.diasDesde != null ? 1 / (s.diasDesde + 1) : 0,
    }));
    const data = METRICAS.map(m => {
      const max = Math.max(1e-9, ...raw.map(r => r[m]));
      const row: Record<string, number | string> = { metric: m };
      raw.forEach((r, i) => { row[`c${i}`] = Math.round((r[m] / max) * 100); });
      return row;
    });
    const legenda = cs.map((s, i) => ({ nome: s.nome, cor: CORES[i] }));
    return { data, legenda };
  }, [top5]);

  if (top5.length < 2) return null;

  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5"><GitCompareArrows className="w-3.5 h-3.5" />Comparativo dos maiores clientes</p>
      <p className="text-[11px] text-gray-400 mb-2 mt-0.5">Top 5 por valor, normalizados (0–100) em cada dimensão.</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#6b7280' }} />
            {legenda.map((l, i) => (
              <Radar key={i} dataKey={`c${i}`} stroke={l.cor} fill={l.cor} fillOpacity={0.06} strokeWidth={2} />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
        {legenda.map((l, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.cor }} />
            <span className="truncate max-w-[160px]">{l.nome}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
