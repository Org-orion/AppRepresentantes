import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { formatDate, formatCurrencyK } from '@/utils/formatters';
import Select from '@/components/ui/Select';
import SearchInput from '@/components/ui/SearchInput';
import Pagination from '@/components/ui/Pagination';
import PageContainer from '@/components/ui/PageContainer';
import DataError from '@/components/ui/DataError';
import TruncationNotice from '@/components/ui/TruncationNotice';
import {
  FileText, Receipt, Download, Paperclip, X, Check, AlertTriangle, SlidersHorizontal,
  List, LayoutGrid, Activity, ChevronRight, CheckCircle2, CircleDashed, Sparkles,
  Truck, History, Share2, ExternalLink, ClipboardCheck, FolderOpen,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { MetricCard as KpiCard, EntityCard, Badge, CardActionFooter } from '@/components/ui/cards';
import { useNavigate } from 'react-router-dom';
import { useFinanceiro } from '@/hooks/useFinanceiro';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import MobileBottomSheet from '@/components/ui/MobileBottomSheet';
import type { PedidoFinanceiro, AnexoItem } from '@/services/financeiro';

const PAGE = 24;
const DAY = 86_400_000;

type ViewMode = 'cards' | 'table' | 'timeline';
type DocStatus = 'completo' | 'parcial' | 'pendente' | 'sem';
type QuickKey = 'completo' | 'so_nf' | 'so_boleto' | 'sem' | 'multi_boleto' | 'hoje' | 'sete_dias' | 'pendente' | 'atencao';

function classify(tipo: string): 'nf' | 'boleto' | 'outro' {
  const t = (tipo ?? '').toLowerCase();
  if (t.includes('boleto')) return 'boleto';
  if (t.includes('nota') || t.includes('nf') || t.includes('fiscal')) return 'nf';
  return 'outro';
}
function nfs(p: PedidoFinanceiro) { return p.anexos.filter(a => classify(a.tipo) === 'nf'); }
function boletos(p: PedidoFinanceiro) { return p.anexos.filter(a => classify(a.tipo) === 'boleto'); }
function temNF(p: PedidoFinanceiro) { return nfs(p).length > 0; }
function temBoleto(p: PedidoFinanceiro) { return boletos(p).length > 0; }
function nomeCliente(p: PedidoFinanceiro) { return p.cliente_fantasia?.trim() || p.cliente_nome || 'Cliente'; }

// Status documental
function docStatus(p: PedidoFinanceiro): DocStatus {
  const nf = temNF(p), bol = temBoleto(p);
  if (nf && bol) return 'completo';
  if (nf || bol) return 'parcial';
  return p.faturado ? 'pendente' : 'sem';
}
// Integridade (0/50/100) considerando NF + boleto
function integridade(p: PedidoFinanceiro): number {
  return (temNF(p) ? 50 : 0) + (temBoleto(p) ? 50 : 0);
}
// Faturado sem documentação completa → exige atenção
function exigeAtencao(p: PedidoFinanceiro): boolean {
  return p.faturado && !(temNF(p) && temBoleto(p));
}
function parseData(d?: string | null): Date | null {
  if (!d) return null;
  const s = d.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(d);
}

const DOC_META: Record<DocStatus, { label: string; chip: string; dot: string; border: string }> = {
  completo: { label: 'Completo', chip: 'bg-emerald-50 text-emerald-700', dot: '#22c55e', border: '#22c55e' },
  parcial:  { label: 'Parcial',  chip: 'bg-orange-50 text-orange-700',  dot: '#f97316', border: '#f97316' },
  pendente: { label: 'Pendente', chip: 'bg-red-50 text-red-600',        dot: '#ef4444', border: '#ef4444' },
  sem:      { label: 'Sem docs', chip: 'bg-gray-100 text-gray-500',     dot: '#9ca3af', border: '#d1d5db' },
};

// ─── Badges ──────────────────────────────────────────────
function StatusPill({ s }: { s: DocStatus }) {
  const m = DOC_META[s];
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', m.chip)}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.dot }} />{m.label}
    </span>
  );
}
function DocBadge({ ok, label, count }: { ok: boolean; label: string; count?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border',
      ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
      {ok ? <Check className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
      {label}{ok && count && count > 1 ? ` ×${count}` : ''}
    </span>
  );
}
function IntegridadeBar({ pct }: { pct: number }) {
  const color = pct === 100 ? '#22c55e' : pct === 50 ? '#f97316' : '#ef4444';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>{pct}%</span>
    </div>
  );
}

