import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate, formatCurrency, formatCurrencyK } from '@/utils/formatters';
import Avatar from '@/components/ui/Avatar';
import { FilterBar, FilterChip } from '@/components/ui/FilterBar';
import SearchInput from '@/components/ui/SearchInput';
import PageContainer from '@/components/ui/PageContainer';
import {
  AlertTriangle, Clock, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, FileDown,
  Loader2, X, Check, Package, DollarSign, Award, Hourglass, TrendingUp,
  Crown, Timer, Sparkles, MapPin, Hash, MessageSquare, Paperclip,
  History, User, ShoppingBag, Receipt, ClipboardCheck,
} from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { cn } from '@/utils/cn';
import { MetricCard, EntityCard } from '@/components/ui/cards';
import type { Orcamento, OrcamentoStatusReal } from '@/types';
import { useOrcamentos } from '@/hooks/useOrcamentos';
import { useAuth } from '@/hooks/useAuth';
import { useCarteira, useClientePedidos } from '@/hooks/useCarteira';
import { fetchRepresentantes } from '@/services/representantes';
import { marcarEmAnalise, aprovarOrcamento, rejeitarOrcamento } from '@/services/orcamentos';
import { baixarOrcamentoPDF } from '@/components/OrcamentoPDFButton';

// ─── Status config ─────────────────────────────────────────
const STATUS_CFG: Record<OrcamentoStatusReal, { label: string; pill: string }> = {
  rascunho:   { label: 'Rascunho',   pill: 'bg-gray-50 text-gray-500 border-gray-200'    },
  enviado:    { label: 'Enviado',    pill: 'bg-blue-50 text-blue-700 border-blue-200'     },
  em_analise: { label: 'Em Análise', pill: 'bg-amber-50 text-amber-700 border-amber-200'  },
  aprovado:   { label: 'Aprovado',   pill: 'bg-green-50 text-green-700 border-green-200'  },
  rejeitado:  { label: 'Rejeitado',  pill: 'bg-red-50 text-red-700 border-red-200'        },
};

type FilterView = 'pendente' | 'aprovado' | 'rejeitado' | 'todos';
const DAY = 86_400_000;

// ─── Prioridade visual ─────────────────────────────────────
type Prioridade = 'atrasado' | 'vencendo' | 'vip' | 'normal';
const PRIO_CFG: Record<Prioridade, { color: string; label: string; pill?: string; icon?: React.ElementType }> = {
  atrasado: { color: '#ef4444', label: 'Validade vencida', pill: 'bg-red-50 text-red-600 border-red-200',    icon: AlertTriangle },
  vencendo: { color: '#f59e0b', label: 'Vence em breve',   pill: 'bg-amber-50 text-amber-600 border-amber-200', icon: Timer },
  vip:      { color: '#3b82f6', label: 'Cliente VIP',      pill: 'bg-blue-50 text-blue-600 border-blue-200',  icon: Crown },
  normal:   { color: '#22c55e', label: 'Normal' },
};

function isPendente(o: Orcamento) {
  return o.status === 'enviado' || o.status === 'em_analise';
}
function valorOrcamento(o: Orcamento): number {
  return (o.itens ?? []).reduce((s, it) => s + (it.preco_unitario ?? 0) * it.quantidade, 0);
}
function numItens(o: Orcamento): number {
  return (o.itens ?? []).length;
}
function nomeCliente(o: Orcamento): string {
  return o.cliente_fantasia?.trim() || o.cliente_nome;
}
function parseData(d?: string | null): Date | null {
  if (!d) return null;
  const s = d.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(d);
}
function diasAguardando(o: Orcamento, hoje: Date): number {
  const c = parseData(o.created_at);
  return c ? Math.max(0, Math.floor((hoje.getTime() - c.getTime()) / DAY)) : 0;
}
function getPrioridade(o: Orcamento, vip: Set<string>, hoje: Date): Prioridade {
  if (isPendente(o) && o.validade) {
    const v = parseData(o.validade);
    if (v) {
      const diff = (v.getTime() - hoje.getTime()) / DAY;
      if (diff < 0) return 'atrasado';
      if (diff <= 7) return 'vencendo';
    }
  }
  if (vip.has(o.cliente_cnpj)) return 'vip';
  return 'normal';
}

function StatusPill({ status }: { status: OrcamentoStatusReal }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', cfg.pill)}>
      {cfg.label}
    </span>
  );
}

function PrioPill({ prio }: { prio: Prioridade }) {
  if (prio === 'normal') return null;
  const cfg = PRIO_CFG[prio];
  const Icon = cfg.icon!;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', cfg.pill)}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

// ─── Toast ─────────────────────────────────────────────────
interface ToastMsg { id: number; texto: string; tone: 'ok' | 'erro' }
function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="fixed top-4 right-4 z-[70] space-y-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium border',
              t.tone === 'ok' ? 'bg-white border-green-200 text-green-700' : 'bg-white border-red-200 text-red-700',
            )}
          >
            {t.tone === 'ok' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
            {t.texto}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── KPI card ──────────────────────────────────────────────
// KpiCard usa o MetricCard compartilhado (variante grid) — mesma linguagem das demais telas.
function KpiCard(props: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: string }) {
  return <MetricCard grid {...props} />;
}

