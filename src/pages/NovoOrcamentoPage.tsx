import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ChevronDown, ChevronUp, Search, Plus, Minus, Trash2, Package, X, ArrowLeft,
  Send, Truck, Filter, Check, Sparkles, ShoppingCart, Save,
  Wrench, ClipboardList, Receipt,
} from 'lucide-react';
import Select from '@/components/ui/Select';
import DatePicker from '@/components/ui/DatePicker';
import PageContainer from '@/components/ui/PageContainer';
import StickyActionBar from '@/components/ui/StickyActionBar';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { useCarteira, useClientePedidos } from '@/hooks/useCarteira';
import { useProdutos } from '@/hooks/useProdutos';
import { parseDadosTabela } from '@/services/pedidosVenda';
import { createOrcamento, enviarOrcamento, type CreateItemPayload } from '@/services/orcamentos';
import { formatDate, formatCurrencyK } from '@/utils/formatters';
import type { Produto } from '@/types';
import type { ClienteCarteira, ClientePedido } from '@/services/carteira';

// ─── Condições de pagamento ─────────────────────────────
const CONDICOES_PAGAMENTO = [
  '28 DDL', '35 DDL', '28/35 DDL', '28/56 DDL',
  '30/60 dias', '30/60/90 dias', 'À Vista',
];

// ─── Frete ───────────────────────────────────────────────
const TIPOS_FRETE = [
  'FOB - Por conta do Destinatário (Cliente)',
  'CIF - 14 DDL (Faturado direto da Transportadora)',
  'CIF - Valor fixo negociado',
];
const FRETE_DESCRICAO: Record<string, string> = {
  'FOB - Por conta do Destinatário (Cliente)': 'O cliente contrata e paga o transporte.',
  'CIF - 14 DDL (Faturado direto da Transportadora)': 'Frete faturado direto pela transportadora em 14 DDL.',
  'CIF - Valor fixo negociado': 'Valor de frete fixo, negociado nesta proposta.',
};

// ─── Itens adicionais (serviços) ─────────────────────────
export interface ItemAdicionalLocal {
  id: string;
  nome: string;
  quantidade: number;
  ativo: boolean;
  unidade: string;
}

const ADICIONAIS_CATALOGO: (Omit<ItemAdicionalLocal, 'ativo' | 'quantidade'> & { descricao: string })[] = [
  { id: 'montagem',  nome: 'Montagem',          unidade: 'SRV', descricao: 'Serviço de montagem das portas' },
  { id: 'borracha',  nome: 'Borracha',           unidade: 'UN',  descricao: 'Vedação de borracha' },
  { id: 'frizos',    nome: 'Frizos nas Portas',  unidade: 'UN',  descricao: 'Acabamento frisado' },
  { id: 'furo',      nome: 'Furo Universal',     unidade: 'UN',  descricao: 'Furação universal para fechadura' },
  { id: 'fechadura', nome: 'Fechadura Soprano',  unidade: 'UN',  descricao: 'Fechadura instalada de fábrica' },
];

function initAdicionais(): ItemAdicionalLocal[] {
  return ADICIONAIS_CATALOGO.map(a => ({ id: a.id, nome: a.nome, unidade: a.unidade, ativo: false, quantidade: 1 }));
}

// ─── Filtros de produto (lógica preservada) ──────────────
interface FiltrosProduto {
  tipo: string; movimento: string; enchimento: string; linha: string;
  revestimento: string; perfil: string; cor: string; protect: string;
  veneziana: string; visor: string; altura: string; largura: string; busca: string;
}

const FILTROS_VAZIO: FiltrosProduto = {
  tipo: '', movimento: '', enchimento: '', linha: '', revestimento: '',
  perfil: '', cor: '', protect: '', veneziana: '', visor: '',
  altura: '', largura: '', busca: '',
};

const CHIPS_DEF: { key: keyof FiltrosProduto; label: string; campo: keyof Produto }[] = [
  { key: 'movimento',    label: 'Movimento',    campo: 'movimento'    },
  { key: 'enchimento',   label: 'Enchimento',   campo: 'enchimento'   },
  { key: 'revestimento', label: 'Revestimento', campo: 'revestimento' },
  { key: 'linha',        label: 'Linha',        campo: 'linha'        },
  { key: 'perfil',       label: 'Liso/Frisado', campo: 'perfil'       },
  { key: 'cor',          label: 'Cor',          campo: 'cor'          },
  { key: 'protect',      label: 'Protect+',     campo: 'protect_plus' },
  { key: 'veneziana',    label: 'Veneziana',    campo: 'veneziana'    },
  { key: 'visor',        label: 'Visor',        campo: 'visor'        },
  { key: 'altura',       label: 'Altura (cm)',  campo: 'altura_cm'    },
  { key: 'largura',      label: 'Largura (cm)', campo: 'largura_cm'   },
];

function getChipsVisiveis(tipo: string): (keyof FiltrosProduto)[] {
  const t = tipo.toUpperCase();
  if (t === 'ALIZAR')  return ['cor', 'altura', 'largura'];
  if (t === 'BATENTE') return ['largura'];
  return ['movimento', 'enchimento', 'revestimento', 'linha', 'perfil', 'cor', 'protect', 'veneziana', 'visor', 'altura', 'largura'];
}

function pStr(p: Produto, campo: keyof Produto): string {
  const v = p[campo];
  return v !== null && v !== undefined ? String(v) : '';
}

