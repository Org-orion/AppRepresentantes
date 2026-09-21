import { useMemo, useState } from 'react';
import { Users, ChevronRight } from 'lucide-react';
import SearchInput from '@/components/ui/SearchInput';
import Select from '@/components/ui/Select';
import { cn } from '@/utils/cn';
import { clienteCasaBusca } from '@/utils/buscaCliente';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { movimentacaoCliente, MOV_META, type Movimentacao } from '@/pages/ClientesPage';
import type { ClienteCarteira } from '@/services/carteira';

const DAY = 24 * 60 * 60 * 1000;
// Valor inteiro, sem abreviar. O travessão para zero é intencional aqui:
// nesta lista R$ 0,00 é ruído, não informação.
function fmtK(v: number): string {
  return v > 0 ? formatCurrency(v) : '—';
}
function diasDesde(iso: string | null, today: Date): number {
  if (!iso) return 999999;
  return Math.floor((today.getTime() - new Date(`${iso.slice(0, 10)}T12:00:00`).getTime()) / DAY);
}

type Ord = 'receita' | 'pedidos' | 'ticket' | 'atraso' | 'ultima';
const ORD: { value: Ord; label: string }[] = [
  { value: 'receita', label: 'Maior valor' },
  { value: 'pedidos', label: 'Mais pedidos' },
  { value: 'ticket', label: 'Maior média/pedido' },
  { value: 'atraso', label: 'Mais atrasados' },
  { value: 'ultima', label: 'Última compra' },
];
const MOV_FILTRO = [
  { value: '', label: 'Toda movimentação' },
  { value: 'ativo', label: 'Ativos' },
  { value: 'atencao', label: 'Em atenção' },
  { value: 'atrasado', label: 'Atrasados' },
  { value: 'dormente', label: 'Dormentes' },
  { value: 'sem_historico', label: 'Sem histórico' },
];

export default function GroupClientsList({ clientes, today, onOpenCliente }: {
  clientes: ClienteCarteira[];
  today: Date;
  onOpenCliente: (c: ClienteCarteira) => void;
}) {
  const [busca, setBusca] = useState('');
  const [uf, setUf] = useState('');
  const [mov, setMov] = useState('');
  const [ord, setOrd] = useState<Ord>('receita');

  const ufs = useMemo(() => [...new Set(clientes.map(c => c.cliente_uf).filter(Boolean))].sort(), [clientes]);

  const lista = useMemo(() => {
    let l = clientes.map(c => ({ c, mov: movimentacaoCliente(c, today), ticket: c.total_pedidos > 0 ? c.total_comprado / c.total_pedidos : 0 }));
    if (busca.trim()) l = l.filter(x => clienteCasaBusca(x.c, busca));
    if (uf) l = l.filter(x => x.c.cliente_uf === uf);
    if (mov) l = l.filter(x => x.mov === mov);
    l.sort((a, b) => {
      if (ord === 'pedidos') return b.c.total_pedidos - a.c.total_pedidos;
      if (ord === 'ticket') return b.ticket - a.ticket;
      if (ord === 'atraso') return diasDesde(b.c.ultimo_pedido, today) - diasDesde(a.c.ultimo_pedido, today);
      if (ord === 'ultima') return diasDesde(a.c.ultimo_pedido, today) - diasDesde(b.c.ultimo_pedido, today);
      return b.c.total_comprado - a.c.total_comprado;
    });
    return l;
  }, [clientes, busca, uf, mov, ord, today]);

  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Clientes do Grupo</h3>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{lista.length}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar cliente ou CNPJ..." />
          <Select size="sm" value={ord} onChange={v => setOrd(v as Ord)} options={ORD} className="w-full" />
          <Select size="sm" value={mov} onChange={setMov} options={MOV_FILTRO} className="w-full" />
          <Select size="sm" value={uf} onChange={setUf} placeholder="UF" className="w-full"
            options={[{ value: '', label: 'Todas UFs' }, ...ufs.map(u => ({ value: u, label: u }))]} />
        </div>
      </div>

      <div className="divide-y divide-gray-50 max-h-[560px] overflow-y-auto scrollbar-thin">
        {lista.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-10">Nenhum cliente para os filtros.</p>
        ) : lista.map(({ c, mov: m, ticket }) => {
          const meta = MOV_META[m as Movimentacao];
          const nome = c.cliente_fantasia?.trim() || c.cliente_nome?.trim() || 'Sem nome';
          return (
            <button key={c.cliente_cnpj} type="button" onClick={() => onOpenCliente(c)}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-semibold text-gray-900 truncate">{nome}</span>
                  <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0', meta.chip)}>{meta.label}</span>
                </div>
                <p className="text-[11px] text-gray-400 truncate mt-0.5">
                  {[c.cliente_cidade, c.cliente_uf].filter(Boolean).join(' · ')}
                  {c.ultimo_pedido && ` · última ${formatDate(c.ultimo_pedido)}`}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-right">
                <div className="w-20"><p className="text-[13px] font-bold text-emerald-700 tabular-nums">{fmtK(c.total_comprado)}</p><p className="text-[9px] text-gray-400">valor</p></div>
                <div className="w-12"><p className="text-[13px] font-semibold text-gray-700 tabular-nums">{c.total_pedidos}</p><p className="text-[9px] text-gray-400">pedidos</p></div>
                <div className="w-20"><p className="text-[13px] font-semibold text-gray-700 tabular-nums">{fmtK(ticket)}</p><p className="text-[9px] text-gray-400">média/ped.</p></div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
