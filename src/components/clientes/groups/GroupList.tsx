import { useMemo, useState } from 'react';
import { Layers, Users, AlertTriangle } from 'lucide-react';
import SearchInput from '@/components/ui/SearchInput';
import { cn } from '@/utils/cn';
import { formatCurrency } from '@/utils/formatters';
import type { ClientGroup, GroupStatus } from '@/hooks/useClientGroups';

const STATUS_DOT: Record<GroupStatus, string> = {
  saudavel: 'bg-emerald-500',
  atencao: 'bg-amber-500',
  critico: 'bg-red-500',
};

// Valor inteiro, sem abreviar.
function fmtK(v: number): string {
  return formatCurrency(v);
}

export default function GroupList({ grupos, selected, onSelect, isLoading }: {
  grupos: ClientGroup[];
  selected: string | null;
  onSelect: (grupo: string) => void;
  isLoading?: boolean;
}) {
  const [busca, setBusca] = useState('');
  const filtrados = useMemo(
    () => busca ? grupos.filter(g => g.grupo.toLowerCase().includes(busca.toLowerCase())) : grupos,
    [grupos, busca],
  );

  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm flex flex-col lg:max-h-[calc(100dvh-8rem)]">
      <div className="p-4 pb-3 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-500" />Grupos de Cliente
        </h2>
        <p className="text-[11px] text-gray-400 mt-0.5">{grupos.length} grupo(s) no seu escopo</p>
        <div className="mt-3"><SearchInput value={busca} onChange={setBusca} placeholder="Buscar grupo..." /></div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {isLoading ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-10">Nenhum grupo encontrado.</p>
        ) : (
          <div className="space-y-1">
            {filtrados.map(g => {
              const on = g.grupo === selected;
              return (
                <button
                  key={g.grupo}
                  type="button"
                  onClick={() => onSelect(g.grupo)}
                  className={cn(
                    'w-full text-left rounded-xl border px-3 py-2.5 transition-colors',
                    on ? 'border-[hsl(142,93%,8%)] bg-[hsl(142,93%,8%)]/5' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_DOT[g.status])} />
                    <span className="text-[13px] font-semibold text-gray-900 truncate flex-1">{g.grupo}</span>
                    <span className="text-xs font-bold text-emerald-700 tabular-nums flex-shrink-0">{fmtK(g.receita)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                    <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{g.totalClientes}</span>
                    {g.emRisco > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-500 font-medium"><AlertTriangle className="w-3 h-3" />{g.emRisco} em risco</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