function getOpcoes(produtos: Produto[], filtros: FiltrosProduto, campo: keyof Produto) {
  let lista = produtos;
  if (campo !== 'tipo_produto'  && filtros.tipo)         lista = lista.filter(p => p.tipo_produto   === filtros.tipo);
  if (campo !== 'movimento'     && filtros.movimento)    lista = lista.filter(p => p.movimento       === filtros.movimento);
  if (campo !== 'enchimento'    && filtros.enchimento)   lista = lista.filter(p => p.enchimento      === filtros.enchimento);
  if (campo !== 'linha'         && filtros.linha)        lista = lista.filter(p => p.linha           === filtros.linha);
  if (campo !== 'revestimento'  && filtros.revestimento) lista = lista.filter(p => p.revestimento    === filtros.revestimento);
  if (campo !== 'perfil'        && filtros.perfil)       lista = lista.filter(p => p.perfil          === filtros.perfil);
  if (campo !== 'cor'           && filtros.cor)          lista = lista.filter(p => p.cor             === filtros.cor);
  if (campo !== 'protect_plus'  && filtros.protect)      lista = lista.filter(p => p.protect_plus    === filtros.protect);
  if (campo !== 'veneziana'     && filtros.veneziana)    lista = lista.filter(p => p.veneziana       === filtros.veneziana);
  if (campo !== 'visor'         && filtros.visor)        lista = lista.filter(p => p.visor           === filtros.visor);
  if (campo !== 'altura_cm'     && filtros.altura)       lista = lista.filter(p => String(p.altura_cm)  === filtros.altura);
  if (campo !== 'largura_cm'    && filtros.largura)      lista = lista.filter(p => String(p.largura_cm) === filtros.largura);
  return [...new Set(lista.map(p => pStr(p, campo)).filter(Boolean))].sort((a, b) => {
    const na = Number(a); const nb = Number(b);
    return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
  });
}

function FilterChip({ label, value, onChange, options, disabled, className }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; disabled?: boolean; className?: string;
}) {
  if (options.length === 0 && !value) return null;
  return (
    <Select
      chip
      value={value}
      onChange={onChange}
      placeholder={label}
      disabled={disabled || options.length === 0}
      className={className}
      options={[{ value: '', label: 'Todos' }, ...options.map(o => ({ value: o, label: o }))]}
    />
  );
}

// ─── Cabeçalho de seção numerado ─────────────────────────
function SectionHeader({ num, title, subtitle, done, icon: Icon }: {
  num: number; title: string; subtitle?: string; done?: boolean; icon?: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-1">
      <span className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors',
        done ? 'bg-[hsl(142,93%,8%)] text-white' : 'bg-gray-100 text-gray-500',
      )}>
        {done ? <Check className="w-4 h-4" /> : num}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          {Icon && <Icon className="w-4 h-4 text-gray-400" />}
          {title}
        </h2>
        {subtitle && <p className="text-[11px] text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm min-w-0 overflow-hidden">
      {children}
    </div>
  );
}

// ─── Campos ──────────────────────────────────────────────
function InputField({ label, value, onChange, placeholder, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full h-11 sm:h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)] focus:border-transparent"
      />
    </div>
  );
}

