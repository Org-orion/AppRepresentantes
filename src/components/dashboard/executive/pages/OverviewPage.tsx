import { TrendingUp } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip, LabelList } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import ExecutiveSummary from '@/components/dashboard/executive/ExecutiveSummary';
import ManagementDiagnosis from '@/components/dashboard/executive/ManagementDiagnosis';
import StrategicActionsPanel from '@/components/dashboard/executive/StrategicActionsPanel';
import PanoramaGlobal from '@/components/dashboard/PanoramaGlobal';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useExecutiveSummary, type ExecutivePeriod } from '@/hooks/useExecutiveSummary';
import { formatCurrency } from '@/utils/formatters';
import { Delta } from '@/components/dashboard/executive/kit';
import ValorAjustavel from '@/components/ui/ValorAjustavel';

function ReceitaTrendCard({ period }: { period: ExecutivePeriod }) {
  const { data: stats } = useDashboardStats(period);
  const d = useExecutiveSummary(period);
  const serie = stats?.vendasMensais ?? [];

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <CardTitle>Tendência de Valor</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2 mb-1">
          <div>
            <ValorAjustavel valor={formatCurrency(d.receita)} className="font-bold text-gray-900" max="1.5rem" />
            <p className="text-[11px] text-gray-400 mt-1">valor do período</p>
          </div>
          <Delta value={d.receitaDelta} />
        </div>
        <div className="h-32 -mx-1 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="execReceita" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ stroke: '#10b981', strokeWidth: 1 }}
                formatter={(v) => [formatCurrency(typeof v === 'number' ? v : Number(v) || 0), 'Valor']}
                contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
              />
              <Area type="monotone" dataKey="valor" stroke="#10b981" strokeWidth={2} fill="url(#execReceita)">
                <LabelList
                  dataKey="valor"
                  position="top"
                  offset={8}
                  formatter={(v: unknown) => formatCurrency(typeof v === 'number' ? v : Number(v) || 0)}
                  style={{ fontSize: 10, fontWeight: 700, fill: '#374151' }}
                />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
          <span>Pipeline: <strong className="text-gray-800 tabular-nums">{d.pipeline?.total ?? 0}</strong> pedidos</span>
          <span>Pendências: <strong className={d.pendencias > 0 ? 'text-amber-600' : 'text-emerald-600'}>{d.pendencias}</strong></span>
        </div>
      </CardContent>
    </Card>
  );
}

// Página 1 — Geral: "O resultado geral está bom ou ruim?"
export default function OverviewPage({ period, global }: { period: ExecutivePeriod; global?: boolean }) {
  return (
    <>
      <ExecutiveSummary period={period} />
      <ManagementDiagnosis period={period} />
      <div className="grid gap-3 lg:grid-cols-2">
        <StrategicActionsPanel period={period} limit={3} title="Ações do Dia" />
        <ReceitaTrendCard period={period} />
      </div>
      {global && <PanoramaGlobal period={period} />}
    </>
  );
}
