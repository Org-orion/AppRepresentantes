import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { formatCurrencyK } from '@/utils/formatters';
import Select from '@/components/ui/Select';
import SearchInput from '@/components/ui/SearchInput';
import Pagination from '@/components/ui/Pagination';
import PageContainer from '@/components/ui/PageContainer';
import DataError from '@/components/ui/DataError';
import MobileBottomSheet from '@/components/ui/MobileBottomSheet';
import {
  CheckCircle2, Unlock, Map as MapIcon, Wrench, Handshake, Factory, FileCheck2, Truck,
  PackageCheck, X, Check, SlidersHorizontal, LayoutList, SquareKanban, Activity,
  Package, AlertTriangle, Clock, FileText, Receipt, Download, MapPin,
  ChevronRight, Sparkles, History, ArrowRight, CalendarClock, Boxes,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAcompanhamento } from '@/hooks/useAcompanhamento';
import { useAuth } from '@/hooks/useAuth';
import { MetricCard as KpiCard, EntityCard, Badge, ProgressSteps, CardActionFooter, DocumentBadge, type ProgressStep } from '@/components/ui/cards';
import type { PedidoStatus, PedidoAnexo } from '@/types';
import type { PedidoStatusLog, PedidoAcompanhamento } from '@/services/acompanhamento';

const TZ = 'America/Sao_Paulo';
const DAY = 86_400_000;

// ─── Datas ───────────────────────────────────────────────
function fmtShort(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(d);
}
function fmtFull(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}
function diasEntre(iso: string | null | undefined, hoje: Date): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return Math.floor((hoje.getTime() - d.getTime()) / DAY);
}
function parseData(d?: string | null): Date | null {
  if (!d) return null;
  const s = d.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(d);
}

// ─── Pipeline (9 status) ─────────────────────────────────
const STEPS: { key: PedidoStatus; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'aprovado',   label: 'Aprovado',   icon: CheckCircle2, color: '#3b82f6' },
  { key: 'liberado',   label: 'Liberado',   icon: Unlock,       color: '#8b5cf6' },
  { key: 'mapeamento', label: 'Mapeamento', icon: MapIcon,      color: '#a855f7' },
  { key: 'ferragem',   label: 'Ferragem',   icon: Wrench,       color: '#f97316' },
  { key: 'comercial',  label: 'Comercial',  icon: Handshake,    color: '#6366f1' },
  { key: 'producao',   label: 'Produção',   icon: Factory,      color: '#f59e0b' },
  { key: 'faturado',   label: 'Faturado',   icon: FileCheck2,   color: '#14b8a6' },
  { key: 'entrega',    label: 'Entrega',    icon: Truck,        color: '#0ea5e9' },
  { key: 'finalizado', label: 'Finalizado', icon: PackageCheck, color: '#22c55e' },
];
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i])) as Record<PedidoStatus, number>;
const STEP_META = Object.fromEntries(STEPS.map((s, i) => [s.key, { ...s, index: i }])) as Record<PedidoStatus, { key: PedidoStatus; label: string; icon: React.ElementType; color: string; index: number }>;
const FATURADO_IDX = STEP_INDEX.faturado;

// Jornada resumida do card — 5 etapas rotuladas (mesmo padrão da Central de Pedidos).
// As 9 etapas do pipeline detalhado (drawer) são colapsadas nesses 5 marcos.
const CARD_STEPS: ProgressStep[] = [
  { key: 'aprovado', label: 'Aprovado', color: '#3b82f6', icon: CheckCircle2 },
  { key: 'producao', label: 'Produção', color: '#f59e0b', icon: Factory },
  { key: 'faturado', label: 'Faturado', color: '#14b8a6', icon: FileCheck2 },
  { key: 'entrega',  label: 'Em rota',  color: '#0ea5e9', icon: Truck },
  { key: 'entregue', label: 'Entregue', color: '#22c55e', icon: PackageCheck },
];
function cardStepIndex(status: PedidoStatus): number {
  const i = STEP_INDEX[status];
  if (i <= STEP_INDEX.liberado) return 0;   // aprovado, liberado
  if (i <= STEP_INDEX.producao) return 1;   // mapeamento, ferragem, comercial, produção
  if (i === STEP_INDEX.faturado) return 2;
  if (i === STEP_INDEX.entrega) return 3;
  return 4;                                  // finalizado
}

