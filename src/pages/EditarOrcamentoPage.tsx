import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Search, Plus, Trash2, Package, X, ArrowLeft, Save, Truck, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import DatePicker from '@/components/ui/DatePicker';
import PageContainer from '@/components/ui/PageContainer';
import StickyActionBar from '@/components/ui/StickyActionBar';
import { cn } from '@/utils/cn';
import { clienteCasaBusca } from '@/utils/buscaCliente';
import { useCarteira } from '@/hooks/useCarteira';
import { useProdutos } from '@/hooks/useProdutos';
import { fetchOrcamentoById, updateOrcamento, type CreateItemPayload } from '@/services/orcamentos';
import type { Produto } from '@/types';
import type { ClienteCarteira } from '@/services/carteira';

const CONDICOES_PAGAMENTO = [
  '28 DDL', '35 DDL', '28/35 DDL', '28/56 DDL',
  '30/60 dias', '30/60/90 dias', 'À Vista',
];

const TIPOS_FRETE = [
  'FOB - Por conta do Destinatário (Cliente)',
  'CIF - 14 DDL (Faturado direto da Transportadora)',
  'CIF - Valor fixo negociado',
];

export interface ItemAdicionalLocal {
  id: string; nome: string; quantidade: number; ativo: boolean; unidade: string;
}

const ADICIONAIS_CATALOGO: Omit<ItemAdicionalLocal, 'ativo' | 'quantidade'>[] = [
  { id: 'montagem',  nome: 'Montagem',         unidade: 'SRV' },
  { id: 'borracha',  nome: 'Borracha',          unidade: 'UN'  },
  { id: 'frizos',    nome: 'Frizos nas Portas', unidade: 'UN'  },
  { id: 'furo',      nome: 'Furo Universal',    unidade: 'UN'  },
  { id: 'fechadura', nome: 'Fechadura Soprano', unidade: 'UN'  },
];

function initAdicionais(): ItemAdicionalLocal[] {
  return ADICIONAIS_CATALOGO.map(a => ({ ...a, ativo: false, quantidade: 1 }));
}

// ─── Componentes de formulário (idênticos ao NovoOrcamentoPage) ───────────────

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
      <Select
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Selecionar...'}
        className="h-11 sm:h-9"
        options={options.map(o => ({ value: o, label: o }))}
      />
    </div>
  );
}

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

