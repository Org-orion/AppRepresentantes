import { DollarSign, ShoppingCart, Receipt, Target, UserCheck, AlertTriangle, Clock, FileWarning } from 'lucide-react';
import { formatCurrency } from '@/utils/formatters';
import { useExecutiveSummary, type ExecutivePeriod } from '@/hooks/useExecutiveSummary';
import { StatusPill, Delta, type ExecStatus } from './kit';
import { cn } from '@/utils/cn';
import ValorAjustavel from '@/components/ui/ValorAjustavel';

interface KpiDef {
  icon: React.ElementType;
  label: string;
  value: string;
  desc: string;
  status: ExecStatus;
  delta?: number | null;
  deltaPositivoBom?: boolean;
}

function KpiCard({ k }: { k: KpiDef }) {
  const Icon = k.icon;
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-3.5 min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon className="w-4 h-4" /></span>
        <StatusPill status={k.status} />
      </div>
      <p className="text-[11px] text-gray-400 mt-2.5 truncate">{k.label}</p>
      <ValorAjustavel valor={k.value} className="font-bold text-gray-900" max="1.25rem" />
      <div className="flex items-center gap-2 mt-1 min-w-0">
        {k.delta !== undefined && <Delta value={k.delta} positivoBom={k.deltaPositivoBom} />}
        <span className="text-[10px] text-gray-400 truncate">{k.desc}</span>
      </div>
    </div>
  );
}

// Faixa de 8 KPIs executivos — leitura de 5 segundos do estado do negócio.
export default function ExecutiveSummary({ period }: { period: ExecutivePeriod }) {
  const d = useExecutiveSummary(period);

  const riscoStatus: ExecStatus = d.clientesRisco === 0 ? 'bom' : d.clientesRisco > d.ativos ? 'critico' : 'atencao';
  const convStatus: ExecStatus = d.conversao >= 30 ? 'bom' : d.conversao >= 15 ? 'atencao' : 'critico';
  const pendStatus: ExecStatus = d.pendencias === 0 ? 'bom' : d.pendencias > 30 ? 'critico' : 'atencao';
  const docStatus: ExecStatus = d.docs === 0 ? 'bom' : d.docs > 20 ? 'critico' : 'atencao';

  const kpis: KpiDef[] = [
    { icon: DollarSign, label: 'Valor do período', value: d.isLoading ? '…' : formatCurrency(d.receita), desc: 'vs período anterior', status: (d.receitaDelta ?? 0) >= 0 ? 'bom' : 'atencao', delta: d.receitaDelta, deltaPositivoBom: true },
    { icon: ShoppingCart, label: 'Pedidos no período', value: d.isLoading ? '…' : d.pedidos.toLocaleString('pt-BR'), desc: 'emitidos', status: 'info' },
    { icon: Receipt, label: 'Média de pedido', value: d.isLoading ? '…' : formatCurrency(d.ticket), desc: 'por pedido', status: 'info' },
    { icon: Target, label: 'Conversão de orçamentos', value: d.isLoading ? '…' : `${d.conversao.toFixed(0)}%`, desc: `${d.orcAprovados}/${d.orcCriados} aprovados`, status: convStatus },
    { icon: UserCheck, label: 'Clientes ativos', value: d.isLoading ? '…' : d.ativos.toLocaleString('pt-BR'), desc: `de ${d.clientesTotal} na carteira`, status: 'bom' },
    { icon: AlertTriangle, label: 'Clientes em risco', value: d.isLoading ? '…' : d.clientesRisco.toLocaleString('pt-BR'), desc: `${d.dormentes} dormente(s)`, status: riscoStatus },
    { icon: Clock, label: 'Pendências críticas', value: d.isLoading ? '…' : d.pendencias.toLocaleString('pt-BR'), desc: 'pedidos parados/atrasados', status: pendStatus },
    { icon: FileWarning, label: 'Documentos pendentes', value: d.isLoading ? '…' : d.docs.toLocaleString('pt-BR'), desc: 'impacta faturamento', status: docStatus },
  ];

  return (
    <div className={cn('grid gap-2.5', 'grid-cols-2 md:grid-cols-4')}>
      {kpis.map(k => <KpiCard key={k.label} k={k} />)}
    </div>
  );
}
