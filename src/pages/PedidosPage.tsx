import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { formatCurrency, formatCurrencyK, formatDate } from '@/utils/formatters';
import Select from '@/components/ui/Select';
import SearchInput from '@/components/ui/SearchInput';
import Pagination from '@/components/ui/Pagination';
import PageContainer from '@/components/ui/PageContainer';
import DataError from '@/components/ui/DataError';
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Search, X, Check, FileText, Receipt, Truck, Package, DollarSign,
  MapPin, Hash, Calendar, CalendarClock, AlertTriangle, LayoutGrid, List, SquareKanban,
  SlidersHorizontal, Boxes, ShoppingCart, PackageCheck, FileCheck2, TrendingUp,
  BarChart3, Clock, User, History, Download,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { MetricCard as KpiCard } from '@/components/ui/cards';
import type { PedidoVenda } from '@/types';
import { usePedidosCompleto, useRepresentantesUnicos, useSituacoesEntrega } from '@/hooks/usePedidosVenda';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import MobileBottomSheet from '@/components/ui/MobileBottomSheet';
import { getPedidoItens, fetchPedidoHistorico, CENTRAL_CAP } from '@/services/pedidosVenda';
import {
  ETAPAS, ETAPA_META, etapaDe, temNF, temBoleto, faturadoOuAlem, docsPendentes,
  emAtraso, numItens, nomeCliente, classifyAnexo, type Etapa,
} from '@/pedidos/central';

const CONCREM = 'hsl(142,93%,8%)';
const ANO_ATUAL = new Date().getFullYear();
const ANOS = Array.from({ length: 5 }, (_, i) => ANO_ATUAL - i);
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const PIE_COLORS = ETAPAS.map(e => e.color);
const PAGE = 24;

type ViewMode = 'cards' | 'table' | 'pipeline';
type QuickKey = 'faturado' | 'rota' | 'entregue' | 'com_nf' | 'sem_nf' | 'com_boleto' | 'sem_boleto' | 'alto_valor' | 'atraso';

