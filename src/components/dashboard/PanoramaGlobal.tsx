import { useMemo } from 'react';
import { Globe2, Layers, Briefcase, DollarSign, PieChart } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useRepPerformance, useGroupPerformance } from '@/hooks/useRepPerformance';
import { formatCurrencyK } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { DashboardFiltros } from '@/services/dashboard';

// Tons de verde para as fatias do 1º, 2º e 3º maiores grupos
const SHADES = ['#059669', '#10b981', '#34d399'];

function Tile({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-3 min-w-0">
      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center', tone)}><Icon className="w-4 h-4" /></span>
      <p className="text-lg font-bold text-gray-900 tabular-nums mt-2 truncate">{value}</p>
      <p className="text-[11px] text-gray-400 truncate">{label}</p>
    </div>
  );
}

// Panorama global (Diretor Geral): receita total, grupos, representantes,
// ticket global e concentração de receita nos 3 maiores grupos.
export default function PanoramaGlobal({ period }: { period?: DashboardFiltros }) {
  const { data: reps = [] } = useRepPerformance(period);
  const { data: grupos = [], isLoading } = useGroupPerformance(period);

  const { receita, ticket, top3, resto, top3List } = useMemo(() => {
    const receita = grupos.reduce((s, g) => s + g.receita, 0);
    const pedidos = grupos.reduce((s, g) => s + g.pedidos, 0);
    const ordenados = [...grupos].sort((a, b) => b.receita - a.receita);
    const top3List = ordenados.slice(0, 3);
    const top3 = top3List.reduce((s, g) => s + g.pctReceita, 0);
    return { receita, pedidos, ticket: pedidos ? receita / pedidos : 0, top3, resto: Math.max(0, 100 - top3), top3List };
  }, [grupos]);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-emerald-500" />
          <CardTitle>Panorama Global</CardTitle>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">diretoria geral</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-10 text-center">Carregando…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <Tile icon={DollarSign} label="Valor total"      value={formatCurrencyK(receita)}            tone="bg-emerald-50 text-emerald-600" />
              <Tile icon={Layers}     label="Grupos ativos"    value={grupos.length.toLocaleString('pt-BR')} tone="bg-indigo-50 text-indigo-600" />
              <Tile icon={Briefcase}  label="Representantes"    value={reps.length.toLocaleString('pt-BR')}   tone="bg-blue-50 text-blue-600" />
              <Tile icon={DollarSign} label="Média de pedido"   value={formatCurrencyK(ticket)}             tone="bg-amber-50 text-amber-600" />
            </div>
            {/* Concentração de receita */}
            {grupos.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500"><PieChart className="w-3.5 h-3.5" />Concentração de valor</span>
                  <span className="text-xs font-bold text-gray-700 tabular-nums">Top 3 · {top3.toFixed(0)}%</span>
                </div>
                {/* Barra segmentada: cada grupo é uma fatia proporcional, dividida por | */}
                <div className="flex h-7 rounded-lg overflow-hidden bg-gray-100">
                  {top3List.map((g, i) => (
                    <div
                      key={g.grupo}
                      className="h-full flex items-center px-2 min-w-0 text-white border-r-2 border-white transition-all duration-700"
                      style={{ width: `${g.pctReceita}%`, backgroundColor: SHADES[i] }}
                      title={`${g.grupo}: ${g.pctReceita.toFixed(0)}% · ${formatCurrencyK(g.receita)}`}
                    >
                      <span className="text-[10px] font-semibold truncate">{g.grupo}</span>
                      <span className="text-[10px] font-bold tabular-nums ml-auto pl-1 flex-shrink-0">{g.pctReceita.toFixed(0)}%</span>
                    </div>
                  ))}
                  {resto > 0 && (
                    <div
                      className="h-full flex items-center px-2 min-w-0 bg-gray-300 text-gray-600 transition-all duration-700"
                      style={{ width: `${resto}%` }}
                      title={`Demais ${Math.max(0, grupos.length - 3)} grupo(s): ${resto.toFixed(0)}%`}
                    >
                      <span className="text-[10px] font-medium truncate">Demais</span>
                      <span className="text-[10px] font-bold tabular-nums ml-auto pl-1 flex-shrink-0">{resto.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
