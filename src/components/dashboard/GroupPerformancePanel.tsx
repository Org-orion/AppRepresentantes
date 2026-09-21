import { Layers, ShoppingCart, Users, DollarSign, AlertTriangle, Briefcase } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useGroupPerformance } from '@/hooks/useRepPerformance';
import { formatCurrency } from '@/utils/formatters';
import type { DashboardFiltros } from '@/services/dashboard';

// Performance por grupo de cliente (escopo do usuário): receita + participação,
// pedidos, clientes, ticket, representantes atuando e clientes atrasados/dormentes.
export default function GroupPerformancePanel({ period }: { period?: DashboardFiltros }) {
  const { data: grupos = [], isLoading } = useGroupPerformance(period);
  const maxRec = Math.max(1, ...grupos.map(g => g.receita));

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-500" />
          <CardTitle>Performance por Grupo</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-10 text-center">Carregando…</p>
        ) : grupos.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">Nenhum grupo com pedidos no seu escopo.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2.5">
            {grupos.map(g => (
              <div key={g.grupo} className="rounded-2xl border border-gray-200/70 p-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 truncate">{g.grupo}</p>
                  <p className="text-sm font-bold text-emerald-700 tabular-nums flex-shrink-0">{formatCurrency(g.receita)}</p>
                </div>
                {/* barra de participação na receita */}
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500/70 transition-all duration-700" style={{ width: `${(g.receita / maxRec) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 tabular-nums w-10 text-right">{g.pctReceita.toFixed(0)}%</span>
                </div>
                {/* métricas */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1"><ShoppingCart className="w-3 h-3 text-gray-400" />{g.pedidos} pedido(s)</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3 text-gray-400" />{g.clientes} cliente(s)</span>
                  <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3 text-gray-400" />{formatCurrency(g.ticketMedio)} / pedido</span>
                  <span className="inline-flex items-center gap-1"><Briefcase className="w-3 h-3 text-gray-400" />{g.representantes} rep.</span>
                  {(g.clientesAtrasados + g.clientesDormentes) > 0 && (
                    <span className="inline-flex items-center gap-1 text-red-500 font-medium" title={`${g.clientesAtrasados} atrasado(s) 31–60d · ${g.clientesDormentes} dormente(s) +60d`}><AlertTriangle className="w-3 h-3" />{g.clientesAtrasados + g.clientesDormentes} clientes sem comprar +30d</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
