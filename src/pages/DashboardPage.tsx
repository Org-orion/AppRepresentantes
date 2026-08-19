import { useState, useEffect, useMemo, useId, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAuth } from '@/hooks/useAuth';
import { perfilDoUsuario } from '@/constants/perfis';
import DirectorExecutiveDashboard from '@/components/dashboard/DirectorExecutiveDashboard';
import GeneralDirectorExecutiveDashboard from '@/components/dashboard/GeneralDirectorExecutiveDashboard';
import { useOrcamentos } from '@/hooks/useOrcamentos';
import { useCarteira } from '@/hooks/useCarteira';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useRepresentantesUnicos } from '@/hooks/usePedidosVenda';
import { formatCurrency, formatCurrencyK, formatDate, formatDateLong } from '@/utils/formatters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import PageContainer from '@/components/ui/PageContainer';
import TruncationNotice from '@/components/ui/TruncationNotice';
import Select from '@/components/ui/Select';
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Users, DollarSign, CreditCard, Award,
  FileText, Clock, CheckCircle, AlertTriangle,
  ArrowRight, ArrowUpRight, TrendingUp, TrendingDown,
  Unlock, Map as MapIcon, Wrench, Handshake, Factory, FileCheck2, Truck, PackageCheck,
  ChevronDown, ChevronLeft, ChevronRight, LayoutList, Layers, CalendarDays, CalendarClock, X,
  Sparkles, Lightbulb, Target, Trophy,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Link } from 'react-router-dom';
import type { PipelineCounts } from '@/services/dashboard';
import type { ClienteCarteira } from '@/services/carteira';

// ─── Constantes ────────────────────────────────────────────────
const MESES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const ANO_ATUAL = new Date().getFullYear();
const ANOS = Array.from({ length: 5 }, (_, i) => ANO_ATUAL - i);
const PERIODO_ANT: Record<'mes' | 'trimestre' | 'ano', string> = { mes: 'mês ant.', trimestre: 'trim. ant.', ano: 'ano ant.' };

const CONCREM = 'hsl(142,93%,8%)';
// Paleta coesa (verde Concrem + acentos) para segmentações
const PIE_COLORS = ['#014017', '#1a7a40', '#2eaf69', '#6dcf99', '#0ea5e9', '#8b5cf6', '#f59e0b', '#cbd5e1'];

const ACCENTS: Record<string, { chip: string; stroke: string }> = {
  blue:   { chip: 'bg-blue-50 text-blue-600',       stroke: '#3b82f6' },
  green:  { chip: 'bg-emerald-50 text-emerald-600', stroke: '#10b981' },
  purple: { chip: 'bg-purple-50 text-purple-600',   stroke: '#8b5cf6' },
  amber:  { chip: 'bg-amber-50 text-amber-600',     stroke: '#f59e0b' },
};

const PIPELINE_STAGES: { key: keyof PipelineCounts; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'aprovado',   label: 'Aprovado',   icon: CheckCircle,  color: '#3b82f6' },
  { key: 'liberado',   label: 'Liberado',   icon: Unlock,       color: '#8b5cf6' },
  { key: 'mapeamento', label: 'Mapeamento', icon: MapIcon,      color: '#a855f7' },
  { key: 'ferragem',   label: 'Ferragem',   icon: Wrench,       color: '#f97316' },
  { key: 'comercial',  label: 'Comercial',  icon: Handshake,    color: '#6366f1' },
  { key: 'producao',   label: 'Produção',   icon: Factory,      color: '#f59e0b' },
  { key: 'faturado',   label: 'Faturado',   icon: FileCheck2,   color: '#14b8a6' },
  { key: 'entrega',    label: 'Entrega',    icon: Truck,        color: '#0ea5e9' },
  { key: 'finalizado', label: 'Finalizado', icon: PackageCheck, color: '#22c55e' },
];

// ─── Animação: contador que sobe ───────────────────────────────
function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setVal(target); return; }
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return val;
}

// ─── Reveal ao entrar na viewport ──────────────────────────────
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ─── Sparkline (mini gráfico de linha/área) ────────────────────
function Sparkline({ data, color, height = 34 }: { data: number[]; color: string; height?: number }) {
  const id = useId().replace(/:/g, '');
  if (data.length < 2) return <div style={{ height }} />;
  const max = Math.max(...data);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / range) * (height - 3) - 1.5}`);
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${w},${height} L 0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Barra de progresso animada ────────────────────────────────
function MiniProgress({ pct, color }: { pct: number; color: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={reduce ? false : { width: 0 }}
        whileInView={reduce ? undefined : { width: `${Math.min(pct, 100)}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
    </div>
  );
}