// ─── Seletor de cliente (modal, preservado) ──────────────
function ClienteSelector({ clientes, selected, onSelect }: {
  clientes: ClienteCarteira[];
  selected: ClienteCarteira | null;
  onSelect: (c: ClienteCarteira | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q) return clientes.slice(0, 40);
    const ql = q.toLowerCase();
    return clientes
      .filter(c =>
        (c.cliente_nome ?? '').toLowerCase().includes(ql) ||
        (c.cliente_fantasia ?? '').toLowerCase().includes(ql) ||
        (c.cliente_cnpj ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))
      )
      .slice(0, 40);
  }, [clientes, q]);

  if (selected) {
    const nome = selected.cliente_fantasia?.trim() || selected.cliente_nome;
    return (
      <div>
        <label className="text-xs font-semibold text-gray-500 mb-1 block">
          Cliente <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-2 h-11 sm:h-9 px-3 border border-[hsl(142,93%,8%)]/30 rounded-lg bg-[hsl(142,93%,8%)]/5">
          <span className="flex-1 text-sm font-medium text-gray-900 truncate">{nome}</span>
          <button onClick={() => onSelect(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="Remover cliente">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="text-xs font-semibold text-gray-500 mb-1 block">
        Cliente <span className="text-red-500">*</span>
      </label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-11 sm:h-9 px-3 text-sm border border-gray-300 rounded-lg text-left text-gray-400 hover:border-gray-400 flex items-center justify-between"
      >
        Selecionar cliente
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 text-sm">Selecionar Cliente</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Buscar cliente..."
                  className="w-full h-9 pl-8 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Nenhum cliente encontrado</p>
              ) : (
                filtered.map(c => {
                  const nome = c.cliente_fantasia?.trim() || c.cliente_nome;
                  return (
                    <button
                      key={c.cliente_cnpj}
                      onClick={() => { onSelect(c); setOpen(false); setQ(''); }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900 truncate">{nome || <span className="italic text-gray-400">Cliente sem nome</span>}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.cliente_cidade}/{c.cliente_uf} · {c.cliente_cnpj}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Insights do cliente (após seleção) ──────────────────
function insightsFromPedidos(pedidos: ClientePedido[]) {
  const total = pedidos.reduce((s, p) => s + (p.total_pedido_venda ?? 0), 0);
  const n = pedidos.length;
  const datas = pedidos.map(p => (p.data_emissao ?? '').slice(0, 10)).filter(Boolean).sort();
  const ultimo = datas.length > 0 ? datas[datas.length - 1] : null;

  const distintas = [...new Set(datas)];
  let ciclo: number | null = null;
  if (distintas.length >= 2) {
    const ts = distintas.map(d => new Date(`${d}T12:00:00`).getTime()).sort((a, b) => a - b);
    let soma = 0;
    for (let i = 1; i < ts.length; i++) soma += (ts[i] - ts[i - 1]) / 86_400_000;
    ciclo = Math.round(soma / (ts.length - 1));
  }

  const qtdPorProduto = new Map<string, number>();
  for (const p of pedidos) {
    for (const it of parseDadosTabela(p.dados_tabela).itens) {
      const nome = (it.produto ?? '').trim();
      if (nome) qtdPorProduto.set(nome, (qtdPorProduto.get(nome) ?? 0) + (it.qtd ?? 0));
    }
  }
  const favorito = qtdPorProduto.size > 0
    ? [...qtdPorProduto.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return { total, n, ultimo, ciclo, favorito, ticket: n > 0 ? total / n : 0 };
}

function ClienteInsights({ cnpj }: { cnpj: string }) {
  const { data: pedidos = [], isLoading } = useClientePedidos(cnpj);
  const ins = useMemo(() => insightsFromPedidos(pedidos), [pedidos]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-gray-50 p-3 flex items-center gap-2 text-xs text-gray-400 animate-pulse">
        <Sparkles className="w-3.5 h-3.5" /> Carregando histórico do cliente...
      </div>
    );
  }
  if (ins.n === 0) {
    return (
      <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-400 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5" /> Sem histórico de pedidos para este cliente.
      </div>
    );
  }

  const stats = [
    { label: 'Última compra',  value: ins.ultimo ? formatDate(ins.ultimo) : '—' },
    { label: 'Frequência',     value: ins.ciclo ? `~${ins.ciclo} dias` : '—' },
    { label: 'Média de pedido', value: ins.ticket > 0 ? formatCurrencyK(ins.ticket) : '—' },
    { label: 'Histórico',      value: `${ins.n} pedido(s)${ins.total > 0 ? ` · ${formatCurrencyK(ins.total)}` : ''}` },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-white p-3.5"
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        <Sparkles className="w-3.5 h-3.5 text-[hsl(142,93%,8%)]" />
        <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">Insights do cliente</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2">
        {stats.map(s => (
          <div key={s.label} className="min-w-0">
            <p className="text-[10px] text-gray-400">{s.label}</p>
            <p className="text-xs font-bold text-gray-800 tabular-nums truncate">{s.value}</p>
          </div>
        ))}
      </div>
      {ins.favorito && (
        <p className="text-[11px] text-gray-500 mt-2.5 pt-2.5 border-t border-emerald-100/60 truncate">
          <span className="text-gray-400">Produto favorito:</span> <span className="font-medium text-gray-700">{ins.favorito}</span>
        </p>
      )}
    </motion.div>
  );
}

// ─── Item local do orçamento ─────────────────────────────
interface OrcItemLocal {
  produto: Produto;
  quantidade: number;
}

function dims(p: Produto) {
  const parts: string[] = [];
  if (p.altura_cm)    parts.push(`${p.altura_cm}cm`);
  if (p.largura_cm)   parts.push(`${p.largura_cm}cm`);
  if (p.espessura_cm) parts.push(`${p.espessura_cm}cm`);
  return parts.join(' × ');
}

// ─── Stepper de quantidade ───────────────────────────────
function QtyStepper({ value, onChange, small }: { value: number; onChange: (v: number) => void; small?: boolean }) {
  const btn = cn(
    'rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center transition-colors',
    small ? 'w-6 h-6' : 'w-8 h-8',
  );
  return (
    <div className="flex items-center gap-1 touch-compact">
      <button type="button" className={btn} onClick={() => onChange(value - 1)} aria-label="Diminuir">
        <Minus className={small ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      </button>
      <input
        type="number"
        min={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={cn(
          'text-center border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(142,93%,8%)] tabular-nums',
          small ? 'w-12 h-6 text-xs' : 'w-16 h-8 text-sm',
        )}
      />
      <button type="button" className={btn} onClick={() => onChange(value + 1)} aria-label="Aumentar">
        <Plus className={small ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      </button>
    </div>
  );
}

// ─── Resumo (sidebar desktop / seção mobile) ─────────────
function SummaryContent({
  clienteSel, itens, adicionais, freteTipo, freteValorNum, condicao, validade,
  setQtd, removeItem,
}: {
  clienteSel: ClienteCarteira | null;
  itens: OrcItemLocal[];
  adicionais: ItemAdicionalLocal[];
  freteTipo: string;
  freteValorNum: number;
  condicao: string;
  validade: string;
  setQtd: (id: string, qtd: number) => void;
  removeItem: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const totalUn = itens.reduce((s, i) => s + i.quantidade, 0);
  const servAtivos = adicionais.filter(a => a.ativo);

  return (
    <div className="space-y-4">
      {/* Cliente */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Cliente</p>
        {clienteSel ? (
          <p className="text-sm font-semibold text-gray-900 truncate">
            {clienteSel.cliente_fantasia?.trim() || clienteSel.cliente_nome}
          </p>
        ) : (
          <p className="text-xs text-gray-300 italic">Nenhum cliente selecionado</p>
        )}
        {(condicao || validade) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {condicao && <span className="text-[11px] text-gray-400">Pagamento: <span className="text-gray-600 font-medium">{condicao}</span></span>}
            {validade && <span className="text-[11px] text-gray-400">Validade: <span className="text-gray-600 font-medium tabular-nums">{formatDate(validade)}</span></span>}
          </div>
        )}
      </div>

      {/* Produtos */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
          Produtos ({itens.length})
        </p>
        {itens.length === 0 ? (
          <p className="text-xs text-gray-300 italic">Nenhum produto adicionado</p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {itens.map(item => (
                <motion.div
                  key={item.produto.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: 8, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{item.produto.descricao}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{item.produto.codigo}</p>
                  </div>
                  <QtyStepper small value={item.quantidade} onChange={q => setQtd(item.produto.id, q)} />
                  <button
                    type="button"
                    onClick={() => removeItem(item.produto.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 touch-compact"
                    aria-label="Remover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Serviços */}
      {servAtivos.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Serviços</p>
          <div className="space-y-1">
            {servAtivos.map(a => (
              <div key={a.id} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{a.nome}</span>
                <span className="text-gray-400 tabular-nums">{a.quantidade} {a.unidade}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Frete */}
      {freteTipo && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Frete</p>
          <p className="text-xs text-gray-700">{freteTipo.split(' - ')[0]} <span className="text-gray-400">· {freteTipo.split(' - ')[1]}</span></p>
          {freteValorNum > 0 && (
            <p className="text-xs font-bold text-gray-900 tabular-nums mt-0.5">R$ {freteValorNum.toFixed(2).replace('.', ',')}</p>
          )}
        </div>
      )}

      {/* Totais */}
      <div className="pt-3 border-t border-gray-100 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Produtos</span>
          <span className="font-semibold text-gray-800 tabular-nums">{itens.length}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Unidades</span>
          <motion.span key={totalUn} initial={reduce ? false : { scale: 1.25, color: '#014017' }} animate={{ scale: 1, color: '#1f2937' }} className="font-semibold tabular-nums">
            {totalUn}
          </motion.span>
        </div>
        {freteValorNum > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Frete</span>
            <span className="font-semibold text-gray-800 tabular-nums">R$ {freteValorNum.toFixed(2).replace('.', ',')}</span>
          </div>
        )}
        <p className="text-[10px] text-gray-400 leading-relaxed pt-1">
          Os preços dos produtos são definidos pela equipe comercial na análise da proposta.
        </p>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────
export default function NovoOrcamentoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const reduce = useReducedMotion();

  const { data: clientes = [] } = useCarteira();
  const { data: produtos = [], isLoading: loadingProd } = useProdutos();

  // ── Dados da proposta ──
  const [clienteSel, setClienteSel] = useState<ClienteCarteira | null>(null);
  const [obra, setObra]             = useState('');
  const [condicao, setCondicao]     = useState('');
  const [validade, setValidade]     = useState('');
  const [endereco, setEndereco]     = useState('');
  const [observacoes, setObs]       = useState('');

  // ── Itens ──
  const [itens, setItens] = useState<OrcItemLocal[]>([]);

  // ── Filtros de produto ──
  const [filtros, setFiltros] = useState<FiltrosProduto>(FILTROS_VAZIO);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [visibleCount, setVisibleCount] = useState(24);

  const filtrosAtivos = (Object.entries(filtros) as [keyof FiltrosProduto, string][])
    .filter(([k, v]) => k !== 'busca' && !!v).length;

  function setFiltro(campo: keyof FiltrosProduto, valor: string) {
    setFiltros(prev => campo === 'tipo' ? { ...FILTROS_VAZIO, tipo: valor } : { ...prev, [campo]: valor });
    setVisibleCount(24);
  }

  // ── Serviços adicionais ──
  const [adicionais, setAdicionais] = useState<ItemAdicionalLocal[]>(initAdicionais);
  function toggleAdicional(id: string) {
    setAdicionais(prev => prev.map(a => a.id === id ? { ...a, ativo: !a.ativo } : a));
  }
  function setAdicionalQtd(id: string, qtd: number) {
    setAdicionais(prev => prev.map(a => a.id === id ? { ...a, quantidade: Math.max(1, qtd) } : a));
  }

  // ── Frete ──
  const [freteTipo, setFreteTipo]   = useState('');
  const [freteValor, setFreteValor] = useState('');
  const freteValorNum = freteValor ? Number(freteValor) : 0;

  // ── Drawer de configuração do produto ──
  const [drawerProd, setDrawerProd] = useState<Produto | null>(null);
  const [drawerQtd, setDrawerQtd]   = useState(1);

  function openDrawer(p: Produto) {
    const atual = itens.find(i => i.produto.id === p.id);
    setDrawerQtd(atual?.quantidade ?? 1);
    setDrawerProd(p);
  }
  useEffect(() => {
    if (!drawerProd) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setDrawerProd(null); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerProd]);

  // ── Produtos filtrados ──
  const prodsFiltrados = useMemo(() => {
    let lista = produtos;
    if (filtros.tipo)         lista = lista.filter(p => p.tipo_produto     === filtros.tipo);
    if (filtros.movimento)    lista = lista.filter(p => p.movimento         === filtros.movimento);
    if (filtros.enchimento)   lista = lista.filter(p => p.enchimento        === filtros.enchimento);
    if (filtros.linha)        lista = lista.filter(p => p.linha             === filtros.linha);
    if (filtros.revestimento) lista = lista.filter(p => p.revestimento      === filtros.revestimento);
    if (filtros.perfil)       lista = lista.filter(p => p.perfil            === filtros.perfil);
    if (filtros.cor)          lista = lista.filter(p => p.cor               === filtros.cor);
    if (filtros.protect)      lista = lista.filter(p => p.protect_plus      === filtros.protect);
    if (filtros.veneziana)    lista = lista.filter(p => p.veneziana         === filtros.veneziana);
    if (filtros.visor)        lista = lista.filter(p => p.visor             === filtros.visor);
    if (filtros.altura)       lista = lista.filter(p => String(p.altura_cm)   === filtros.altura);
    if (filtros.largura)      lista = lista.filter(p => String(p.largura_cm)  === filtros.largura);
    if (filtros.busca) {
      const q = filtros.busca.toLowerCase();
      lista = lista.filter(p =>
        p.codigo.toLowerCase().includes(q) ||
        p.descricao.toLowerCase().includes(q)
      );
    }
    return lista;
  }, [produtos, filtros]);

  // ── Carrinho ──
  const addProduto = useCallback((produto: Produto, qtd = 1) => {
    setItens(prev => {
      const existe = prev.find(i => i.produto.id === produto.id);
      if (existe) return prev.map(i => i.produto.id === produto.id ? { ...i, quantidade: i.quantidade + qtd } : i);
      return [...prev, { produto, quantidade: qtd }];
    });
  }, []);
  const setItemQtd = useCallback((produto: Produto, qtd: number) => {
    setItens(prev => {
      const existe = prev.find(i => i.produto.id === produto.id);
      if (qtd <= 0) return prev.filter(i => i.produto.id !== produto.id);
      if (existe) return prev.map(i => i.produto.id === produto.id ? { ...i, quantidade: qtd } : i);
      return [...prev, { produto, quantidade: qtd }];
    });
  }, []);
  const removeItem = (id: string) => setItens(prev => prev.filter(i => i.produto.id !== id));
  const setQtd = (id: string, qtd: number) => {
    if (qtd <= 0) { removeItem(id); return; }
    setItens(prev => prev.map(i => i.produto.id === id ? { ...i, quantidade: qtd } : i));
  };

  // ── Salvar / Enviar ──
  const saveMut = useMutation({
    mutationFn: async (modo: 'rascunho' | 'enviar') => {
      const uid    = user!.usuario!.id;
      const repErp = user?.repCodes?.[0]?.representante_erp;

      const itensProduto: CreateItemPayload[] = itens.map(i => ({
        produto_id:        i.produto.id,
        produto_codigo:    i.produto.codigo,
        produto_descricao: i.produto.descricao,
        unidade:           i.produto.unidade,
        quantidade:        i.quantidade,
        is_adicional:      false,
      }));

      const itensAdicionaisAtivos: CreateItemPayload[] = adicionais
        .filter(a => a.ativo)
        .map(a => ({
          produto_codigo:    `ADICIONAL.${a.id}`,
          produto_descricao: a.nome,
          unidade:           a.unidade,
          quantidade:        a.quantidade,
          is_adicional:      true,
        }));

      const orc = await createOrcamento(
        {
          usuario_id:         uid,
          representante_erp:  repErp,
          cliente_cnpj:       clienteSel!.cliente_cnpj,
          cliente_nome:       clienteSel!.cliente_nome,
          cliente_fantasia:   clienteSel!.cliente_fantasia ?? undefined,
          obra_referencia:    obra        || undefined,
          condicao_pagamento: condicao    || undefined,
          validade:           validade    || undefined,
          endereco_entrega:   endereco    || undefined,
          frete_tipo:         freteTipo   || undefined,
          frete_valor:        freteValor ? Number(freteValor) : undefined,
          observacoes:        observacoes || undefined,
        },
        [...itensProduto, ...itensAdicionaisAtivos],
      );

      if (modo === 'enviar') await enviarOrcamento(orc.id);
      return orc;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos'] });
      navigate('/orcamentos');
    },
  });

  const canSave = !!clienteSel && itens.length > 0;
  const salvando = saveMut.isPending;
  const modoSalvando = saveMut.isPending ? saveMut.variables : null;

  const opTipos = getOpcoes(produtos, filtros, 'tipo_produto');
  const chipsVisiveis = getChipsVisiveis(filtros.tipo);
  const totalUn = itens.reduce((s, i) => s + i.quantidade, 0);
  const servAtivosCount = adicionais.filter(a => a.ativo).length;

  const drawerNoCarrinho = drawerProd ? itens.find(i => i.produto.id === drawerProd.id) : undefined;

  const summaryProps = {
    clienteSel, itens, adicionais, freteTipo, freteValorNum, condicao, validade, setQtd, removeItem,
  };

  return (
    <PageContainer bottomBar>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/orcamentos')}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Novo Orçamento</h1>
          <p className="text-xs text-gray-400 mt-0.5">Pré-orçamento para análise comercial</p>
        </div>
      </div>

      <div className="lg:flex lg:gap-5 lg:items-start">
        {/* ═══ Coluna principal ═══ */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── 1. Cliente ── */}
          <SectionCard>
            <SectionHeader num={1} title="Informações do Cliente" done={!!clienteSel} />
            <div className="p-5 pt-3 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ClienteSelector
                  clientes={clientes}
                  selected={clienteSel}
                  onSelect={c => {
                    setClienteSel(c);
                    if (c) setEndereco(`${c.cliente_cidade} - ${c.cliente_uf}`);
                  }}
                />
                <InputField label="Obra / Referência" value={obra} onChange={setObra} placeholder="Nome da obra" />
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Condição de Pagamento</label>
                  <Select
                    value={condicao}
                    onChange={setCondicao}
                    placeholder="Selecionar..."
                    className="h-11 sm:h-9"
                    options={CONDICOES_PAGAMENTO.map(o => ({ value: o, label: o }))}
                  />
                </div>
              </div>

              {/* Insights (após seleção do cliente) */}
              {clienteSel && <ClienteInsights cnpj={clienteSel.cliente_cnpj} />}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Validade da Proposta</label>
                  <DatePicker
                    value={validade || null}
                    onChange={v => setValidade(v ?? '')}
                    className="h-11 sm:h-9"
                  />
                </div>
                <InputField
                  label="Endereço de Entrega"
                  value={endereco}
                  onChange={setEndereco}
                  placeholder="Rua, número, bairro, cidade - UF"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Observações</label>
                <textarea
                  value={observacoes}
                  onChange={e => setObs(e.target.value)}
                  placeholder="Informações adicionais para a equipe de orçamentos..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)] focus:border-transparent resize-none"
                />
              </div>
            </div>
          </SectionCard>

          {/* ── 2. Produtos ── */}
          <SectionCard>
            <div className="flex items-center justify-between pr-5">
              <SectionHeader num={2} title="Seleção de Produtos" done={itens.length > 0} />
              <span className="text-xs text-gray-400 flex-shrink-0">{produtos.length} no catálogo</span>
            </div>
            <div className="p-5 pt-3 space-y-3">
              {/* Botão "Filtros (N)" — só no mobile */}
              <button
                type="button"
                onClick={() => setFiltrosAbertos(o => !o)}
                className={cn(
                  'lg:hidden flex items-center justify-between w-full h-10 px-3 rounded-lg text-sm font-medium border transition-colors',
                  filtrosAtivos > 0
                    ? 'border-[hsl(142,93%,8%)] bg-[hsl(142,93%,8%)]/5 text-[hsl(142,93%,8%)]'
                    : 'border-gray-300 bg-white text-gray-600',
                )}
              >
                <span className="flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Filtros{filtrosAtivos > 0 && ` (${filtrosAtivos})`}
                </span>
                {filtrosAbertos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {/* Filtros: desktop sempre visível; mobile em grade de 2 colunas ao abrir */}
              <div className={cn(
                'gap-2 lg:flex lg:flex-wrap lg:items-center',
                filtrosAbertos ? 'grid grid-cols-2 animate-filters-reveal' : 'hidden',
              )}>
                <FilterChip label="Tipo" value={filtros.tipo} onChange={v => setFiltro('tipo', v)} options={opTipos} className="w-full lg:w-auto" />
                {chipsVisiveis.map(key => {
                  const def = CHIPS_DEF.find(c => c.key === key)!;
                  return (
                    <FilterChip
                      key={key}
                      label={def.label}
                      value={filtros[key] as string}
                      onChange={v => setFiltro(key, v)}
                      options={getOpcoes(produtos, filtros, def.campo)}
                      className="w-full lg:w-auto"
                    />
                  );
                })}
                {filtrosAtivos > 0 && (
                  <button
                    onClick={() => { setFiltros(FILTROS_VAZIO); setVisibleCount(24); }}
                    className="col-span-2 text-xs text-red-500 hover:text-red-700 transition-colors px-1 text-left lg:col-auto"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>

              {/* Busca */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={filtros.busca}
                  onChange={e => setFiltro('busca', e.target.value)}
                  placeholder="Buscar por código ou descrição..."
                  className="w-full h-10 sm:h-9 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
                />
              </div>

              {/* Cards de produto */}
              {loadingProd ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 bg-gray-50 rounded-xl animate-pulse" />)}
                </div>
              ) : prodsFiltrados.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Nenhum produto com esses filtros</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {prodsFiltrados.slice(0, visibleCount).map(prod => {
                      const noCarrinho = itens.find(i => i.produto.id === prod.id);
                      const d = dims(prod);
                      return (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => openDrawer(prod)}
                          className={cn(
                            'group relative rounded-xl border p-3 text-left transition-all hover:shadow-md hover:-translate-y-0.5',
                            noCarrinho
                              ? 'border-[hsl(142,93%,8%)]/40 bg-[hsl(142,93%,8%)]/[0.04]'
                              : 'border-gray-200/80 bg-white hover:border-gray-300',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-[10px] text-gray-400">{prod.codigo}</span>
                            {noCarrinho && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[hsl(142,93%,8%)] bg-[hsl(142,93%,8%)]/10 rounded-full px-1.5 py-0.5 tabular-nums">
                                <ShoppingCart className="w-2.5 h-2.5" />
                                {noCarrinho.quantidade}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium text-gray-900 leading-snug line-clamp-2 mt-1 pr-8">{prod.descricao}</p>
                          <div className="flex gap-1 mt-1.5 flex-wrap items-center">
                            {prod.tipo_produto && <span className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{prod.tipo_produto}</span>}
                            {prod.linha       && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 rounded">{prod.linha}</span>}
                            {prod.movimento   && <span className="text-[9px] bg-purple-50 text-purple-600 px-1 rounded">{prod.movimento}</span>}
                            {d && <span className="text-[9px] text-gray-400">{d}</span>}
                          </div>
                          {/* Quick add */}
                          <span
                            role="button"
                            tabIndex={-1}
                            onClick={e => { e.stopPropagation(); addProduto(prod); }}
                            className={cn(
                              'absolute bottom-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center transition-colors',
                              noCarrinho
                                ? 'bg-[hsl(142,93%,8%)]/10 text-[hsl(142,93%,8%)] hover:bg-[hsl(142,93%,8%)]/20'
                                : 'bg-[hsl(142,93%,8%)] text-white hover:bg-[hsl(142,93%,15%)]',
                            )}
                            title={noCarrinho ? `Adicionar mais (atual: ${noCarrinho.quantidade})` : 'Adicionar'}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[11px] text-gray-400">
                      Mostrando {Math.min(visibleCount, prodsFiltrados.length)} de {prodsFiltrados.length} produto(s)
                    </p>
                    {visibleCount < prodsFiltrados.length && (
                      <button
                        type="button"
                        onClick={() => setVisibleCount(c => c + 24)}
                        className="text-xs font-medium text-[hsl(142,93%,8%)] hover:underline"
                      >
                        Mostrar mais
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </SectionCard>

          {/* ── 3. Serviços adicionais ── */}
          <SectionCard>
            <SectionHeader
              num={3}
              title="Serviços Adicionais"
              subtitle="Serviços e acessórios complementares por porta"
              done={servAtivosCount > 0}
              icon={Wrench}
            />
            <div className="p-5 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {adicionais.map(a => {
                  const cat = ADICIONAIS_CATALOGO.find(c => c.id === a.id)!;
                  return (
                    <div
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleAdicional(a.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAdicional(a.id); } }}
                      className={cn(
                        'rounded-xl border p-3.5 cursor-pointer transition-all',
                        a.ativo
                          ? 'border-[hsl(142,93%,8%)]/40 bg-[hsl(142,93%,8%)]/[0.04] shadow-sm'
                          : 'border-gray-200/80 hover:border-gray-300',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border-2 transition-colors',
                          a.ativo ? 'bg-[hsl(142,93%,8%)] border-[hsl(142,93%,8%)] text-white' : 'border-gray-300',
                        )}>
                          {a.ativo && <Check className="w-3 h-3" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{a.nome}</p>
                          <p className="text-[11px] text-gray-400 truncate">{cat.descricao}</p>
                        </div>
                        {a.ativo && (
                          <div onClick={e => e.stopPropagation()}>
                            <QtyStepper small value={a.quantidade} onChange={q => setAdicionalQtd(a.id, q)} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          {/* ── 4. Frete ── */}
          <SectionCard>
            <SectionHeader num={4} title="Frete" done={!!freteTipo} icon={Truck} />
            <div className="p-5 pt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {TIPOS_FRETE.map(tipo => {
                  const selecionado = freteTipo === tipo;
                  const [sigla, resto] = [tipo.split(' - ')[0], tipo.split(' - ')[1]];
                  return (
                    <button
                      key={tipo}
                      type="button"
                      onClick={() => setFreteTipo(selecionado ? '' : tipo)}
                      className={cn(
                        'rounded-xl border p-3.5 text-left transition-all',
                        selecionado
                          ? 'border-[hsl(142,93%,8%)]/40 bg-[hsl(142,93%,8%)]/[0.04] shadow-sm'
                          : 'border-gray-200/80 hover:border-gray-300',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                          selecionado ? 'border-[hsl(142,93%,8%)]' : 'border-gray-300',
                        )}>
                          {selecionado && <span className="w-2 h-2 rounded-full bg-[hsl(142,93%,8%)]" />}
                        </span>
                        <p className="text-sm font-semibold text-gray-800">{sigla}</p>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1 leading-snug">{resto}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{FRETE_DESCRICAO[tipo]}</p>
                    </button>
                  );
                })}
              </div>
              {freteTipo === 'CIF - Valor fixo negociado' && (
                <motion.div initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="sm:max-w-[240px]">
                  <InputField
                    label="Valor do Frete (R$)"
                    value={freteValor}
                    onChange={setFreteValor}
                    placeholder="0,00"
                    type="number"
                  />
                </motion.div>
              )}
            </div>
          </SectionCard>

          {/* ── 5. Revisão final (mobile — no desktop fica na sidebar) ── */}
          <div className="lg:hidden">
            <SectionCard>
              <SectionHeader num={5} title="Revisão Final" icon={ClipboardList} done={canSave} />
              <div className="p-5 pt-3">
                <SummaryContent {...summaryProps} />
              </div>
            </SectionCard>
          </div>
        </div>

        {/* ═══ Sidebar de resumo (desktop) ═══ */}
        <aside className="hidden lg:block w-[320px] xl:w-[360px] flex-shrink-0 lg:sticky lg:top-4">
          <div className="rounded-2xl bg-white border border-gray-200/70 shadow-sm">
            <div className="flex items-center gap-2 px-4 pt-4 pb-1">
              <Receipt className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Resumo do Orçamento</h3>
            </div>
            <div className="p-4 pt-3 max-h-[calc(100dvh-14rem)] overflow-y-auto scrollbar-thin">
              <SummaryContent {...summaryProps} />
            </div>
          </div>
        </aside>
      </div>

      {/* ═══ Barra inferior fixa ═══ */}
      <StickyActionBar>
        <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600 min-w-0 flex-1">
          <div className="truncate">
            {itens.length > 0
              ? <span><strong className="tabular-nums">{itens.length}</strong> prod. · <strong className="tabular-nums">{totalUn}</strong> un.{servAtivosCount > 0 && <span className="text-gray-400"> · {servAtivosCount} serviço(s)</span>}</span>
              : <span className="text-gray-400 text-xs">Nenhum item adicionado</span>}
          </div>
          {freteValorNum > 0 && (
            <div className="text-xs text-gray-400">
              Frete: <span className="text-gray-700 font-semibold tabular-nums">R$ {freteValorNum.toFixed(2).replace('.', ',')}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => navigate('/orcamentos')}
            className="h-10 px-3 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            Cancelar
          </button>
          <button
            onClick={() => saveMut.mutate('rascunho')}
            disabled={!canSave || salvando}
            className="h-10 px-3 sm:px-4 text-sm font-medium text-[hsl(142,93%,8%)] border border-[hsl(142,93%,8%)]/30 rounded-xl hover:bg-[hsl(142,93%,8%)]/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
          >
            {salvando && modoSalvando === 'rascunho'
              ? <div className="w-4 h-4 border-2 border-[hsl(142,93%,8%)]/30 border-t-[hsl(142,93%,8%)] rounded-full animate-spin" />
              : <Save className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Salvar Rascunho</span>
            <span className="sm:hidden">Rascunho</span>
          </button>
          <button
            onClick={() => saveMut.mutate('enviar')}
            disabled={!canSave || salvando}
            className="h-10 px-3 sm:px-4 text-sm font-medium bg-[hsl(142,93%,8%)] text-white rounded-xl hover:bg-[hsl(142,93%,15%)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap shadow-sm"
          >
            {salvando && modoSalvando === 'enviar'
              ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Enviar p/ Análise</span>
            <span className="sm:hidden">Enviar</span>
          </button>
        </div>
        </div>
      </StickyActionBar>

      {/* Erro */}
      {saveMut.isError && (
        <div className="fixed bottom-32 right-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          Erro ao salvar. Verifique os dados e tente novamente.
        </div>
      )}

      {/* ═══ Drawer de configuração do produto ═══ */}
      {drawerProd && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="drawer-overlay absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerProd(null)} />
          <div className="drawer-panel absolute right-0 top-0 h-full w-full sm:max-w-md bg-white shadow-2xl flex flex-col">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between gap-3 p-5 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="font-mono text-xs text-gray-400">{drawerProd.codigo}</p>
                <h2 className="text-base font-bold text-gray-900 leading-snug mt-1">{drawerProd.descricao}</h2>
              </div>
              <button
                onClick={() => setDrawerProd(null)}
                className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Atributos */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Especificações</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {([
                    ['Tipo',         drawerProd.tipo_produto],
                    ['Linha',        drawerProd.linha],
                    ['Movimento',    drawerProd.movimento],
                    ['Enchimento',   drawerProd.enchimento],
                    ['Revestimento', drawerProd.revestimento],
                    ['Liso/Frisado', drawerProd.perfil],
                    ['Cor',          drawerProd.cor],
                    ['Protect+',     drawerProd.protect_plus],
                    ['Veneziana',    drawerProd.veneziana],
                    ['Visor',        drawerProd.visor],
                    ['Dimensões',    dims(drawerProd) || null],
                    ['Unidade',      drawerProd.unidade],
                  ] as [string, string | null][]).filter(([, v]) => !!v).map(([label, v]) => (
                    <div key={label} className="min-w-0">
                      <p className="text-[10px] text-gray-400">{label}</p>
                      <p className="text-xs font-medium text-gray-800 truncate">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Quantidade</p>
                <QtyStepper value={drawerQtd} onChange={q => setDrawerQtd(Math.max(1, q))} />
              </div>

              <p className="text-[11px] text-gray-400 leading-relaxed">
                O preço deste produto será definido pela equipe comercial durante a análise da proposta.
              </p>
            </div>

            {/* Ações */}
            <div className="p-4 border-t border-gray-100 space-y-2">
              <button
                type="button"
                onClick={() => { setItemQtd(drawerProd, drawerQtd); setDrawerProd(null); }}
                className="w-full h-11 rounded-xl bg-[hsl(142,93%,8%)] text-white text-sm font-medium hover:bg-[hsl(142,93%,15%)] transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {drawerNoCarrinho ? 'Atualizar quantidade' : 'Adicionar ao orçamento'}
              </button>
              {drawerNoCarrinho && (
                <button
                  type="button"
                  onClick={() => { removeItem(drawerProd.id); setDrawerProd(null); }}
                  className="w-full h-10 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Remover do orçamento
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