// ─── Documentos ──────────────────────────────────────────
function classifyAnexo(tipo: string): 'nf' | 'boleto' | 'outro' {
  const t = (tipo ?? '').toLowerCase();
  if (t.includes('boleto')) return 'boleto';
  if (t.includes('nota') || t.includes('nf') || t.includes('fiscal')) return 'nf';
  return 'outro';
}
function temNF(p: PedidoAcompanhamento) { return (p.anexos ?? []).some(a => classifyAnexo(a.tipo) === 'nf'); }
function temBoleto(p: PedidoAcompanhamento) { return (p.anexos ?? []).some(a => classifyAnexo(a.tipo) === 'boleto'); }
function faturadoOuAlem(p: PedidoAcompanhamento) { return STEP_INDEX[p.status] >= FATURADO_IDX; }
function docsPendentes(p: PedidoAcompanhamento) { return faturadoOuAlem(p) && (!temNF(p) || !temBoleto(p)); }

// ─── Derivações operacionais ─────────────────────────────
function diasNoStatus(p: PedidoAcompanhamento, hoje: Date): number {
  return diasEntre(p.status_updated_at ?? p.data_emissao, hoje);
}
function parado(p: PedidoAcompanhamento, hoje: Date): boolean {
  return p.status !== 'finalizado' && diasNoStatus(p, hoje) > 7;
}
function emAtraso(p: PedidoAcompanhamento, hoje: Date): boolean {
  if (p.status === 'finalizado') return false;
  const emb = parseData(p.previsao_embarque);
  if (emb && emb < hoje) return true;
  return p.status === 'entrega' && diasNoStatus(p, hoje) > 10;
}
function proximaEtapa(p: PedidoAcompanhamento): { key: PedidoStatus; label: string } | null {
  const i = STEP_INDEX[p.status];
  return i < STEPS.length - 1 ? STEPS[i + 1] : null;
}
function nomeCliente(p: PedidoAcompanhamento) { return p.cliente_fantasia?.trim() || p.cliente_nome; }

