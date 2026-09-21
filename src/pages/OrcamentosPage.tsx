import { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { formatDate, formatCurrency } from '@/utils/formatters';
import SearchInput from '@/components/ui/SearchInput';
import Pagination from '@/components/ui/Pagination';
import PageContainer from '@/components/ui/PageContainer';
import Avatar from '@/components/ui/Avatar';
import { EntityCard, ProgressSteps, type ProgressStep } from '@/components/ui/cards';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import {
  Plus, FileText, Clock, CheckCircle, XCircle, Send, RotateCcw, Pencil, Trash2,
  AlertTriangle, FileDown, Copy, LayoutGrid, List, SquareKanban, Package,
  DollarSign, CalendarClock, ChevronDown, Loader2,
} from 'lucide-react';
import { baixarOrcamentoPDF } from '@/components/OrcamentoPDFButton';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { perfilDoUsuario } from '@/constants/perfis';
import { useOrcamentos } from '@/hooks/useOrcamentos';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { enviarOrcamento, excluirOrcamento, duplicarOrcamento } from '@/services/orcamentos';
import type { Orcamento, OrcamentoStatusReal } from '@/types';
import ValorAjustavel from '@/components/ui/ValorAjustavel';

// ─── Status config ─────────────────────────────────────
const STATUS_CONFIG: Record<OrcamentoStatusReal, {
  label: string; bg: string; text: string; icon: React.ElementType; accent: string;
}> = {
  rascunho:   { label: 'Rascunho',   bg: 'bg-gray-100', text: 'text-gray-600',  icon: FileText,    accent: '#9ca3af' },
  enviado:    { label: 'Enviado',    bg: 'bg-blue-50',  text: 'text-blue-700',  icon: Send,        accent: '#3b82f6' },
  em_analise: { label: 'Em Análise', bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock,       accent: '#f59e0b' },
  aprovado:   { label: 'Aprovado',   bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle, accent: '#22c55e' },
  rejeitado:  { label: 'Rejeitado',  bg: 'bg-red-50',   text: 'text-red-700',   icon: XCircle,     accent: '#ef4444' },
};

// Jornada do orçamento (ciclo de status) — mesmo padrão de "steps" da referência.
// Rejeitado é estado terminal (mostra o motivo, sem barra de etapas).
const QUOTE_STEPS: ProgressStep[] = [
  { key: 'rascunho',   label: 'Rascunho',   color: STATUS_CONFIG.rascunho.accent,   icon: FileText },
  { key: 'enviado',    label: 'Enviado',    color: STATUS_CONFIG.enviado.accent,    icon: Send },
  { key: 'em_analise', label: 'Em análise', color: STATUS_CONFIG.em_analise.accent, icon: Clock },
  { key: 'aprovado',   label: 'Aprovado',   color: STATUS_CONFIG.aprovado.accent,   icon: CheckCircle },
];
const QUOTE_STEP_IDX: Record<string, number> = { rascunho: 0, enviado: 1, em_analise: 2, aprovado: 3 };

const STATUSES = Object.keys(STATUS_CONFIG) as OrcamentoStatusReal[];
const PAGE_SIZE = 9;

type ViewMode = 'cards' | 'table' | 'kanban';

// ─── Helpers de valor / itens ──────────────────────────
function valorOrcamento(o: Orcamento): number {
  return (o.itens ?? []).reduce((s, it) => s + (it.preco_unitario ?? 0) * it.quantidade, 0);
}
function numProdutos(o: Orcamento): number {
  return (o.itens ?? []).filter(i => !i.is_adicional).length;
}
function nomeCliente(o: Orcamento): string {
  return o.cliente_fantasia?.trim() || o.cliente_nome;
}

function StatusBadge({ status }: { status: OrcamentoStatusReal }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full', cfg.bg, cfg.text)}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

// ─── Ações rápidas (inline, sem menu) ──────────────────
interface QuoteActions {
  onEditar: (o: Orcamento) => void;
  onEnviar: (id: string) => void;
  onDuplicar: (id: string) => void;
  onExcluir: (id: string) => void;
  duplicandoId: string | null;
}

function QuickActions({ orc, a, compact }: { orc: Orcamento; a: QuoteActions; compact?: boolean }) {
  const { user } = useAuth();
  const [pdfLoading, setPdfLoading] = useState(false);
  // Diretor é somente-leitura em Orçamentos (não edita/envia/duplica/exclui).
  if (perfilDoUsuario(user?.usuario) === 'diretor') return null;
  const btn = cn(
    'rounded-lg flex items-center justify-center transition-colors',
    compact ? 'w-7 h-7' : 'w-8 h-8',
    'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
  );

  async function pdf() {
    setPdfLoading(true);
    try { await baixarOrcamentoPDF(orc.id, orc.numero); }
    finally { setPdfLoading(false); }
  }

  return (
    <div className="flex items-center gap-0.5 touch-compact">
      {orc.status === 'rascunho' ? (
        <>
          <button type="button" title="Editar" aria-label="Editar" className={btn} onClick={e => { e.stopPropagation(); a.onEditar(orc); }}>
            <Pencil className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </button>
          <button type="button" title="Enviar para análise" aria-label="Enviar" className={cn(btn, 'hover:text-blue-600 hover:bg-blue-50')} onClick={e => { e.stopPropagation(); a.onEnviar(orc.id); }}>
            <Send className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </button>
        </>
      ) : (
        <button type="button" title="Baixar PDF" aria-label="Baixar PDF" className={btn} disabled={pdfLoading} onClick={e => { e.stopPropagation(); void pdf(); }}>
          {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
        </button>
      )}
      <button
        type="button" title="Duplicar" aria-label="Duplicar" className={btn}
        disabled={a.duplicandoId === orc.id}
        onClick={e => { e.stopPropagation(); a.onDuplicar(orc.id); }}
      >
        {a.duplicandoId === orc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
      </button>
      {orc.status === 'rascunho' && (
        <button type="button" title="Excluir" aria-label="Excluir" className={cn(btn, 'hover:text-red-600 hover:bg-red-50')} onClick={e => { e.stopPropagation(); a.onExcluir(orc.id); }}>
          <Trash2 className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </button>
      )}
    </div>
  );
}

// ─── Card rico ─────────────────────────────────────────
function QuoteCard({ orc, a, index }: { orc: Orcamento; a: QuoteActions; index: number }) {
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const valor = valorOrcamento(orc);
  const nProd = numProdutos(orc);
  const itens = orc.itens ?? [];

  return (
    <EntityCard layout index={index} accent={STATUS_CONFIG[orc.status].accent}>
      <div className="p-4 flex-1">
        {/* Linha 1: nº + status | ações */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-400">#{orc.numero}</span>
          <StatusBadge status={orc.status} />
          <div className="ml-auto"><QuickActions orc={orc} a={a} compact /></div>
        </div>

        {/* Cliente + obra + valor em destaque */}
        <div className="flex items-start justify-between gap-2 mt-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-[15px] leading-snug line-clamp-2">{nomeCliente(orc)}</p>
            {orc.obra_referencia && <p className="text-xs text-gray-400 mt-0.5 truncate">Obra: {orc.obra_referencia}</p>}
          </div>
          <p className={cn('font-bold text-base tabular-nums flex-shrink-0', valor > 0 ? 'text-gray-900' : 'text-gray-300')}>
            {valor > 0 ? formatCurrency(valor) : '—'}
          </p>
        </div>

        {/* Métricas */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs font-semibold tabular-nums text-gray-700 hover:bg-gray-100 transition-colors"
            title="Ver itens"
          >
            <Package className="w-3.5 h-3.5 text-gray-400" />
            {nProd} produto(s)
            <ChevronDown className={cn('w-3 h-3 text-gray-400 transition-transform', expanded && 'rotate-180')} />
          </button>
          {orc.validade && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs font-medium tabular-nums text-blue-700">
              <CalendarClock className="w-3.5 h-3.5 text-blue-500" />
              Val. {formatDate(orc.validade)}
            </span>
          )}
        </div>

        {/* Itens (embutidos — expande sem nova query) */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                {itens.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhum item adicionado</p>
                ) : itens.map((item, i) => (
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Motivo da rejeição */}
        {orc.status === 'rejeitado' && orc.observacoes && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-red-600 mb-0.5">Motivo da rejeição</p>
              <p className="text-xs text-red-700 line-clamp-3">{orc.observacoes}</p>
            </div>
          </div>
        )}
      </div>

      {/* Jornada do orçamento (etapas do status) */}
      {orc.status !== 'rejeitado' && (
        <div className="px-4 pb-3 pt-1">
          <ProgressSteps steps={QUOTE_STEPS} currentIndex={QUOTE_STEP_IDX[orc.status] ?? 0} />
        </div>
      )}

      {/* Rodapé: autor + data */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-50/60 border-t border-gray-100">
        {orc.autor ? (
          <span className="flex items-center gap-1.5 min-w-0" title={orc.representante_erp ?? undefined}>
            <Avatar nome={orc.autor.nome} avatarUrl={orc.autor.avatar_url} size="sm" className="!w-5 !h-5 text-[8px]" />
            <span className="text-[11px] text-gray-500 truncate max-w-[130px]">{orc.autor.nome}</span>
          </span>
        ) : <span />}
        <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">Criado {formatDate(orc.created_at)}</span>
      </div>
    </EntityCard>
  );
}

// ─── Visão em tabela ───────────────────────────────────
function QuoteTable({ orcs, a }: { orcs: Orcamento[]; a: QuoteActions }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="px-4 py-3">Nº</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Obra</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Itens</th>
              <th className="px-4 py-3">Autor</th>
              <th className="px-4 py-3">Criado</th>
              <th className="px-4 py-3">Validade</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {orcs.map(o => {
              const valor = valorOrcamento(o);
              return (
                <tr key={o.id} className="hover:bg-gray-50/70 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">#{o.numero}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-[200px]">{nomeCliente(o)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[140px]">{o.obra_referencia ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                    {valor > 0 ? formatCurrency(valor) : <span className="text-gray-300 font-normal">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-gray-700">{numProdutos(o)}</td>
                  <td className="px-4 py-3">
                    {o.autor ? (
                      <span className="flex items-center gap-1.5">
                        <Avatar nome={o.autor.nome} avatarUrl={o.autor.avatar_url} size="sm" className="!w-5 !h-5 text-[8px]" />
                        <span className="text-xs text-gray-500 truncate max-w-[110px]">{o.autor.nome}</span>
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">{formatDate(o.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">{o.validade ? formatDate(o.validade) : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end"><QuickActions orc={o} a={a} compact /></div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Visão Kanban ──────────────────────────────────────
function QuoteKanban({ orcs, a }: { orcs: Orcamento[]; a: QuoteActions }) {
  const reduce = useReducedMotion();
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <div className="flex gap-3 min-w-max items-start">
        {STATUSES.map(status => {
          const cfg = STATUS_CONFIG[status];
          const col = orcs.filter(o => o.status === status);
          return (
            <div key={status} className="w-[270px] flex-shrink-0 rounded-2xl bg-gray-50/80 border border-gray-100 p-2">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.accent }} />
                <span className="text-xs font-semibold text-gray-700">{cfg.label}</span>
                <span className="text-[10px] font-bold text-gray-400 bg-white border border-gray-200 rounded-full px-1.5 py-0.5 tabular-nums">{col.length}</span>
              </div>
              <div className="space-y-2 mt-1">
                {col.length === 0 ? (
                  <p className="text-[11px] text-gray-300 text-center py-6">Vazio</p>
                ) : col.map((o, i) => {
                  const valor = valorOrcamento(o);
                  return (
                    <motion.div
                      key={o.id}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.2) }}
                      className="rounded-xl bg-white border border-gray-200/70 shadow-sm p-3"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[10px] text-gray-400">#{o.numero}</span>
                        <QuickActions orc={o} a={a} compact />
                      </div>
                      <p className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-2 mt-1">{nomeCliente(o)}</p>
                      {o.obra_referencia && <p className="text-[11px] text-gray-400 truncate mt-0.5">{o.obra_referencia}</p>}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-bold text-emerald-700 tabular-nums">
                          {valor > 0 ? formatCurrency(valor) : <span className="text-gray-300 font-normal">—</span>}
                        </span>
                        <span className="text-[10px] text-gray-400 tabular-nums">{formatDate(o.created_at)}</span>
                      </div>
                      {o.autor && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-50">
                          <Avatar nome={o.autor.nome} avatarUrl={o.autor.avatar_url} size="sm" className="!w-4 !h-4 text-[7px]" />
                          <span className="text-[10px] text-gray-400 truncate">{o.autor.nome}</span>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── KPI card ──────────────────────────────────────────
function KpiCard({ label, value, tone, active, onClick, icon: Icon }: {
  label: string; value: string; tone?: string; active?: boolean; onClick?: () => void; icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'rounded-2xl bg-white border shadow-sm px-3.5 py-3 text-left transition-all min-w-0',
        onClick && 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer',
        active ? 'border-[hsl(142,93%,8%)] ring-1 ring-[hsl(142,93%,8%)]/20' : 'border-gray-200/70',
      )}
    >
      <div className="flex items-center gap-1.5 text-gray-400 min-w-0">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <p className="text-[10px] font-semibold uppercase tracking-wider truncate">{label}</p>
      </div>
      <div className="mt-1"><ValorAjustavel valor={value} className={cn('font-bold', tone ?? 'text-gray-900')} /></div>
    </button>
  );
}

// ─── Página ────────────────────────────────────────────
export default function OrcamentosPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const statusParam = searchParams.get('status');
  const statusInicial: OrcamentoStatusReal | 'todos' =
    statusParam && (STATUSES as string[]).includes(statusParam)
      ? (statusParam as OrcamentoStatusReal)
      : 'todos';

  const { user } = useAuth();
  const isDiretor = perfilDoUsuario(user?.usuario) === 'diretor';
  const [search, setSearch] = useState('');
  // 'analise' é um pseudo-filtro que cobre enviado + em_analise (como o KPI)
  const [statusFilter, setStatusFilter] = useState<OrcamentoStatusReal | 'todos' | 'analise'>(statusInicial);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('orc_view');
    return saved === 'table' || saved === 'kanban' ? saved : 'cards';
  });
  const [confirmEnviar, setConfirmEnviar] = useState<string | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem('orc_view', view); }, [view]);
  // No mobile a tabela não é a visão principal → cai para cards.
  const isDesktop = useIsDesktop();
  const effView: ViewMode = view === 'table' && !isDesktop ? 'cards' : view;

  const qc = useQueryClient();
  const { data: orcamentos = [], isLoading } = useOrcamentos();

  const enviarMut = useMutation({
    mutationFn: enviarOrcamento,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orcamentos'] }); setConfirmEnviar(null); },
  });
  const excluirMut = useMutation({
    mutationFn: excluirOrcamento,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orcamentos'] }); setConfirmExcluir(null); },
  });
  const duplicarMut = useMutation({
    mutationFn: (id: string) => duplicarOrcamento(id, user!.usuario!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orcamentos'] }),
  });

  const actions: QuoteActions = {
    onEditar: o => navigate(`/orcamentos/${o.id}/editar`),
    onEnviar: setConfirmEnviar,
    onDuplicar: id => duplicarMut.mutate(id),
    onExcluir: setConfirmExcluir,
    duplicandoId: duplicarMut.isPending ? (duplicarMut.variables ?? null) : null,
  };

  const filtered = useMemo(() => {
    let list = [...orcamentos];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.numero.toLowerCase().includes(q) ||
        o.cliente_nome.toLowerCase().includes(q) ||
        (o.cliente_fantasia ?? '').toLowerCase().includes(q) ||
        o.cliente_cnpj.includes(q) ||
        (o.obra_referencia ?? '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'todos' && view !== 'kanban') {
      list = statusFilter === 'analise'
        ? list.filter(o => o.status === 'enviado' || o.status === 'em_analise')
        : list.filter(o => o.status === statusFilter);
    }
    return list;
  }, [orcamentos, search, statusFilter, view]);

  // KPIs (sobre TODOS os orçamentos, não os filtrados)
  const kpis = useMemo(() => {
    const c = (s: OrcamentoStatusReal) => orcamentos.filter(o => o.status === s).length;
    const pipelineValue = orcamentos
      .filter(o => o.status === 'enviado' || o.status === 'em_analise' || o.status === 'aprovado')
      .reduce((s, o) => s + valorOrcamento(o), 0);
    return {
      total: orcamentos.length,
      rascunho: c('rascunho'),
      analise: c('enviado') + c('em_analise'),
      aprovado: c('aprovado'),
      rejeitado: c('rejeitado'),
      pipelineValue,
    };
  }, [orcamentos]);

  // Paginação (cards e tabela; kanban mostra tudo)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );
  useEffect(() => { setPage(1); }, [search, statusFilter, view]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  function goToPage(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Alterna o filtro de status pelos KPIs (clicar de novo volta a "todos")
  function toggleStatus(s: OrcamentoStatusReal | 'todos' | 'analise') {
    setStatusFilter(prev => (prev === s ? 'todos' : s));
  }

  if (isLoading) {
    return (
      <div className="p-5 space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  const VIEWS: { key: ViewMode; icon: React.ElementType; label: string }[] = [
    { key: 'cards',  icon: LayoutGrid,   label: 'Cards'  },
    { key: 'table',  icon: List,         label: 'Tabela' },
    { key: 'kanban', icon: SquareKanban, label: 'Kanban' },
  ];

  return (
    <PageContainer>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Orçamentos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filtered.length} orçamento(s)
            {view !== 'kanban' && filtered.length > PAGE_SIZE && (
              <span className="text-gray-400"> · mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</span>
            )}
          </p>
        </div>
        {!isDiretor && (
          <Link
            to="/orcamentos/novo"
            className="flex items-center gap-1.5 h-10 px-3 sm:px-4 bg-[hsl(142,93%,8%)] text-white text-sm font-medium rounded-xl hover:bg-[hsl(142,93%,15%)] transition-colors shadow-sm flex-shrink-0"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span className="hidden sm:inline">Novo Orçamento</span>
          </Link>
        )}
      </div>

      {/* KPIs (clicáveis: filtram por status) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <KpiCard icon={FileText} label="Total" value={String(kpis.total)}
          active={statusFilter === 'todos'} onClick={() => setStatusFilter('todos')} />
        <KpiCard icon={FileText} label="Rascunhos" value={String(kpis.rascunho)}
          active={statusFilter === 'rascunho'} onClick={() => toggleStatus('rascunho')} />
        <KpiCard icon={Clock} label="Em Análise" value={String(kpis.analise)} tone="text-amber-600"
          active={statusFilter === 'analise' || statusFilter === 'enviado' || statusFilter === 'em_analise'} onClick={() => toggleStatus('analise')} />
        <KpiCard icon={CheckCircle} label="Aprovados" value={String(kpis.aprovado)} tone="text-emerald-700"
          active={statusFilter === 'aprovado'} onClick={() => toggleStatus('aprovado')} />
        <KpiCard icon={XCircle} label="Rejeitados" value={String(kpis.rejeitado)} tone="text-red-600"
          active={statusFilter === 'rejeitado'} onClick={() => toggleStatus('rejeitado')} />
        <KpiCard icon={DollarSign} label="Valor Pipeline" tone="text-emerald-700"
          value={kpis.pipelineValue > 0 ? formatCurrency(kpis.pipelineValue) : '—'} />
      </div>

      {/* Toolbar: busca + view switcher */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nº, cliente, obra..." />
        </div>
        <div className="inline-flex rounded-xl bg-gray-100 p-0.5 flex-shrink-0 touch-compact">
          {VIEWS.filter(v => v.key !== 'table' || isDesktop).map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              title={v.label}
              className={cn(
                'flex items-center gap-1.5 px-2.5 sm:px-3 h-9 text-xs font-medium rounded-[10px] transition-colors',
                effView === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              <v.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Aviso de status filtrado (útil no kanban, onde o filtro não se aplica) */}
      {statusFilter !== 'todos' && view === 'kanban' && (
        <p className="text-[11px] text-gray-400 -mt-2">
          O Kanban mostra todos os status; o filtro "{statusFilter === 'analise' ? 'Em Análise' : STATUS_CONFIG[statusFilter].label}" se aplica às visões Cards e Tabela.
        </p>
      )}

      {/* Conteúdo */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm py-16 text-center">
          <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Nenhum orçamento encontrado</p>
          <Link
            to="/orcamentos/novo"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-[hsl(142,93%,8%)] font-medium hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar primeiro orçamento
          </Link>
        </div>
      ) : effView === 'kanban' ? (
        <QuoteKanban orcs={filtered} a={actions} />
      ) : effView === 'table' ? (
        <>
          <QuoteTable orcs={paginated} a={actions} />
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={goToPage} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
            {paginated.map((orc, i) => (
              <QuoteCard key={orc.id} orc={orc} a={actions} index={i} />
            ))}
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={goToPage} />
        </>
      )}

      {/* Erro ao duplicar */}
      {duplicarMut.isError && (
        <div className="fixed bottom-20 right-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          Erro ao duplicar o orçamento. Tente novamente.
        </div>
      )}

      {/* Confirm enviar */}
      {confirmEnviar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-2">Enviar orçamento?</h3>
            <p className="text-sm text-gray-600 mb-4">
              O orçamento será encaminhado para a equipe de análise. Após enviado não será possível editar.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmEnviar(null)}
                className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => enviarMut.mutate(confirmEnviar)}
                disabled={enviarMut.isPending}
                className="h-9 px-4 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {enviarMut.isPending && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
                Confirmar Envio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm excluir */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-2">Excluir rascunho?</h3>
            <p className="text-sm text-gray-600 mb-4">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmExcluir(null)}
                className="h-9 px-4 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => excluirMut.mutate(confirmExcluir)}
                disabled={excluirMut.isPending}
                className="h-9 px-4 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
