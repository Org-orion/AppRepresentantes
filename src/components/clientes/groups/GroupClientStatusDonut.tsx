import { PieChart as PieIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import type { StatusSlice } from '@/hooks/useGroupClientVisualAnalytics';

// Gráfico G — Distribuição dos clientes por status (donut). Leitura imediata do perfil do grupo.
export default function GroupClientStatusDonut({ data }: { data: StatusSlice[] }) {
  const total = data.reduce((s, d) => s + d.n, 0);

  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5"><PieIcon className="w-3.5 h-3.5" />Distribuição por status</p>
      <p className="text-[11px] text-gray-400 mb-1 mt-0.5">Perfil de movimentação da carteira do grupo</p>
      <div className="flex items-center gap-4 mt-2">
        <div className="relative w-[128px] h-[128px] flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="n" nameKey="label" cx="50%" cy="50%" innerRadius={44} outerRadius={62} paddingAngle={2} stroke="none">
                {data.map(d => <Cell key={d.status} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-bold text-gray-900 tabular-nums leading-none">{total}</span>
            <span className="text-[10px] text-gray-400">clientes</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {data.map(d => (
            <div key={d.status} className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-[12px] text-gray-600 truncate flex-1">{d.label}</span>
              <span className="text-[12px] font-bold text-gray-900 tabular-nums flex-shrink-0">{d.n}</span>
              <span className="text-[10px] text-gray-400 tabular-nums w-9 text-right flex-shrink-0">{total > 0 ? ((d.n / total) * 100).toFixed(0) : 0}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
