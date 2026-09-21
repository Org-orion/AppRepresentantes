import { type ElementType } from 'react';
import { cn } from '@/utils/cn';
import ValorAjustavel from '@/components/ui/ValorAjustavel';

// KPI/Métrica padrão do sistema — extraído do topo da Central de Pedidos.
// ícone + label pequeno + valor grande + subtítulo opcional. Tom semântico no valor.
export default function MetricCard({
  icon: Icon, label, value, tone, sub, onClick, grid = false, className,
}: {
  icon?: ElementType;
  label: string;
  value: string;
  tone?: string;       // classe de cor do valor (ex.: 'text-emerald-700')
  sub?: string;
  onClick?: () => void;
  grid?: boolean;      // true = tile em grade (min-w-0); false = fileira rolável (min-w-[140px])
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-white border border-gray-200/70 shadow-sm p-3.5 transition-shadow hover:shadow-md',
        grid ? 'min-w-0 overflow-hidden' : 'min-w-[140px] sm:min-w-0 flex-shrink-0 sm:flex-shrink',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-gray-400 min-w-0">
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
        <p className="text-[10px] font-semibold uppercase tracking-wider truncate">{label}</p>
      </div>
      {/* ValorAjustavel em vez de `truncate`: sem abreviação os valores ficaram
          longos, e truncar cortaria o número — some justamente a informação. */}
      <div className="mt-1">
        <ValorAjustavel valor={value} className={cn('font-bold', tone ?? 'text-gray-900')} />
      </div>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