// ─── Gráfico dinâmico de aprovações ────────────────────────
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function MiniToggle<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5 touch-compact">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'px-2 h-6 text-[10px] font-medium rounded-md transition-colors',
            value === o.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ApprovalsChart({ source, hoje }: { source: Orcamento[]; hoje: Date }) {
  const [periodo, setPeriodo] = useState<'semanas' | 'meses'>('meses');
  const [metrica, setMetrica] = useState<'qtde' | 'valor'>('qtde');

  const data = useMemo(() => {
    const buckets: { label: string; ini: Date; fim: Date }[] = [];
    if (periodo === 'semanas') {
      for (let i = 7; i >= 0; i--) {
        const ini = new Date(hoje);
        ini.setDate(hoje.getDate() - hoje.getDay() - i * 7);
        ini.setHours(0, 0, 0, 0);
        const fim = new Date(ini);
        fim.setDate(ini.getDate() + 7);
        buckets.push({
          label: `${String(ini.getDate()).padStart(2, '0')}/${String(ini.getMonth() + 1).padStart(2, '0')}`,
          ini, fim,
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const ini = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const fim = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 1);
        buckets.push({ label: MESES_ABREV[ini.getMonth()], ini, fim });
      }
    }
    return buckets.map(b => {
      const dentro = (o: Orcamento) => {
        const u = parseData(o.updated_at);
        return !!u && u >= b.ini && u < b.fim;
      };
      const aprov = source.filter(o => o.status === 'aprovado' && dentro(o));
      const rejei = source.filter(o => o.status === 'rejeitado' && dentro(o));
      return {
        label: b.label,
        aprovados: aprov.length,
        rejeitados: rejei.length,
        valor: aprov.reduce((s, o) => s + valorOrcamento(o), 0),
      };
    });
  }, [source, hoje, periodo]);

  const totalAprov = data.reduce((s, d) => s + d.aprovados, 0);
  const totalRejei = data.reduce((s, d) => s + d.rejeitados, 0);
  const totalValor = data.reduce((s, d) => s + d.valor, 0);
  const isValor = metrica === 'valor';

  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm p-3.5 min-w-0 overflow-hidden transition-shadow hover:shadow-md">
      {/* Cabeçalho: título + totais + toggles */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Aprovações no período</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-lg font-bold text-gray-900 tabular-nums leading-tight">
              {isValor ? (totalValor > 0 ? formatCurrencyK(totalValor) : '—') : totalAprov}
            </span>
            {!isValor && totalRejei > 0 && (
              <span className="text-[10px] font-medium text-red-500 tabular-nums">{totalRejei} rejeitado(s)</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <MiniToggle value={periodo} onChange={setPeriodo}
            options={[{ key: 'semanas', label: '8 sem' }, { key: 'meses', label: '6 meses' }]} />
          <MiniToggle value={metrica} onChange={setMetrica}
            options={[{ key: 'qtde', label: 'Qtde' }, { key: 'valor', label: 'Valor' }]} />
        </div>
      </div>

      {/* Gráfico (remonta ao trocar toggle → re-anima) */}
      <ResponsiveContainer width="100%" height={110} key={`${periodo}-${metrica}`}>
        <ComposedChart data={data} margin={{ top: 10, right: 4, bottom: 0, left: isValor ? -14 : -26 }}>
          <defs>
            <linearGradient id="aprovGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(142,93%,8%)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(142,93%,8%)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tickFormatter={v => (isValor ? `${(Number(v) / 1000).toFixed(0)}k` : String(v))}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
            formatter={(v, name) => {
              if (name === 'valor')      return [formatCurrency(Number(v)), 'Valor aprovado'];
              if (name === 'aprovados')  return [`${v}`, 'Aprovados'];
              if (name === 'rejeitados') return [`${v}`, 'Rejeitados'];
              return [String(v), String(name)];
            }}
            labelFormatter={l => (periodo === 'semanas' ? `Semana de ${l}` : String(l))}
          />
          <Area
            type="monotone"
            dataKey={isValor ? 'valor' : 'aprovados'}
            name={isValor ? 'valor' : 'aprovados'}
            stroke="hsl(142,93%,8%)"
            strokeWidth={2.5}
            fill="url(#aprovGrad)"
            dot={{ r: 2.5, fill: 'hsl(142,93%,8%)' }}
            activeDot={{ r: 4.5 }}
          />
          {!isValor && (
            <Line
              type="monotone"
              dataKey="rejeitados"
              name="rejeitados"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legenda */}
      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[hsl(142,93%,8%)]" />
          {isValor ? 'Valor aprovado' : 'Aprovados'}
        </span>
        {!isValor && (
          <span className="inline-flex items-center gap-1">
            <span className="w-3 border-t border-dashed border-red-400" />
            Rejeitados
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Card de orçamento (Centro de Aprovações) ──────────────
interface CardProps {
  orc: Orcamento;
  canAct: boolean;
  prio: Prioridade;
  comissaoPct?: number;
  hoje: Date;
  checked: boolean;
  onCheck: (id: string, on: boolean) => void;
  onOpen: (o: Orcamento) => void;
  onAprovar: (id: string) => void;
  onRejeitar: (o: Orcamento) => void;
  acting: boolean;
}

function AprovacaoCard({ orc, canAct, prio, comissaoPct, hoje, checked, onCheck, onOpen, onAprovar, onRejeitar, acting }: CardProps) {
  const valor = valorOrcamento(orc);
  const nItens = numItens(orc);
  const comissao = comissaoPct !== undefined && valor > 0 ? valor * (comissaoPct / 100) : null;
  const aguardando = diasAguardando(orc, hoje);
  const pendente = isPendente(orc);

  return (
    <EntityCard layout onClick={() => onOpen(orc)} accent={PRIO_CFG[prio].color}>
      <div className="p-4">
        {/* Linha 1: checkbox + nº + status + prioridade | ações rápidas */}
        <div className="flex items-center gap-2 flex-wrap">
          {canAct && pendente && (
            <span
              role="checkbox"
              aria-checked={checked}
              tabIndex={0}
              onClick={e => { e.stopPropagation(); onCheck(orc.id, !checked); }}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onCheck(orc.id, !checked); } }}
              className={cn(
                'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer touch-compact',
                checked ? 'bg-[hsl(142,93%,8%)] border-[hsl(142,93%,8%)] text-white' : 'border-gray-300 hover:border-gray-400',
              )}
              title="Selecionar para aprovação em lote"
            >
              {checked && <Check className="w-3 h-3" />}
            </span>
          )}
          <span className="font-mono text-xs text-gray-400">#{orc.numero}</span>
          <StatusPill status={orc.status} />
          <PrioPill prio={prio} />
          {canAct && pendente && (
            <div className="ml-auto flex items-center gap-1 touch-compact" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => onAprovar(orc.id)}
                disabled={acting}
                title="Aprovar"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 transition-all active:scale-95 disabled:opacity-50"
              >
                {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => onRejeitar(orc)}
                disabled={acting}
                title="Rejeitar"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-all active:scale-95 disabled:opacity-50"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Cliente + obra */}
        <p className="font-semibold text-gray-900 text-[15px] mt-2 leading-snug line-clamp-2 group-hover:text-[hsl(142,93%,8%)] transition-colors">
          {nomeCliente(orc)}
        </p>
        {orc.obra_referencia && <p className="text-xs text-gray-400 mt-0.5 truncate">Obra: {orc.obra_referencia}</p>}

        {/* Métricas */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs font-semibold tabular-nums text-emerald-700">
            <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
            {valor > 0 ? formatCurrencyK(valor) : '—'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs font-semibold tabular-nums text-gray-700">
            <Package className="w-3.5 h-3.5 text-gray-400" />
            {nItens} item(s)
          </span>
          {comissao !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs font-semibold tabular-nums text-amber-700" title={`Comissão prevista (${comissaoPct}%)`}>
              <Award className="w-3.5 h-3.5 text-amber-500" />
              {formatCurrencyK(comissao)}
            </span>
          )}
          {pendente && (
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums',
              aguardando > 5 ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500',
            )} title="Tempo aguardando aprovação">
              <Hourglass className="w-3.5 h-3.5" />
              {aguardando === 0 ? 'hoje' : `${aguardando}d`}
            </span>
          )}
        </div>

        {/* Condições da proposta */}
        {(orc.condicao_pagamento || orc.frete_tipo || orc.frete_valor) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2.5 text-[11px] text-gray-400">
            {orc.condicao_pagamento && <span>Pagamento: <span className="text-gray-600 font-medium">{orc.condicao_pagamento}</span></span>}
            {orc.frete_tipo && <span>Frete: <span className="text-gray-600 font-medium">{orc.frete_tipo.split(' - ')[0]}</span></span>}
            {!!orc.frete_valor && orc.frete_valor > 0 && <span className="text-gray-600 font-medium tabular-nums">{formatCurrency(orc.frete_valor)}</span>}
          </div>
        )}

        {/* Observações do representante / motivo de rejeição */}
        {orc.observacoes && (
          <div className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2 mt-2.5 border',
            orc.status === 'rejeitado' ? 'bg-red-50 border-red-100' : 'bg-blue-50/50 border-blue-100',
          )}>
            {orc.status === 'rejeitado'
              ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              : <MessageSquare className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />}
            <p className={cn('text-xs line-clamp-2', orc.status === 'rejeitado' ? 'text-red-700' : 'text-blue-800/80')}>
              {orc.observacoes}
            </p>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-50/60 border-t border-gray-100">
        <span className="flex items-center gap-1.5 min-w-0" title={orc.representante_erp ?? undefined}>
          {orc.autor && <Avatar nome={orc.autor.nome} avatarUrl={orc.autor.avatar_url} size="sm" className="!w-5 !h-5 text-[8px]" />}
          <span className="text-[11px] text-gray-500 truncate max-w-[160px]">
            {orc.autor?.nome ?? orc.representante_erp ?? '—'}
          </span>
        </span>
        <span className="flex items-center gap-3 text-[11px] text-gray-400 tabular-nums flex-shrink-0">
          <span>Criado {formatDate(orc.created_at)}</span>
          {orc.validade && <span className="hidden sm:inline">Val. {formatDate(orc.validade)}</span>}
        </span>
      </div>
    </EntityCard>
  );
}

// ─── Drawer de análise ─────────────────────────────────────
function DrawerSecao({ titulo, icon: Icon, children }: { titulo: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
        <Icon className="w-3.5 h-3.5" />{titulo}
      </p>
      {children}
    </div>
  );
}

function HistoricoCompras({ cnpj }: { cnpj: string }) {
  const { data: pedidos = [], isLoading } = useClientePedidos(cnpj);
  const stats = useMemo(() => {
    const total = pedidos.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
    const datas = pedidos.map(p => (p.data_emissao ?? '').slice(0, 10)).filter(Boolean).sort();
    return {
      n: pedidos.length,
      total,
      ticket: pedidos.length > 0 ? total / pedidos.length : 0,
      ultimo: datas.length > 0 ? datas[datas.length - 1] : null,
    };
  }, [pedidos]);

  if (isLoading) return <div className="h-14 rounded-xl bg-gray-50 animate-pulse" />;
  if (stats.n === 0) return <p className="text-xs text-gray-400">Sem histórico de pedidos no ERP.</p>;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      <div><p className="text-[10px] text-gray-400">Pedidos</p><p className="text-xs font-bold text-gray-800 tabular-nums">{stats.n}</p></div>
      <div><p className="text-[10px] text-gray-400">Volume total</p><p className="text-xs font-bold text-emerald-700 tabular-nums">{stats.total > 0 ? formatCurrencyK(stats.total) : '—'}</p></div>
      <div><p className="text-[10px] text-gray-400">Média de pedido</p><p className="text-xs font-bold text-gray-800 tabular-nums">{stats.ticket > 0 ? formatCurrencyK(stats.ticket) : '—'}</p></div>
      <div><p className="text-[10px] text-gray-400">Última compra</p><p className="text-xs font-bold text-gray-800 tabular-nums">{stats.ultimo ? formatDate(stats.ultimo) : '—'}</p></div>
    </div>
  );
}

interface DrawerProps {
  orc: Orcamento;
  canAct: boolean;
  prio: Prioridade;
  comissaoPct?: number;
  cidadeUf?: string;
  hoje: Date;
  acting: boolean;
  onClose: () => void;
  onEmAnalise: (id: string) => void;
  onAprovar: (id: string) => void;
  onRejeitar: (id: string, motivo: string) => void;
}

function AprovacaoDrawer({ orc, canAct, prio, comissaoPct, cidadeUf, hoje, acting, onClose, onEmAnalise, onAprovar, onRejeitar }: DrawerProps) {
  const [rejectMode, setRejectMode] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    setRejectMode(false); setMotivo('');
  }, [orc.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const valor = valorOrcamento(orc);
  const comissao = comissaoPct !== undefined && valor > 0 ? valor * (comissaoPct / 100) : null;
  const pendente = isPendente(orc);
  const itens = orc.itens ?? [];
  const produtos = itens.filter(i => !i.is_adicional);
  const adicionais = itens.filter(i => i.is_adicional);

  async function pdf() {
    setPdfLoading(true);
    try { await baixarOrcamentoPDF(orc.id, orc.numero); }
    finally { setPdfLoading(false); }
  }

  // Timeline honesta: eventos deriváveis dos dados existentes
  const timeline: { label: string; data: string; done: boolean }[] = [
    { label: 'Orçamento criado', data: orc.created_at, done: true },
    ...(orc.status !== 'rascunho' ? [{
      label: orc.status === 'aprovado' ? 'Aprovado'
        : orc.status === 'rejeitado' ? 'Rejeitado'
        : orc.status === 'em_analise' ? 'Em análise'
        : 'Enviado para análise',
      data: orc.updated_at,
      done: true,
    }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="drawer-overlay absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="drawer-panel absolute right-0 top-0 h-full w-full sm:max-w-lg bg-white shadow-2xl flex flex-col">

        {/* Cabeçalho */}
        <div className="p-5 pb-4 border-b border-gray-100" style={{ borderTop: `3px solid ${PRIO_CFG[prio].color}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-gray-400">#{orc.numero}</span>
                <StatusPill status={orc.status} />
                <PrioPill prio={prio} />
              </div>
              <h2 className="text-lg font-bold text-gray-900 leading-tight mt-1.5 line-clamp-2">{nomeCliente(orc)}</h2>
              {orc.obra_referencia && <p className="text-sm text-gray-400 mt-0.5 truncate">Obra: {orc.obra_referencia}</p>}
            </div>
            <button onClick={onClose} aria-label="Fechar"
              className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-6">

          {/* Resumo executivo */}
          <DrawerSecao titulo="Resumo executivo" icon={Sparkles}>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-emerald-50/60 p-3">
                <p className="text-[10px] text-gray-400">Valor total</p>
                <p className="text-base font-bold text-emerald-700 tabular-nums">{valor > 0 ? formatCurrencyK(valor) : '—'}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-[10px] text-gray-400">Itens</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{itens.length}</p>
              </div>
              <div className="rounded-xl bg-amber-50/60 p-3">
                <p className="text-[10px] text-gray-400">Comissão prevista{comissaoPct !== undefined ? ` (${comissaoPct}%)` : ''}</p>
                <p className="text-base font-bold text-amber-700 tabular-nums">{comissao !== null ? formatCurrencyK(comissao) : '—'}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-[10px] text-gray-400">Aguardando há</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{diasAguardando(orc, hoje)} dia(s)</p>
              </div>
            </div>
          </DrawerSecao>

          {/* Dados do cliente */}
          <DrawerSecao titulo="Dados do cliente" icon={User}>
            <div className="space-y-1.5 text-sm">
              <p className="font-semibold text-gray-900">{nomeCliente(orc)}</p>
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <Hash className="w-3 h-3 text-gray-400" /><span className="font-mono">{orc.cliente_cnpj}</span>
              </p>
              {cidadeUf && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <MapPin className="w-3 h-3 text-gray-400" />{cidadeUf}
                </p>
              )}
              {orc.endereco_entrega && (
                <p className="text-xs text-gray-500"><span className="text-gray-400">Entrega:</span> {orc.endereco_entrega}</p>
              )}
            </div>
          </DrawerSecao>

          {/* Histórico de compras */}
          <DrawerSecao titulo="Histórico de compras" icon={ShoppingBag}>
            <HistoricoCompras cnpj={orc.cliente_cnpj} />
          </DrawerSecao>

          {/* Produtos */}
          <DrawerSecao titulo={`Produtos (${produtos.length})`} icon={Package}>
            {produtos.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum produto</p>
            ) : (
              <div className="space-y-1.5">
                {produtos.map((item, i) => (
                  <div key={item.id ?? i} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-700 font-medium truncate block">{item.produto_descricao}</span>
                      <span className="text-gray-400">{item.produto_codigo} · {item.quantidade} {item.unidade}</span>
                    </div>
                    {item.preco_unitario ? (
                      <span className="text-gray-700 tabular-nums flex-shrink-0">{formatCurrency(item.preco_unitario * item.quantidade)}</span>
                    ) : (
                      <span className="text-gray-300 text-[10px] flex-shrink-0">sem preço</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {adicionais.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-gray-50">
                <p className="text-[10px] text-gray-400 mb-1.5">Serviços adicionais</p>
                <div className="space-y-1">
                  {adicionais.map((item, i) => (
                    <div key={item.id ?? i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{item.produto_descricao}</span>
                      <span className="text-gray-400 tabular-nums">{item.quantidade} {item.unidade}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DrawerSecao>

          {/* Condições da proposta */}
          <DrawerSecao titulo="Condições da proposta" icon={Receipt}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><p className="text-[10px] text-gray-400">Pagamento</p><p className="text-xs font-medium text-gray-800">{orc.condicao_pagamento ?? '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Validade</p><p className="text-xs font-medium text-gray-800 tabular-nums">{orc.validade ? formatDate(orc.validade) : '—'}</p></div>
              <div className="col-span-2"><p className="text-[10px] text-gray-400">Frete</p>
                <p className="text-xs font-medium text-gray-800">
                  {orc.frete_tipo ?? '—'}{!!orc.frete_valor && orc.frete_valor > 0 && <span className="tabular-nums"> · {formatCurrency(orc.frete_valor)}</span>}
                </p>
              </div>
            </div>
          </DrawerSecao>

          {/* Timeline */}
          <DrawerSecao titulo="Timeline do orçamento" icon={History}>
            <div className="relative pl-5">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
              <div className="space-y-3">
                {timeline.map((ev, i) => (
                  <div key={i} className="relative">
                    <span className={cn(
                      'absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white',
                      ev.done ? 'bg-[#2eaf69]' : 'bg-gray-200',
                    )} />
                    <p className="text-xs font-medium text-gray-800">{ev.label}</p>
                    <p className="text-[10px] text-gray-400 tabular-nums">{formatDate(ev.data)}</p>
                  </div>
                ))}
              </div>
            </div>
          </DrawerSecao>

          {/* Anexos */}
          <DrawerSecao titulo="Anexos" icon={Paperclip}>
            <button
              type="button"
              onClick={() => void pdf()}
              disabled={pdfLoading}
              className="flex items-center gap-2.5 w-full rounded-xl border border-gray-200 p-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center flex-shrink-0">
                {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              </span>
              <span className="min-w-0">
                <span className="text-xs font-medium text-gray-800 block truncate">Orcamento_{orc.numero}.pdf</span>
                <span className="text-[10px] text-gray-400">Documento gerado do orçamento · clique para baixar</span>
              </span>
            </button>
          </DrawerSecao>

          {/* Comentários */}
          <DrawerSecao titulo="Comentários" icon={MessageSquare}>
            {orc.observacoes ? (
              <div className={cn(
                'rounded-xl px-3.5 py-3 border',
                orc.status === 'rejeitado' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100',
              )}>
                <div className="flex items-center gap-1.5 mb-1">
                  {orc.autor && <Avatar nome={orc.autor.nome} avatarUrl={orc.autor.avatar_url} size="sm" className="!w-4 !h-4 text-[7px]" />}
                  <p className="text-[10px] font-semibold text-gray-500">
                    {orc.status === 'rejeitado' ? 'Motivo da rejeição' : orc.autor?.nome ?? 'Representante'}
                  </p>
                </div>
                <p className={cn('text-xs leading-relaxed', orc.status === 'rejeitado' ? 'text-red-700' : 'text-gray-700')}>
                  {orc.observacoes}
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-400">Sem comentários do representante.</p>
            )}
          </DrawerSecao>
        </div>

        {/* Ações */}
        {canAct && pendente && (
          <div className="border-t border-gray-100 p-4 space-y-2 bg-white">
            {!rejectMode ? (
              <div className="flex gap-2">
                {orc.status === 'enviado' && (
                  <button
                    onClick={() => onEmAnalise(orc.id)}
                    disabled={acting}
                    className="h-11 px-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Clock className="w-4 h-4" />
                    <span className="hidden sm:inline">Em Análise</span>
                  </button>
                )}
                <button
                  onClick={() => onAprovar(orc.id)}
                  disabled={acting}
                  className="flex-1 h-11 rounded-xl bg-[hsl(142,93%,8%)] text-white text-sm font-medium hover:bg-[hsl(142,93%,15%)] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                >
                  {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                  Aprovar
                </button>
                <button
                  onClick={() => setRejectMode(true)}
                  disabled={acting}
                  className="flex-1 h-11 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <ThumbsDown className="w-4 h-4" />
                  Rejeitar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  placeholder="Motivo da rejeição (obrigatório)..."
                  rows={2}
                  className="w-full text-sm border border-red-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { onRejeitar(orc.id, motivo); }}
                    disabled={!motivo.trim() || acting}
                    className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                    Confirmar Rejeição
                  </button>
                  <button
                    onClick={() => { setRejectMode(false); setMotivo(''); }}
                    className="h-10 px-4 rounded-xl text-sm text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!canAct && orc.status === 'em_analise' && (
          <div className="border-t border-gray-100 p-4 bg-amber-50/50">
            <p className="flex items-center gap-2 text-xs text-amber-700">
              <Clock className="w-3.5 h-3.5" />
              Em análise pela equipe de orçamentos
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página ────────────────────────────────────────────────
export default function AprovacoesPage() {
  const { user } = useAuth();
  const isOperador = user?.usuario?.operador ?? false;
  const isAdmin    = user?.usuario?.admin    ?? false;
  const canAct     = isOperador || isAdmin;
  const hoje = useMemo(() => new Date(), []);

  const [view, setView] = useState<FilterView>('pendente');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOrc, setDrawerOrc] = useState<Orcamento | null>(null);
  const [confirmLote, setConfirmLote] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const qc = useQueryClient();
  const { data: allOrcamentos = [], isLoading } = useOrcamentos();
  const { data: carteira = [] } = useCarteira(isAdmin ? 'todos' : undefined);
  const { data: representantes = [] } = useQuery({
    queryKey: ['representantes'],
    queryFn: fetchRepresentantes,
    enabled: canAct,
    staleTime: 1000 * 60 * 10,
  });

  // VIP = top 10 clientes da carteira por volume comprado
  const vipSet = useMemo(() => {
    const top = [...carteira]
      .filter(c => c.total_comprado > 0)
      .sort((a, b) => b.total_comprado - a.total_comprado)
      .slice(0, 10);
    return new Set(top.map(c => c.cliente_cnpj));
  }, [carteira]);

  // Cidade/UF por CNPJ (para o drawer)
  const cidadePorCnpj = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of carteira) {
      if (c.cliente_cidade) m.set(c.cliente_cnpj, `${c.cliente_cidade}/${c.cliente_uf}`);
    }
    return m;
  }, [carteira]);

  // Comissão % por representante_erp
  const comissaoPorRep = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of representantes) m.set(r.representante_erp, r.comissao_percentual);
    return m;
  }, [representantes]);

  function toast(texto: string, tone: ToastMsg['tone'] = 'ok') {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, texto, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['orcamentos'] });

  // ── Fonte + filtros ──
  const source = useMemo(
    () => allOrcamentos.filter(o => o.status !== 'rascunho'),
    [allOrcamentos]
  );

  const filtered = useMemo(() => {
    let list = source;
    if (view === 'pendente')  list = list.filter(isPendente);
    if (view === 'aprovado')  list = list.filter(o => o.status === 'aprovado');
    if (view === 'rejeitado') list = list.filter(o => o.status === 'rejeitado');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.numero.toLowerCase().includes(q) ||
        o.cliente_nome.toLowerCase().includes(q) ||
        (o.cliente_fantasia ?? '').toLowerCase().includes(q) ||
        (o.obra_referencia ?? '').toLowerCase().includes(q) ||
        (o.representante_erp ?? '').toLowerCase().includes(q)
      );
    }
    // Pendentes urgentes primeiro
    const prioOrdem: Record<Prioridade, number> = { atrasado: 0, vencendo: 1, vip: 2, normal: 3 };
    return [...list].sort((a, b) => {
      const pa = prioOrdem[getPrioridade(a, vipSet, hoje)];
      const pb = prioOrdem[getPrioridade(b, vipSet, hoje)];
      if (pa !== pb) return pa - pb;
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    });
  }, [source, view, search, vipSet, hoje]);

  const counts = useMemo(() => ({
    pendente:  source.filter(isPendente).length,
    aprovado:  source.filter(o => o.status === 'aprovado').length,
    rejeitado: source.filter(o => o.status === 'rejeitado').length,
    todos:     source.length,
  }), [source]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const pendentes = source.filter(isPendente);
    const aprovados = source.filter(o => o.status === 'aprovado');
    const hojeStr = hoje.toISOString().slice(0, 10);
    const aprovadosHoje = aprovados.filter(o => (o.updated_at ?? '').slice(0, 10) === hojeStr).length;
    const valorAguardando = pendentes.reduce((s, o) => s + valorOrcamento(o), 0);
    const maior = pendentes.reduce((m, o) => Math.max(m, valorOrcamento(o)), 0);
    // Tempo médio: aprovados, updated_at - created_at
    const tempos = aprovados
      .map(o => {
        const c = parseData(o.created_at); const u = parseData(o.updated_at);
        return c && u ? (u.getTime() - c.getTime()) / DAY : null;
      })
      .filter((v): v is number => v !== null && v >= 0);
    const tempoMedio = tempos.length > 0 ? tempos.reduce((s, v) => s + v, 0) / tempos.length : null;
    return { pendentes: pendentes.length, aprovadosHoje, valorAguardando, maior, tempoMedio };
  }, [source, hoje]);

  // ── Mutations (compartilhadas por card, drawer e lote) ──
  function proximoPendente(atualId: string): Orcamento | null {
    const pendentes = filtered.filter(o => isPendente(o) && o.id !== atualId);
    return pendentes[0] ?? null;
  }

  const aprovarMut = useMutation({
    mutationFn: (id: string) => aprovarOrcamento(id),
    onSuccess: (_, id) => {
      invalidate();
      toast('Orçamento aprovado com sucesso');
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      if (drawerOrc?.id === id) setDrawerOrc(proximoPendente(id));
    },
    onError: () => toast('Erro ao aprovar o orçamento', 'erro'),
  });

  const rejeitarMut = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => rejeitarOrcamento(id, motivo),
    onSuccess: (_, { id }) => {
      invalidate();
      toast('Orçamento rejeitado');
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      if (drawerOrc?.id === id) setDrawerOrc(proximoPendente(id));
    },
    onError: () => toast('Erro ao rejeitar o orçamento', 'erro'),
  });

  const emAnaliseMut = useMutation({
    mutationFn: (id: string) => marcarEmAnalise(id),
    onSuccess: (_, id) => {
      invalidate();
      toast('Marcado como Em Análise');
      if (drawerOrc?.id === id) setDrawerOrc(prev => prev ? { ...prev, status: 'em_analise' } : prev);
    },
    onError: () => toast('Erro ao atualizar o status', 'erro'),
  });

  const loteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map(id => aprovarOrcamento(id)));
      const ok = results.filter(r => r.status === 'fulfilled').length;
      return { ok, total: ids.length };
    },
    onSuccess: ({ ok, total }) => {
      invalidate();
      setSelected(new Set());
      setConfirmLote(false);
      toast(ok === total ? `${ok} orçamento(s) aprovado(s)` : `${ok}/${total} aprovados — verifique os demais`, ok === total ? 'ok' : 'erro');
    },
    onError: () => { setConfirmLote(false); toast('Erro na aprovação em lote', 'erro'); },
  });

  const acting = aprovarMut.isPending || rejeitarMut.isPending || emAnaliseMut.isPending || loteMut.isPending;

  function onCheck(id: string, on: boolean) {
    setSelected(prev => {
      const n = new Set(prev);
      if (on) n.add(id); else n.delete(id);
      return n;
    });
  }

  // Rejeitar a partir do card → abre o drawer já em modo de análise
  function abrirParaRejeitar(o: Orcamento) {
    setDrawerOrc(o);
  }

  const filters: { key: FilterView; label: string }[] = [
    { key: 'pendente',  label: 'Pendentes'  },
    { key: 'aprovado',  label: 'Aprovados'  },
    { key: 'rejeitado', label: 'Rejeitados' },
    { key: 'todos',     label: 'Todos'      },
  ];

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="p-4 sm:p-5 space-y-4">
        <div className="h-8 w-64 bg-gray-100 rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <PageContainer bottomBar={selected.size > 0}>
      <ToastStack toasts={toasts} />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-[hsl(142,93%,8%)]" />
          Centro de Aprovações
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {canAct ? 'Analise, aprove ou rejeite os orçamentos enviados pelos representantes'
                  : 'Acompanhe o status dos seus orçamentos enviados'}
        </p>
      </div>

      {/* KPIs + gráfico */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <KpiCard icon={Hourglass}   label="Pendentes"        value={String(kpis.pendentes)} tone="text-amber-600" />
          <KpiCard icon={CheckCircle2} label="Aprovados hoje"  value={String(kpis.aprovadosHoje)} tone="text-emerald-700" />
          <KpiCard icon={XCircle}     label="Rejeitados"       value={String(counts.rejeitado)} tone="text-red-600" />
          <KpiCard icon={DollarSign}  label="Valor aguardando" value={kpis.valorAguardando > 0 ? formatCurrencyK(kpis.valorAguardando) : '—'} tone="text-emerald-700" />
          <KpiCard icon={TrendingUp}  label="Maior pendente"   value={kpis.maior > 0 ? formatCurrencyK(kpis.maior) : '—'} />
          <KpiCard icon={Timer}       label="Tempo médio"      value={kpis.tempoMedio !== null ? `${kpis.tempoMedio.toFixed(1).replace('.', ',')}d` : '—'} sub="da criação à aprovação" />
        </div>

        {/* Gráfico dinâmico de aprovações */}
        <ApprovalsChart source={source} hoje={hoje} />
      </div>

      {/* Filtros + busca */}
      <div className="flex flex-col sm:flex-row gap-2">
        <FilterBar>
          {filters.map(({ key, label }) => (
            <FilterChip key={key} active={view === key} onClick={() => setView(key)} count={counts[key]}>
              {label}
            </FilterChip>
          ))}
        </FilterBar>
        <div className="sm:ml-auto sm:w-72">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar nº, cliente, representante..." />
        </div>
      </div>

      {/* Legenda de prioridade */}
      {canAct && view === 'pendente' && filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-400">
          {(['atrasado', 'vencendo', 'vip', 'normal'] as Prioridade[]).map(p => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIO_CFG[p].color }} />
              {PRIO_CFG[p].label}
            </span>
          ))}
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm py-16 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600">
            {view === 'pendente' ? 'Nenhum orçamento pendente — tudo em dia! 🎉' : 'Nenhum orçamento encontrado'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          <AnimatePresence mode="popLayout">
            {filtered.map(orc => (
              <AprovacaoCard
                key={orc.id}
                orc={orc}
                canAct={canAct}
                prio={getPrioridade(orc, vipSet, hoje)}
                comissaoPct={orc.representante_erp ? comissaoPorRep.get(orc.representante_erp) : undefined}
                hoje={hoje}
                checked={selected.has(orc.id)}
                onCheck={onCheck}
                onOpen={setDrawerOrc}
                onAprovar={id => aprovarMut.mutate(id)}
                onRejeitar={abrirParaRejeitar}
                acting={acting}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Barra de aprovação em lote */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="fixed left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-40 bottom-[calc(var(--nav-h)+var(--safe-bottom)+1rem)] lg:bottom-6"
          >
            <div className="flex items-center gap-3 rounded-2xl bg-gray-900 text-white shadow-2xl px-4 py-3">
              <span className="text-sm font-medium tabular-nums whitespace-nowrap">
                {selected.size} selecionado(s)
              </span>
              <button
                onClick={() => setConfirmLote(true)}
                disabled={loteMut.isPending}
                className="h-9 px-4 rounded-xl bg-[#2eaf69] text-white text-sm font-medium hover:bg-[#27995c] transition-all active:scale-[0.97] disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
              >
                {loteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                Aprovar em lote
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-white/60 hover:text-white transition-colors whitespace-nowrap"
              >
                Limpar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmação do lote */}
      {confirmLote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-2">Aprovar {selected.size} orçamento(s)?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Todos os orçamentos selecionados serão aprovados de uma vez. Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmLote(false)}
                className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => loteMut.mutate([...selected])}
                disabled={loteMut.isPending}
                className="h-9 px-4 text-sm bg-[hsl(142,93%,8%)] text-white rounded-lg hover:bg-[hsl(142,93%,15%)] disabled:opacity-50 flex items-center gap-2"
              >
                {loteMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirmar Aprovação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer de análise */}
      {drawerOrc && (
        <AprovacaoDrawer
          orc={drawerOrc}
          canAct={canAct}
          prio={getPrioridade(drawerOrc, vipSet, hoje)}
          comissaoPct={drawerOrc.representante_erp ? comissaoPorRep.get(drawerOrc.representante_erp) : undefined}
          cidadeUf={cidadePorCnpj.get(drawerOrc.cliente_cnpj)}
          hoje={hoje}
          acting={acting}
          onClose={() => setDrawerOrc(null)}
          onEmAnalise={id => emAnaliseMut.mutate(id)}
          onAprovar={id => aprovarMut.mutate(id)}
          onRejeitar={(id, motivo) => rejeitarMut.mutate({ id, motivo })}
        />
      )}
    </PageContainer>
  );
}