// ─── KPI Card rico ─────────────────────────────────────────────
function RichKPICard({
  title, value, format, subtitle, icon: Icon, accent, trend, spark, progress, loading,
}: {
  title: string; value: number; format: (n: number) => string; subtitle: string;
  icon: React.ElementType; accent: keyof typeof ACCENTS;
  trend?: { value: number; label: string };
  spark?: number[]; progress?: number; loading?: boolean;
}) {
  const animated = useCountUp(loading ? 0 : value);
  const a = ACCENTS[accent];
  const up = (trend?.value ?? 0) >= 0;
  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm p-4 h-full flex flex-col transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', a.chip)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1.5 tabular-nums whitespace-nowrap leading-tight">
        {loading ? '···' : format(animated)}
      </p>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <p className="text-xs text-gray-500 truncate">{subtitle}</p>
        {trend && (
          <span className={cn('flex items-center gap-0.5 text-xs font-semibold flex-shrink-0', up ? 'text-emerald-600' : 'text-red-500')}>
            {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {up ? '+' : ''}{trend.value.toFixed(1)}%
          </span>
        )}
      </div>
      {/* Rodapé visual: sparkline OU progress, ancorado embaixo */}
      <div className="mt-auto pt-3">
        {spark ? <Sparkline data={spark} color={a.stroke} />
          : progress !== undefined ? <MiniProgress pct={progress} color={a.stroke} />
          : null}
        {trend && <p className="text-[10px] text-gray-400 mt-1">{trend.label}</p>}
      </div>
    </div>
  );
}

