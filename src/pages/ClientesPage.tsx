import { useState, useMemo, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { formatCurrency, formatDate, parseContatos } from '@/utils/formatters';
import SearchInput from '@/components/ui/SearchInput';
import Select from '@/components/ui/Select';
import PageContainer from '@/components/ui/PageContainer';
import { cn } from '@/utils/cn';
import { MetricCard } from '@/components/ui/cards';
import { useSearchParams } from 'react-router-dom';
import { useCarteira, useClientePedidos } from '@/hooks/useCarteira';
import { parseDadosTabela } from '@/services/pedidosVenda';
import type { ClienteCarteira, ClientePedido } from '@/services/carteira';
import ClienteViewToggle, { type ClienteView } from '@/components/clientes/ClienteViewToggle';
import ClientGroupsView from '@/components/clientes/groups/ClientGroupsView';
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Bar, Line, ReferenceLine,
} from 'recharts';
import {
  MapPin, Phone, Mail, ShoppingCart, DollarSign, Calendar,
  Building2, Copy, Check, ChevronLeft, Users, Hash,
  Sparkles, AlertTriangle, TrendingUp, Lightbulb, Target,
  Package, CalendarClock, Receipt, Clock,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────
const CONCREM = 'hsl(142,93%,8%)';
const PIE_COLORS = ['#014017', '#1a7a40', '#2eaf69', '#6dcf99', '#0ea5e9', '#8b5cf6', '#f59e0b', '#cbd5e1'];
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function fmtCompact(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (value >= 1_000)     return `R$ ${(value / 1_000).toFixed(1).replace('.', ',')}k`;
  return `R$ ${value.toFixed(0)}`;
}
function fmtVolume(value: number): string {
  return value > 0 ? fmtCompact(value) : '—';
}
function fmtCnpj(cnpj: string) {
  const n = (cnpj ?? '').replace(/\D/g, '');
  if (n.length !== 14) return cnpj;
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function nomeCliente(c: ClienteCarteira) {
  const fantasia = c.cliente_fantasia?.trim();
  const razao = c.cliente_nome?.trim();
  return { nome: fantasia || razao || '', razao: fantasia && razao ? razao : null, semNome: !(fantasia || razao) };
}
function iniciais(nome: string) {
  return nome.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function parseISO(d: string): Date | null {
  const s = (d ?? '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const DAY = 24 * 60 * 60 * 1000;
const PRAZO_PADRAO = 30; // dias — prazo padrão fixo de recompra por cliente

// ─── Analytics por cliente (a partir dos pedidos reais) ─
interface ClienteAnalytics {
  totalPedidos: number;
  receita: number;
  ticketMedio: number;
  ultimoPedido: Date | null;
  intervaloMedio: number | null;     // dias entre compras
  proximaCompra: Date | null;        // último pedido + 30 dias (prazo padrão fixo)
  diasAtraso: number;                // > 0 = atrasado (passou do prazo de 30 dias)
  diasDesdeUltimo: number | null;    // dias desde a última compra
  movimentacao: 'ativo' | 'atencao' | 'atrasado' | 'dormente' | 'sem_historico';
  serieMensal: { mes: string; valor: number }[];
  freqMensal: { mes: string; count: number }[];
  freqStats: {
    media: number; total: number; mesesAtivos: number;
    pico: { mes: string; count: number } | null;
    maxConsecutivos: number; slope: number;
    constancia: 'alta' | 'média' | 'baixa';
    comportamento: string;
    chart: { mes: string; count: number; trend: number }[];
    cicloDias: number | null;         // frequência real (intervalo médio) em dias
    historicoInsuficiente: boolean;   // < 2 compras → não dá p/ calcular frequência
  };
  topProduto: { nome: string; qtd: number; valor: number; pctPedidos: number } | null;
  mixProdutos: { name: string; value: number }[];
  recentes: ClientePedido[];
  tendencia: number | null;          // % últimos 3m vs 3m anteriores
}

function computeAnalytics(pedidos: ClientePedido[], today: Date): ClienteAnalytics {
  const receita = pedidos.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
  const totalPedidos = pedidos.length;
  const ticketMedio = totalPedidos > 0 ? receita / totalPedidos : 0;

  const datas = pedidos.map(p => parseISO(p.data_emissao)).filter(Boolean) as Date[];
  datas.sort((a, b) => a.getTime() - b.getTime());
  const ultimoPedido = datas.length > 0 ? datas[datas.length - 1] : null;

  // Intervalo médio entre datas DISTINTAS de compra
  const distintas = [...new Set(datas.map(d => d.getTime()))].sort((a, b) => a - b);
  let intervaloMedio: number | null = null;
  if (distintas.length >= 2) {
    let soma = 0;
    for (let i = 1; i < distintas.length; i++) soma += (distintas[i] - distintas[i - 1]) / DAY;
    intervaloMedio = soma / (distintas.length - 1);
  }
  // Próxima compra = ÚLTIMO PEDIDO + 30 dias (prazo padrão fixo — NÃO o ciclo médio).
  // Vale mesmo com 1 pedido; só é null quando o cliente não tem nenhum pedido.
  const proximaCompra = ultimoPedido ? new Date(ultimoPedido.getTime() + PRAZO_PADRAO * DAY) : null;
  const diasAtraso = proximaCompra ? Math.floor((today.getTime() - proximaCompra.getTime()) / DAY) : 0;
  const diasDesdeUltimo = ultimoPedido ? Math.floor((today.getTime() - ultimoPedido.getTime()) / DAY) : null;
  // Classificação de movimentação (por dias desde a última compra)
  const movimentacao: ClienteAnalytics['movimentacao'] =
    totalPedidos === 0 || diasDesdeUltimo === null ? 'sem_historico'
    : diasDesdeUltimo <= 20 ? 'ativo'
    : diasDesdeUltimo <= 30 ? 'atencao'
    : diasDesdeUltimo <= 60 ? 'atrasado'
    : 'dormente';

  // Série mensal (últimos 12 meses) — valor e frequência
  const serieMensal: { mes: string; valor: number }[] = [];
  const freqMensal: { mes: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const doMes = pedidos.filter(p => {
      const d = parseISO(p.data_emissao);
      return d && d >= ref && d <= fim;
    });
    const label = MESES_ABREV[ref.getMonth()];
    serieMensal.push({ mes: label, valor: doMes.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0) });
    freqMensal.push({ mes: label, count: doMes.length });
  }

  // ── Frequência de compra (12 meses): estatísticas + tendência ──
  const freqCounts = freqMensal.map(m => m.count);
  const freqTotal = freqCounts.reduce((s, c) => s + c, 0);
  const freqMedia = freqTotal / 12;
  const mesesAtivos = freqCounts.filter(c => c > 0).length;
  const maxCount = Math.max(0, ...freqCounts);
  const picoIdx = maxCount > 0 ? freqCounts.indexOf(maxCount) : -1;
  const picoFreq = picoIdx >= 0 ? { mes: freqMensal[picoIdx].mes, count: maxCount } : null;
  let streak = 0, maxStreak = 0;
  for (const c of freqCounts) { if (c > 0) { streak++; if (streak > maxStreak) maxStreak = streak; } else streak = 0; }
  // Regressão linear simples sobre as 12 contagens → linha de tendência
  const nF = freqCounts.length;
  const sumX = (nF - 1) * nF / 2;
  const sumXX = freqCounts.reduce((s, _c, i) => s + i * i, 0);
  const sumXY = freqCounts.reduce((s, c, i) => s + i * c, 0);
  const denom = nF * sumXX - sumX * sumX;
  const slopeF = denom !== 0 ? (nF * sumXY - sumX * freqTotal) / denom : 0;
  const interceptF = (freqTotal - slopeF * sumX) / nF;
  const freqChart = freqMensal.map((m, i) => ({ ...m, trend: Math.max(0, interceptF + slopeF * i) }));
  const ratioAtivos = mesesAtivos / 12;
  const constancia: 'alta' | 'média' | 'baixa' = ratioAtivos >= 0.6 ? 'alta' : ratioAtivos >= 0.33 ? 'média' : 'baixa';
  const comportamento = freqTotal === 0
    ? 'Sem compras no período'
    : constancia === 'alta' ? 'Frequência regular'
    : constancia === 'média' ? 'Frequência sazonal'
    : 'Frequência irregular';
  const freqStats: ClienteAnalytics['freqStats'] = {
    media: freqMedia, total: freqTotal, mesesAtivos, pico: picoFreq,
    maxConsecutivos: maxStreak, slope: slopeF, constancia, comportamento, chart: freqChart,
    cicloDias: intervaloMedio != null ? Math.round(intervaloMedio) : null,
    historicoInsuficiente: distintas.length < 2,
  };

  // Tendência: últimos 3 meses vs 3 anteriores
  const ult3 = serieMensal.slice(9).reduce((s, m) => s + m.valor, 0);
  const ant3 = serieMensal.slice(6, 9).reduce((s, m) => s + m.valor, 0);
  const tendencia = ant3 > 0 ? ((ult3 - ant3) / ant3) * 100 : null;

  // Produtos (do JSON dados_tabela)
  const qtdPorProduto = new Map<string, number>();
  const valorPorProduto = new Map<string, number>();
  const pedidosComProduto = new Map<string, number>();
  for (const p of pedidos) {
    const itens = parseDadosTabela(p.dados_tabela).itens;
    const vistos = new Set<string>();
    for (const it of itens) {
      const nome = (it.produto ?? '').trim();
      if (!nome) continue;
      qtdPorProduto.set(nome, (qtdPorProduto.get(nome) ?? 0) + (it.qtd ?? 0));
      valorPorProduto.set(nome, (valorPorProduto.get(nome) ?? 0) + (it.valor_total ?? 0));
      if (!vistos.has(nome)) { vistos.add(nome); pedidosComProduto.set(nome, (pedidosComProduto.get(nome) ?? 0) + 1); }
    }
  }
  // Produto Mais Comprado → por QUANTIDADE (desempate por valor total)
  let topProduto: ClienteAnalytics['topProduto'] = null;
  if (qtdPorProduto.size > 0) {
    const [nome, qtd] = [...qtdPorProduto.entries()].sort((a, b) =>
      b[1] - a[1] || (valorPorProduto.get(b[0]) ?? 0) - (valorPorProduto.get(a[0]) ?? 0)
    )[0];
    topProduto = {
      nome, qtd,
      valor: valorPorProduto.get(nome) ?? 0,
      pctPedidos: totalPedidos > 0 ? Math.round(((pedidosComProduto.get(nome) ?? 0) / totalPedidos) * 100) : 0,
    };
  }
  // Mix de Produtos → por VALOR (desempate por quantidade)
  const mixArr = [...valorPorProduto.entries()].map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || (qtdPorProduto.get(b.name) ?? 0) - (qtdPorProduto.get(a.name) ?? 0));
  const mixTop = mixArr.slice(0, 5);
  const resto = mixArr.slice(5).reduce((s, x) => s + x.value, 0);
  if (resto > 0) mixTop.push({ name: 'Outros', value: resto });

  const recentes = [...pedidos]
    .sort((a, b) => (b.data_emissao ?? '').localeCompare(a.data_emissao ?? ''))
    .slice(0, 6);

  return {
    totalPedidos, receita, ticketMedio, ultimoPedido, intervaloMedio, proximaCompra,
    diasAtraso, diasDesdeUltimo, movimentacao, serieMensal, freqMensal, freqStats, topProduto, mixProdutos: mixTop, recentes, tendencia,
  };
}

// Metadados visuais da classificação de movimentação do cliente
export type Movimentacao = ClienteAnalytics['movimentacao'];
export const MOV_META: Record<ClienteAnalytics['movimentacao'], { label: string; chip: string; dot: string }> = {
  ativo:         { label: 'Ativo',         chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  atencao:       { label: 'Atenção',       chip: 'bg-amber-50 text-amber-700',     dot: 'bg-amber-500' },
  atrasado:      { label: 'Atrasado',      chip: 'bg-red-50 text-red-600',         dot: 'bg-red-500' },
  dormente:      { label: 'Dormente',      chip: 'bg-gray-800 text-white',         dot: 'bg-gray-300' },
  sem_historico: { label: 'Sem histórico', chip: 'bg-gray-100 text-gray-500',      dot: 'bg-gray-300' },
};

// ─── Micro-componentes ────────────────────────────────
// Movimentação a partir do resumo da carteira (dias desde o último pedido) — mesma
// régua do mini-dashboard (Ativo ≤20 · Atenção ≤30 · Atrasado ≤60 · Dormente >60).
export function movimentacaoCliente(c: ClienteCarteira, today: Date): ClienteAnalytics['movimentacao'] {
  if (c.total_pedidos === 0 || !c.ultimo_pedido) return 'sem_historico';
  const d = parseISO(c.ultimo_pedido);
  if (!d) return 'sem_historico';
  const dias = Math.floor((today.getTime() - d.getTime()) / DAY);
  if (dias <= 20) return 'ativo';
  if (dias <= 30) return 'atencao';
  if (dias <= 60) return 'atrasado';
  return 'dormente';
}

function ClienteAvatar({ nome, semNome, size = 'md' }: { nome: string; semNome: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'w-14 h-14 text-base rounded-2xl' : size === 'md' ? 'w-10 h-10 text-xs rounded-xl' : 'w-8 h-8 text-[10px] rounded-lg';
  const icon = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';
  return (
    <div className={cn('bg-[hsl(142,93%,8%)] text-white flex items-center justify-center flex-shrink-0 font-bold', dim)}>
      {semNome ? <Building2 className={icon} /> : iniciais(nome)}
    </div>
  );
}

function ContatoRow({ tipo, valor }: { tipo: 'email' | 'tel'; valor: string }) {
  const [copied, setCopied] = useState(false);
  const Icon = tipo === 'email' ? Mail : Phone;
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard indisponível */ }
  }
  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 min-w-0">
      <Icon className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
      <span className="truncate">{valor}</span>
      <button type="button" onClick={copiar} title={copied ? 'Copiado!' : 'Copiar'} aria-label="Copiar"
        className="flex-shrink-0 p-0.5 rounded text-gray-300 hover:text-gray-600 transition-colors">
        {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// StatTile usa o MetricCard compartilhado (variante grid) — mesma linguagem do sistema.
function StatTile(props: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: string }) {
  return <MetricCard grid {...props} />;
}

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

function PanelCard({ title, icon: Icon, children, badge, subtitle, badgeTone }: {
  title: string; icon?: React.ElementType; children: React.ReactNode; badge?: string; subtitle?: string; badgeTone?: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm min-w-0 overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-400" />}
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {badge && <span className={`text-[10px] px-2 py-0.5 rounded-full ${badgeTone ?? 'text-gray-400 bg-gray-100'}`}>{badge}</span>}
        </div>
        {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4 pt-3 min-w-0">{children}</div>
    </div>
  );
}

// ─── Frequência de Compra (12 meses) — gráfico premium ────
function FreqStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 px-2.5 py-2 text-center min-w-0">
      <p className={`text-lg font-bold tabular-nums leading-none ${tone ?? 'text-gray-900'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-1 truncate">{sub ? `${label} · ${sub}` : label}</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FreqTooltip({ active, payload, label, media }: any) {
  if (!active || !payload?.length) return null;
  const count = payload.find((p: { dataKey?: string }) => p.dataKey === 'count')?.value ?? 0;
  const diff = count - media;
  const rel = Math.abs(diff) < 0.25 ? 'na média mensal' : diff > 0 ? `+${diff.toFixed(1)} acima da média` : `${diff.toFixed(1)} abaixo da média`;
  const relColor = Math.abs(diff) < 0.25 ? 'text-gray-400' : diff > 0 ? 'text-emerald-600' : 'text-gray-400';
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-lg px-3 py-2">
      <p className="text-xs font-semibold text-gray-900">{label}</p>
      <p className="text-xs text-gray-600 tabular-nums">{count} compra{count === 1 ? '' : 's'}</p>
      <p className={`text-[11px] tabular-nums ${relColor}`}>{rel}</p>
    </div>
  );
}

function FrequenciaCompra({ stats, reduce }: { stats: ClienteAnalytics['freqStats']; reduce: boolean }) {
  const { media, total, mesesAtivos, pico, constancia, comportamento, chart, cicloDias, historicoInsuficiente } = stats;
  const maxCount = pico?.count ?? 0;
  const cor = constancia === 'alta'
    ? { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
    : constancia === 'média'
    ? { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
    : { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400' };

  if (total === 0) {
    return (
      <PanelCard title="Frequência de Compra" icon={Clock} badge="12 meses">
        <p className="text-sm text-gray-400 py-10 text-center">Nenhuma compra registrada nos últimos 12 meses</p>
      </PanelCard>
    );
  }

  return (
    <PanelCard title="Frequência de Compra" icon={Clock} badge="12 meses">
      <div className="space-y-3">
        {/* Mini-resumo */}
        <div className="grid grid-cols-3 gap-2">
          <FreqStat label="Média/mês" value={media.toFixed(1)} />
          <FreqStat label="Pico" value={String(maxCount)} sub={pico?.mes} tone="text-[hsl(142,93%,8%)]" />
          <FreqStat label="Meses ativos" value={`${mesesAtivos}/12`} />
        </div>

        {/* Frequência real (histórica) vs prazo padrão */}
        <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-3 py-1.5 text-[11px]">
          <span className="text-gray-500">Frequência real: <span className="font-semibold text-gray-800">{historicoInsuficiente ? 'histórico insuficiente' : `a cada ~${cicloDias} dias`}</span></span>
          <span className="text-gray-400">Prazo padrão <span className="font-semibold text-gray-600">30d</span></span>
        </div>

        {/* Gráfico */}
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chart} margin={{ top: 12, right: 6, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="freqBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3ac47d" />
                <stop offset="100%" stopColor="#2eaf69" stopOpacity={0.55} />
              </linearGradient>
              <linearGradient id="freqBarHi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#12833f" />
                <stop offset="100%" stopColor={CONCREM} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="mes" interval={0} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} width={28} domain={[0, 'dataMax + 1']} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(46,175,105,0.06)' }} content={<FreqTooltip media={media} />} />
            <ReferenceLine y={media} stroke="#9ca3af" strokeDasharray="4 4" strokeWidth={1} ifOverflow="extendDomain" />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={34} background={{ fill: '#f3f4f6', radius: 6 }} isAnimationActive={!reduce} animationDuration={800}>
              {chart.map((m, i) => (
                <Cell key={i} fill={m.count === maxCount && m.count > 0 ? 'url(#freqBarHi)' : 'url(#freqBar)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={1.75} dot={false} activeDot={false} opacity={0.75} isAnimationActive={!reduce} animationDuration={800} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legenda mínima */}
        <div className="flex items-center justify-end gap-3 text-[9px] text-gray-400 -mt-1.5 pr-1">
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-gray-400" />média</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t-2 border-amber-400" />tendência</span>
        </div>

        {/* Insight */}
        <div className={`rounded-xl px-3 py-2 ${cor.bg}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${cor.dot}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wide ${cor.text}`}>{comportamento}</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-snug">
            Maior recorrência em <span className="font-medium text-gray-700">{pico?.mes}</span> ({maxCount} compra{maxCount === 1 ? '' : 's'}). O cliente comprou em <span className="font-medium text-gray-700">{mesesAtivos}</span> dos últimos 12 meses.
          </p>
        </div>
      </div>
    </PanelCard>
  );
}

// ─── Painel de inteligência do cliente ────────────────
export function ClienteIntel({ cliente, onBack }: { cliente: ClienteCarteira; onBack: () => void }) {
  const today = useMemo(() => new Date(), []);
  const reduce = useReducedMotion();
  const [contatosAbertos, setContatosAbertos] = useState(false);
  // Recolhe os contatos ao trocar de cliente
  useEffect(() => { setContatosAbertos(false); }, [cliente.cliente_cnpj]);
  const { nome, razao, semNome } = nomeCliente(cliente);
  const { data: pedidos = [], isLoading } = useClientePedidos(cliente.cliente_cnpj);
  const a = useMemo(() => computeAnalytics(pedidos, today), [pedidos, today]);

  const emails = parseContatos(cliente.cliente_email);
  const telefones = parseContatos(cliente.cliente_telefone);
  const local = cliente.cliente_cidade ? `${cliente.cliente_cidade}/${cliente.cliente_uf}` : null;

  const atrasado = a.movimentacao === 'atrasado' || a.movimentacao === 'dormente';

  // ── Insights (regras sobre dados reais) ──
  const insights = useMemo(() => {
    const list: { tone: InsightTone; title: string; text: string }[] = [];
    if (a.totalPedidos === 0) {
      list.push({ tone: 'info', title: 'Sem histórico de compras', text: 'Este cliente ainda não possui pedidos registrados para o seu acesso.' });
      return list;
    }
    const ultimoStr = a.ultimoPedido ? formatDate(a.ultimoPedido.toISOString().slice(0, 10)) : '—';
    const proxStr = a.proximaCompra ? formatDate(a.proximaCompra.toISOString().slice(0, 10)) : '—';
    const cicloTxt = a.freqStats.cicloDias
      ? ` Frequência histórica: a cada ~${a.freqStats.cicloDias} dias — costumava comprar antes do prazo padrão.`
      : '';
    if (a.movimentacao === 'dormente') {
      list.push({ tone: 'risk', title: 'Cliente dormente',
        text: `Ultrapassou o prazo padrão de recompra de 30 dias. Última compra ${ultimoStr}, esperada ${proxStr} — atraso de ${a.diasAtraso} dia(s). Recomendação: entrar em contato para reativação.${cicloTxt}` });
    } else if (a.movimentacao === 'atrasado') {
      list.push({ tone: 'risk', title: 'Compra atrasada',
        text: `Passou dos 30 dias sem comprar (esperada ${proxStr}, atraso de ${a.diasAtraso} dia(s)). Vale um contato de reativação.${cicloTxt}` });
    } else if (a.movimentacao === 'atencao') {
      list.push({ tone: 'opp', title: 'Próximo do prazo',
        text: `Faltam ${-a.diasAtraso} dia(s) para o prazo padrão de recompra (${proxStr}). Bom momento para um follow-up.` });
    } else if (a.movimentacao === 'ativo') {
      list.push({ tone: 'good', title: 'Cliente ativo',
        text: `Comprou há ${a.diasDesdeUltimo} dia(s), dentro do prazo padrão de 30 dias.` });
    }
    if (a.tendencia !== null) {
      list.push(a.tendencia >= 0
        ? { tone: 'good', title: 'Volume em crescimento', text: `Compras cresceram ${a.tendencia.toFixed(0)}% no último trimestre vs o anterior.` }
        : { tone: 'risk', title: 'Volume em queda', text: `Compras caíram ${Math.abs(a.tendencia).toFixed(0)}% no último trimestre vs o anterior.` });
    }
    const topValor = a.mixProdutos.find(m => m.name !== 'Outros') ?? null;
    if (a.topProduto && topValor) {
      if (a.topProduto.nome === topValor.name) {
        list.push({ tone: 'good', title: 'Produto-chave',
          text: `Produto favorito por quantidade: "${a.topProduto.nome}", com ${a.topProduto.qtd.toLocaleString('pt-BR')} unidades. Lidera tanto em quantidade quanto em faturamento (${fmtCompact(topValor.value)}).` });
      } else {
        list.push({ tone: 'opp', title: 'Quantidade × faturamento',
          text: `O mais comprado em unidades é "${a.topProduto.nome}" (${a.topProduto.qtd.toLocaleString('pt-BR')} un.), enquanto o de maior participação no faturamento é "${topValor.name}" (${fmtCompact(topValor.value)}).` });
      }
    } else if (a.mixProdutos.length >= 4) {
      list.push({ tone: 'good', title: 'Mix diversificado', text: `Cliente compra ${a.mixProdutos.length}+ linhas de produto — relacionamento saudável.` });
    }
    if (a.totalPedidos === 1) {
      list.push({ tone: 'opp', title: 'Primeira compra', text: 'Cliente com apenas 1 pedido — acompanhar de perto para garantir a recompra.' });
    }
    return list.slice(0, 4);
  }, [a]);

  return (
    <motion.div
      key={cliente.cliente_cnpj}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      {/* ── Cabeçalho do cliente ── */}
      <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm p-4 lg:p-5">
        <div className="flex items-start gap-3 lg:gap-4">
          <button type="button" onClick={onBack} aria-label="Voltar"
            className="lg:hidden flex-shrink-0 p-1.5 -ml-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          {/* Avatar: menor no mobile, grande no desktop */}
          <div className="hidden lg:block"><ClienteAvatar nome={nome} semNome={semNome} size="lg" /></div>
          <div className="lg:hidden"><ClienteAvatar nome={nome} semNome={semNome} size="md" /></div>
          <div className="flex-1 min-w-0">
            {semNome
              ? <h2 className="text-base lg:text-lg italic text-gray-400 leading-tight">Cliente sem nome</h2>
              : <h2 className="text-base lg:text-lg font-bold text-gray-900 leading-tight line-clamp-2">{nome}</h2>}
            {razao && <p className="text-xs lg:text-sm text-gray-400 mt-0.5 truncate">{razao}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 lg:mt-2">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <Hash className="w-3 h-3 text-gray-400" /><span className="font-mono">{fmtCnpj(cliente.cliente_cnpj)}</span>
              </span>
              {local && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3 text-gray-400" />{local}
                </span>
              )}
              {!isLoading && (
                <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold', MOV_META[a.movimentacao].chip)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', MOV_META[a.movimentacao].dot)} />
                  {MOV_META[a.movimentacao].label}
                </span>
              )}
            </div>

            {(telefones.length > 0 || emails.length > 0) && (
              <>
                {/* Contatos: sempre visíveis no desktop; recolhidos no mobile */}
                <div className={cn(
                  'flex-wrap gap-x-5 gap-y-1.5 mt-3',
                  contatosAbertos ? 'flex' : 'hidden lg:flex',
                )}>
                  {telefones.slice(0, 2).map((t, i) => <ContatoRow key={`t${i}`} tipo="tel" valor={t} />)}
                  {emails.slice(0, 2).map((e, i) => <ContatoRow key={`e${i}`} tipo="email" valor={e} />)}
                </div>
                <button
                  type="button"
                  onClick={() => setContatosAbertos(v => !v)}
                  className="lg:hidden mt-2 text-[11px] font-medium text-[hsl(142,93%,8%)] hover:underline"
                >
                  {contatosAbertos ? 'Ocultar contatos' : `Ver contatos (${telefones.length + emails.length})`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border border-gray-200/70 p-4 animate-pulse">
              <div className="h-2.5 bg-gray-100 rounded w-2/3" />
              <div className="h-5 bg-gray-100 rounded w-1/2 mt-3" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ── KPIs do cliente ── */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile icon={DollarSign} label="Valor total" value={fmtVolume(a.receita)} tone="text-emerald-700"
              sub={a.receita > 0 ? formatCurrency(a.receita) : 'sem valor registrado'} />
            <StatTile icon={ShoppingCart} label="Pedidos" value={String(a.totalPedidos)}
              sub={a.intervaloMedio ? `a cada ~${Math.round(a.intervaloMedio)} dias` : 'frequência indisponível'} />
            <StatTile icon={Receipt} label="Média de pedido" value={fmtVolume(a.ticketMedio)} tone="text-blue-700"
              sub={a.ultimoPedido ? `último: ${formatDate(a.ultimoPedido.toISOString().slice(0, 10))}` : undefined} />
            {/* Próxima compra — prazo padrão fixo de 30 dias */}
            <div className={cn(
              'rounded-2xl border shadow-sm p-4 min-w-0 overflow-hidden',
              atrasado ? 'bg-red-50/60 border-red-200' : a.movimentacao === 'atencao' ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-gray-200/70',
            )}>
              <div className={cn('flex items-center gap-2', atrasado ? 'text-red-500' : a.movimentacao === 'atencao' ? 'text-amber-600' : 'text-gray-400')}>
                <CalendarClock className="w-3.5 h-3.5" />
                <p className="text-[10px] font-semibold uppercase tracking-wider">Próxima compra</p>
              </div>
              <p className={cn('text-lg font-bold mt-1.5 tabular-nums leading-tight', atrasado ? 'text-red-600' : 'text-gray-900')}>
                {a.proximaCompra ? formatDate(a.proximaCompra.toISOString().slice(0, 10)) : '—'}
              </p>
              <p className={cn('text-[11px] mt-0.5 font-medium', atrasado ? 'text-red-500' : a.movimentacao === 'atencao' ? 'text-amber-600' : 'text-gray-400')}>
                {a.movimentacao === 'sem_historico' ? 'sem histórico de compras'
                  : a.movimentacao === 'dormente' ? `cliente dormente · há ${a.diasAtraso} dia(s)`
                  : a.movimentacao === 'atrasado' ? `atrasada há ${a.diasAtraso} dia(s)`
                  : a.movimentacao === 'atencao' ? `próximo do prazo · faltam ${-a.diasAtraso} dia(s)`
                  : 'dentro do prazo'}
              </p>
              {a.ultimoPedido && (
                <div className="mt-2 pt-2 border-t border-gray-200/60 space-y-0.5">
                  <p className="text-[10px] text-gray-400">Prazo padrão: <span className="font-semibold text-gray-600">30 dias</span></p>
                  <p className="text-[10px] text-gray-400">Último pedido: <span className="font-semibold text-gray-600 tabular-nums">{formatDate(a.ultimoPedido.toISOString().slice(0, 10))}</span></p>
                </div>
              )}
            </div>
          </div>

          {/* ── Insights ── */}
          {insights.length > 0 && (
            <PanelCard title="Insights" icon={Sparkles} badge="automático">
              <div className="grid sm:grid-cols-2 gap-2.5">
                {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
              </div>
            </PanelCard>
          )}

          {/* ── Evolução de compras + Mix de produtos ── */}
          <div className="grid xl:grid-cols-3 gap-3">
            <div className="xl:col-span-2 min-w-0">
              <PanelCard title="Evolução de Compras" badge="12 meses">
                {a.serieMensal.every(m => m.valor === 0) ? (
                  <p className="text-sm text-gray-400 py-10 text-center">Sem valores registrados no período</p>
                ) : (
                  <ResponsiveContainer width="100%" height={190}>
                    <AreaChart data={a.serieMensal} margin={{ top: 6, right: 6, bottom: 0, left: -16 }}>
                      <defs>
                        <linearGradient id="areaCliente" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CONCREM} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={CONCREM} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Compras']}
                        contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb' }} />
                      <Area type="monotone" dataKey="valor" stroke={CONCREM} strokeWidth={2.5} fill="url(#areaCliente)" dot={{ r: 2.5, fill: CONCREM }} activeDot={{ r: 4.5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </PanelCard>
            </div>

            <PanelCard title="Mix de Produtos" icon={DollarSign} badge="por valor" badgeTone="text-blue-700 bg-blue-50" subtitle="Baseado no valor total comprado (R$)">
              {a.mixProdutos.length === 0 ? (
                <p className="text-sm text-gray-400 py-10 text-center">Sem histórico suficiente para calcular o mix por valor.</p>
              ) : (() => {
                const mixTotal = a.mixProdutos.reduce((s, d) => s + d.value, 0) || 1;
                return (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={a.mixProdutos} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="none">
                        {a.mixProdutos.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [`${formatCurrency(Number(v))} · ${Math.round(Number(v) / mixTotal * 100)}% do faturamento`, n as string]}
                        contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e5e7eb', maxWidth: 260 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 mt-1">
                    {a.mixProdutos.slice(0, 4).map((d, i) => (
                      <div key={d.name} className="flex items-center gap-1.5 text-[11px] text-gray-500 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="truncate flex-1">{d.name}</span>
                        <span className="font-semibold text-gray-700 tabular-nums flex-shrink-0">{fmtCompact(d.value)}</span>
                        <span className="text-gray-400 tabular-nums flex-shrink-0 w-9 text-right">{Math.round(d.value / mixTotal * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2.5 pt-2 border-t border-gray-100 leading-snug">
                    Calculado pelo <span className="font-medium text-gray-500">valor total comprado</span> em cada produto — participação no faturamento do cliente.
                  </p>
                </>
                );
              })()}
            </PanelCard>
          </div>

          {/* ── Produto destaque + Frequência de compra ── */}
          <div className="grid xl:grid-cols-3 gap-3">
            <PanelCard title="Produto Mais Comprado" icon={Package} badge="por quantidade" badgeTone="text-emerald-700 bg-emerald-50" subtitle="Baseado na quantidade total de unidades compradas">
              {a.topProduto ? (
                <div>
                  <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-3">{a.topProduto.nome}</p>
                  <div className="flex items-end gap-5 mt-3">
                    <div>
                      <p className="text-2xl font-bold text-[hsl(142,93%,8%)] tabular-nums leading-none">{a.topProduto.qtd.toLocaleString('pt-BR')}</p>
                      <p className="text-[10px] text-gray-400 mt-1">unidades compradas</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-gray-900 tabular-nums leading-none">{a.topProduto.pctPedidos}%</p>
                      <p className="text-[10px] text-gray-400 mt-1">dos pedidos</p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-3">
                    <div className="h-full rounded-full bg-[hsl(142,93%,8%)] transition-all duration-700" style={{ width: `${a.topProduto.pctPedidos}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2.5 pt-2 border-t border-gray-100 leading-snug">
                    Definido pela <span className="font-medium text-gray-500">maior quantidade de unidades</span> compradas — independe do valor em R$.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-400 py-6 text-center">Sem histórico suficiente para calcular o produto favorito.</p>
              )}
            </PanelCard>

            <div className="xl:col-span-2 min-w-0">
              <FrequenciaCompra stats={a.freqStats} reduce={!!reduce} />
            </div>
          </div>

          {/* ── Atividade recente ── */}
          <PanelCard title="Atividade Recente" icon={Calendar}>
            {a.recentes.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Nenhum pedido registrado</p>
            ) : (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
                <div className="space-y-3.5">
                  {a.recentes.map(p => (
                    <div key={p.numero_pedido} className="relative">
                      <span className="absolute -left-5 top-1 w-3.5 h-3.5 rounded-full border-2 border-white bg-[#2eaf69]" />
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-mono text-gray-400">#{p.numero_pedido}</span>
                        <span className="text-[11px] text-gray-400">{p.data_emissao ? formatDate(p.data_emissao.slice(0, 10)) : '—'}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 tabular-nums mt-0.5">
                        {p.total_pedido_venda > 0 ? formatCurrency(p.total_pedido_venda) : <span className="text-gray-300 font-normal">sem valor</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </PanelCard>
        </>
      )}
    </motion.div>
  );
}

// ─── Item da lista (coluna esquerda) ──────────────────
function ClienteListItem({ cliente, active, onSelect }: {
  cliente: ClienteCarteira; active: boolean; onSelect: () => void;
}) {
  const { nome, semNome } = nomeCliente(cliente);
  const mov = movimentacaoCliente(cliente, new Date());
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
        active ? 'bg-[hsl(142,93%,8%)]/8 ring-1 ring-[hsl(142,93%,8%)]/25' : 'hover:bg-gray-50',
      )}
    >
      <ClienteAvatar nome={nome} semNome={semNome} size="sm" />
      <div className="flex-1 min-w-0">
        {semNome
          ? <p className="text-[13px] italic text-gray-400 truncate">Cliente sem nome</p>
          : <p className={cn('text-[13px] font-medium truncate', active ? 'text-[hsl(142,93%,8%)]' : 'text-gray-800')}>{nome}</p>}
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <span className="text-[11px] text-gray-400 truncate">
            {cliente.cliente_cidade ? `${cliente.cliente_cidade}/${cliente.cliente_uf}` : fmtCnpj(cliente.cliente_cnpj)}
          </span>
          {mov !== 'ativo' && mov !== 'sem_historico' && (
            <span className={cn('flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none', MOV_META[mov].chip)}>
              {MOV_META[mov].label}
            </span>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-bold text-gray-800 tabular-nums">{fmtVolume(cliente.total_comprado)}</p>
        <p className="text-[10px] text-gray-400 tabular-nums">{cliente.total_pedidos} ped.</p>
      </div>
    </button>
  );
}

// ─── Página ───────────────────────────────────────────
type SortKey = 'nome' | 'pedidos' | 'volume';

const SORT_OPTIONS = [
  { value: 'nome',    label: 'Nome A–Z' },
  { value: 'pedidos', label: 'Mais pedidos' },
  { value: 'volume',  label: 'Maior volume' },
];

export default function ClientesPage() {
  const [search, setSearch]     = useState('');
  const [ufFilter, setUfFilter] = useState('');
  const [sort, setSort]         = useState<SortKey>('nome');
  const [selected, setSelected] = useState<ClienteCarteira | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const view: ClienteView = searchParams.get('view') === 'grupos' ? 'grupos' : 'clientes';
  function setView(v: ClienteView) {
    const p = new URLSearchParams(searchParams);
    if (v === 'grupos') p.set('view', 'grupos'); else p.delete('view');
    p.delete('grupo');
    p.delete('cnpj');
    setSearchParams(p);   // push — permite voltar entre Clientes e Grupos
  }

  const { data: clientes = [], isLoading } = useCarteira();

  // Deep-link vindo de uma notificação de recompra: /clientes?cnpj=... abre o cliente.
  const cnpjParam = searchParams.get('cnpj');
  useEffect(() => {
    if (!cnpjParam || clientes.length === 0) return;
    const alvo = cnpjParam.replace(/\D/g, '');
    const found = clientes.find(c => (c.cliente_cnpj ?? '').replace(/\D/g, '') === alvo);
    if (found) setSelected(found);
  }, [cnpjParam, clientes]);

  const ufsUnicas = useMemo(
    () => [...new Set(clientes.map(c => c.cliente_uf).filter(Boolean))].sort(),
    [clientes]
  );

  const filtered = useMemo(() => {
    let list = [...clientes];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.cliente_nome ?? '').toLowerCase().includes(q) ||
        (c.cliente_fantasia ?? '').toLowerCase().includes(q) ||
        (c.cliente_cnpj ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))
      );
    }
    if (ufFilter) list = list.filter(c => c.cliente_uf === ufFilter);
    if (sort === 'pedidos') list.sort((a, b) => b.total_pedidos - a.total_pedidos);
    else if (sort === 'volume') list.sort((a, b) => b.total_comprado - a.total_comprado);
    return list;
  }, [clientes, search, ufFilter, sort]);

  // Seleciona o primeiro cliente automaticamente no desktop
  useEffect(() => {
    if (!selected && filtered.length > 0 && window.innerWidth >= 1024) {
      setSelected(filtered[0]);
    }
  }, [filtered, selected]);

  const totalVolume  = clientes.reduce((s, c) => s + c.total_comprado, 0);
  const totalPedidos = clientes.reduce((s, c) => s + c.total_pedidos, 0);
  const hasFilters = !!(search || ufFilter);

  return (
    <PageContainer space="none">
      <div className="mb-3">
        <ClienteViewToggle view={view} onChange={setView} />
      </div>

      {view === 'grupos' ? (
        <ClientGroupsView />
      ) : (
      <div className="flex gap-4 items-start">

        {/* ── Coluna esquerda: lista de clientes ── */}
        <div className={cn(
          'w-full lg:w-[320px] xl:w-[360px] lg:flex-shrink-0',
          'lg:sticky lg:top-4',
          selected && 'hidden lg:block',
        )}>
          <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm flex flex-col lg:max-h-[calc(100dvh-6rem)]">
            {/* Header */}
            <div className="p-4 pb-3 border-b border-gray-100">
              <h1 className="text-base font-bold text-gray-900 tracking-tight">Carteira de Clientes</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {clientes.length.toLocaleString('pt-BR')} clientes · {totalPedidos.toLocaleString('pt-BR')} pedidos · {fmtCompact(totalVolume)}
              </p>
              <div className="mt-3 space-y-2">
                <SearchInput value={search} onChange={setSearch} placeholder="Buscar cliente ou CNPJ..." />
                <div className="grid grid-cols-2 gap-2">
                  <Select size="sm" value={sort} onChange={v => setSort(v as SortKey)} options={SORT_OPTIONS} className="w-full" />
                  <Select size="sm" value={ufFilter} onChange={setUfFilter} placeholder="UF" className="w-full"
                    options={[{ value: '', label: 'Todos' }, ...ufsUnicas.map(uf => ({ value: uf, label: uf }))]} />
                </div>
                {hasFilters && (
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-gray-400">{filtered.length} resultado(s)</p>
                    <button onClick={() => { setSearch(''); setUfFilter(''); }}
                      className="text-[11px] font-medium text-[hsl(142,93%,8%)] hover:underline">
                      Limpar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Lista rolável */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
              {isLoading ? (
                <div className="space-y-2 p-1">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-2.5 bg-gray-100 rounded w-3/4" />
                        <div className="h-2 bg-gray-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center">
                  <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Nenhum cliente encontrado</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filtered.map(c => (
                    <ClienteListItem
                      key={c.cliente_cnpj}
                      cliente={c}
                      active={selected?.cliente_cnpj === c.cliente_cnpj}
                      onSelect={() => setSelected(c)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Painel direito: inteligência do cliente ── */}
        <div className={cn('flex-1 min-w-0', !selected && 'hidden lg:block')}>
          {selected ? (
            <ClienteIntel cliente={selected} onBack={() => setSelected(null)} />
          ) : (
            <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm py-24 text-center">
              <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">Selecione um cliente</p>
              <p className="text-xs text-gray-400 mt-1">Escolha um cliente na lista para ver o painel completo</p>
            </div>
          )}
        </div>
      </div>
      )}
    </PageContainer>
  );
}