// ─── Badges ──────────────────────────────────────────────
function StatusPill({ status }: { status: PedidoStatus }) {
  const m = STEP_META[status];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${m.color}18`, color: m.color }}>
      <Icon className="w-2.5 h-2.5" />{m.label}
    </span>
  );
}
function DocBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border',
      ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200')}>
      {ok ? <Check className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}{label}
    </span>
  );
}
function DocBadges({ pedido }: { pedido: PedidoAcompanhamento }) {
  if (!faturadoOuAlem(pedido)) return null;
  return (
    <div className="flex items-center gap-1.5">
      <DocBadge ok={temNF(pedido)} label="NF" />
      <DocBadge ok={temBoleto(pedido)} label="Boleto" />
    </div>
  );
}

// ─── Card (Lista Inteligente) ────────────────────────────
function PedidoCard({ pedido, onOpen, index, hoje }: {
  pedido: PedidoAcompanhamento; onOpen: (p: PedidoAcompanhamento) => void; index: number; hoje: Date;
}) {
  const prox = proximaEtapa(pedido);
  const dias = diasNoStatus(pedido, hoje);
  const atraso = emAtraso(pedido, hoje);
  const estaParado = parado(pedido, hoje) && !atraso;
  const pend = docsPendentes(pedido);
  const temValor = pedido.total_pedido_venda > 0;

  return (
    <EntityCard
      layout
      index={index}
      onClick={() => onOpen(pedido)}
      accent={atraso ? '#ef4444' : estaParado ? '#f97316' : STEP_META[pedido.status].color}
    >
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-gray-400">#{pedido.numero_pedido}</span>
          <StatusPill status={pedido.status} />
          {atraso && <Badge tone="danger" icon={AlertTriangle}>Atraso</Badge>}
          {estaParado && <Badge tone="warning" icon={Clock}>Parado</Badge>}
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">Emissão {fmtShort(pedido.data_emissao)}</span>
        </div>

        <div className="flex items-start justify-between gap-2 mt-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-[15px] leading-snug line-clamp-2 group-hover:text-[hsl(142,93%,8%)] transition-colors">{nomeCliente(pedido)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">{pedido.cliente_cnpj}</p>
          </div>
          {temValor && <p className="font-bold text-base tabular-nums text-gray-900 flex-shrink-0">{formatCurrencyK(pedido.total_pedido_venda)}</p>}
        </div>

        {/* Próxima etapa + tempo no status */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px]">
          {prox ? (
            <span className="inline-flex items-center gap-1 text-gray-500">
              Próxima: <span className="font-semibold" style={{ color: STEP_META[prox.key].color }}>{prox.label}</span>
              <ArrowRight className="w-3 h-3 text-gray-300" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium"><Check className="w-3 h-3" />Concluído</span>
          )}
          <span className={cn('inline-flex items-center gap-1', estaParado || atraso ? 'text-orange-600 font-medium' : 'text-gray-400')}>
            <Clock className="w-3 h-3" />{dias === 0 ? 'hoje' : `${dias}d nesta etapa`}
          </span>
          {pedido.cliente_cidade && <span className="inline-flex items-center gap-1 text-gray-400"><MapPin className="w-3 h-3" />{pedido.cliente_cidade}/{pedido.cliente_uf}</span>}
        </div>

        {/* Previsão de embarque */}
        {pedido.previsao_embarque && (
          <div className="flex items-center gap-2 mt-2.5">
            <span className="text-[10px] text-amber-600 tabular-nums inline-flex items-center gap-1"><CalendarClock className="w-3 h-3" />Embarque {fmtShort(pedido.previsao_embarque)}</span>
          </div>
        )}
        {pend && <p className="text-[10px] text-red-600 font-medium mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Documento obrigatório pendente</p>}
      </div>

      {/* Jornada rotulada (mesmo padrão da Central de Pedidos) */}
      <div className="px-4 pb-3 pt-1">
        <ProgressSteps steps={CARD_STEPS} currentIndex={cardStepIndex(pedido.status)} />
      </div>

      {/* Rodapé de ações: documentos + botão principal */}
      <CardActionFooter
        left={<>
          <DocumentBadge kind="nf" ok={temNF(pedido)} />
          <DocumentBadge kind="boleto" ok={temBoleto(pedido)} />
        </>}
        right={
          <span className="inline-flex items-center gap-1 rounded-xl bg-[hsl(142,93%,8%)] text-white text-[11px] font-semibold px-3 py-1.5 group-hover:brightness-125 transition-all">
            Ver detalhes do pedido <ChevronRight className="w-3 h-3" />
          </span>
        }
      />
    </EntityCard>
  );
}

// ─── KPI ─────────────────────────────────────────────────
// KpiCard migrado para o design system compartilhado (MetricCard) — ver import no topo.

function QuickChip({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex flex-shrink-0 items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 border',
        active ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}>
      {label}
      {count !== undefined && count > 0 && <span className={cn('text-[9px] font-bold tabular-nums rounded-full px-1', active ? 'bg-white/25' : 'bg-gray-100 text-gray-500')}>{count}</span>}
    </button>
  );
}

// ─── Pipeline View ───────────────────────────────────────
function PipelineView({ pedidos, onOpen, hoje }: { pedidos: PedidoAcompanhamento[]; onOpen: (p: PedidoAcompanhamento) => void; hoje: Date }) {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <div className="flex gap-3 min-w-max items-start">
        {STEPS.map(st => {
          const col = pedidos.filter(p => p.status === st.key);
          const valor = col.reduce((s, p) => s + p.total_pedido_venda, 0);
          return (
            <div key={st.key} className="w-[250px] flex-shrink-0 rounded-2xl bg-gray-50/80 border border-gray-100 p-2">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />
                <span className="text-xs font-semibold text-gray-700">{st.label}</span>
                <span className="text-[10px] font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 tabular-nums">{col.length}</span>
                {valor > 0 && <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{formatCurrencyK(valor)}</span>}
              </div>
              <div className="space-y-2 mt-1 max-h-[68vh] overflow-y-auto scrollbar-thin">
                {col.length === 0 ? <p className="text-[11px] text-gray-300 text-center py-6">Vazio</p> : col.slice(0, 50).map((p, i) => (
                  <motion.div key={p.numero_pedido}
                    initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.15) }}
                    onClick={() => onOpen(p)}
                    className="rounded-xl bg-white border border-gray-200/70 shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[10px] text-gray-400">#{p.numero_pedido}</span>
                      {emAtraso(p, hoje) ? <AlertTriangle className="w-3 h-3 text-red-500" /> : parado(p, hoje) ? <Clock className="w-3 h-3 text-orange-500" /> : null}
                    </div>
                    <p className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-2 mt-1">{nomeCliente(p)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs font-bold text-gray-900 tabular-nums">{p.total_pedido_venda > 0 ? formatCurrencyK(p.total_pedido_venda) : '—'}</span>
                      {faturadoOuAlem(p) && <DocBadges pedido={p} />}
                    </div>
                  </motion.div>
                ))}
                {col.length > 50 && <p className="text-[10px] text-gray-400 text-center py-1">+{col.length - 50}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Timeline View (movimentações recentes) ──────────────
function TimelineView({ pedidos, onOpen }: { pedidos: PedidoAcompanhamento[]; onOpen: (p: PedidoAcompanhamento) => void }) {
  const reduce = useReducedMotion();
  // Junta todos os logs num fluxo cronológico, agrupado por dia
  const eventos = useMemo(() => {
    type Ev = { numero: string; cliente: string; status: PedidoStatus; statusDb: string; data: string; pedido: PedidoAcompanhamento };
    const evs: Ev[] = [];
    for (const p of pedidos) {
      if (p.logs.length > 0) {
        for (const log of p.logs) evs.push({ numero: p.numero_pedido, cliente: nomeCliente(p), status: log.status, statusDb: log.status_db, data: log.created_at, pedido: p });
      } else {
        evs.push({ numero: p.numero_pedido, cliente: nomeCliente(p), status: p.status, statusDb: p.status, data: p.data_emissao, pedido: p });
      }
    }
    evs.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
    // agrupa por dia
    const grupos = new Map<string, Ev[]>();
    for (const e of evs.slice(0, 120)) {
      const dia = (e.data ?? '').slice(0, 10);
      const arr = grupos.get(dia) ?? [];
      arr.push(e);
      grupos.set(dia, arr);
    }
    return [...grupos.entries()];
  }, [pedidos]);

  const hoje = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const rotuloDia = (d: string) => d === hoje ? 'Hoje' : d === ontem ? 'Ontem' : fmtShort(d);

  if (eventos.length === 0) return <p className="text-sm text-gray-400 text-center py-10">Sem movimentações recentes</p>;

  return (
    <div className="space-y-5 max-w-2xl">
      {eventos.map(([dia, evs]) => (
        <div key={dia}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2 sticky top-0 bg-gray-50/80 backdrop-blur py-1">{rotuloDia(dia)}</p>
          <div className="relative pl-6">
            <div className="absolute left-[9px] top-1 bottom-1 w-px bg-gray-100" />
            <div className="space-y-2.5">
              {evs.map((e, i) => {
                const m = STEP_META[e.status]; const Icon = m.icon;
                return (
                  <motion.button key={`${e.numero}-${i}`} type="button" onClick={() => onOpen(e.pedido)}
                    initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.2) }}
                    className="relative flex items-center gap-3 w-full text-left rounded-xl hover:bg-white p-2 -ml-2 transition-colors">
                    <span className="absolute -left-[19px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-gray-50" style={{ backgroundColor: m.color }}>
                      <Icon className="w-2.5 h-2.5 text-white" />
                    </span>
                    <div className="flex-1 min-w-0 ml-1">
                      <p className="text-xs text-gray-700"><span className="font-mono text-gray-400">#{e.numero}</span> <span className="font-medium">{e.cliente}</span></p>
                      <p className="text-[11px]" style={{ color: m.color }}>{e.statusDb.replace(/_/g, ' ')}</p>
                    </div>
                    <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">{fmtFull(e.data).split(' ')[1] ?? ''}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Drawer ──────────────────────────────────────────────
function DrawerSecao({ titulo, icon: Icon, children }: { titulo: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2"><Icon className="w-3.5 h-3.5" />{titulo}</p>
      {children}
    </div>
  );
}

function PedidoDrawer({ pedido, hoje, onClose }: { pedido: PedidoAcompanhamento; hoje: Date; onClose: () => void }) {
  const { user } = useAuth();
  // Representante puro (não admin, não operador) não vê data/hora nem o autor
  // ("por X") das atualizações de status — são dados internos do ERP.
  const isRep = !user?.usuario?.admin && !user?.usuario?.operador;
  const idx = STEP_INDEX[pedido.status];
  const prox = proximaEtapa(pedido);
  const anexos = pedido.anexos ?? [];

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  // Data por status (do histórico) para a timeline completa
  const dataPorStatus = useMemo(() => {
    const m: Partial<Record<PedidoStatus, PedidoStatusLog>> = {};
    for (const log of [...pedido.logs].reverse()) m[log.status] = log; // 1ª ocorrência cronológica
    return m;
  }, [pedido.logs]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="drawer-overlay absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="drawer-panel absolute right-0 top-0 h-full w-full sm:max-w-lg bg-white shadow-2xl flex flex-col">
        <div className="p-5 pb-4 border-b border-gray-100" style={{ borderTop: `3px solid ${STEP_META[pedido.status].color}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-gray-400">#{pedido.numero_pedido}</span>
                <StatusPill status={pedido.status} />
                {emAtraso(pedido, hoje) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Atraso</span>}
              </div>
              <h2 className="text-lg font-bold text-gray-900 leading-tight mt-1.5 line-clamp-2">{nomeCliente(pedido)}</h2>
              <p className="text-xs text-gray-400 mt-0.5 font-mono">{pedido.cliente_cnpj}</p>
            </div>
            <button onClick={onClose} aria-label="Fechar" className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-6">
          {/* Resumo */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Emissão</p><p className="text-sm font-bold text-gray-900 tabular-nums">{fmtShort(pedido.data_emissao)}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Valor</p><p className="text-sm font-bold text-gray-900 tabular-nums">{pedido.total_pedido_venda > 0 ? formatCurrencyK(pedido.total_pedido_venda) : '—'}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Próxima etapa</p><p className="text-sm font-bold tabular-nums" style={{ color: prox ? STEP_META[prox.key].color : '#22c55e' }}>{prox?.label ?? 'Concluído'}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Tempo na etapa</p><p className="text-sm font-bold text-gray-900 tabular-nums">{diasNoStatus(pedido, hoje)} dia(s)</p></div>
          </div>

          {/* Timeline completa */}
          <DrawerSecao titulo="Jornada do pedido" icon={Activity}>
            <div className="relative pl-5">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
              <div className="space-y-3">
                {STEPS.map((s, i) => {
                  const done = i < idx; const atual = i === idx;
                  const log = dataPorStatus[s.key];
                  return (
                    <div key={s.key} className="relative">
                      <span className="absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ backgroundColor: (done || atual) ? s.color : '#e5e7eb' }} />
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('text-xs', atual ? 'font-bold text-gray-900' : done ? 'font-medium text-gray-700' : 'text-gray-400')}>{s.label}{atual && ' · atual'}</p>
                        {log && !isRep && <span className="text-[10px] text-gray-400 tabular-nums">{fmtFull(log.created_at)}</span>}
                      </div>
                      {log?.observacao && <p className="text-[11px] text-gray-500">{log.observacao}</p>}
                      {log?.responsavel && !isRep && <p className="text-[10px] text-gray-400">por {log.responsavel}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </DrawerSecao>

          {/* Documentos */}
          <DrawerSecao titulo="Documentos" icon={FileCheck2}>
            {faturadoOuAlem(pedido) && (
              <div className="flex items-center gap-2 mb-2.5">
                <DocBadge ok={temNF(pedido)} label={temNF(pedido) ? 'NF anexada' : 'NF pendente'} />
                <DocBadge ok={temBoleto(pedido)} label={temBoleto(pedido) ? 'Boleto anexado' : 'Boleto pendente'} />
              </div>
            )}
            {anexos.length > 0 ? (
              <div className="space-y-1.5">
                {anexos.map((a: PedidoAnexo, i: number) => {
                  const cls = classifyAnexo(a.tipo);
                  const Icon = cls === 'nf' ? FileText : cls === 'boleto' ? Receipt : Download;
                  return (
                    <button key={i} type="button" onClick={() => window.open(a.arquivo_url, '_blank', 'noopener,noreferrer')}
                      className="flex items-center gap-2.5 w-full rounded-xl border border-gray-200 p-2.5 hover:bg-gray-50 transition-colors text-left">
                      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', cls === 'nf' ? 'bg-purple-50 text-purple-500' : cls === 'boleto' ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-500')}><Icon className="w-4 h-4" /></span>
                      <span className="min-w-0 flex-1"><span className="text-xs font-medium text-gray-800 block truncate">{a.arquivo_nome || (cls === 'nf' ? 'Nota Fiscal' : cls === 'boleto' ? 'Boleto' : a.tipo)}</span><span className="text-[10px] text-gray-400">clique para baixar</span></span>
                      <Download className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : <p className="text-xs text-gray-400">{faturadoOuAlem(pedido) ? 'Nenhum documento anexado ainda.' : 'Documentos disponíveis após o faturamento.'}</p>}
          </DrawerSecao>

          {/* Entrega */}
          <DrawerSecao titulo="Informações de entrega" icon={Truck}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><p className="text-[10px] text-gray-400">Situação</p><p className="text-xs font-medium text-gray-800">{pedido.situacao_entrega ?? '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Previsão embarque</p><p className="text-xs font-medium text-gray-800 tabular-nums">{fmtShort(pedido.previsao_embarque)}</p></div>
              <div><p className="text-[10px] text-gray-400">Cidade / UF</p><p className="text-xs font-medium text-gray-800">{pedido.cliente_cidade ? `${pedido.cliente_cidade}/${pedido.cliente_uf}` : '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Representante</p><p className="text-xs font-medium text-gray-800 truncate">{pedido.representante ?? '—'}</p></div>
            </div>
          </DrawerSecao>

          {/* Histórico — oculto para representantes (auditoria interna de quem/quando) */}
          {!isRep && (
          <DrawerSecao titulo="Histórico de movimentações" icon={History}>
            {pedido.logs.length === 0 ? <p className="text-xs text-gray-400">Sem histórico registrado.</p> : (
              <div className="space-y-1.5">
                {pedido.logs.map(log => {
                  const m = STEP_META[log.status]; const Icon = m.icon;
                  return (
                    <div key={log.id} className="flex items-center gap-2 text-xs">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: m.color }}><Icon className="w-3 h-3 text-white" /></span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-700 capitalize">{log.status_db.replace(/_/g, ' ')}</span>
                        {log.observacao && <span className="text-gray-400 ml-1">· {log.observacao}</span>}
                        {log.responsavel && <span className="text-gray-300 ml-1 text-[10px]">({log.responsavel})</span>}
                      </div>
                      <span className="text-gray-400 flex-shrink-0 tabular-nums text-[10px] bg-gray-50 px-1.5 py-0.5 rounded">{fmtFull(log.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </DrawerSecao>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Override de apresentação (preservado do original) ────
const STATUS_OVERRIDE: Record<string, PedidoStatus> = { '135732': 'mapeamento', '135128': 'producao', '133469': 'finalizado' };
const OVERRIDE_ORDER = ['133469', '135128', '135732'];

type ViewMode = 'lista' | 'pipeline' | 'timeline';
type QuickKey = 'atrasado' | 'parado' | 'faturado' | 'entrega' | 'finalizado' | 'docs' | 'nf_pend' | 'boleto_pend';
const PAGE = 24;

// ─── Página ──────────────────────────────────────────────
export default function AcompanhamentoPage() {
  const hoje = useMemo(() => new Date(), []);
  const reduce = useReducedMotion();
  const { data: pedidosRaw = [], isLoading, isError, error, refetch } = useAcompanhamento();

  const [view, setView] = useState<ViewMode>(() => {
    const s = localStorage.getItem('acomp_view');
    return s === 'pipeline' || s === 'timeline' ? s : 'lista';
  });
  useEffect(() => { localStorage.setItem('acomp_view', view); }, [view]);

  const [search, setSearch] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<'' | PedidoStatus>('');
  const [representante, setRepresentante] = useState('');
  const [quick, setQuick] = useState<Set<QuickKey>>(new Set());
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<PedidoAcompanhamento | null>(null);

  // Aplica override de apresentação + ordenação (preservado)
  const pedidos = useMemo(() => {
    const list = pedidosRaw.map(p => STATUS_OVERRIDE[p.numero_pedido] ? { ...p, status: STATUS_OVERRIDE[p.numero_pedido], logs: [] } : p);
    const top = OVERRIDE_ORDER.map(n => list.find(p => p.numero_pedido === n)).filter(Boolean) as typeof list;
    const rest = list.filter(p => !STATUS_OVERRIDE[p.numero_pedido]);
    return [...top, ...rest];
  }, [pedidosRaw]);

  const reps = useMemo(() => [...new Set(pedidos.map(p => p.representante).filter(Boolean) as string[])].sort(), [pedidos]);

  const matchQuick = useCallback((p: PedidoAcompanhamento): boolean => {
    for (const q of quick) {
      if (q === 'atrasado' && !emAtraso(p, hoje)) return false;
      if (q === 'parado' && !parado(p, hoje)) return false;
      if (q === 'faturado' && p.status !== 'faturado') return false;
      if (q === 'entrega' && p.status !== 'entrega') return false;
      if (q === 'finalizado' && p.status !== 'finalizado') return false;
      if (q === 'docs' && !docsPendentes(p)) return false;
      if (q === 'nf_pend' && !(faturadoOuAlem(p) && !temNF(p))) return false;
      if (q === 'boleto_pend' && !(faturadoOuAlem(p) && !temBoleto(p))) return false;
    }
    return true;
  }, [quick, hoje]);

  const filtrados = useMemo(() => {
    let list = pedidos;
    if (statusFiltro) list = list.filter(p => p.status === statusFiltro);
    if (representante) list = list.filter(p => p.representante === representante);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.numero_pedido.toLowerCase().includes(q) || p.cliente_nome.toLowerCase().includes(q) || (p.cliente_fantasia ?? '').toLowerCase().includes(q) || p.cliente_cnpj.includes(q));
    }
    return list.filter(matchQuick);
  }, [pedidos, statusFiltro, representante, search, matchQuick]);

  useEffect(() => { setPage(1); }, [statusFiltro, representante, search, quick, view]);

  // KPIs (sobre a base, respeitando busca/status server-less — usamos "pedidos")
  const kpis = useMemo(() => {
    const c = (s: PedidoStatus) => pedidos.filter(p => p.status === s).length;
    return {
      total: pedidos.length,
      aprovados: c('aprovado') + c('liberado'),
      producao: c('mapeamento') + c('ferragem') + c('comercial') + c('producao'),
      faturados: c('faturado'),
      entrega: c('entrega'),
      finalizados: c('finalizado'),
      parados: pedidos.filter(p => parado(p, hoje)).length,
      docs: pedidos.filter(docsPendentes).length,
      atraso: pedidos.filter(p => emAtraso(p, hoje)).length,
    };
  }, [pedidos, hoje]);

  // Bloco "Atenção necessária"
  const atencao = useMemo(() => {
    const semNF = pedidos.filter(p => faturadoOuAlem(p) && !temNF(p)).length;
    const semBoleto = pedidos.filter(p => faturadoOuAlem(p) && !temBoleto(p)).length;
    const paradosN = pedidos.filter(p => parado(p, hoje)).length;
    const entregaLonga = pedidos.filter(p => p.status === 'entrega' && diasNoStatus(p, hoje) > 10).length;
    const msgs: { texto: string; tone: 'red' | 'orange'; quick: QuickKey }[] = [];
    if (semNF > 0) msgs.push({ texto: `${semNF} pedido(s) faturado(s) sem NF anexada`, tone: 'red', quick: 'nf_pend' });
    if (semBoleto > 0) msgs.push({ texto: `${semBoleto} pedido(s) faturado(s) sem boleto`, tone: 'red', quick: 'boleto_pend' });
    if (paradosN > 0) msgs.push({ texto: `${paradosN} pedido(s) parado(s) há mais de 7 dias na mesma etapa`, tone: 'orange', quick: 'parado' });
    if (entregaLonga > 0) msgs.push({ texto: `${entregaLonga} pedido(s) em entrega há mais tempo que o esperado`, tone: 'orange', quick: 'atrasado' });
    return msgs;
  }, [pedidos, hoje]);

  const quickCounts = useMemo(() => ({
    atrasado: pedidos.filter(p => emAtraso(p, hoje)).length,
    parado: pedidos.filter(p => parado(p, hoje)).length,
    faturado: pedidos.filter(p => p.status === 'faturado').length,
    entrega: pedidos.filter(p => p.status === 'entrega').length,
    finalizado: pedidos.filter(p => p.status === 'finalizado').length,
    docs: pedidos.filter(docsPendentes).length,
    nf_pend: pedidos.filter(p => faturadoOuAlem(p) && !temNF(p)).length,
    boleto_pend: pedidos.filter(p => faturadoOuAlem(p) && !temBoleto(p)).length,
  }), [pedidos, hoje]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE));
  const paginados = useMemo(() => filtrados.slice((page - 1) * PAGE, page * PAGE), [filtrados, page]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const hasFilters = !!(search || statusFiltro || representante || quick.size > 0);
  function clearFilters() { setSearch(''); setStatusFiltro(''); setRepresentante(''); setQuick(new Set()); }
  function toggleQuick(k: QuickKey) { setQuick(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }

  const QUICK_DEFS: { key: QuickKey; label: string }[] = [
    { key: 'atrasado', label: 'Atrasados' },
    { key: 'parado', label: 'Parados' },
    { key: 'faturado', label: 'Faturados' },
    { key: 'entrega', label: 'Em entrega' },
    { key: 'finalizado', label: 'Finalizados' },
    { key: 'docs', label: 'Docs pendentes' },
    { key: 'nf_pend', label: 'NF pendente' },
    { key: 'boleto_pend', label: 'Boleto pendente' },
  ];
  const VIEWS: { key: ViewMode; icon: React.ElementType; label: string }[] = [
    { key: 'lista', icon: LayoutList, label: 'Lista' },
    { key: 'pipeline', icon: SquareKanban, label: 'Kanban' },
    { key: 'timeline', icon: Activity, label: 'Timeline' },
  ];

  // Havia um bloco aqui que despejava a mensagem crua do Postgres na tela — no
  // incidente de 2026-08-19 isso teria mostrado host, usuário do banco e motivo
  // da falha de autenticação para o representante. Detalhe técnico não é assunto
  // do usuário final; vai para o console e, quando houver auditoria (Etapa 11),
  // para o registro de eventos.
  if (isError) {
    if (import.meta.env.DEV) console.error('[Acompanhamento] falha ao carregar pedidos:', error);
    return (
      <PageContainer>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Central de Acompanhamento</h1>
        </div>
        <DataError recurso="os pedidos em acompanhamento" onRetry={() => refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Central de Acompanhamento</h1>
        <p className="text-sm text-gray-500 mt-0.5">{isLoading ? 'Carregando...' : `${kpis.total.toLocaleString('pt-BR')} pedido(s) em acompanhamento`}</p>
      </div>

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-2.5">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-[64px] bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="flex sm:grid sm:grid-cols-3 xl:grid-cols-9 gap-2.5 overflow-x-auto scrollbar-thin -mx-1 px-1 sm:mx-0 sm:px-0 sm:overflow-visible">
          <KpiCard icon={Boxes} label="Total" value={kpis.total.toLocaleString('pt-BR')} />
          <KpiCard icon={CheckCircle2} label="Aprovados" value={String(kpis.aprovados)} tone="text-blue-700" />
          <KpiCard icon={Factory} label="Em produção" value={String(kpis.producao)} tone="text-amber-600" />
          <KpiCard icon={FileCheck2} label="Faturados" value={String(kpis.faturados)} tone="text-teal-700" />
          <KpiCard icon={Truck} label="Em entrega" value={String(kpis.entrega)} tone="text-sky-700" />
          <KpiCard icon={PackageCheck} label="Finalizados" value={String(kpis.finalizados)} tone="text-emerald-700" />
          <KpiCard icon={Clock} label="Parados" value={String(kpis.parados)} tone={kpis.parados > 0 ? 'text-orange-600' : undefined} />
          <KpiCard icon={FileText} label="Docs pend." value={String(kpis.docs)} tone={kpis.docs > 0 ? 'text-red-600' : undefined} />
          <KpiCard icon={AlertTriangle} label="Atraso" value={String(kpis.atraso)} tone={kpis.atraso > 0 ? 'text-red-600' : undefined} />
        </div>
      )}

      {/* Atenção necessária */}
      {!isLoading && atencao.length > 0 && (
        <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/70 to-white shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center"><Sparkles className="w-4 h-4" /></span>
            <h2 className="text-sm font-semibold text-gray-900">Atenção necessária</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {atencao.map((a, i) => (
              <button key={i} type="button" onClick={() => setQuick(new Set([a.quick]))}
                className="flex items-center gap-2.5 rounded-xl bg-white/70 p-2.5 text-left hover:bg-white transition-colors border border-transparent hover:border-gray-200">
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', a.tone === 'red' ? 'bg-red-500' : 'bg-orange-500')} />
                <span className="text-xs text-gray-700 flex-1 min-w-0">{a.texto}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0"><SearchInput value={search} onChange={setSearch} placeholder="Nº pedido, cliente, CNPJ..." /></div>
        <button type="button" onClick={() => setShowFilters(true)}
          className={cn('inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-medium border transition-colors flex-shrink-0',
            (statusFiltro || representante) ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}>
          <SlidersHorizontal className="w-4 h-4" /><span className="hidden sm:inline">Filtros</span>
        </button>
        <div className="inline-flex rounded-xl bg-gray-100 p-0.5 flex-shrink-0 touch-compact">
          {VIEWS.map(v => (
            <button key={v.key} type="button" onClick={() => setView(v.key)} title={v.label}
              className={cn('flex items-center gap-1.5 px-2.5 sm:px-3 h-9 text-xs font-medium rounded-[10px] transition-colors', view === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              <v.icon className="w-4 h-4" /><span className="hidden md:inline">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick chips */}
      <div className="flex gap-2 overflow-x-auto scrollbar-thin -mx-1 px-1 pb-1">
        <QuickChip label="Todos" active={quick.size === 0} onClick={() => setQuick(new Set())} />
        {QUICK_DEFS.map(q => <QuickChip key={q.key} label={q.label} active={quick.has(q.key)} onClick={() => toggleQuick(q.key)} count={quickCounts[q.key]} />)}
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-52 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm py-16 text-center">
          <Package className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Nenhum pedido encontrado</p>
          {hasFilters && <button onClick={clearFilters} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(142,93%,8%)] hover:underline"><X className="w-3.5 h-3.5" />Limpar filtros</button>}
        </div>
      ) : view === 'pipeline' ? (
        <PipelineView pedidos={filtrados} onOpen={setSelected} hoje={hoje} />
      ) : view === 'timeline' ? (
        <TimelineView pedidos={filtrados} onOpen={setSelected} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
            {paginados.map((p, i) => <PedidoCard key={p.numero_pedido} pedido={p} onOpen={setSelected} index={i} hoje={hoje} />)}
          </div>
          <div className="mt-3"><Pagination currentPage={page} totalPages={totalPages} onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /></div>
        </>
      )}

      {/* Bottom sheet de filtros */}
      <MobileBottomSheet
        open={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filtros"
        footer={
          <>
            <button onClick={clearFilters} className="h-11 px-4 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Limpar</button>
            <button onClick={() => setShowFilters(false)} className="flex-1 h-11 rounded-xl bg-[hsl(142,93%,8%)] text-white text-sm font-medium hover:bg-[hsl(142,93%,15%)] transition-colors">Aplicar</button>
          </>
        }
      >
        <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Status</label>
          <Select value={statusFiltro} onChange={v => setStatusFiltro(v as '' | PedidoStatus)} placeholder="Todos"
            options={[{ value: '', label: 'Todos os status' }, ...STEPS.map(s => ({ value: s.key, label: s.label }))]} /></div>
        <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Representante</label>
          <Select value={representante} onChange={setRepresentante} placeholder="Todos"
            options={[{ value: '', label: 'Todos' }, ...reps.map(r => ({ value: r, label: r }))]} /></div>
      </MobileBottomSheet>

      {selected && <PedidoDrawer pedido={selected} hoje={hoje} onClose={() => setSelected(null)} />}
    </PageContainer>
  );
}
