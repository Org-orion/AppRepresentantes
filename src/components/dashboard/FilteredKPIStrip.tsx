import { useMemo } from 'react';
import { DollarSign, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import { useAcompanhamento } from '@/hooks/useAcompanhamento';
import { formatCurrency } from '@/utils/formatters';
import { useDirectorFilters, applyPedidoFilters } from './DirectorFilters';
import { cn } from '@/utils/cn';
import ValorAjustavel from '@/components/ui/ValorAjustavel';

function Kpi({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', tone)}><Icon className="w-4 h-4" /></span>
        <p className="text-[11px] text-gray-400 truncate">{label}</p>
      </div>
      <div className="mt-1.5"><ValorAjustavel valor={value} className="font-bold text-gray-900" /></div>
    </div>
  );
}

// KPIs que reagem aos filtros (grupo/rep/UF/etapa) — recalculados sobre os
// pedidos já escopados do diretor.
export default function FilteredKPIStrip() {
  const { data: pedidos = [], isLoading } = useAcompanhamento();
  const { filters, active } = useDirectorFilters();

  const rows = useMemo(() => applyPedidoFilters(pedidos, filters), [pedidos, filters]);
  const { receita, count, ticket, clientes } = useMemo(() => {
    const receita = rows.reduce((s, p) => s + (p.total_pedido_venda || 0), 0);
    const count = rows.length;
    const clientes = new Set(rows.map(p => p.cliente_cnpj).filter(Boolean)).size;
    return { receita, count, ticket: count ? receita / count : 0, clientes };
  }, [rows]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <p className="text-xs font-semibold text-gray-500">Visão operacional</p>
        {active > 0 && <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">filtrado · {count} pedido(s)</span>}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Kpi icon={DollarSign}   label="Valor"         value={isLoading ? '…' : formatCurrency(receita)} tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={ShoppingCart} label="Pedidos"       value={isLoading ? '…' : count.toLocaleString('pt-BR')} tone="bg-amber-50 text-amber-600" />
        <Kpi icon={TrendingUp}   label="Média de pedido" value={isLoading ? '…' : formatCurrency(ticket)} tone="bg-blue-50 text-blue-600" />
        <Kpi icon={Users}        label="Clientes"      value={isLoading ? '…' : clientes.toLocaleString('pt-BR')} tone="bg-indigo-50 text-indigo-600" />
      </div>
    </div>
  );
}