// ─── KPI / chip ──────────────────────────────────────────
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

// ─── Card ────────────────────────────────────────────────
function DocCard({ pedido, onOpen, index, conferido }: { pedido: PedidoFinanceiro; onOpen: (p: PedidoFinanceiro) => void; index: number; conferido?: boolean }) {
  const s = docStatus(pedido);
  const nBol = boletos(pedido).length;

  return (
    <EntityCard layout index={index} onClick={() => onOpen(pedido)} accent={DOC_META[s].border}>
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-gray-400">#{pedido.numero_pedido}</span>
          <StatusPill s={s} />
          {exigeAtencao(pedido) && <Badge tone="danger" icon={AlertTriangle}>Atenção</Badge>}
          {conferido && <Badge tone="positive" icon={Check}>Conferido</Badge>}
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{formatDate(pedido.data_emissao)}</span>
        </div>

        <div className="flex items-start justify-between gap-2 mt-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-[15px] leading-snug line-clamp-2 group-hover:text-[hsl(142,93%,8%)] transition-colors">{nomeCliente(pedido)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">{pedido.cliente_cnpj}</p>
          </div>
          {pedido.total_pedido_venda > 0 && <p className="font-bold text-base tabular-nums text-gray-900 flex-shrink-0">{formatCurrencyK(pedido.total_pedido_venda)}</p>}
        </div>

        {/* Integridade documental */}
        <div className="mt-3"><IntegridadeBar pct={integridade(pedido)} /></div>
      </div>

      {/* Rodapé: documentos + ação (padrão da referência) */}
      <CardActionFooter
        left={<>
          <DocBadge ok={temNF(pedido)} label="NF" count={nfs(pedido).length} />
          <DocBadge ok={temBoleto(pedido)} label="Boleto" count={nBol} />
        </>}
        right={
          <span className="inline-flex items-center gap-1 rounded-xl bg-[hsl(142,93%,8%)] text-white text-[11px] font-semibold px-3 py-1.5 group-hover:brightness-125 transition-all">
            Ver detalhes <ChevronRight className="w-3 h-3" />
          </span>
        }
      />
    </EntityCard>
  );
}

// ─── Tabela ──────────────────────────────────────────────
function TableView({ pedidos, onOpen }: { pedidos: PedidoFinanceiro[]; onOpen: (p: PedidoFinanceiro) => void }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Emissão</th>
              <th className="px-4 py-3">Status documental</th>
              <th className="px-4 py-3 text-center">NF</th>
              <th className="px-4 py-3 text-center">Boleto</th>
              <th className="px-4 py-3 text-center">Boletos</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pedidos.map(p => {
              const nBol = boletos(p).length;
              return (
                <tr key={p.numero_pedido} onClick={() => onOpen(p)} className="hover:bg-gray-50/70 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">#{p.numero_pedido}</td>
                  <td className="px-4 py-3"><p className="font-medium text-gray-900 truncate max-w-[220px]">{nomeCliente(p)}</p></td>
                  <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">{formatDate(p.data_emissao)}</td>
                  <td className="px-4 py-3"><StatusPill s={docStatus(p)} /></td>
                  <td className="px-4 py-3 text-center">{temNF(p) ? <Check className="w-4 h-4 text-emerald-500 mx-auto" /> : <X className="w-4 h-4 text-gray-300 mx-auto" />}</td>
                  <td className="px-4 py-3 text-center">{temBoleto(p) ? <Check className="w-4 h-4 text-emerald-500 mx-auto" /> : <X className="w-4 h-4 text-gray-300 mx-auto" />}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-gray-600">{nBol > 0 ? nBol : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end"><span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(142,93%,8%)]">Detalhes<ChevronRight className="w-3 h-3" /></span></div>
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

// ─── Timeline ────────────────────────────────────────────
function TimelineView({ pedidos, onOpen }: { pedidos: PedidoFinanceiro[]; onOpen: (p: PedidoFinanceiro) => void }) {
  const reduce = useReducedMotion();
  const eventos = useMemo(() => {
    type Ev = { numero: string; cliente: string; tipo: 'nf' | 'boleto' | 'outro'; data: string; pedido: PedidoFinanceiro };
    const evs: Ev[] = [];
    for (const p of pedidos) {
      for (const a of p.anexos) {
        const data = a.criado_em || p.data_emissao;
        if (data) evs.push({ numero: p.numero_pedido, cliente: nomeCliente(p), tipo: classify(a.tipo), data, pedido: p });
      }
    }
    evs.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
    const grupos = new Map<string, Ev[]>();
    for (const e of evs.slice(0, 150)) {
      const dia = (e.data ?? '').slice(0, 10);
      const arr = grupos.get(dia) ?? []; arr.push(e); grupos.set(dia, arr);
    }
    return [...grupos.entries()];
  }, [pedidos]);

  const hoje = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const rotulo = (d: string) => d === hoje ? 'Hoje' : d === ontem ? 'Ontem' : formatDate(d);

  if (eventos.length === 0) return <p className="text-sm text-gray-400 text-center py-10">Nenhum documento recente</p>;

  return (
    <div className="space-y-5 max-w-2xl">
      {eventos.map(([dia, evs]) => (
        <div key={dia}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{rotulo(dia)}</p>
          <div className="relative pl-6">
            <div className="absolute left-[9px] top-1 bottom-1 w-px bg-gray-100" />
            <div className="space-y-2.5">
              {evs.map((e, i) => {
                const Icon = e.tipo === 'nf' ? FileText : e.tipo === 'boleto' ? Receipt : Paperclip;
                const color = e.tipo === 'nf' ? '#a855f7' : e.tipo === 'boleto' ? '#3b82f6' : '#9ca3af';
                return (
                  <motion.button key={`${e.numero}-${i}`} type="button" onClick={() => onOpen(e.pedido)}
                    initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.2) }}
                    className="relative flex items-center gap-3 w-full text-left rounded-xl hover:bg-white p-2 -ml-2 transition-colors">
                    <span className="absolute -left-[19px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-gray-50" style={{ backgroundColor: color }}>
                      <Icon className="w-2.5 h-2.5 text-white" />
                    </span>
                    <div className="flex-1 min-w-0 ml-1">
                      <p className="text-xs text-gray-700">
                        {e.tipo === 'nf' ? 'NF' : e.tipo === 'boleto' ? 'Boleto' : 'Anexo'} anexado no pedido <span className="font-mono text-gray-400">#{e.numero}</span>
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">{e.cliente}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
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
function AnexoLinha({ anexo, rotulo }: { anexo: AnexoItem; rotulo: string }) {
  const cls = classify(anexo.tipo);
  const Icon = cls === 'nf' ? FileText : cls === 'boleto' ? Receipt : Paperclip;
  return (
    <a href={anexo.arquivo_url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-xl border border-gray-200 p-2.5 hover:bg-gray-50 transition-colors">
      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', cls === 'nf' ? 'bg-purple-50 text-purple-500' : cls === 'boleto' ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-500')}><Icon className="w-4 h-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="text-xs font-medium text-gray-800 block truncate">{anexo.arquivo_nome || rotulo}</span>
        <span className="text-[10px] text-gray-400">{anexo.criado_em ? `anexado ${formatDate(anexo.criado_em)}` : 'clique para baixar'}</span>
      </span>
      <Download className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
    </a>
  );
}

function DocDrawer({ pedido, onClose, onToast, conferido, onConferir }: {
  pedido: PedidoFinanceiro; onClose: () => void; onToast: (m: string) => void; conferido: boolean; onConferir: () => void;
}) {
  const navigate = useNavigate();
  const [baixando, setBaixando] = useState(false);
  const s = docStatus(pedido);
  const listaNF = nfs(pedido);
  const listaBol = boletos(pedido);
  const outros = pedido.anexos.filter(a => classify(a.tipo) === 'outro');

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  // Dispara um download real via <a download>; síncrono (dentro do gesto de clique),
  // evitando o bloqueio de pop-up que ocorria com window.open + setTimeout.
  function baixarArquivo(url: string, nome?: string) {
    const a = document.createElement('a');
    a.href = url;
    if (nome) a.download = nome;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function baixarTudo() {
    if (pedido.anexos.length === 0) return;
    setBaixando(true);
    pedido.anexos.forEach(a => baixarArquivo(a.arquivo_url, a.arquivo_nome));
    onToast(`Baixando ${pedido.anexos.length} documento(s)`);
    setTimeout(() => setBaixando(false), 1200);
  }

  async function compartilhar() {
    const rot = (t: string) => { const c = classify(t); return c === 'nf' ? 'NF' : c === 'boleto' ? 'Boleto' : 'Anexo'; };
    const links = pedido.anexos.map(a => `${rot(a.tipo)}: ${a.arquivo_url}`).join('\n');
    const texto = `Documentos do pedido #${pedido.numero_pedido} — ${nomeCliente(pedido)}${links ? '\n' + links : ''}`;
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };

    // 1) tenta compartilhar os ARQUIVOS (celular com suporte a Web Share de files)
    try {
      if (pedido.anexos.length > 0 && typeof nav.canShare === 'function') {
        const files = await Promise.all(pedido.anexos.slice(0, 10).map(async a => {
          const res = await fetch(a.arquivo_url);
          const blob = await res.blob();
          return new File([blob], a.arquivo_nome || 'documento.pdf', { type: blob.type || 'application/pdf' });
        }));
        if (nav.canShare({ files })) {
          await navigator.share({ files, title: `Pedido #${pedido.numero_pedido}`, text: `Documentos — ${nomeCliente(pedido)}` });
          onToast('Documentos compartilhados');
          return;
        }
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;   // usuário cancelou
      // qualquer outro erro (CORS ao buscar o arquivo etc.) → cai para o texto
    }
    // 2) compartilha o TEXTO com os links dos documentos
    try {
      if (navigator.share) { await navigator.share({ title: `Pedido #${pedido.numero_pedido}`, text: texto }); return; }
    } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
    // 3) copia os links para a área de transferência
    try { await navigator.clipboard.writeText(texto); onToast('Links dos documentos copiados'); }
    catch { onToast('Não foi possível compartilhar'); }
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="drawer-overlay absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="drawer-panel absolute right-0 top-0 h-full w-full sm:max-w-lg bg-white shadow-2xl flex flex-col">
        <div className="p-5 pb-4 border-b border-gray-100" style={{ borderTop: `3px solid ${DOC_META[s].border}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-gray-400">#{pedido.numero_pedido}</span>
                <StatusPill s={s} />
                {exigeAtencao(pedido) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Atenção</span>}
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
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Emissão</p><p className="text-sm font-bold text-gray-900 tabular-nums">{formatDate(pedido.data_emissao)}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] text-gray-400">Valor</p><p className="text-sm font-bold text-gray-900 tabular-nums">{pedido.total_pedido_venda > 0 ? formatCurrencyK(pedido.total_pedido_venda) : '—'}</p></div>
          </div>
          <div>
            <p className="text-[11px] text-gray-400 mb-1">Integridade documental</p>
            <IntegridadeBar pct={integridade(pedido)} />
          </div>

          {/* Documentos */}
          <DrawerSecao titulo="Documentos" icon={FolderOpen}>
            <div className="flex items-center gap-2 mb-2.5">
              <DocBadge ok={temNF(pedido)} label={temNF(pedido) ? 'NF anexada' : 'NF pendente'} />
              <DocBadge ok={temBoleto(pedido)} label={temBoleto(pedido) ? 'Boleto anexado' : 'Boleto pendente'} count={listaBol.length} />
            </div>
            {pedido.anexos.length === 0 ? (
              <p className="text-xs text-gray-400">{pedido.faturado ? 'Pedido faturado sem documentos anexados.' : 'Nenhum documento anexado.'}</p>
            ) : (
              <div className="space-y-3">
                {listaNF.length > 0 && (
                  <div><p className="text-[10px] text-gray-400 mb-1">Notas fiscais ({listaNF.length})</p>
                    <div className="space-y-1.5">{listaNF.map((a, i) => <AnexoLinha key={i} anexo={a} rotulo={`Nota fiscal ${i + 1}`} />)}</div></div>
                )}
                {listaBol.length > 0 && (
                  <div><p className="text-[10px] text-gray-400 mb-1">Boletos ({listaBol.length})</p>
                    <div className="space-y-1.5">{listaBol.map((a, i) => <AnexoLinha key={i} anexo={a} rotulo={`Boleto ${i + 1}`} />)}</div></div>
                )}
                {outros.length > 0 && (
                  <div><p className="text-[10px] text-gray-400 mb-1">Outros anexos ({outros.length})</p>
                    <div className="space-y-1.5">{outros.map((a, i) => <AnexoLinha key={i} anexo={a} rotulo={`Anexo ${i + 1}`} />)}</div></div>
                )}
              </div>
            )}
          </DrawerSecao>

          {/* Relação com o pedido */}
          <DrawerSecao titulo="Relação com o pedido" icon={Truck}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><p className="text-[10px] text-gray-400">Situação</p><p className="text-xs font-medium text-gray-800">{pedido.faturado ? 'Faturado' : 'Em processamento'}</p></div>
              <div><p className="text-[10px] text-gray-400">Entrega</p><p className="text-xs font-medium text-gray-800">{pedido.situacao_entrega ?? '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Cidade / UF</p><p className="text-xs font-medium text-gray-800">{pedido.cliente_cidade ? `${pedido.cliente_cidade}/${pedido.cliente_uf}` : '—'}</p></div>
              <div><p className="text-[10px] text-gray-400">Representante</p><p className="text-xs font-medium text-gray-800 truncate">{pedido.representante ?? '—'}</p></div>
            </div>
          </DrawerSecao>

          {/* Histórico */}
          <DrawerSecao titulo="Histórico documental" icon={History}>
            {pedido.anexos.length === 0 ? <p className="text-xs text-gray-400">Sem anexos registrados.</p> : (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-100" />
                <div className="space-y-2.5">
                  {[...pedido.anexos].sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? '')).map((a, i) => {
                    const cls = classify(a.tipo);
                    return (
                      <div key={i} className="relative">
                        <span className="absolute -left-5 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ backgroundColor: cls === 'nf' ? '#a855f7' : cls === 'boleto' ? '#3b82f6' : '#9ca3af' }} />
                        <p className="text-xs font-medium text-gray-800">{cls === 'nf' ? 'Nota fiscal' : cls === 'boleto' ? 'Boleto' : 'Anexo'} adicionado</p>
                        <p className="text-[10px] text-gray-400 tabular-nums">{a.criado_em ? formatDate(a.criado_em) : '—'}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </DrawerSecao>
        </div>

        {/* Ações */}
        <div className="border-t border-gray-100 p-4 space-y-2">
          <div className="flex gap-2">
            <button onClick={baixarTudo} disabled={pedido.anexos.length === 0 || baixando}
              className="flex-1 h-11 rounded-xl bg-[hsl(142,93%,8%)] text-white text-sm font-medium hover:bg-[hsl(142,93%,15%)] transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2">
              <Download className="w-4 h-4" />{pedido.anexos.length === 0 ? 'Sem documentos' : baixando ? 'Baixando...' : `Baixar tudo (${pedido.anexos.length})`}
            </button>
            <button onClick={compartilhar} className="h-11 px-4 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center" title="Compartilhar"><Share2 className="w-4 h-4" /></button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate(`/pedidos?busca=${encodeURIComponent(pedido.numero_pedido)}`)} className="flex-1 h-10 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Abrir pedido</button>
            <button onClick={onConferir}
              className={cn('flex-1 h-10 rounded-xl text-sm font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 border',
                conferido ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
              {conferido ? <Check className="w-3.5 h-3.5" /> : <ClipboardCheck className="w-3.5 h-3.5" />}{conferido ? 'Conferido' : 'Marcar conferido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────
export default function FinanceiroPage() {
  const hoje = useMemo(() => new Date(), []);
  const { data: pedidos = [], isLoading, isError, refetch } = useFinanceiro();
  const reduce = useReducedMotion();

  const [view, setView] = useState<ViewMode>(() => {
    const s = localStorage.getItem('fin_view');
    return s === 'table' || s === 'timeline' ? s : 'cards';
  });
  useEffect(() => { localStorage.setItem('fin_view', view); }, [view]);
  // No mobile a tabela não é a visão principal → cai para cards.
  const isDesktop = useIsDesktop();
  const effView: ViewMode = view === 'table' && !isDesktop ? 'cards' : view;

  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<'' | DocStatus>('');
  const [representante, setRepresentante] = useState('');
  const [quick, setQuick] = useState<Set<QuickKey>>(new Set());
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<PedidoFinanceiro | null>(null);
  const [toasts, setToasts] = useState<{ id: number; m: string }[]>([]);

  // Pedidos marcados como conferidos — persiste em localStorage (não há tabela no banco)
  const [conferidos, setConferidos] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('fin_conferidos') || '[]')); } catch { return new Set(); }
  });
  function toggleConferido(numero: string) {
    setConferidos(prev => {
      const n = new Set(prev);
      const era = n.has(numero);
      if (era) n.delete(numero); else n.add(numero);
      try { localStorage.setItem('fin_conferidos', JSON.stringify([...n])); } catch { /* quota */ }
      toast(era ? 'Marcação de conferência removida' : 'Pedido marcado como conferido');
      return n;
    });
  }

  function toast(m: string) {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, m }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  }

  const reps = useMemo(() => [...new Set(pedidos.map(p => p.representante).filter(Boolean) as string[])].sort(), [pedidos]);

  const matchQuick = useCallback((p: PedidoFinanceiro): boolean => {
    const dEmiss = parseData(p.data_emissao);
    for (const q of quick) {
      if (q === 'completo' && docStatus(p) !== 'completo') return false;
      if (q === 'so_nf' && !(temNF(p) && !temBoleto(p))) return false;
      if (q === 'so_boleto' && !(temBoleto(p) && !temNF(p))) return false;
      if (q === 'sem' && p.anexos.length > 0) return false;
      if (q === 'multi_boleto' && boletos(p).length < 2) return false;
      if (q === 'pendente' && docStatus(p) !== 'pendente') return false;
      if (q === 'atencao' && !exigeAtencao(p)) return false;
      if (q === 'hoje') { const has = p.anexos.some(a => (a.criado_em ?? '').slice(0, 10) === hoje.toISOString().slice(0, 10)); if (!has) return false; }
      if (q === 'sete_dias') {
        const recente = p.anexos.some(a => { const d = parseData(a.criado_em); return d && (hoje.getTime() - d.getTime()) <= 7 * DAY; }) || (dEmiss && (hoje.getTime() - dEmiss.getTime()) <= 7 * DAY);
        if (!recente) return false;
      }
    }
    return true;
  }, [quick, hoje]);

  const filtrados = useMemo(() => {
    let list = pedidos;
    if (statusFiltro) list = list.filter(p => docStatus(p) === statusFiltro);
    if (representante) list = list.filter(p => p.representante === representante);
    if (busca) {
      const q = busca.toLowerCase();
      list = list.filter(p => p.numero_pedido.toLowerCase().includes(q) || p.cliente_nome.toLowerCase().includes(q) || (p.cliente_fantasia ?? '').toLowerCase().includes(q) || (p.cliente_cnpj ?? '').includes(q));
    }
    return list.filter(matchQuick);
  }, [pedidos, statusFiltro, representante, busca, matchQuick]);

  useEffect(() => { setPage(1); }, [statusFiltro, representante, busca, quick, view]);

  const kpis = useMemo(() => {
    let nf = 0, bol = 0, completo = 0, parcial = 0, pendente = 0, semDoc = 0, faturadoIncompleto = 0;
    for (const p of pedidos) {
      nf += nfs(p).length; bol += boletos(p).length;
      const s = docStatus(p);
      if (s === 'completo') completo++; else if (s === 'parcial') parcial++; else if (s === 'pendente') pendente++; else semDoc++;
      if (exigeAtencao(p)) faturadoIncompleto++;
    }
    return { comAnexos: pedidos.filter(p => p.anexos.length > 0).length, nf, bol, completo, parcial, pendente, semDoc, faturadoIncompleto };
  }, [pedidos]);

  const atencao = useMemo(() => {
    const semBoleto = pedidos.filter(p => p.faturado && !temBoleto(p)).length;
    const nfSemBoleto = pedidos.filter(p => temNF(p) && !temBoleto(p)).length;
    const multiBol = pedidos.filter(p => boletos(p).length > 1).length;
    const recent = pedidos.reduce((n, p) => n + p.anexos.filter(a => { const d = parseData(a.criado_em); return d && (hoje.getTime() - d.getTime()) <= 7 * DAY; }).length, 0);
    const msgs: { texto: string; tone: 'red' | 'orange' | 'blue'; quick: QuickKey }[] = [];
    if (semBoleto > 0) msgs.push({ texto: `${semBoleto} pedido(s) faturado(s) sem boleto anexado`, tone: 'red', quick: 'atencao' });
    if (nfSemBoleto > 0) msgs.push({ texto: `${nfSemBoleto} pedido(s) com NF, mas ainda sem boleto`, tone: 'orange', quick: 'so_nf' });
    if (multiBol > 0) msgs.push({ texto: `${multiBol} pedido(s) com múltiplos boletos`, tone: 'blue', quick: 'multi_boleto' });
    if (recent > 0) msgs.push({ texto: `${recent} documento(s) anexado(s) nos últimos 7 dias`, tone: 'blue', quick: 'sete_dias' });
    return msgs;
  }, [pedidos, hoje]);

  const quickCounts = useMemo(() => ({
    completo: pedidos.filter(p => docStatus(p) === 'completo').length,
    so_nf: pedidos.filter(p => temNF(p) && !temBoleto(p)).length,
    so_boleto: pedidos.filter(p => temBoleto(p) && !temNF(p)).length,
    sem: pedidos.filter(p => p.anexos.length === 0).length,
    multi_boleto: pedidos.filter(p => boletos(p).length > 1).length,
    hoje: pedidos.filter(p => p.anexos.some(a => (a.criado_em ?? '').slice(0, 10) === hoje.toISOString().slice(0, 10))).length,
    sete_dias: pedidos.filter(p => p.anexos.some(a => { const d = parseData(a.criado_em); return d && (hoje.getTime() - d.getTime()) <= 7 * DAY; })).length,
    pendente: pedidos.filter(p => docStatus(p) === 'pendente').length,
    atencao: pedidos.filter(exigeAtencao).length,
  }), [pedidos, hoje]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE));
  const paginados = useMemo(() => filtrados.slice((page - 1) * PAGE, page * PAGE), [filtrados, page]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const hasFilters = !!(busca || statusFiltro || representante || quick.size > 0);
  function clearFilters() { setBusca(''); setStatusFiltro(''); setRepresentante(''); setQuick(new Set()); }
  function toggleQuick(k: QuickKey) { setQuick(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }

  const QUICK_DEFS: { key: QuickKey; label: string }[] = [
    { key: 'completo', label: 'Completos' },
    { key: 'so_nf', label: 'Só NF' },
    { key: 'so_boleto', label: 'Só boleto' },
    { key: 'sem', label: 'Sem anexos' },
    { key: 'multi_boleto', label: 'Boletos múltiplos' },
    { key: 'hoje', label: 'Emitidos hoje' },
    { key: 'sete_dias', label: 'Últimos 7 dias' },
    { key: 'pendente', label: 'Pendentes' },
    { key: 'atencao', label: 'Exigem atenção' },
  ];
  const VIEWS: { key: ViewMode; icon: React.ElementType; label: string }[] = [
    { key: 'cards', icon: LayoutGrid, label: 'Cards' },
    { key: 'table', icon: List, label: 'Tabela' },
    { key: 'timeline', icon: Activity, label: 'Recentes' },
  ];

  // Falha de carga tem tela própria: sem isto, "sem documentos" e "sistema fora"
  // ficam indistinguíveis (ver docs/INCIDENTE-2026-08-19-FDW.md).
  if (isError) {
    return (
      <PageContainer>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Central Financeira</h1>
        </div>
        <DataError recurso="os documentos fiscais" onRetry={() => refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[70] space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 shadow-lg text-sm font-medium bg-white border border-emerald-200 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />{t.m}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Central Financeira</h1>
        <p className="text-sm text-gray-500 mt-0.5">{isLoading ? 'Carregando...' : `${pedidos.length.toLocaleString('pt-BR')} pedido(s) · notas fiscais e boletos`}</p>
      </div>

      {pedidos.truncado && <TruncationNotice itens="documentos" />}

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-[64px] bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="flex sm:grid sm:grid-cols-4 xl:grid-cols-7 gap-2.5 overflow-x-auto scrollbar-thin -mx-1 px-1 sm:mx-0 sm:px-0 sm:overflow-visible">
          <KpiCard icon={Paperclip} label="Com anexos" value={String(kpis.comAnexos)} />
          <KpiCard icon={FileText} label="Notas fiscais" value={String(kpis.nf)} tone="text-purple-700" />
          <KpiCard icon={Receipt} label="Boletos" value={String(kpis.bol)} tone="text-blue-700" />
          <KpiCard icon={CheckCircle2} label="Completos" value={String(kpis.completo)} tone="text-emerald-700" />
          <KpiCard icon={CircleDashed} label="Parciais" value={String(kpis.parcial)} tone="text-orange-600" />
          <KpiCard icon={AlertTriangle} label="Pendentes" value={String(kpis.pendente)} tone={kpis.pendente > 0 ? 'text-red-600' : undefined} />
          <KpiCard icon={AlertTriangle} label="Faturado s/ docs" value={String(kpis.faturadoIncompleto)} tone={kpis.faturadoIncompleto > 0 ? 'text-red-600' : undefined} />
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
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', a.tone === 'red' ? 'bg-red-500' : a.tone === 'orange' ? 'bg-orange-500' : 'bg-blue-500')} />
                <span className="text-xs text-gray-700 flex-1 min-w-0">{a.texto}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0"><SearchInput value={busca} onChange={setBusca} placeholder="Pedido, cliente, CNPJ..." /></div>
        <button type="button" onClick={() => setShowFilters(true)}
          className={cn('inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-medium border transition-colors flex-shrink-0',
            (statusFiltro || representante) ? 'bg-[hsl(142,93%,8%)] text-white border-[hsl(142,93%,8%)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}>
          <SlidersHorizontal className="w-4 h-4" /><span className="hidden sm:inline">Filtros</span>
        </button>
        <div className="inline-flex rounded-xl bg-gray-100 p-0.5 flex-shrink-0 touch-compact">
          {VIEWS.filter(v => v.key !== 'table' || isDesktop).map(v => (
            <button key={v.key} type="button" onClick={() => setView(v.key)} title={v.label}
              className={cn('flex items-center gap-1.5 px-2.5 sm:px-3 h-9 text-xs font-medium rounded-[10px] transition-colors', effView === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
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
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm py-16 text-center">
          <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Nenhum documento encontrado</p>
          {hasFilters && <button onClick={clearFilters} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(142,93%,8%)] hover:underline"><X className="w-3.5 h-3.5" />Limpar filtros</button>}
        </div>
      ) : effView === 'timeline' ? (
        <TimelineView pedidos={filtrados} onOpen={setSelected} />
      ) : effView === 'table' ? (
        <>
          <TableView pedidos={paginados} onOpen={setSelected} />
          <div className="mt-3"><Pagination currentPage={page} totalPages={totalPages} onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /></div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
            {paginados.map((p, i) => <DocCard key={p.numero_pedido} pedido={p} onOpen={setSelected} index={i} conferido={conferidos.has(p.numero_pedido)} />)}
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
        <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Status documental</label>
          <Select value={statusFiltro} onChange={v => setStatusFiltro(v as '' | DocStatus)} placeholder="Todos"
            options={[{ value: '', label: 'Todos' }, { value: 'completo', label: 'Completo' }, { value: 'parcial', label: 'Parcial' }, { value: 'pendente', label: 'Pendente' }, { value: 'sem', label: 'Sem docs' }]} /></div>
        {reps.length > 1 && (
          <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Representante</label>
            <Select value={representante} onChange={setRepresentante} placeholder="Todos"
              options={[{ value: '', label: 'Todos' }, ...reps.map(r => ({ value: r, label: r }))]} /></div>
        )}
      </MobileBottomSheet>

      {selected && (
        <DocDrawer
          pedido={selected}
          onClose={() => setSelected(null)}
          onToast={toast}
          conferido={conferidos.has(selected.numero_pedido)}
          onConferir={() => toggleConferido(selected.numero_pedido)}
        />
      )}
    </PageContainer>
  );
}