function ClienteSelector({ clientes, selected, onSelect }: {
  clientes: ClienteCarteira[];
  selected: ClienteCarteira | null;
  onSelect: (c: ClienteCarteira | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState('');

  const filtered = useMemo(() => {
    if (!q.trim()) return clientes.slice(0, 40);
    return clientes.filter(c => clienteCasaBusca(c, q)).slice(0, 40);
  }, [clientes, q]);

  if (selected) {
    const nome = selected.cliente_fantasia?.trim() || selected.cliente_nome;
    return (
      <div>
        <label className="text-xs font-semibold text-gray-500 mb-1 block">
          Cliente <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-2 h-9 px-3 border border-gray-300 rounded-lg bg-gray-50">
          <span className="flex-1 text-sm font-medium text-gray-900 truncate">{nome}</span>
          <button onClick={() => onSelect(null)} className="text-gray-400 hover:text-gray-600">
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
        className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg text-left text-gray-400 hover:border-gray-400 flex items-center justify-between"
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
                  className="w-full h-8 pl-8 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.map(c => {
                const nome = c.cliente_fantasia?.trim() || c.cliente_nome;
                return (
                  <button
                    key={c.cliente_cnpj}
                    onClick={() => { onSelect(c); setOpen(false); setQ(''); }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{nome}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.cliente_cidade}/{c.cliente_uf} · {c.cliente_cnpj}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FiltrosProduto {
  tipo: string; movimento: string; enchimento: string;
  linha: string; revestimento: string; perfil: string; cor: string;
  protect: string; veneziana: string; visor: string;
  altura: string; largura: string; busca: string;
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
];

function getChipsVisiveis(tipo: string): (keyof FiltrosProduto)[] {
  const t = tipo.toUpperCase();
  if (t === 'ALIZAR')  return ['cor'];
  if (t === 'BATENTE') return [];
  return ['movimento', 'enchimento', 'revestimento', 'linha', 'perfil', 'cor'];
}

function getOpcoes(produtos: Produto[], filtros: FiltrosProduto, campo: keyof Produto) {
  let lista = produtos;
  if (campo !== 'tipo_produto'  && filtros.tipo)         lista = lista.filter(p => p.tipo_produto  === filtros.tipo);
  if (campo !== 'movimento'     && filtros.movimento)    lista = lista.filter(p => p.movimento      === filtros.movimento);
  if (campo !== 'enchimento'    && filtros.enchimento)   lista = lista.filter(p => p.enchimento     === filtros.enchimento);
  if (campo !== 'linha'         && filtros.linha)        lista = lista.filter(p => p.linha          === filtros.linha);
  if (campo !== 'revestimento'  && filtros.revestimento) lista = lista.filter(p => p.revestimento   === filtros.revestimento);
  if (campo !== 'perfil'        && filtros.perfil)       lista = lista.filter(p => p.perfil         === filtros.perfil);
  if (campo !== 'cor'           && filtros.cor)          lista = lista.filter(p => p.cor            === filtros.cor);
  return [...new Set(lista.map(p => p[campo] as string).filter(Boolean))].sort();
}

// ─── Chip de filtro (usa o Select customizado — Radix) ─────
function FilterChip({ label, value, onChange, options, className }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; className?: string;
}) {
  if (options.length === 0 && !value) return null;
  return (
    <Select
      chip
      value={value}
      onChange={onChange}
      placeholder={label}
      disabled={options.length === 0}
      className={className}
      options={[{ value: '', label: 'Todos' }, ...options.map(o => ({ value: o, label: o }))]}
    />
  );
}

interface OrcItemLocal { produto: Produto; quantidade: number; }

// ─── Página ───────────────────────────────────────────
export default function EditarOrcamentoPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc       = useQueryClient();

  const { data: clientes = [] }                       = useCarteira();
  const { data: produtos = [], isLoading: loadingProd } = useProdutos();

  // Carrega orçamento existente
  const { data: orcamento, isLoading: loadingOrc } = useQuery({
    queryKey: ['orcamento', id],
    queryFn:  () => fetchOrcamentoById(id!),
    enabled:  !!id,
  });

  // Form state
  const [clienteSel, setClienteSel]   = useState<ClienteCarteira | null>(null);
  const [obra, setObra]               = useState('');
  const [condicao, setCondicao]       = useState('');
  const [validade, setValidade]       = useState('');
  const [endereco, setEndereco]       = useState('');
  const [observacoes, setObs]         = useState('');
  const [itens, setItens]             = useState<OrcItemLocal[]>([]);
  const [initialized, setInitialized] = useState(false);

  const [filtros, setFiltros]           = useState<FiltrosProduto>(FILTROS_VAZIO);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false); // só afeta o mobile
  const [adicionais, setAdicionais]     = useState<ItemAdicionalLocal[]>(initAdicionais);
  const [freteTipo, setFreteTipo]       = useState('');
  const [freteValor, setFreteValor]     = useState('');

  // Quantos filtros de produto estão ativos (ignora a busca por texto)
  const filtrosAtivos = (Object.entries(filtros) as [keyof FiltrosProduto, string][])
    .filter(([k, v]) => k !== 'busca' && !!v).length;

  function setFiltro(campo: keyof FiltrosProduto, valor: string) {
    setFiltros(prev => campo === 'tipo' ? { ...FILTROS_VAZIO, tipo: valor } : { ...prev, [campo]: valor });
  }

  function toggleAdicional(id: string) {
    setAdicionais(prev => prev.map(a => a.id === id ? { ...a, ativo: !a.ativo } : a));
  }
  function setAdicionalQtd(id: string, qtd: number) {
    setAdicionais(prev => prev.map(a => a.id === id ? { ...a, quantidade: Math.max(1, qtd) } : a));
  }
  // Preenche form quando o orçamento carrega
  useEffect(() => {
    if (!orcamento || initialized || produtos.length === 0 || clientes.length === 0) return;

    setObra(orcamento.obra_referencia ?? '');
    setCondicao(orcamento.condicao_pagamento ?? '');
    setValidade(orcamento.validade ?? '');
    setEndereco(orcamento.endereco_entrega ?? '');
    setObs(orcamento.observacoes ?? '');
    setFreteTipo(orcamento.frete_tipo ?? '');
    setFreteValor(orcamento.frete_valor ? String(orcamento.frete_valor) : '');

    const cli = clientes.find(c => c.cliente_cnpj === orcamento.cliente_cnpj) ?? null;
    if (cli) setClienteSel(cli);

    // Reconstrói itens produtos (não adicionais)
    const itensMapeados: OrcItemLocal[] = (orcamento.itens ?? [])
      .filter(item => !item.is_adicional)
      .map(item => {
        const prod = produtos.find(p => p.id === item.produto_id || p.codigo === item.produto_codigo);
        if (!prod) return null;
        return { produto: prod, quantidade: item.quantidade };
      })
      .filter(Boolean) as OrcItemLocal[];
    setItens(itensMapeados);

    // Reconstrói itens adicionais salvos
    const adicionaisSalvos = (orcamento.itens ?? []).filter(i => i.is_adicional);
    if (adicionaisSalvos.length > 0) {
      setAdicionais(initAdicionais().map(a => {
        const salvo = adicionaisSalvos.find(s => s.produto_codigo === `ADICIONAL.${a.id}`);
        if (!salvo) return a;
        return { ...a, ativo: true, quantidade: salvo.quantidade };
      }));
    }

    setInitialized(true);
  }, [orcamento, produtos, clientes, initialized]);

  useEffect(() => {
    if (orcamento && orcamento.status !== 'rascunho') {
      navigate('/orcamentos', { replace: true });
    }
  }, [orcamento, navigate]);

  // Produtos filtrados
  const prodsFiltrados = useMemo(() => {
    let lista = produtos;
    if (filtros.tipo)         lista = lista.filter(p => p.tipo_produto    === filtros.tipo);
    if (filtros.movimento)    lista = lista.filter(p => p.movimento        === filtros.movimento);
    if (filtros.enchimento)   lista = lista.filter(p => p.enchimento       === filtros.enchimento);
    if (filtros.linha)        lista = lista.filter(p => p.linha            === filtros.linha);
    if (filtros.revestimento) lista = lista.filter(p => p.revestimento     === filtros.revestimento);
    if (filtros.perfil)       lista = lista.filter(p => p.perfil           === filtros.perfil);
    if (filtros.cor)          lista = lista.filter(p => p.cor              === filtros.cor);
    if (filtros.protect)      lista = lista.filter(p => p.protect_plus     === filtros.protect);
    if (filtros.veneziana)    lista = lista.filter(p => p.veneziana        === filtros.veneziana);
    if (filtros.visor)        lista = lista.filter(p => p.visor            === filtros.visor);
    if (filtros.altura)       lista = lista.filter(p => String(p.altura_cm)  === filtros.altura);
    if (filtros.largura)      lista = lista.filter(p => String(p.largura_cm) === filtros.largura);
    if (filtros.busca) {
      const q = filtros.busca.toLowerCase();
      lista = lista.filter(p => p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q));
    }
    return lista;
  }, [produtos, filtros]);

  const addProduto = useCallback((produto: Produto) => {
    setItens(prev => {
      const existe = prev.find(i => i.produto.id === produto.id);
      if (existe) return prev.map(i => i.produto.id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      return [...prev, { produto, quantidade: 1 }];
    });
  }, []);

  const removeItem = (id: string) => setItens(prev => prev.filter(i => i.produto.id !== id));
  const setQtd = (id: string, qtd: number) => {
    if (qtd <= 0) { removeItem(id); return; }
    setItens(prev => prev.map(i => i.produto.id === id ? { ...i, quantidade: qtd } : i));
  };

  const saveMut = useMutation({
    mutationFn: () => {
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
      return updateOrcamento(
        id!,
        {
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
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos'] });
      qc.invalidateQueries({ queryKey: ['orcamento', id] });
      navigate('/orcamentos');
    },
  });

  const canSave       = !!clienteSel && itens.length > 0;
  const freteValorNum = freteValor ? Number(freteValor) : 0;

  function dims(p: Produto) {
    const parts: string[] = [];
    if (p.altura_cm)    parts.push(`${p.altura_cm}cm`);
    if (p.largura_cm)   parts.push(`${p.largura_cm}cm`);
    if (p.espessura_cm) parts.push(`${p.espessura_cm}cm`);
    return parts.join(' × ');
  }

  const opTipos       = getOpcoes(produtos, filtros, 'tipo_produto');
  const chipsVisiveis = getChipsVisiveis(filtros.tipo);

  if (loadingOrc) {
    return (
      <div className="p-5 flex items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-2 border-[hsl(142,93%,8%)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PageContainer bottomBar>

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/orcamentos')}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Editar Orçamento
            <span className="ml-2 font-mono text-sm text-gray-400">#{orcamento?.numero}</span>
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Apenas rascunhos podem ser editados</p>
        </div>
      </div>

      {/* ── Dados da Proposta ── */}
      <Card>
        <CardHeader><CardTitle>Dados da Proposta</CardTitle></CardHeader>
        <CardContent className="space-y-4 sm:space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ClienteSelector clientes={clientes} selected={clienteSel} onSelect={setClienteSel} />
            <InputField label="Obra / Referência" value={obra} onChange={setObra} placeholder="Nome da obra" />
            <SelectField label="Condição de Pagamento" value={condicao} onChange={setCondicao} options={CONDICOES_PAGAMENTO} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Validade da Proposta</label>
              <DatePicker value={validade || null} onChange={v => setValidade(v ?? '')} className="h-11 sm:h-9" />
            </div>
            <InputField label="Endereço de Entrega" value={endereco} onChange={setEndereco} placeholder="Rua, número, bairro, cidade - UF" />
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
        </CardContent>
      </Card>

      {/* ── Seleção de Produtos ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Seleção de Produtos</CardTitle>
            <span className="text-xs text-gray-400">{produtos.length} produtos no catálogo</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-3">
          {/* Botão "Filtros (N)" — só no mobile */}
          <button
            type="button"
            onClick={() => setFiltrosAbertos(o => !o)}
            className={cn(
              'lg:hidden flex items-center justify-between w-full h-9 px-3 rounded-lg text-sm font-medium border transition-colors',
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

          {/* Filtros: desktop sempre visível (flex-wrap); mobile em grade de 2 colunas ao abrir. */}
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
                onClick={() => setFiltros(FILTROS_VAZIO)}
                className="col-span-2 text-xs text-red-500 hover:text-red-700 px-1 text-left lg:col-auto"
              >
                Limpar filtros
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={filtros.busca}
              onChange={e => setFiltro('busca', e.target.value)}
              placeholder="Buscar por código ou descrição..."
              className="w-full h-8 pl-9 pr-3 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(142,93%,8%)]"
            />
          </div>

          {loadingProd ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-[hsl(142,93%,8%)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : prodsFiltrados.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Nenhum produto com esses filtros</p>
            </div>
          ) : (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[70px_1fr_36px] sm:grid-cols-[80px_1fr_110px_36px] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                <span>Código</span><span>Descrição</span><span className="hidden sm:block">Dimensões</span><span></span>
              </div>
              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {prodsFiltrados.map(prod => {
                  const noCarrinho = itens.find(i => i.produto.id === prod.id);
                  const d = dims(prod);
                  return (
                    <div
                      key={prod.id}
                      className={cn(
                        'grid grid-cols-[70px_1fr_36px] sm:grid-cols-[80px_1fr_110px_36px] gap-2 px-3 py-2.5 items-center transition-colors',
                        noCarrinho ? 'bg-green-50' : 'hover:bg-gray-50'
                      )}
                    >
                      <span className="font-mono text-[11px] text-gray-500 leading-tight">{prod.codigo}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 leading-snug">{prod.descricao}</p>
                        <div className="flex gap-1 mt-0.5 flex-wrap items-center">
                          {prod.tipo_produto && <span className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{prod.tipo_produto}</span>}
                          {prod.linha        && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 rounded">{prod.linha}</span>}
                          {prod.movimento    && <span className="text-[9px] bg-purple-50 text-purple-600 px-1 rounded">{prod.movimento}</span>}
                          {d && <span className="sm:hidden text-[9px] text-gray-400">{d}</span>}
                        </div>
                      </div>
                      <span className="hidden sm:block text-xs text-gray-400 leading-tight">{d || '—'}</span>
                      <button
                        onClick={() => addProduto(prod)}
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
                          noCarrinho
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-[hsl(142,93%,8%)] text-white hover:bg-[hsl(142,93%,15%)]'
                        )}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
                {prodsFiltrados.length} produto(s)
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Itens do Orçamento ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Itens do Orçamento</CardTitle>
            <span className={cn(
              'text-xs font-semibold px-2 py-0.5 rounded-full',
              itens.length > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            )}>
              {itens.length} item(s)
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {itens.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              <Package className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              Adicione produtos acima para compor o orçamento
            </div>
          ) : (
            <div className="space-y-2">
              {itens.map((item, idx) => (
                <div key={item.produto.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-400 w-4 flex-shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{item.produto.descricao}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{item.produto.codigo} · {item.produto.unidade}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setQtd(item.produto.id, item.quantidade - 1)}
                      className="w-6 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm font-bold leading-none"
                    >−</button>
                    <input
                      type="number"
                      min={1}
                      value={item.quantidade}
                      onChange={e => setQtd(item.produto.id, Number(e.target.value))}
                      className="w-14 h-6 text-center text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[hsl(142,93%,8%)]"
                    />
                    <button
                      onClick={() => setQtd(item.produto.id, item.quantidade + 1)}
                      className="w-6 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm font-bold leading-none"
                    >+</button>
                  </div>
                  <button
                    onClick={() => removeItem(item.produto.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Seção 4: Itens Adicionais ── */}
      <Card>
        <CardHeader>
          <CardTitle>Itens Adicionais</CardTitle>
          <p className="text-xs text-gray-400 mt-0.5">Serviços e acessórios complementares por porta</p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {adicionais.map(a => (
              <div key={a.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl">
                <button onClick={() => toggleAdicional(a.id)} className={cn('w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors', a.ativo ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300')}>
                  {a.ativo && <span className="text-[10px] font-bold">✓</span>}
                </button>
                <span className="flex-1 text-sm font-medium text-gray-800">{a.nome}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs text-gray-400">Qtd.</span>
                  <input type="number" min={1} value={a.quantidade} onChange={e => setAdicionalQtd(a.id, Number(e.target.value))} disabled={!a.ativo} className="w-14 h-7 text-center text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(142,93%,8%)] disabled:opacity-40" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Seção 5: Frete ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-gray-500" />
            <CardTitle>Frete</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-3">
          <SelectField label="Tipo de Frete" value={freteTipo} onChange={setFreteTipo} options={TIPOS_FRETE} placeholder="Selecionar tipo de frete..." />
          {freteTipo === 'CIF - Valor fixo negociado' && (
            <InputField label="Valor do Frete (R$)" value={freteValor} onChange={setFreteValor} placeholder="0,00" type="number" />
          )}
        </CardContent>
      </Card>

      {/* ── Barra inferior fixa — acima do MobileNav ── */}
      <StickyActionBar>
        <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600 min-w-0 flex-1">
          <div className="truncate">
            {itens.length > 0
              ? <span><strong>{itens.length}</strong> prod. · <strong>{itens.reduce((s,i) => s + i.quantidade, 0)}</strong> un.</span>
              : <span className="text-gray-400 text-xs">Nenhum item adicionado</span>
            }
          </div>
          {freteValorNum > 0 && (
            <div className="text-xs text-gray-400">
              Frete: <span className="text-gray-700 font-semibold">R$ {freteValorNum.toFixed(2).replace('.',',')}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => navigate('/orcamentos')} className="h-9 px-3 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap">
            Cancelar
          </button>
          <button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending} className="h-9 px-4 text-sm bg-[hsl(142,93%,8%)] text-white rounded-lg hover:bg-[hsl(142,93%,15%)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap">
            {saveMut.isPending ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar Alterações
          </button>
        </div>
        </div>
      </StickyActionBar>

      {saveMut.isError && (
        <div className="fixed bottom-20 right-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          Erro ao salvar. Tente novamente.
        </div>
      )}
    </PageContainer>
  );
}
