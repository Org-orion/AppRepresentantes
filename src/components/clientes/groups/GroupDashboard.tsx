import { useMemo } from 'react';
import {
  ChevronLeft, Users, DollarSign, ShoppingCart, Receipt, UserCheck, Clock,
  AlertTriangle, Moon, CalendarClock, Briefcase, Layers, Sparkles, Crown, TrendingUp, Lightbulb,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/formatters';
import type { ClientGroup, GroupStatus } from '@/hooks/useClientGroups';
import type { ClienteCarteira } from '@/services/carteira';
import GroupClientVisualAnalytics from './GroupClientVisualAnalytics';

function fmtK(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1).replace('.', ',')}k`;
  return v > 0 ? `R$ ${v.toFixed(0)}` : 'R$ 0';
}
function nome(c: ClienteCarteira) { return c.cliente_fantasia?.trim() || c.cliente_nome?.trim() || 'Sem nome'; }

const STATUS_META: Record<GroupStatus, { label: string; cls: string }> = {
  saudavel: { label: 'Saudável', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  atencao:  { label: 'Atenção',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  critico:  { label: 'Crítico',  cls: 'bg-red-50 text-red-600 border-red-200' },
};

function Kpi({ icon: Icon, label, value, sub, tone, title }: { icon: React.ElementType; label: string; value: string; sub?: string; tone: string; title?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-3 min-w-0" title={title}>
      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center', tone)}><Icon className="w-4 h-4" /></span>
      <p className="text-lg font-bold text-gray-900 tabular-nums mt-2 truncate">{value}</p>
      <p className="text-[11px] text-gray-400 truncate">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

function Ranking({ titulo, icon: Icon, itens }: { titulo: string; icon: React.ElementType; itens: { nome: string; valor: string; extra?: string }[] }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{titulo}</p>
      {itens.length === 0 ? <p className="text-xs text-gray-400 py-2">—</p> : (
        <div className="space-y-1.5">
          {itens.map((it, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              <span className="w-4 text-[10px] font-bold text-gray-300 flex-shrink-0">{i + 1}</span>
              <span className="text-[12px] text-gray-700 truncate flex-1">{it.nome}</span>
              <span className="text-[12px] font-bold text-gray-900 tabular-nums flex-shrink-0">{it.valor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GroupDashboard({ g, today, onOpenCliente, onBack, children }: {
  g: ClientGroup;
  today: Date;
  onOpenCliente: (c: ClienteCarteira) => void;
  onBack?: () => void;
  children?: React.ReactNode;   // GroupClientsList (injetado pela view)
}) {
  const st = STATUS_META[g.status];

  const { topValor, dormentesValor, insights } = useMemo(() => {
    const topValor = [...g.clientes].sort((a, b) => b.total_comprado - a.total_comprado).slice(0, 5)
      .map(c => ({ nome: nome(c), valor: fmtK(c.total_comprado) }));
    const dormentesValor = [...g.clientes]
      .filter(c => c.ultimo_pedido && (today.getTime() - new Date(`${c.ultimo_pedido.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000 > 60)
      .sort((a, b) => b.total_comprado - a.total_comprado).slice(0, 5)
      .map(c => ({ nome: nome(c), valor: fmtK(c.total_comprado) }));

    const lider = [...g.clientes].sort((a, b) => b.total_comprado - a.total_comprado)[0];
    const pctLider = lider && g.receita > 0 ? (lider.total_comprado / g.receita) * 100 : 0;
    const ins: { tone: 'info' | 'risk' | 'opp' | 'good'; text: string }[] = [];
    ins.push({ tone: 'info', text: `O grupo ${g.grupo} representa ${fmtK(g.receita)} em ${g.totalClientes} cliente(s) e ${g.pedidos} pedido(s).` });
    if (g.emRisco > 0) ins.push({ tone: 'risk', text: `${g.emRisco} cliente(s) sem comprar há +30 dias${g.dormentes > 0 ? ` (${g.dormentes} dormente[s] +60d)` : ''}.` });
    if (lider && pctLider >= 20) ins.push({ tone: 'info', text: `${nome(lider)} concentra ${pctLider.toFixed(0)}% do valor do grupo.` });
    if (g.dormentes > 0) ins.push({ tone: 'opp', text: `${g.dormentes} cliente(s) dormente(s) podem ser reativados.` });
    if (g.representantes > 0) ins.push({ tone: 'info', text: `${g.representantes} representante(s) atuando no grupo.` });
    return { topValor, dormentesValor, insights: ins.slice(0, 4) };
  }, [g, today]);

  const INS_STYLE = {
    info: 'bg-blue-50 text-blue-600', risk: 'bg-red-50 text-red-600',
    opp: 'bg-amber-50 text-amber-600', good: 'bg-emerald-50 text-emerald-600',
  } as const;

  return (
    <div className="space-y-3 min-w-0">
      {/* Header do grupo */}
      <div className="rounded-2xl border border-gray-200/70 bg-white p-4">
        <div className="flex items-start gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className="lg:hidden -ml-1 mt-0.5 text-gray-400 hover:text-gray-700"><ChevronLeft className="w-5 h-5" /></button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="w-4 h-4 text-emerald-500" />
              <h2 className="text-lg font-bold text-gray-900">{g.grupo}</h2>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', st.cls)}>{st.label}</span>
            </div>
            <p className="text-[13px] text-gray-500 mt-1">
              {g.totalClientes} clientes · {fmtK(g.receita)} · {g.pedidos.toLocaleString('pt-BR')} pedidos
              {g.ultimaMovimentacao && ` · última movimentação ${formatDate(g.ultimaMovimentacao)}`}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Kpi icon={Users}        label="Clientes"        value={g.totalClientes.toLocaleString('pt-BR')} tone="bg-gray-100 text-gray-600" />
        <Kpi icon={DollarSign}   label="Valor total"     value={fmtK(g.receita)} tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={ShoppingCart} label="Pedidos"         value={g.pedidos.toLocaleString('pt-BR')} tone="bg-amber-50 text-amber-600" />
        <Kpi icon={Receipt}      label="Média de pedido" value={fmtK(g.ticketMedio)} tone="bg-blue-50 text-blue-600" title="Valor total ÷ nº de pedidos" />
        <Kpi icon={Briefcase}    label="Representantes"  value={g.representantes.toLocaleString('pt-BR')} tone="bg-indigo-50 text-indigo-600" title="Representantes distintos atuando no grupo" />
        <Kpi icon={UserCheck}    label="Ativos"          value={g.ativos.toLocaleString('pt-BR')} tone="bg-emerald-50 text-emerald-600" title="Compraram nos últimos 20 dias" />
        <Kpi icon={Clock}        label="Em atenção"      value={g.atencaoN.toLocaleString('pt-BR')} tone="bg-amber-50 text-amber-600" title="Última compra entre 21 e 30 dias" />
        <Kpi icon={AlertTriangle} label="Atrasados"      value={g.atrasados.toLocaleString('pt-BR')} tone="bg-red-50 text-red-500" title="Última compra entre 31 e 60 dias" />
        <Kpi icon={Moon}         label="Dormentes"       value={g.dormentes.toLocaleString('pt-BR')} tone="bg-slate-100 text-slate-500" title="Sem comprar há mais de 60 dias" />
        <Kpi icon={CalendarClock} label="Recompra vencida" value={g.proximasVencidas.toLocaleString('pt-BR')} tone="bg-orange-50 text-orange-500" title="Último pedido + 30 dias já passou" />
      </div>

      {/* Inteligência do grupo */}
      <div className="rounded-2xl border border-gray-200/70 bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-emerald-500" />Inteligência do Grupo</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl border border-gray-100 p-3">
              <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', INS_STYLE[ins.tone])}>
                {ins.tone === 'risk' ? <AlertTriangle className="w-4 h-4" /> : ins.tone === 'opp' ? <Lightbulb className="w-4 h-4" /> : ins.tone === 'good' ? <TrendingUp className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              </span>
              <p className="text-[13px] text-gray-600 leading-snug">{ins.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Rankings */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Ranking titulo="Top clientes por valor" icon={Crown} itens={topValor} />
        <Ranking titulo="Dormentes de alto valor" icon={Moon} itens={dormentesValor} />
      </div>

      {/* Análise visual — primeiro enxergar, depois detalhar */}
      <GroupClientVisualAnalytics clientes={g.clientes} receitaGrupo={g.receita} today={today} onOpenCliente={onOpenCliente} />

      {/* Lista de clientes (injetada) */}
      {children}
    </div>
  );
}
