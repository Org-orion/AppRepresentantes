import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UsersRound, X, ShoppingCart, DollarSign, UserCheck, AlertTriangle, Moon, Award, CalendarClock, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useRepPerformance } from '@/hooks/useRepPerformance';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { RepPerf, RepBadge } from '@/services/performance';
import type { DashboardFiltros } from '@/services/dashboard';
import ValorAjustavel from '@/components/ui/ValorAjustavel';

const BADGE: Record<RepBadge, { label: string; cls: string; bar: string }> = {
  excelente: { label: 'Excelente', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  bom:       { label: 'Bom',       cls: 'bg-blue-50 text-blue-700 border-blue-200',          bar: 'bg-blue-500' },
  atencao:   { label: 'Atenção',   cls: 'bg-amber-50 text-amber-700 border-amber-200',       bar: 'bg-amber-500' },
  critico:   { label: 'Crítico',   cls: 'bg-red-50 text-red-600 border-red-200',             bar: 'bg-red-500' },
};

const PAGE_SIZE = 8;

type Criterio = 'score' | 'receita' | 'pedidos' | 'ticket' | 'ativos' | 'atraso';
const CRITERIOS: { key: Criterio; label: string }[] = [
  { key: 'score',   label: 'Score' },
  { key: 'receita', label: 'Valor' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'ticket',  label: 'Média' },
  { key: 'ativos',  label: 'Ativos' },
  { key: 'atraso',  label: 'Menos atraso' },
];

function ordenar(reps: RepPerf[], c: Criterio): RepPerf[] {
  const arr = [...reps];
  switch (c) {
    case 'receita': return arr.sort((a, b) => b.totalVendido - a.totalVendido);
    case 'pedidos': return arr.sort((a, b) => b.pedidos - a.pedidos);
    case 'ticket':  return arr.sort((a, b) => b.ticketMedio - a.ticketMedio);
    case 'ativos':  return arr.sort((a, b) => b.clientesAtivos - a.clientesAtivos);
    case 'atraso':  return arr.sort((a, b) => (a.clientesAtrasados + a.clientesDormentes) - (b.clientesAtrasados + b.clientesDormentes));
    default:        return arr.sort((a, b) => b.score - a.score);
  }
}

function Metric({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
      <div className="flex items-center gap-1.5 text-gray-400"><Icon className="w-3.5 h-3.5" /><span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span></div>
      <div className="mt-0.5"><ValorAjustavel valor={value} className={cn('font-bold', tone ?? 'text-gray-900')} max="1rem" /></div>
    </div>
  );
}

export default function RepPerformancePanel({ period }: { period?: DashboardFiltros }) {
  const { data: reps = [], isLoading } = useRepPerformance(period);
  const [criterio, setCriterio] = useState<Criterio>('score');
  const [sel, setSel] = useState<RepPerf | null>(null);
  const [page, setPage] = useState(0);

  const ordenados = useMemo(() => ordenar(reps, criterio), [reps, criterio]);
  const top = ordenados.slice(0, 3);
  const maxRec = Math.max(1, ...reps.map(r => r.totalVendido));
  // Atenção Necessária: piores por score entre os que têm sinal de risco
  const atencao = useMemo(
    () => reps.filter(r => r.badge === 'critico' || r.badge === 'atencao' || (r.clientesAtrasados + r.clientesDormentes) > 0)
             .sort((a, b) => a.score - b.score).slice(0, 3),
    [reps],
  );

  // Paginação da matriz — volta à 1ª página ao trocar a ordenação
  useEffect(() => { setPage(0); }, [criterio]);
  const totalPages = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = ordenados.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const primeiro = ordenados.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const ultimo = Math.min(ordenados.length, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <UsersRound className="w-4 h-4 text-indigo-500" />
            <CardTitle>Performance dos Representantes</CardTitle>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 mr-0.5">
              <ArrowUpDown className="w-3 h-3" />Ordenar por
            </span>
            {CRITERIOS.map(c => (
              <button key={c.key} type="button" onClick={() => setCriterio(c.key)}
                className={cn('text-[11px] font-medium px-2 py-1 rounded-full border transition-colors',
                  criterio === c.key ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300')}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-10 text-center">Carregando…</p>
        ) : reps.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">Nenhum representante com pedidos no seu escopo.</p>
        ) : (
          <>
            {/* Top Performance */}
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Top Performance</p>
            <div className="grid sm:grid-cols-3 gap-2.5 mb-4">
              {top.map((r, i) => (
                <button key={r.representante} type="button" onClick={() => setSel(r)}
                  className="text-left rounded-2xl border border-gray-200/70 bg-white p-3 hover:shadow-md transition-shadow min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-gray-300">#{i + 1}</span>
                    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full border', BADGE[r.badge].cls)}>{BADGE[r.badge].label}</span>
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900 truncate mt-1">{r.representante}</p>
                  <p className="text-lg font-bold text-emerald-700 tabular-nums leading-none mt-1">{formatCurrency(r.totalVendido)}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden"><div className={cn('h-full rounded-full', BADGE[r.badge].bar)} style={{ width: `${r.score}%` }} /></div>
                    <span className="text-[10px] font-bold text-gray-500 tabular-nums">{r.score}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Atenção Necessária */}
            {atencao.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Atenção Necessária</p>
                <div className="grid sm:grid-cols-3 gap-2.5 mb-4">
                  {atencao.map(r => {
                    const risco = r.clientesAtrasados + r.clientesDormentes;
                    return (
                      <button key={r.representante} type="button" onClick={() => setSel(r)}
                        className="text-left rounded-2xl border border-red-100 bg-red-50/40 p-3 hover:shadow-md transition-shadow min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full border', BADGE[r.badge].cls)}>{BADGE[r.badge].label}</span>
                          <span className="text-[10px] font-bold text-gray-400 tabular-nums">score {r.score}</span>
                        </div>
                        <p className="text-[13px] font-semibold text-gray-900 truncate mt-1">{r.representante}</p>
                        <p className="text-xs font-medium text-red-600 mt-1">{risco > 0 ? `${risco} cliente(s) sem comprar +30d` : 'performance abaixo da média'}</p>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Matriz completa */}
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-3 py-2">Representante</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-center">Pedidos</th>
                    <th className="px-3 py-2 text-center" title="Ativos: compraram nos últimos 30 dias · Em risco: sem comprar há +30 dias">Clientes</th>
                    <th className="px-3 py-2 text-right">Média</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map(r => (
                    <tr key={r.representante} onClick={() => setSel(r)} className="hover:bg-gray-50/70 transition-colors cursor-pointer">
                      <td className="px-3 py-2 font-medium text-gray-800 truncate max-w-[220px]">{r.representante}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 w-28">
                          <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden"><div className={cn('h-full rounded-full', BADGE[r.badge].bar)} style={{ width: `${r.score}%` }} /></div>
                          <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6">{r.score}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden sm:block h-1 w-16 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${(r.totalVendido / maxRec) * 100}%` }} /></div>
                          {formatCurrency(r.totalVendido)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-600">{r.pedidos}</td>
                      <td className="px-3 py-2 text-[11px]" title={`${r.clientesAtrasados} atrasado(s) 31–60d · ${r.clientesDormentes} dormente(s) +60d`}>
                        <div className="flex items-center justify-center gap-3">
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />{r.clientesAtivos} ativos
                          </span>
                          {(r.clientesAtrasados + r.clientesDormentes) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-red-500 font-semibold whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />{r.clientesAtrasados + r.clientesDormentes} em risco
                            </span>
                          ) : (
                            <span className="text-gray-300">sem risco</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatCurrency(r.ticketMedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Rodapé: legenda + paginação */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mt-3 px-1">
              <p className="text-[10px] text-gray-400">Clique numa linha para ver o detalhe completo do representante (inclui atrasados e dormentes separados).</p>
              {ordenados.length > PAGE_SIZE && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-[11px] text-gray-400 tabular-nums">{primeiro}–{ultimo} de {ordenados.length}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage <= 0}
                      className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" aria-label="Página anterior">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-semibold text-gray-600 tabular-nums w-10 text-center">{safePage + 1}/{totalPages}</span>
                    <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1}
                      className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" aria-label="Próxima página">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      {/* Drawer de drill-down */}
      <AnimatePresence>
        {sel && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSel(null)} />
            <motion.div
              className="fixed z-50 bg-white shadow-2xl overflow-y-auto inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh] sm:inset-y-0 sm:right-0 sm:left-auto sm:bottom-auto sm:w-[380px] sm:max-h-none sm:rounded-none"
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100" style={{ borderTop: `3px solid ${sel.badge === 'excelente' ? '#22c55e' : sel.badge === 'bom' ? '#3b82f6' : sel.badge === 'atencao' ? '#f59e0b' : '#ef4444'}` }}>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Representante</p>
                  <h3 className="text-sm font-bold text-gray-900 leading-snug">{sel.representante}</h3>
                </div>
                <button type="button" onClick={() => setSel(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-3">
                {/* Score */}
                <div className="rounded-2xl bg-gray-50 border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500"><Award className="w-3.5 h-3.5" />Score comercial</span>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', BADGE[sel.badge].cls)}>{BADGE[sel.badge].label}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-2 flex-1 rounded-full bg-gray-200 overflow-hidden"><div className={cn('h-full rounded-full', BADGE[sel.badge].bar)} style={{ width: `${sel.score}%` }} /></div>
                    <span className="text-lg font-bold text-gray-800 tabular-nums">{sel.score}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Metric icon={DollarSign} label="Valor" value={formatCurrency(sel.totalVendido)} tone="text-emerald-700" />
                  <Metric icon={ShoppingCart} label="Pedidos" value={String(sel.pedidos)} />
                  <Metric icon={DollarSign} label="Média de pedido" value={formatCurrency(sel.ticketMedio)} />
                  <Metric icon={UsersRound} label="Clientes" value={String(sel.clientes)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Metric icon={UserCheck} label="Ativos" value={String(sel.clientesAtivos)} tone="text-emerald-700" />
                  <Metric icon={AlertTriangle} label="Atrasados" value={String(sel.clientesAtrasados)} tone="text-red-600" />
                  <Metric icon={Moon} label="Dormentes" value={String(sel.clientesDormentes)} tone="text-gray-500" />
                </div>
                {sel.ultimoPedido && (
                  <p className="text-[11px] text-gray-400 flex items-center gap-1.5 pt-1"><CalendarClock className="w-3.5 h-3.5" />Último pedido em {formatDate(sel.ultimoPedido)}</p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Card>
  );
}
