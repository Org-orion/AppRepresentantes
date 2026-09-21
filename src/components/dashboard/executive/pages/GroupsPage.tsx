import { useMemo } from 'react';
import { Crown, Receipt, AlertTriangle, Users } from 'lucide-react';
import GroupPerformancePanel from '@/components/dashboard/GroupPerformancePanel';
import UFDistributionPanel from '@/components/dashboard/UFDistributionPanel';
import { useGroupPerformance } from '@/hooks/useRepPerformance';
import { formatCurrency } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { GroupPerf } from '@/services/performance';
import type { ExecutivePeriod } from '@/hooks/useExecutiveSummary';

function Highlight({ icon: Icon, label, grupo, valor, tone }: { icon: React.ElementType; label: string; grupo: string; valor: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', tone)}><Icon className="w-4 h-4" /></span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{label}</span>
      </div>
      <p className="text-sm font-semibold text-gray-900 truncate mt-2">{grupo}</p>
      <p className="text-[11px] text-gray-500 tabular-nums">{valor}</p>
    </div>
  );
}

// Página 3 — Grupos: "Quais grupos sustentam o resultado e quais puxam para baixo?"
export default function GroupsPage({ period, global }: { period: ExecutivePeriod; global?: boolean }) {
  const { data: grupos = [] } = useGroupPerformance(period);

  const destaque = useMemo(() => {
    if (grupos.length === 0) return null;
    const byReceita = [...grupos].sort((a, b) => b.receita - a.receita)[0];
    const byTicket = [...grupos].sort((a, b) => b.ticketMedio - a.ticketMedio)[0];
    const byRisco = [...grupos].sort((a, b) => (b.clientesAtrasados + b.clientesDormentes) - (a.clientesAtrasados + a.clientesDormentes))[0];
    const byClientes = [...grupos].sort((a, b) => b.clientes - a.clientes)[0];
    return { byReceita, byTicket, byRisco, byClientes } as Record<string, GroupPerf>;
  }, [grupos]);

  return (
    <>
      {destaque && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <Highlight icon={Crown} label="Maior valor" grupo={destaque.byReceita.grupo} valor={formatCurrency(destaque.byReceita.receita)} tone="bg-emerald-50 text-emerald-600" />
          <Highlight icon={Receipt} label="Maior média/ped." grupo={destaque.byTicket.grupo} valor={`${formatCurrency(destaque.byTicket.ticketMedio)} / pedido`} tone="bg-blue-50 text-blue-600" />
          <Highlight icon={AlertTriangle} label="Mais em atraso" grupo={destaque.byRisco.grupo} valor={`${destaque.byRisco.clientesAtrasados + destaque.byRisco.clientesDormentes} cliente(s)`} tone="bg-red-50 text-red-500" />
          <Highlight icon={Users} label="Mais clientes" grupo={destaque.byClientes.grupo} valor={`${destaque.byClientes.clientes} cliente(s)`} tone="bg-indigo-50 text-indigo-600" />
        </div>
      )}
      <GroupPerformancePanel period={period} />
      {global && <UFDistributionPanel period={period} />}
    </>
  );
}