// ─── Insight card (painel estilo IA) ───────────────────────────
type InsightTone = 'good' | 'risk' | 'info' | 'opp';
const INSIGHT_STYLE: Record<InsightTone, { chip: string; icon: React.ElementType }> = {
  good: { chip: 'bg-emerald-50 text-emerald-600', icon: TrendingUp },
  risk: { chip: 'bg-red-50 text-red-600',         icon: AlertTriangle },
  info: { chip: 'bg-blue-50 text-blue-600',       icon: Target },
  opp:  { chip: 'bg-amber-50 text-amber-600',     icon: Lightbulb },
};
function InsightCard({ tone, title, text }: { tone: InsightTone; title: string; text: string }) {
  const s = INSIGHT_STYLE[tone];
  const Icon = s.icon;
  return (
    <div className="flex items-start gap-3 rounded-xl bg-gray-50/70 p-3">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', s.chip)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-800">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// ─── Funil comercial (barras centralizadas animadas) ───────────
function CommercialFunnel({ stages, detalhado }: {
  stages: { label: string; value: number; color: string }[]; detalhado: boolean;
}) {
  const reduce = useReducedMotion();
  const max = Math.max(...stages.map(s => s.value), 1);
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const conv = i > 0 && stages[i - 1].value > 0 ? Math.round((s.value / stages[i - 1].value) * 100) : null;
        return (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">{s.label}</span>
              <span className="text-xs font-bold text-gray-900 tabular-nums">
                {s.value.toLocaleString('pt-BR')}
                {detalhado && conv !== null && <span className="text-[10px] font-medium text-gray-400 ml-1.5">{conv}%</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: s.color }}
                initial={reduce ? false : { width: 0 }}
                whileInView={reduce ? undefined : { width: `${pct}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: i * 0.06, ease: 'easeOut' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Ranking (top clientes / representantes) ───────────────────
function RankingList({ items }: { items: { nome: string; valor: string; sub?: string }[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-400 py-4 text-center">Sem dados</p>;
  const medal = ['bg-amber-100 text-amber-700', 'bg-gray-100 text-gray-600', 'bg-orange-100 text-orange-700'];
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={`${it.nome}-${i}`} className="flex items-center gap-3 min-w-0">
          <span className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0', medal[i] ?? 'bg-gray-50 text-gray-400')}>
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{it.nome}</p>
            {it.sub && <p className="text-[11px] text-gray-400 truncate">{it.sub}</p>}
          </div>
          <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0 whitespace-nowrap">{it.valor}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Atividade de orçamentos: calendário mensal (últimos 3 meses) ─
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

type DiaSelecionado = { key: string; count: number; numeros: string[] };

function MonthCalendar({ year, month, activity, today, onSelectDay, selectedKey }: {
  year: number; month: number; activity: Map<string, string[]>; today: Date;
  onSelectDay: (d: DiaSelecionado) => void; selectedKey: string | null;
}) {
  // Grade do mês: começa no domingo da 1ª semana, termina no sábado da última
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const out: { key: string; dia: number; count: number; numeros: string[]; noMes: boolean; isToday: boolean }[] = [];
    const cursor = new Date(start);
    while (out.length < 42) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const numeros = activity.get(key) ?? [];
      out.push({
        key,
        dia: cursor.getDate(),
        count: numeros.length,
        numeros,
        noMes: cursor.getMonth() === month,
        isToday: cursor.toDateString() === today.toDateString(),
      });
      cursor.setDate(cursor.getDate() + 1);
      // para na última semana que contém o fim do mês
      if (out.length % 7 === 0 && cursor.getMonth() !== month && out.length >= 28) break;
    }
    return out;
  }, [year, month, activity, today]);

  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-gray-700 mb-2 text-center sm:text-left">
        <span className="capitalize">{MESES_FULL[month]}</span> <span className="text-gray-400 font-medium">{year}</span>
      </p>
      <div className="grid grid-cols-7 gap-y-1">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i} className="h-6 flex items-center justify-center text-[10px] font-semibold text-gray-400">{d}</span>
        ))}
        {cells.map(c => {
          const clicavel = c.noMes && c.count > 0;
          const isSel = c.noMes && selectedKey === c.key;
          const dotClass = cn(
            'w-7 h-7 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[11px] tabular-nums transition-colors',
            !c.noMes ? 'text-gray-300'
              : c.count === 0 ? 'text-gray-600'
              : c.count === 1 ? 'bg-emerald-200 text-emerald-900 font-semibold'
              : c.count === 2 ? 'bg-emerald-400 text-white font-semibold'
              : 'bg-emerald-600 text-white font-semibold',
            clicavel && 'hover:brightness-95 cursor-pointer',
            c.noMes && c.isToday && 'ring-2 ring-[hsl(142,93%,8%)] ring-offset-1 font-semibold',
            c.noMes && c.isToday && c.count === 0 && 'text-[hsl(142,93%,8%)]',
            isSel && 'outline outline-2 outline-offset-1 outline-emerald-500',
          );
          const titulo = c.noMes ? `${formatDate(c.key)} — ${c.count} orçamento(s)` : undefined;
          return (
            <span key={c.key} className="h-8 sm:h-7 flex items-center justify-center">
              {clicavel ? (
                <button type="button" title={titulo} className={dotClass}
                  onClick={() => onSelectDay({ key: c.key, count: c.count, numeros: c.numeros })}>
                  {c.dia}
                </button>
              ) : (
                <span title={titulo} className={dotClass}>{c.dia}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ActivityCalendar({ activity, today }: { activity: Map<string, string[]>; today: Date }) {
  const reduce = useReducedMotion();
  const lg = useMediaQuery('(min-width: 1024px)');
  const sm = useMediaQuery('(min-width: 640px)');
  const count = lg ? 3 : sm ? 2 : 1; // desktop 3 · tablet 2 · mobile 1

  const [offset, setOffset] = useState(0); // deslocamento em meses a partir do mês atual
  const [dir, setDir] = useState(0);       // direção da última navegação (p/ animação)
  const [selected, setSelected] = useState<DiaSelecionado | null>(null);

  // Janela de meses terminando no mês âncora (mês atual + offset). Do mais antigo p/ o mais novo.
  const months = useMemo(() => {
    const anchor = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - (count - 1 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, [today, offset, count]);

  const rangeLabel = useMemo(() => {
    const f = months[0], l = months[months.length - 1];
    if (months.length === 1) return `${MESES_FULL[f.month]} de ${f.year}`;
    const fm = MESES_FULL[f.month].slice(0, 3), lm = MESES_FULL[l.month].slice(0, 3);
    return f.year === l.year ? `${fm}–${lm} de ${l.year}` : `${fm}/${f.year} – ${lm}/${l.year}`;
  }, [months]);

  const go = (delta: number) => { setDir(delta); setOffset(o => o + delta); setSelected(null); };
  const irHoje = () => { setDir(0); setOffset(0); setSelected(null); };

  return (
    <div>
      {/* Cabeçalho + navegação */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 leading-tight">Atividade de Orçamentos</h3>
            <p className="text-[11px] text-gray-400 capitalize">{rangeLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => go(-1)} aria-label="Meses anteriores"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={irHoje}
            className="px-2.5 h-8 rounded-lg text-[11px] font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
            Hoje
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Próximos meses"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Calendários (transição animada entre janelas de meses) */}
      <div className="overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${offset}-${count}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir === 0 ? 0 : dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir === 0 ? 0 : dir * -24 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="grid gap-x-5 gap-y-4"
            style={{ gridTemplateColumns: `repeat(${count}, minmax(0,1fr))` }}
          >
            {months.map(m => (
              <MonthCalendar key={`${m.year}-${m.month}`} year={m.year} month={m.month}
                activity={activity} today={today} onSelectDay={setSelected} selectedKey={selected?.key ?? null} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Detalhe do dia (clique no desktop / toque no mobile) */}
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mt-3 rounded-xl bg-emerald-50/70 border border-emerald-100 px-3 py-2 flex items-start gap-2.5">
              <CalendarClock className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 tabular-nums">{formatDate(selected.key)} · {selected.count} orçamento(s)</p>
                {selected.numeros.length > 0 && (
                  <p className="text-[11px] text-gray-500 mt-0.5 break-words">
                    {selected.numeros.slice(0, 8).map(n => `#${n}`).join(', ')}{selected.numeros.length > 8 ? ` +${selected.numeros.length - 8}` : ''}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Fechar" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legenda: quantos orçamentos criados no dia */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-gray-100 text-[10px] text-gray-500">
        <span className="font-semibold text-gray-400 uppercase tracking-wider">Orçamentos por dia</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center text-[8px] text-gray-500 tabular-nums">0</span>
          nenhum
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-emerald-200 flex items-center justify-center text-[8px] font-semibold text-emerald-900 tabular-nums">1</span>
          um
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center text-[8px] font-semibold text-white tabular-nums">2</span>
          dois
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-emerald-600 flex items-center justify-center text-[8px] font-semibold text-white">3+</span>
          três ou mais
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full ring-2 ring-[hsl(142,93%,8%)] ring-offset-1 flex items-center justify-center text-[8px] font-semibold text-[hsl(142,93%,8%)]">·</span>
          hoje
        </span>
      </div>
    </div>
  );
}

// ─── Pipeline dinâmico (fluxo segmentado + estágios animados) ──
function PipelineFlow({ pipeline }: { pipeline?: PipelineCounts }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const total = pipeline?.total || 0;
  const max = Math.max(...PIPELINE_STAGES.map(s => pipeline?.[s.key] ?? 0), 1);
  const ativos = PIPELINE_STAGES.filter(s => (pipeline?.[s.key] ?? 0) > 0);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex h-3.5 w-full rounded-full overflow-hidden bg-gray-100">
          {ativos.map(s => {
            const count = pipeline?.[s.key] ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={s.key} title={`${s.label}: ${count} (${Math.round(pct)}%)`}
                className="h-full transition-[width] duration-700 ease-out"
                style={{ width: ready ? `${pct}%` : '0%', backgroundColor: s.color }} />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5">
          {ativos.map(s => (
            <span key={s.key} className="inline-flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              {s.label} <strong className="text-gray-700 tabular-nums">{pipeline?.[s.key] ?? 0}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-3">
        {PIPELINE_STAGES.map((s, i) => {
          const count = pipeline?.[s.key] ?? 0;
          const pctMax = max > 0 ? (count / max) * 100 : 0;
          const pctTot = total > 0 ? Math.round((count / total) * 100) : 0;
          const Icon = s.icon;
          const delay = `${i * 45}ms`;
          return (
            <div key={s.key} className="transition-all duration-500"
              style={{ opacity: ready ? 1 : 0, transform: ready ? 'none' : 'translateY(6px)', transitionDelay: delay }}>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                  <Icon className="w-3.5 h-3.5" style={{ color: s.color }} />{s.label}
                </span>
                <span className="text-xs tabular-nums text-gray-400">
                  <strong className="text-gray-800">{count}</strong>{count > 0 && ` · ${pctTot}%`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: ready ? `${pctMax}%` : '0%', backgroundColor: s.color, transitionDelay: delay }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PipelineMiniBar({ pipeline }: { pipeline?: PipelineCounts }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const total = pipeline?.total || 0;
  const ativos = PIPELINE_STAGES.filter(s => (pipeline?.[s.key] ?? 0) > 0);
  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-100 gap-px">
      {ativos.map(s => {
        const pct = total > 0 ? ((pipeline?.[s.key] ?? 0) / total) * 100 : 0;
        return <div key={s.key} className="h-full transition-[width] duration-700 ease-out"
          style={{ width: ready ? `${pct}%` : '0%', backgroundColor: s.color }} />;
      })}
    </div>
  );
}

// ─── Status mini card (orçamentos por status, clicável) ────────
function StatusCard({ label, count, icon: Icon, bg, text, border, hint }: {
  label: string; count: number; icon: React.ElementType; bg: string; text: string; border: string; hint?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5 p-3 rounded-xl border', bg, border)}>
      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center bg-white/60 flex-shrink-0', text)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0">
        <p className={cn('text-lg font-bold leading-tight', text)}>{count}</p>
        <p className={cn('text-[11px] font-medium truncate opacity-70', text)}>{label}</p>
        {hint && <p className={cn('text-[10px] font-medium opacity-60 mt-0.5 tabular-nums', text)}>{hint}</p>}
      </div>
    </div>
  );
}

// ─── Título de seção ───────────────────────────────────────────
function SectionHead({ children, to, action }: { children: ReactNode; to?: string; action?: string }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{children}</h2>
      {to && (
        <Link to={to} className="text-xs text-[hsl(142,93%,8%)] hover:underline flex items-center gap-1 font-medium">
          {action ?? 'Ver todos'} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { user } = useAuth();
  const today = new Date();
  const rep = user?.representante;
  const perfil = perfilDoUsuario(user?.usuario);
  const isAdmin = perfil === 'admin' || perfil === 'diretor_geral';
  const isDiretor = perfil === 'diretor' || perfil === 'diretor_geral';
  const isGeral = perfil === 'diretor_geral';

  // ── Filtros / modo ──
  const [periodo, setPeriodo] = useState<'mes' | 'trimestre' | 'ano'>('mes');
  const [ano, setAno] = useState(today.getFullYear());
  const [mes, setMes] = useState(today.getMonth() + 1);
  const [trimestre, setTrimestre] = useState(Math.floor(today.getMonth() / 3) + 1);
  const [repFiltro, setRepFiltro] = useState<string>('todos');
  const [modo, setModo] = useState<'resumido' | 'detalhado'>('resumido');
  const [pipelineAberto, setPipelineAberto] = useState(false);
  const detalhado = modo === 'detalhado';

  const { data: stats, isLoading: loading, isError: statsErro, refetch: recarregarStats } =
    useDashboardStats({ periodo, ano, mes, trimestre, representante: repFiltro });
  const { data: orcamentosAll = [] } = useOrcamentos();
  const { data: clientes = [], isError: carteiraErro, refetch: recarregarCarteira } =
    useCarteira(isAdmin ? repFiltro : undefined);

  // O dashboard mistura fonte nativa (orçamentos) com fonte do ERP (stats e
  // carteira). Se a parte do ERP falha, os KPIs continuam renderizando — em
  // zero. Zero aqui é indistinguível de "não vendeu nada", e é sobre esse número
  // que um diretor decide. Por isso o aviso é explícito em vez de silencioso.
  const dadosIncompletos = statsErro || carteiraErro;
  const { data: representantes = [] } = useRepresentantesUnicos();

  const orcamentos = (isAdmin && repFiltro !== 'todos')
    ? orcamentosAll.filter(o => o.representante_erp === repFiltro)
    : orcamentosAll;

  const periodoLabel = periodo === 'mes' ? `${MESES_LABEL[mes - 1]}/${ano}`
    : periodo === 'trimestre' ? `T${trimestre}/${ano}` : `${ano}`;

  // ── Derivados (mesma lógica de negócio) ──
  const orcStatus = {
    rascunho:   orcamentos.filter(o => o.status === 'rascunho').length,
    em_analise: orcamentos.filter(o => o.status === 'enviado' || o.status === 'em_analise').length,
    aprovado:   orcamentos.filter(o => o.status === 'aprovado').length,
    rejeitado:  orcamentos.filter(o => o.status === 'rejeitado').length,
  };

  const ultimosOrc = [...orcamentos]
    .filter(o => o.status !== 'rascunho')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6);

  const trendMes = stats && stats.totalVendidoMesAnt > 0
    ? ((stats.totalVendidoMes - stats.totalVendidoMesAnt) / stats.totalVendidoMesAnt) * 100 : 0;

  const comissao = (stats?.totalVendidoMes ?? 0) * ((rep?.comissao_percentual ?? 0) / 100);

  const totalOrcCriados  = orcamentos.length;
  const totalOrcEnviados = orcamentos.filter(o => o.status !== 'rascunho').length;
  const totalOrcAprov    = orcamentos.filter(o => o.status === 'aprovado').length;
  const totalClientes    = clientes.length;
  const totalPedidos     = stats?.totalPedidos ?? 0;

  const vendasSerie = (stats?.vendasMensais ?? []).map(m => m.valor);
  const faturadoPct = (stats?.totalVendidoMes ?? 0) > 0
    ? ((stats?.totalFaturadoMes ?? 0) / (stats!.totalVendidoMes)) * 100 : 0;
  const comissaoPct = (stats?.totalVendidoMes ?? 0) > 0 ? Math.min((comissao / stats!.totalVendidoMes) * 100 * 5, 100) : 0;

  // ── Segmentação de clientes por UF (donut) ──
  const ufData = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clientes) { const uf = (c.cliente_uf || '—').trim() || '—'; m.set(uf, (m.get(uf) ?? 0) + 1); }
    const arr = [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const top = arr.slice(0, 6);
    const resto = arr.slice(6).reduce((s, x) => s + x.value, 0);
    if (resto > 0) top.push({ name: 'Outros', value: resto });
    return top;
  }, [clientes]);

  // ── Rankings ──
  const topClientes = useMemo(
    () => [...clientes].sort((a: ClienteCarteira, b) => b.total_comprado - a.total_comprado).slice(0, 5),
    [clientes]
  );
  const topReps = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orcamentosAll) { const r = o.representante_erp?.trim(); if (r) m.set(r, (m.get(r) ?? 0) + 1); }
    return [...m.entries()].map(([nome, count]) => ({ nome, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [orcamentosAll]);

  // ── Atividade (heatmap) ──
  const activity = useMemo(() => {
    // date (YYYY-MM-DD) → números dos orçamentos criados naquele dia
    const m = new Map<string, string[]>();
    for (const o of orcamentos) {
      const d = (o.created_at ?? '').slice(0, 10);
      if (!d) continue;
      const arr = m.get(d) ?? [];
      arr.push(String(o.numero));
      m.set(d, arr);
    }
    return m;
  }, [orcamentos]);

  // ── Insights (estilo IA, baseado em regras sobre dados reais) ──
  const insights = useMemo(() => {
    const list: { tone: InsightTone; title: string; text: string }[] = [];
    const conversao = totalOrcCriados > 0 ? Math.round((totalOrcAprov / totalOrcCriados) * 100) : 0;
    const topStage = PIPELINE_STAGES
      .map(s => ({ label: s.label, c: stats?.pipeline[s.key] ?? 0 }))
      .sort((a, b) => b.c - a.c)[0];

    if (stats && stats.totalVendidoMesAnt > 0) {
      list.push(trendMes >= 0
        ? { tone: 'good', title: `Vendas em alta`, text: `Crescimento de ${trendMes.toFixed(1)}% vs ${PERIODO_ANT[periodo]} — ${formatCurrencyK(stats.totalVendidoMes)} em ${periodoLabel}.` }
        : { tone: 'risk', title: `Vendas em queda`, text: `Retração de ${Math.abs(trendMes).toFixed(1)}% vs ${PERIODO_ANT[periodo]}. Vale reforçar a prospecção.` });
    }
    list.push(conversao >= 30
      ? { tone: 'good', title: `Conversão saudável`, text: `${conversao}% dos orçamentos criados foram aprovados (${totalOrcAprov}/${totalOrcCriados}).` }
      : { tone: 'risk', title: `Conversão baixa`, text: `Só ${conversao}% dos orçamentos viraram aprovação. ${orcStatus.em_analise} em análise aguardando retorno.` });
    if (topStage && topStage.c > 0) {
      list.push({ tone: 'info', title: `Gargalo do pipeline`, text: `Maior concentração em "${topStage.label}" com ${topStage.c} pedido(s). Priorize o avanço desse estágio.` });
    }
    if (ufData.length > 0) {
      list.push({ tone: 'opp', title: `Concentração geográfica`, text: `${ufData[0].name} lidera a carteira com ${ufData[0].value} cliente(s). Oportunidade de expandir para outras regiões.` });
    }
    return list.slice(0, 4);
  }, [stats, trendMes, periodo, periodoLabel, totalOrcAprov, totalOrcCriados, orcStatus.em_analise, ufData]);

  const funnelStages = [
    { label: 'Clientes na carteira', value: totalClientes,    color: '#3b82f6' },
    { label: 'Orçamentos criados',   value: totalOrcCriados,   color: '#22c55e' },
    { label: 'Orçamentos enviados',  value: totalOrcEnviados,  color: '#f97316' },
    { label: 'Orçamentos aprovados', value: totalOrcAprov,     color: '#10b981' },
    { label: 'Pedidos no pipeline',  value: totalPedidos,      color: '#8b5cf6' },
  ];

  const nome = user?.usuario?.nome?.split(' ')[0] ?? rep?.nome?.split(' ')[0] ?? 'Representante';

  const STATUS_PILL: Record<string, { pill: string; label: string; dot: string }> = {
    enviado:    { pill: 'bg-blue-50 text-blue-700 border-blue-200',   label: 'Enviado',    dot: '#3b82f6' },
    em_analise: { pill: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Em Análise', dot: '#f59e0b' },
    aprovado:   { pill: 'bg-green-50 text-green-700 border-green-200', label: 'Aprovado',   dot: '#22c55e' },
    rejeitado:  { pill: 'bg-red-50 text-red-700 border-red-200',       label: 'Rejeitado',  dot: '#ef4444' },
  };

  // ── Roteador por perfil ──────────────────────────────────────────────────
  // Diretor / Diretor Geral: Sala de Comando Gerencial (página executiva dedicada).
  // Representante / Operador / Admin: dashboard operacional abaixo (inalterado).
  if (isDiretor) {
    return isGeral ? <GeneralDirectorExecutiveDashboard /> : <DirectorExecutiveDashboard />;
  }

  return (
    <PageContainer space="lg">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Olá, {nome} 👋</h1>
        <p className="text-sm text-gray-500 mt-1 capitalize">Portal do Representante · {formatDateLong(today)}</p>
      </div>

      {stats?.truncado && <TruncationNotice itens="pedidos" total={stats.totalPedidos} />}

      {/* ── Aviso de dados incompletos ── */}
      {dadosIncompletos && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">Alguns dados não puderam ser carregados</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Os números abaixo estão incompletos e <strong>não representam o resultado real</strong>.
              Não tome decisão por eles até recarregar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (statsErro) recarregarStats(); if (carteiraErro) recarregarCarteira(); }}
            className="flex-shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
          {(['mes', 'trimestre', 'ano'] as const).map(p => (
            <button key={p} type="button" onClick={() => setPeriodo(p)}
              className={cn('px-3 h-7 text-xs font-medium rounded-md transition-colors',
                periodo === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {p === 'mes' ? 'Mês' : p === 'trimestre' ? 'Trimestre' : 'Ano'}
            </button>
          ))}
        </div>

        <Select size="sm" value={String(ano)} onChange={v => setAno(Number(v))}
          options={ANOS.map(a => ({ value: String(a), label: String(a) }))} />
        {periodo === 'mes' && (
          <Select size="sm" value={String(mes)} onChange={v => setMes(Number(v))}
            options={MESES_LABEL.map((m, i) => ({ value: String(i + 1), label: m }))} />
        )}
        {periodo === 'trimestre' && (
          <Select size="sm" value={String(trimestre)} onChange={v => setTrimestre(Number(v))}
            options={[1, 2, 3, 4].map(t => ({ value: String(t), label: `T${t}` }))} />
        )}
        {isAdmin && (
          <Select size="sm" value={repFiltro} onChange={setRepFiltro} className="max-w-[220px]"
            options={[{ value: 'todos', label: 'Todos os representantes' }, ...representantes.map(r => ({ value: r, label: r }))]} />
        )}

        <button type="button" onClick={() => setModo(m => (m === 'resumido' ? 'detalhado' : 'resumido'))}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          <LayoutList className="w-3.5 h-3.5" />{modo === 'resumido' ? 'Resumido' : 'Detalhado'}
        </button>
      </div>

      {/* ── KPIs ricos ── */}
      <Reveal>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <RichKPICard title="Carteira Total" value={totalClientes} format={n => Math.round(n).toLocaleString('pt-BR')}
            subtitle="clientes ativos" icon={Users} accent="blue" progress={100} />
          <RichKPICard title={`Vendido · ${periodoLabel}`} value={stats?.totalVendidoMes ?? 0} format={formatCurrencyK}
            subtitle={`${stats?.pedidosNoPeriodo ?? 0} pedido(s)`} icon={DollarSign} accent="green" loading={loading}
            spark={vendasSerie.length > 1 ? vendasSerie : undefined}
            trend={stats && stats.totalVendidoMesAnt > 0 ? { value: trendMes, label: `vs ${PERIODO_ANT[periodo]}` } : undefined} />
          <RichKPICard title={`Faturado · ${periodoLabel}`} value={stats?.totalFaturadoMes ?? 0} format={formatCurrencyK}
            subtitle={`${stats?.faturadosNoPeriodo ?? 0} pedido(s) com NF`} icon={CreditCard} accent="purple" loading={loading}
            progress={faturadoPct} />
          <RichKPICard title="Comissão Prevista" value={comissao} format={formatCurrencyK}
            subtitle={`${rep?.comissao_percentual ?? 0}% s/ vendas`} icon={Award} accent="amber" loading={loading}
            progress={comissaoPct} />
        </div>
      </Reveal>

      {/* ── Insights (estilo IA) ── */}
      {insights.length > 0 && (
        <Reveal delay={0.05}>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-[hsl(142,93%,8%)]/10 text-[hsl(142,93%,8%)] flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900">Insights</h2>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">automático</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
              </div>
            </CardContent>
          </Card>
        </Reveal>
      )}

      {/* ── Tendência de vendas + Segmentação (donut) ── */}
      <Reveal delay={0.05}>
        <div className="grid lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2 min-w-0 overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Tendência de Vendas</CardTitle>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">6 meses</span>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center h-52">
                  <div className="w-6 h-6 border-2 border-[hsl(142,93%,8%)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={stats?.vendasMensais ?? []} margin={{ top: 6, right: 6, bottom: 4, left: -18 }}>
                    <defs>
                      <linearGradient id="areaVendas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CONCREM} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={CONCREM} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Vendas']}
                      contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                    <Area type="monotone" dataKey="valor" stroke={CONCREM} strokeWidth={2.5} fill="url(#areaVendas)" dot={{ r: 3, fill: CONCREM }} activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader><CardTitle>Clientes por Estado</CardTitle></CardHeader>
            <CardContent>
              {ufData.length === 0 ? (
                <p className="text-sm text-gray-400 py-12 text-center">Sem dados</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie data={ufData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                        {ufData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [`${v} cliente(s)`, n as string]}
                        contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 justify-center">
                    {ufData.map((d, i) => (
                      <span key={d.name} className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {d.name} <strong className="text-gray-700 tabular-nums">{d.value}</strong>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </Reveal>

      {/* ── Funil comercial + Ranking clientes ── */}
      <Reveal delay={0.05}>
        <div className="grid lg:grid-cols-2 gap-3">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader><CardTitle>Funil Comercial</CardTitle></CardHeader>
            <CardContent><CommercialFunnel stages={funnelStages} detalhado={detalhado} /></CardContent>
          </Card>
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                <CardTitle>Top Clientes por Volume</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <RankingList items={topClientes.map(c => ({
                nome: c.cliente_fantasia?.trim() || c.cliente_nome || 'Cliente sem nome',
                sub: `${c.total_pedidos} pedido(s)${c.cliente_uf ? ` · ${c.cliente_uf}` : ''}`,
                valor: c.total_comprado > 0 ? formatCurrencyK(c.total_comprado) : '—',
              }))} />
            </CardContent>
          </Card>
        </div>
      </Reveal>

      {/* ── Pipeline de Pedidos (dinâmico, recolhível) ── */}
      <Reveal delay={0.05}>
        <div>
          <SectionHead to="/acompanhamento" action="Acompanhar">Pipeline de Pedidos</SectionHead>
          {pipelineAberto ? (
            <div className="rounded-2xl border border-gray-200/70 bg-white shadow-sm p-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
                  <div className="w-5 h-5 border-2 border-[hsl(142,93%,8%)] border-t-transparent rounded-full animate-spin" />
                  Carregando...
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-400">
                      Total: <strong className="text-gray-700">{stats?.pipeline.total ?? 0}</strong> pedidos · Média de pedido <strong className="text-gray-700">{formatCurrencyK(stats?.ticketMedio ?? 0)}</strong>
                    </span>
                    <button type="button" onClick={() => setPipelineAberto(false)}
                      className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1">
                      Recolher <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                    </button>
                  </div>
                  <PipelineFlow pipeline={stats?.pipeline} />
                </>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setPipelineAberto(true)}
              className="group w-full text-left rounded-2xl border border-gray-200/70 bg-white shadow-sm px-4 py-3 transition-all hover:border-[hsl(142,93%,8%)]/30 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-[hsl(142,93%,8%)]/10 text-[hsl(142,93%,8%)] flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105">
                    <Layers className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800"><span className="tabular-nums">{stats?.pipeline.total ?? 0}</span> pedidos · 9 estágios</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">Média de pedido {formatCurrencyK(stats?.ticketMedio ?? 0)}</p>
                  </div>
                </div>
                <span className="flex items-center gap-1 text-xs font-medium text-[hsl(142,93%,8%)] flex-shrink-0">
                  Expandir <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
                </span>
              </div>
              <div className="mt-2.5"><PipelineMiniBar pipeline={stats?.pipeline} /></div>
            </button>
          )}
        </div>
      </Reveal>

      {/* ── Atividade (heatmap) + Top Representantes (admin) ── */}
      <Reveal delay={0.05}>
        <div className={cn('grid gap-3', isAdmin && topReps.length > 0 ? 'lg:grid-cols-2' : 'grid-cols-1')}>
          <Card className="min-w-0 overflow-hidden">
            <CardContent><ActivityCalendar activity={activity} today={today} /></CardContent>
          </Card>
          {isAdmin && topReps.length > 0 && (
            <Card className="min-w-0 overflow-hidden">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <CardTitle>Top Representantes</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <RankingList items={topReps.map(r => ({ nome: r.nome, sub: 'orçamentos', valor: String(r.count) }))} />
              </CardContent>
            </Card>
          )}
        </div>
      </Reveal>

      {/* ── Orçamentos por status (clicáveis) ── */}
      <Reveal delay={0.05}>
        <div>
          <SectionHead to="/orcamentos">Orçamentos</SectionHead>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { label: 'Rascunhos',  count: orcStatus.rascunho,   icon: FileText,      bg: 'bg-gray-50',    text: 'text-gray-600',    border: 'border-gray-200',    status: 'rascunho' },
              { label: 'Em Análise', count: orcStatus.em_analise, icon: Clock,         bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   status: 'em_analise' },
              { label: 'Aprovados',  count: orcStatus.aprovado,   icon: CheckCircle,   bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', status: 'aprovado' },
              { label: 'Rejeitados', count: orcStatus.rejeitado,  icon: AlertTriangle, bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     status: 'rejeitado' },
            ] as const).map(c => {
              const pct = totalOrcCriados > 0 ? Math.round((c.count / totalOrcCriados) * 100) : 0;
              return (
                <Link key={c.status} to={`/orcamentos?status=${c.status}`}
                  className="relative group block rounded-xl transition-all hover:shadow-md hover:-translate-y-0.5">
                  <StatusCard label={c.label} count={c.count} icon={c.icon} bg={c.bg} text={c.text} border={c.border}
                    hint={detalhado ? `${pct}% do total` : undefined} />
                  <span className="absolute top-2 right-2 flex items-center gap-0.5 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    ver <ArrowUpRight className="w-2.5 h-2.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </Reveal>

      {/* ── Timeline de eventos recentes ── */}
      <Reveal delay={0.05}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Eventos Recentes</CardTitle>
              <Link to="/orcamentos" className="text-xs text-[hsl(142,93%,8%)] hover:underline flex items-center gap-1 font-medium">
                Ver todos <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {ultimosOrc.length === 0 ? (
              <p className="py-8 text-sm text-gray-400 text-center">Nenhum orçamento enviado ainda</p>
            ) : (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
                <div className="space-y-4">
                  {ultimosOrc.map(orc => {
                    const cfg = STATUS_PILL[orc.status] ?? { pill: 'bg-gray-50 text-gray-500 border-gray-200', label: orc.status, dot: '#9ca3af' };
                    const nomeCli = orc.cliente_fantasia?.trim() || orc.cliente_nome;
                    return (
                      <div key={orc.id} className="relative">
                        <span className="absolute -left-5 top-1 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ backgroundColor: cfg.dot }} />
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-mono text-gray-400">#{orc.numero}</span>
                            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', cfg.pill)}>{cfg.label}</span>
                          </div>
                          <span className="text-[11px] text-gray-400 flex-shrink-0">{formatDate(orc.updated_at)}</span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 truncate mt-0.5">{nomeCli}</p>
                        {orc.condicao_pagamento && <p className="text-[11px] text-gray-400 mt-0.5">{orc.condicao_pagamento}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </Reveal>
    </PageContainer>
  );
}