// ─── Progresso da jornada (5 etapas) ─────────────────────
function Jornada({ etapa, compact }: { etapa: Etapa; compact?: boolean }) {
  const idx = ETAPA_META[etapa].index;
  return (
    <div className="flex items-center gap-1">
      {ETAPAS.map((e, i) => {
        const done = i < idx;
        const atual = i === idx;
        return (
          <div key={e.key} className="flex items-center gap-1 flex-1 min-w-0">
            <div className="flex flex-col items-center flex-1 min-w-0">
              <div
                className={cn(
                  'rounded-full flex items-center justify-center transition-colors',
                  compact ? 'w-4 h-4' : 'w-5 h-5',
                  atual ? 'text-white' : done ? 'text-white' : 'bg-gray-100 text-gray-300',
                )}
                style={atual || done ? { backgroundColor: e.color } : undefined}
                title={e.label}
              >
                {done ? <Check className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                  : <e.icon className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
              </div>
              {!compact && (
                <span className={cn('text-[8px] mt-0.5 truncate max-w-full', atual ? 'font-semibold text-gray-700' : 'text-gray-400')}>
                  {e.label}
                </span>
              )}
            </div>
            {i < ETAPAS.length - 1 && (
              <div className={cn('h-0.5 flex-1 rounded-full -mt-3', compact && 'mt-0')} style={{ backgroundColor: i < idx ? e.color : '#e5e7eb' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Badges de documento ─────────────────────────────────
function DocBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border',
      ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200',
    )}>
      {ok ? <Check className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}
function DocBadges({ pedido, className }: { pedido: PedidoVenda; className?: string }) {
  if (!faturadoOuAlem(pedido)) return null;
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <DocBadge ok={temNF(pedido)} label="NF" />
      <DocBadge ok={temBoleto(pedido)} label="Boleto" />
    </div>
  );
}

function EtapaPill({ etapa }: { etapa: Etapa }) {
  const m = ETAPA_META[etapa];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${m.color}18`, color: m.color }}>
      <Icon className="w-2.5 h-2.5" />
      {m.label}
    </span>
  );
}

// ─── Card de pedido ──────────────────────────────────────
function PedidoCard({ pedido, onOpen, index }: { pedido: PedidoVenda; onOpen: (p: PedidoVenda) => void; index: number }) {
  const reduce = useReducedMotion();
  const etapa = etapaDe(pedido);
  const itens = numItens(pedido);
  const temValor = pedido.total_pedido_venda > 0;
  const hoje = useMemo(() => new Date(), []);
  const atraso = emAtraso(pedido, hoje);
  const pend = docsPendentes(pedido);

  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.25), ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onOpen(pedido)}
      className="group rounded-2xl bg-white border border-gray-200/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden flex flex-col"
      style={{ borderLeft: `3px solid ${ETAPA_META[etapa].color}` }}
    >
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-gray-400">#{pedido.numero_pedido}</span>
          <EtapaPill etapa={etapa} />
          {atraso && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
              <AlertTriangle className="w-2.5 h-2.5" /> Atraso
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{formatDate(pedido.data_emissao)}</span>
        </div>

        <div className="flex items-start justify-between gap-2 mt-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-[15px] leading-snug line-clamp-2 group-hover:text-[hsl(142,93%,8%)] transition-colors">{nomeCliente(pedido)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">{pedido.representante ?? '—'}</p>
          </div>
          <p className={cn('font-bold text-base tabular-nums flex-shrink-0', temValor ? 'text-gray-900' : 'text-gray-300')}>
            {temValor ? formatCurrencyK(pedido.total_pedido_venda) : '—'}
          </p>
        </div>

        {/* Métricas */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Package className="w-3 h-3 text-gray-400" />{itens} item(s)</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Boxes className="w-3 h-3 text-gray-400" />{pedido.total_qtd} un.</span>
          {pedido.frete > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Truck className="w-3 h-3 text-gray-400" />{formatCurrencyK(pedido.frete)}</span>}
          {(pedido.cliente_cidade) && <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><MapPin className="w-3 h-3" />{pedido.cliente_cidade}/{pedido.cliente_uf}</span>}
        </div>

        {/* Documentos + embarque */}
        {(faturadoOuAlem(pedido) || pedido.previsao_embarque) && (
          <div className="flex items-center justify-between gap-2 mt-2.5">
            <DocBadges pedido={pedido} />
            {pedido.previsao_embarque && (
              <span className="text-[10px] text-amber-600 tabular-nums flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />Emb: {formatDate(pedido.previsao_embarque)}
              </span>
            )}
          </div>
        )}
        {pend && (
          <p className="text-[10px] text-amber-600 font-medium mt-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />Documentos pendentes
          </p>
        )}
      </div>

      {/* Progresso da jornada */}
      <div className="px-4 pb-3.5 pt-1">
        <Jornada etapa={etapa} />
      </div>
    </motion.div>
  );
}

// KpiCard migrado para o design system compartilhado (MetricCard em
// @/components/ui/cards) — importado como KpiCard no topo deste arquivo.

// ─── Quick chip ──────────────────────────────────────────
function QuickChip({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 border',
        active
          ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={cn('text-[9px] font-bold tabular-nums rounded-full px-1', active ? 'bg-white/25' : 'bg-gray-100 text-gray-500')}>{count}</span>
      )}
    </button>
  );
}

// ─── Tabela ──────────────────────────────────────────────
function TableView({ pedidos, onOpen }: { pedidos: PedidoVenda[]; onOpen: (p: PedidoVenda) => void }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Representante</th>
              <th className="px-4 py-3">Local</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Itens</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Docs</th>
              <th className="px-4 py-3">Emissão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pedidos.map(p => (
              <tr key={p.id} onClick={() => onOpen(p)} className="hover:bg-gray-50/70 transition-colors cursor-pointer">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">#{p.numero_pedido}</td>
                <td className="px-4 py-3"><p className="font-medium text-gray-900 truncate max-w-[200px]">{nomeCliente(p)}</p></td>
                <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[150px]">{p.representante ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{p.cliente_cidade ? `${p.cliente_cidade}/${p.cliente_uf}` : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{p.total_pedido_venda > 0 ? formatCurrencyK(p.total_pedido_venda) : <span className="text-gray-300 font-normal">—</span>}</td>
                <td className="px-4 py-3 text-center tabular-nums text-gray-600">{numItens(p)}</td>
                <td className="px-4 py-3"><EtapaPill etapa={etapaDe(p)} /></td>
                <td className="px-4 py-3">{faturadoOuAlem(p) ? <DocBadges pedido={p} /> : <span className="text-gray-300 text-xs">—</span>}</td>
                <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">{formatDate(p.data_emissao)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pipeline (5 colunas) ────────────────────────────────
function PipelineView({ pedidos, onOpen }: { pedidos: PedidoVenda[]; onOpen: (p: PedidoVenda) => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <div className="flex gap-3 min-w-max items-start">
        {ETAPAS.map(et => {
          const col = pedidos.filter(p => etapaDe(p) === et.key);
          const valor = col.reduce((s, p) => s + p.total_pedido_venda, 0);
          return (
            <div key={et.key} className="w-[260px] flex-shrink-0 rounded-2xl bg-gray-50/80 border border-gray-100 p-2">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: et.color }} />
                <span className="text-xs font-semibold text-gray-700">{et.label}</span>
                <span className="text-[10px] font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 tabular-nums">{col.length}</span>
                {valor > 0 && <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{formatCurrencyK(valor)}</span>}
              </div>
              <div className="space-y-2 mt-1 max-h-[70vh] overflow-y-auto scrollbar-thin">
                {col.length === 0 ? (
                  <p className="text-[11px] text-gray-300 text-center py-6">Vazio</p>
                ) : col.slice(0, 50).map((p, i) => (
                  <motion.div
                    key={p.id}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(i * 0.02, 0.15) }}
                    onClick={() => onOpen(p)}
                    className="rounded-xl bg-white border border-gray-200/70 shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[10px] text-gray-400">#{p.numero_pedido}</span>
                      {emAtraso(p, new Date()) && <AlertTriangle className="w-3 h-3 text-red-500" />}
                    </div>
                    <p className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-2 mt-1">{nomeCliente(p)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs font-bold text-gray-900 tabular-nums">{p.total_pedido_venda > 0 ? formatCurrencyK(p.total_pedido_venda) : '—'}</span>
                      {faturadoOuAlem(p) && <DocBadges pedido={p} />}
                    </div>
                  </motion.div>
                ))}
                {col.length > 50 && <p className="text-[10px] text-gray-400 text-center py-1">+{col.length - 50} pedidos</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Drawer de detalhes ──────────────────────────────────
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

function PedidoDrawer({ pedido, onClose }: { pedido: PedidoVenda; onClose: () => void }) {
  const { user } = useAuth();
  // Representante puro (não admin, não operador) não vê o histórico de status
  // com data/hora e autor — é auditoria interna do ERP.
  const isRep = !user?.usuario?.admin && !user?.usuario?.operador;
  const etapa = etapaDe(pedido);
  const idx = ETAPA_META[etapa].index;
  const itens = getPedidoItens(pedido);
  const hoje = useMemo(() => new Date(), []);

  const { data: historico = [] } = useQuery({
    queryKey: ['pedido-historico', pedido.numero_pedido],
    queryFn: () => fetchPedidoHistorico(pedido.numero_pedido),
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const anexos = pedido.anexos ?? [];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="drawer-overlay absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="drawer-panel absolute right-0 top-0 h-full w-full sm:max-w-lg bg-white shadow-2xl flex flex-col">
        {/* Cabeçalho */}
        <div className="p-5 pb-4 border-b border-gray-100" style={{ borderTop: `3px solid ${ETAPA_META[etapa].color}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-gray-400">#{pedido.numero_pedido}</span>
                <EtapaPill etapa={etapa} />
                {emAtraso(pedido, hoje) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Atraso</span>}
              </div>
              <h2 className="text-lg font-bold text-gray-900 leading-tight mt-1.5 line-clamp-2">{nomeCliente(pedido)}</h2>
            </div>
            <button onClick={onClose} aria-label="Fechar" className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-6">
          {/* Resumo executivo */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Valor total</p><p className="text-base font-bold text-gray-900 tabular-nums">{pedido.total_pedido_venda > 0 ? formatCurrencyK(pedido.total_pedido_venda) : '—'}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Itens · Unidades</p><p className="text-base font-bold text-gray-900 tabular-nums">{itens.length} · {pedido.total_qtd}</p></div>
          </div>

          {/* Timeline */}
          <DrawerSecao titulo="Jornada do pedido" icon={TrendingUp}>
            <div className="relative pl-5">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
              <div className="space-y-3">
                {ETAPAS.map((e, i) => {
                  const done = i < idx; const atual = i === idx;
                  return (
                    <div key={e.key} className="relative">
                      <span className="absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ backgroundColor: (done || atual) ? e.color : '#e5e7eb' }} />
                      <p className={cn('text-xs', atual ? 'font-bold text-gray-900' : done ? 'font-medium text-gray-700' : 'text-gray-400')}>{e.label}</p>
                      {atual && <p className="text-[10px] text-gray-400">etapa atual</p>}
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
                {anexos.map((a, i) => {
                  const cls = classifyAnexo(a.tipo);
                  const Icon = cls === 'nf' ? FileText : cls === 'boleto' ? Receipt : Download;
                  return (
                    <button key={i} type="button" onClick={() => window.open(a.arquivo_url, '_blank', 'noopener,noreferrer')}
                      className="flex items-center gap-2.5 w-full rounded-xl border border-gray-200 p-2.5 hover:bg-gray-50 transition-colors text-left">
                      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', cls === 'nf' ? 'bg-purple-50 text-purple-500' : cls === 'boleto' ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-500')}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-gray-800 block truncate">{a.arquivo_nome || (cls === 'nf' ? 'Nota Fiscal' : cls === 'boleto' ? 'Boleto' : a.tipo)}</span>
                        <span className="text-[10px] text-gray-400">clique para baixar</span>
                      </span>
                      <Download className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400">{faturadoOuAlem(pedido) ? 'Nenhum documento anexado ainda.' : 'Documentos disponíveis após o faturamento.'}</p>
            )}
          </DrawerSecao>

          {/* Itens */}
          <DrawerSecao titulo={`Itens (${itens.length})`} icon={Package}>
            {itens.length === 0 ? (
              <p className="text-xs text-gray-400">Sem itens detalhados</p>
            ) : (
              <div className="space-y-1.5">
                {itens.map((item, i) => (
                  <div key={item.id ?? i} className="flex items-start justify-between gap-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-700 font-medium block truncate">{item.produto}</span>
                      <span className="text-gray-400">{item.qtd} {item.un}{item.percentual_desconto > 0 && ` · -${item.percentual_desconto}%`}</span>
                    </div>
                    <span className="text-gray-900 font-semibold tabular-nums flex-shrink-0">{formatCurrency(item.valor_total)}</span>
                  </div>
                ))}
              </div>
            )}
          </DrawerSecao>

          {/* Logística */}
          <DrawerSecao titulo="Logística" icon={Truck}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><p className="text-[10px] text-gray-400">Frete</p><p className="text-xs font-medium text-gray-800 tabular-nums">{pedido.frete > 0 ? formatCurrency(pedido.frete) : '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Embarque</p><p className="text-xs font-medium text-gray-800 tabular-nums">{pedido.previsao_embarque ? formatDate(pedido.previsao_embarque) : '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Cidade / UF</p><p className="text-xs font-medium text-gray-800">{pedido.cliente_cidade ? `${pedido.cliente_cidade}/${pedido.cliente_uf}` : '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Situação entrega</p><p className="text-xs font-medium text-gray-800">{pedido.situacao_entrega ?? '—'}</p></div>
            </div>
          </DrawerSecao>

          {/* Cliente / representante */}
          <DrawerSecao titulo="Cliente & representante" icon={User}>
            <div className="space-y-1.5 text-xs">
              <p className="flex items-center gap-1.5 text-gray-600"><Hash className="w-3 h-3 text-gray-400" /><span className="font-mono">{pedido.cliente_cnpj}</span></p>
              <p className="text-gray-600">{pedido.representante ?? '—'}</p>
              {pedido.data_emissao && <p className="flex items-center gap-1.5 text-gray-500"><Calendar className="w-3 h-3 text-gray-400" />Emitido em {formatDate(pedido.data_emissao)}</p>}
            </div>
          </DrawerSecao>

          {/* Histórico — oculto para representantes (auditoria interna de quem/quando) */}
          {!isRep && (
          <DrawerSecao titulo="Histórico de status" icon={History}>
            {historico.length === 0 ? (
              <p className="text-xs text-gray-400">Sem histórico de alterações registrado.</p>
            ) : (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
                <div className="space-y-3">
                  {historico.map((h, i) => (
                    <div key={i} className="relative">
                      <span className="absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white bg-[#2eaf69]" />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-gray-800 capitalize">{h.status}</p>
                        <span className="text-[10px] text-gray-400 tabular-nums">{formatDate(h.created_at)}</span>
                      </div>
                      {h.observacao && <p className="text-[11px] text-gray-500">{h.observacao}</p>}
                      {h.responsavel && <p className="text-[10px] text-gray-400">por {h.responsavel}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DrawerSecao>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────
export default function PedidosPage() {
  const hoje = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>(() => {
    const s = localStorage.getItem('ped_view');
    return s === 'table' || s === 'pipeline' ? s : 'cards';
  });
  useEffect(() => { localStorage.setItem('ped_view', view); }, [view]);
  // No mobile a tabela não é a visão principal → cai para cards.
  const isDesktop = useIsDesktop();
  const effView: ViewMode = view === 'table' && !isDesktop ? 'cards' : view;

  // Busca inicial vinda de ?busca= (ex.: "Abrir pedido" na Central Financeira)
  const [searchParams] = useSearchParams();
  const buscaInicial = searchParams.get('busca') ?? '';

  // Filtros de servidor (disparam refetch)
  const [searchInput, setSearchInput] = useState(buscaInicial);
  const [clienteInput, setClienteInput] = useState('');
  const [search, setSearch] = useState(buscaInicial);
  const [cliente, setCliente] = useState('');
  const [ano, setAno] = useState('');
  const [mes, setMes] = useState('');
  const [representante, setRepresentante] = useState('');
  const [situacao, setSituacao] = useState('');

  // Filtros client-side
  const [quick, setQuick] = useState<Set<QuickKey>>(new Set());
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [selected, setSelected] = useState<PedidoVenda | null>(null);

  const { data: result, isLoading, isFetching, isError, refetch } = usePedidosCompleto({
    search: search || undefined,
    cliente: cliente || undefined,
    representante: representante || undefined,
    ano: ano ? Number(ano) : undefined,
    mes: mes ? Number(mes) : undefined,
    situacaoEntrega: situacao || undefined,
  });
  const { data: repsUnicos = [] } = useRepresentantesUnicos();
  const { data: situacoes = [] } = useSituacoesEntrega();

  // Memoizado: `result?.data ?? []` criava um array novo a cada render, o que
  // invalidava todos os useMemo que dependem de `base` sem nada ter mudado.
  const base = useMemo(() => result?.data ?? [], [result]);

  // Threshold de "alto valor" = percentil 80 do conjunto
  const altoValorThreshold = useMemo(() => {
    const vals = base.map(p => p.total_pedido_venda).filter(v => v > 0).sort((a, b) => a - b);
    if (vals.length === 0) return Infinity;
    return vals[Math.floor(vals.length * 0.8)] ?? vals[vals.length - 1];
  }, [base]);

  const matchQuick = useCallback((p: PedidoVenda): boolean => {
    for (const q of quick) {
      const et = etapaDe(p);
      if (q === 'faturado' && et !== 'faturado') return false;
      if (q === 'rota' && et !== 'rota') return false;
      if (q === 'entregue' && et !== 'entregue') return false;
      if (q === 'com_nf' && !temNF(p)) return false;
      if (q === 'sem_nf' && temNF(p)) return false;
      if (q === 'com_boleto' && !temBoleto(p)) return false;
      if (q === 'sem_boleto' && temBoleto(p)) return false;
      if (q === 'alto_valor' && p.total_pedido_venda < altoValorThreshold) return false;
      if (q === 'atraso' && !emAtraso(p, hoje)) return false;
    }
    return true;
  }, [quick, altoValorThreshold, hoje]);

  const filtrados = useMemo(() => base.filter(matchQuick), [base, matchQuick]);

  useEffect(() => { setPage(1); }, [quick, search, cliente, ano, mes, representante, situacao]);

  // ── KPIs (sobre o conjunto base do servidor) ──
  const kpis = useMemo(() => {
    const valorTotal = base.reduce((s, p) => s + p.total_pedido_venda, 0);
    const cont = (et: Etapa) => base.filter(p => etapaDe(p) === et).length;
    return {
      total: result?.total ?? base.length,
      valorTotal,
      faturados: cont('faturado'),
      emEntrega: cont('rota'),
      entregues: cont('entregue'),
      ticket: base.length > 0 ? valorTotal / base.length : 0,
      docsPend: base.filter(docsPendentes).length,
      atencao: base.filter(p => emAtraso(p, hoje)).length,
    };
  }, [base, result?.total, hoje]);

  // ── Contagens dos quick chips ──
  const quickCounts = useMemo(() => ({
    faturado: base.filter(p => etapaDe(p) === 'faturado').length,
    rota: base.filter(p => etapaDe(p) === 'rota').length,
    entregue: base.filter(p => etapaDe(p) === 'entregue').length,
    com_nf: base.filter(temNF).length,
    sem_nf: base.filter(p => !temNF(p)).length,
    com_boleto: base.filter(temBoleto).length,
    sem_boleto: base.filter(p => !temBoleto(p)).length,
    alto_valor: base.filter(p => p.total_pedido_venda >= altoValorThreshold).length,
    atraso: base.filter(p => emAtraso(p, hoje)).length,
  }), [base, altoValorThreshold, hoje]);

  // ── Charts ──
  const chartStatus = useMemo(
    () => ETAPAS.map(e => ({ name: e.label, value: base.filter(p => etapaDe(p) === e.key).length, color: e.color })).filter(d => d.value > 0),
    [base],
  );
  const chartEvolucao = useMemo(() => {
    const arr: { mes: string; pedidos: number; valor: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
      const doMes = base.filter(p => { const d = p.data_emissao ? new Date(`${p.data_emissao.slice(0,10)}T12:00:00`) : null; return d && d >= ref && d < fim; });
      arr.push({ mes: MESES[ref.getMonth()], pedidos: doMes.length, valor: doMes.reduce((s, p) => s + p.total_pedido_venda, 0) });
    }
    return arr;
  }, [base, hoje]);
  // Top clientes — agregado a partir de `base`, que já vem filtrado pelos pedidos
  // do usuário (cada representante vê somente os próprios clientes).
  const chartClientes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of base) { const c = nomeCliente(p)?.trim(); if (c && c !== '—') m.set(c, (m.get(c) ?? 0) + 1); }
    return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  }, [base]);

  // Paginação (cards/table)
  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE));
  const paginados = useMemo(() => filtrados.slice((page - 1) * PAGE, page * PAGE), [filtrados, page]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const hasFilters = !!(search || cliente || ano || mes || representante || situacao);

  function applySearch() {
    setSearch(searchInput.trim());
    setCliente(clienteInput.trim());
  }
  function clearFilters() {
    setSearch(''); setSearchInput(''); setCliente(''); setClienteInput('');
    setAno(''); setMes(''); setRepresentante(''); setSituacao(''); setQuick(new Set());
  }
  function toggleQuick(k: QuickKey) {
    setQuick(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  const QUICK_DEFS: { key: QuickKey; label: string }[] = [
    { key: 'faturado', label: 'Faturados' },
    { key: 'rota', label: 'Em rota' },
    { key: 'entregue', label: 'Entregues' },
    { key: 'com_nf', label: 'Com NF' },
    { key: 'sem_nf', label: 'Sem NF' },
    { key: 'com_boleto', label: 'Com boleto' },
    { key: 'sem_boleto', label: 'Sem boleto' },
    { key: 'alto_valor', label: 'Alto valor' },
    { key: 'atraso', label: 'Atrasados' },
  ];

  const VIEWS: { key: ViewMode; icon: React.ElementType; label: string }[] = [
    { key: 'cards', icon: LayoutGrid, label: 'Cards' },
    { key: 'table', icon: List, label: 'Tabela' },
    { key: 'pipeline', icon: SquareKanban, label: 'Kanban' },
  ];

  // Falha de carga tem tela própria: cair no estado vazio faria a queda parecer
  // ausência de pedidos (ver docs/INCIDENTE-2026-08-19-FDW.md).
  if (isError) {
    return (
      <PageContainer>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Central de Pedidos</h1>
        </div>
        <DataError recurso="os pedidos" onRetry={() => refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Central de Pedidos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading ? 'Carregando...' : `${kpis.total.toLocaleString('pt-BR')} pedido(s)`}
            {quick.size > 0 && !isLoading && <span className="text-gray-400"> · {filtrados.length} após filtros rápidos</span>}
            {result?.truncated && <span className="text-amber-600"> · exibindo os {CENTRAL_CAP.toLocaleString('pt-BR')} mais recentes</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCharts(v => !v)}
          className={cn('hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium border transition-colors',
            showCharts ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}
        >
          <BarChart3 className="w-4 h-4" />
          Inteligência
        </button>
      </div>

      {/* KPIs — scroll horizontal no mobile, grid no desktop */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[68px] bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="flex sm:grid sm:grid-cols-4 xl:grid-cols-8 gap-2.5 overflow-x-auto scrollbar-thin -mx-1 px-1 sm:mx-0 sm:px-0 sm:overflow-visible">
          <KpiCard icon={ShoppingCart} label="Pedidos" value={kpis.total.toLocaleString('pt-BR')} />
          <KpiCard icon={DollarSign} label="Valor total" value={kpis.valorTotal > 0 ? formatCurrencyK(kpis.valorTotal) : '—'} tone="text-emerald-700" />
          <KpiCard icon={FileCheck2} label="Faturados" value={String(kpis.faturados)} tone="text-teal-700" />
          <KpiCard icon={Truck} label="Em entrega" value={String(kpis.emEntrega)} tone="text-sky-700" />
          <KpiCard icon={PackageCheck} label="Entregues" value={String(kpis.entregues)} tone="text-emerald-700" />
          <KpiCard icon={TrendingUp} label="Média de pedido" value={kpis.ticket > 0 ? formatCurrencyK(kpis.ticket) : '—'} tone="text-blue-700" />
          <KpiCard icon={AlertTriangle} label="Docs pendentes" value={String(kpis.docsPend)} tone={kpis.docsPend > 0 ? 'text-amber-600' : undefined} />
          <KpiCard icon={Clock} label="Atenção / atraso" value={String(kpis.atencao)} tone={kpis.atencao > 0 ? 'text-red-600' : undefined} />
        </div>
      )}

      {/* Inteligência (gráficos) */}
      <AnimatePresence>
        {showCharts && !isLoading && base.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid lg:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm p-4 min-w-0 overflow-hidden">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Pedidos por etapa</p>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={chartStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="none">
                      {chartStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e5e7eb' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                  {chartStatus.map(d => (
                    <span key={d.name} className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name} <strong className="text-gray-700 tabular-nums">{d.value}</strong>
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm p-4 min-w-0 overflow-hidden">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Evolução (6 meses)</p>
                <ResponsiveContainer width="100%" height={170}>
                  <AreaChart data={chartEvolucao} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
                    <defs><linearGradient id="pedEvol" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CONCREM} stopOpacity={0.3} /><stop offset="100%" stopColor={CONCREM} stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip formatter={(v) => [`${v} pedido(s)`, '']} contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e5e7eb' }} />
                    <Area type="monotone" dataKey="pedidos" stroke={CONCREM} strokeWidth={2.5} fill="url(#pedEvol)" dot={{ r: 2.5, fill: CONCREM }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm p-4 min-w-0 overflow-hidden">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Top clientes</p>
                {chartClientes.length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center">Sem dados</p>
                ) : (
                  <div className="space-y-2 mt-1">
                    {chartClientes.map((r, i) => {
                      const max = chartClientes[0].n;
                      return (
                        <div key={r.nome}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[11px] text-gray-600 truncate max-w-[70%]">{r.nome}</span>
                            <span className="text-[11px] font-bold text-gray-800 tabular-nums">{r.n}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(r.n / max) * 100}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toolbar: busca + filtros + view switch */}
      <div className="flex items-center gap-2">
        <form onSubmit={e => { e.preventDefault(); applySearch(); }} className="flex-1 min-w-0">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Nº pedido, CNPJ..." />
        </form>
        <button
          type="button"
          onClick={() => setShowFilters(true)}
          className={cn('inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-medium border transition-colors flex-shrink-0',
            hasFilters ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filtros</span>
        </button>
        <div className="inline-flex rounded-xl bg-gray-100 p-0.5 flex-shrink-0 touch-compact">
          {VIEWS.filter(v => v.key !== 'table' || isDesktop).map(v => (
            <button key={v.key} type="button" onClick={() => setView(v.key)} title={v.label}
              className={cn('flex items-center gap-1.5 px-2.5 sm:px-3 h-9 text-xs font-medium rounded-[10px] transition-colors',
                effView === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              <v.icon className="w-4 h-4" />
              <span className="hidden md:inline">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick chips — roláveis no mobile */}
      <div className="flex gap-2 overflow-x-auto scrollbar-thin -mx-1 px-1 pb-1">
        {QUICK_DEFS.map(q => (
          <QuickChip key={q.key} label={q.label} active={quick.has(q.key)} onClick={() => toggleQuick(q.key)} count={quickCounts[q.key]} />
        ))}
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-56 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm py-16 text-center">
          <Boxes className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Nenhum pedido encontrado</p>
          {(hasFilters || quick.size > 0) && (
            <button onClick={clearFilters} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(142,93%,8%)] hover:underline">
              <X className="w-3.5 h-3.5" />Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className={cn(isFetching && 'opacity-60 pointer-events-none transition-opacity')}>
          {effView === 'pipeline' ? (
            <PipelineView pedidos={filtrados} onOpen={setSelected} />
          ) : effView === 'table' ? (
            <>
              <TableView pedidos={paginados} onOpen={setSelected} />
              <div className="mt-3"><Pagination currentPage={page} totalPages={totalPages} onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /></div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                {paginados.map((p, i) => <PedidoCard key={p.id} pedido={p} onOpen={setSelected} index={i} />)}
              </div>
              <div className="mt-3"><Pagination currentPage={page} totalPages={totalPages} onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /></div>
            </>
          )}
        </div>
      )}

      {/* Bottom sheet de filtros */}
      <MobileBottomSheet
        open={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filtros"
        footer={
          <>
            <button onClick={() => clearFilters()} className="h-11 px-4 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Limpar</button>
            <button onClick={() => { applySearch(); setShowFilters(false); }} className="flex-1 h-11 rounded-xl bg-[hsl(142,93%,8%)] text-white text-sm font-medium hover:bg-[hsl(142,93%,15%)] transition-colors">Aplicar filtros</button>
          </>
        }
      >
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Cliente</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={clienteInput} onChange={e => setClienteInput(e.target.value)} placeholder="Nome / fantasia..."
              className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Ano</label>
            <Select value={ano} onChange={setAno} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...ANOS.map(a => ({ value: String(a), label: String(a) }))]} /></div>
          <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Mês</label>
            <Select value={mes} onChange={setMes} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...MESES.map((m, i) => ({ value: String(i + 1), label: m }))]} /></div>
        </div>
        <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Representante</label>
          <Select value={representante} onChange={setRepresentante} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...repsUnicos.map(r => ({ value: r, label: r }))]} /></div>
        <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Situação da entrega</label>
          <Select value={situacao} onChange={setSituacao} placeholder="Todas" options={[{ value: '', label: 'Todas' }, ...situacoes.map(s => ({ value: s, label: s }))]} /></div>
      </MobileBottomSheet>

      {/* Drawer */}
      {selected && <PedidoDrawer pedido={selected} onClose={() => setSelected(null)} />}
    </PageContainer>
  );
}
