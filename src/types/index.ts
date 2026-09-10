// ─── MODELO REAL DO BANCO ────────────────────────────────────────────────────

/** Perfil (role única) — coluna `perfil` em concremapprep_usuarios.
 *  admin/diretor_geral = visão global; diretor = escopo por grupos de cliente. */
export type Perfil = 'representante' | 'operador' | 'admin' | 'diretor' | 'diretor_geral';

/** Usuário do portal (pessoa real — um por login) */
export interface Usuario {
  id: string;         // = auth.users.id
  nome: string;
  email: string;
  telefone?: string | null;    // requer ALTER TABLE (ver PerfilPage.tsx)
  avatar_url?: string | null;  // URL pública da foto no bucket 'avatars'
  admin: boolean;
  operador: boolean;
  perfil?: Perfil | null;      // role única (fonte de verdade; fallback nos flags)
  ativo: boolean;
  created_at: string;
}

/** Grupo de cliente (tabela client_groups) — eixo de escopo do Diretor. */
export interface ClientGroup {
  id: string;
  name: string;
  is_active: boolean;
}

/** Código de representante no ERP.
 *  Um usuário pode ter N rep codes (ex: Danilo 12%, Danilo 15%) */
export interface RepresentanteERP {
  id: string;
  codigo: string;             // "40054603"
  nome_erp: string;           // "DISTRIBUIDORA / MKT LILLIAN 15"
  representante_erp: string;  // "40054603 - DISTRIBUIDORA / MKT LILLIAN 15"
                              //  match exato com concrem_pedidos_venda.representante
  comissao_percentual: number;
  ativo: boolean;
  created_at: string;
}

/** Item dentro de dados_tabela (JSON) */
export interface PedidoItemERP {
  id: string;
  produto: string;
  un: string;
  qtd: number;
  valor_un: number;
  valor_total: number;
  peso_liquido: number;
  desconto: number;
  percentual_desconto: number;
}

/** Pedido de venda real — tabela concrem_pedidos_venda */
export interface PedidoVenda {
  id: string;
  numero_pedido: string;
  id_nota_conf: number | null;
  ped_compra_cliente: string | null;
  data_emissao: string;
  data_validade: string | null;
  previsao_embarque: string | null;
  situacao_entrega: string | null;
  cliente_codigo: string;
  cliente_nome: string;
  cliente_cnpj: string;
  cliente_fantasia: string | null;
  cliente_cidade: string;
  cliente_uf: string;
  cliente_cep: string;
  cliente_endereco: string;
  cliente_bairro: string;
  cliente_telefone: string;
  cliente_email: string | null;
  cliente_inscest: string;
  cliente_estab: string;
  representante: string | null;
  /** JSON string com { itens: PedidoItemERP[] } */
  dados_tabela: string;
  frete: number;
  desconto: number;
  total_qtd: number;
  total_qtd_m3: number;
  total_produtos: number;
  total_pedido_venda: number;
  peso_liquido_item: number;
  created_at: string;
  updated_at: string;
  // campos extras injetados pela view meus_pedidos
  representante_id?: string;
  comissao_percentual?: number;
  rep_codigo?: string;
  // campos enriquecidos pelo serviço
  numero_nota?: string | null;
  status_pipeline?: string | null;
  anexos?: PedidoAnexo[];
}

export interface PedidoAnexo {
  tipo: string;          // 'nota_fiscal' | 'boleto' | etc.
  arquivo_nome: string;
  arquivo_url: string;
}

/** dados_tabela parseado */
export interface PedidoDadosTabela {
  itens: PedidoItemERP[];
}

// ─── PRODUTOS ─────────────────────────────────────────────────────────────────

export interface Produto {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  tipo_produto: string | null;
  movimento: string | null;
  enchimento: string | null;
  linha: string | null;
  perfil: string | null;
  revestimento: string | null;
  cor: string | null;
  altura_cm: number | null;
  largura_cm: number | null;
  espessura_cm: number | null;
  batente_cm: number | null;
  protect_plus: string | null;
  veneziana: string | null;
  visor: string | null;
  situacao: string | null;
}

// ─── ORÇAMENTOS ───────────────────────────────────────────────────────────────

export type OrcamentoStatusReal = 'rascunho' | 'enviado' | 'em_analise' | 'aprovado' | 'rejeitado';

export interface OrcamentoItem {
  id: string;
  orcamento_id: string;
  produto_id: string | null;
  produto_codigo: string;
  produto_descricao: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number | null;
  is_adicional: boolean;
}

/** Autor do orçamento (usuário que o criou) — vem de concremapprep_usuarios. */
export interface OrcamentoAutor {
  id: string;
  nome: string;
  avatar_url: string | null;
}

export interface Orcamento {
  id: string;
  numero: string;
  usuario_id: string;
  representante_erp: string | null;
  cliente_cnpj: string;
  cliente_nome: string;
  cliente_fantasia: string | null;
  obra_referencia: string | null;
  condicao_pagamento: string | null;
  validade: string | null;
  endereco_entrega: string | null;
  frete_tipo: string | null;
  frete_valor: number | null;
  status: OrcamentoStatusReal;
  observacoes: string | null;
  itens?: OrcamentoItem[];
  autor?: OrcamentoAutor | null;
  created_at: string;
  updated_at: string;
}

// ─── LEGADO (mock) — mantido para compatibilidade enquanto o mock está ativo ──

export interface Representante {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  regiao: string;
  avatar_url?: string;
  comissao_percentual: number;
  meta_mensal: number;
  ativo: boolean;
  created_at: string;
}

export interface Cliente {
  id: string;
  representante_id: string;
  razao_social: string;
  nome_fantasia?: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: {
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
  };
  tipo: 'construtora' | 'incorporadora' | 'arquiteto' | 'engenheiro' | 'prefeitura' | 'outros';
  ativo: boolean;
  created_at: string;
}

/** @deprecated — usar OrcamentoItem (real) */
export interface OrcamentoItemMock {
  id: string;
  orcamento_id: string;
  produto_id: string;
  produto_nome: string;
  produto_codigo: string;
  quantidade: number;
  unidade: string;
  preco_unitario: number;
  desconto_percentual: number;
  preco_final: number;
  subtotal: number;
  observacao?: string;
}

export type OrcamentoStatus =
  | 'rascunho'
  | 'enviado'
  | 'em_analise'
  | 'aprovado'
  | 'devolvido'
  | 'perdido';

/** @deprecated — usar Orcamento (real) */
export interface OrcamentoMock {
  id: string;
  numero: string;
  representante_id: string;
  cliente_id: string;
  cliente?: Cliente;
  status: OrcamentoStatus;
  itens: OrcamentoItemMock[];
  valor_total: number;
  desconto_geral_percentual: number;
  valor_final: number;
  prazo_entrega_dias: number;
  condicao_pagamento: string;
  observacoes?: string;
  validade_dias: number;
  created_at: string;
  updated_at: string;
  enviado_at?: string;
  aprovado_at?: string;
}

export type PedidoStatus =
  | 'aprovado'
  | 'liberado'
  | 'mapeamento'
  | 'ferragem'
  | 'comercial'
  | 'producao'
  | 'faturado'
  | 'entrega'
  | 'finalizado';

export interface PedidoStatusLog {
  id: string;
  pedido_id: string;
  status: PedidoStatus;
  observacao?: string;
  responsavel: string;
  created_at: string;
}

export interface Pedido {
  id: string;
  numero: string;
  orcamento_id: string;
  orcamento?: OrcamentoMock;
  representante_id: string;
  cliente_id: string;
  cliente?: Cliente;
  status: PedidoStatus;
  status_logs: PedidoStatusLog[];
  valor_total: number;
  data_previsao_entrega: string;
  data_entrega_realizada?: string;
  nota_fiscal?: string;
  created_at: string;
  updated_at: string;
}

export interface FinanceiroCliente {
  id: string;
  cliente_id: string;
  cliente?: Cliente;
  representante_id: string;
  pedido_id?: string;
  tipo: 'comissao' | 'pagamento' | 'bonus' | 'estorno';
  descricao: string;
  valor: number;
  data_vencimento: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago' | 'atrasado' | 'cancelado';
  created_at: string;
}

export interface TituloCliente {
  id: string;
  numero: string;
  cliente_id: string;
  cliente?: Cliente;
  representante_id: string;
  pedido_id?: string;
  valor: number;
  data_emissao: string;
  data_vencimento: string;
  data_pagamento?: string;
  status: 'a_vencer' | 'vencido' | 'pago' | 'cancelado';
  nota_fiscal_numero?: string;
  has_boleto: boolean;
  has_nota_fiscal: boolean;
}

export interface Notificacao {
  id: string;
  representante_id: string;
  tipo: 'orcamento' | 'pedido' | 'financeiro' | 'sistema' | 'cliente';
  titulo: string;
  mensagem: string;
  lida: boolean;
  link?: string;
  created_at: string;
}

export interface KPIDashboard {
  orcamentos_mes: number;
  orcamentos_mes_anterior: number;
  valor_orcamentos_mes: number;
  valor_orcamentos_mes_anterior: number;
  pedidos_ativos: number;
  pedidos_entregues_mes: number;
  taxa_conversao: number;
  taxa_conversao_anterior: number;
  comissoes_pendentes: number;
  comissoes_recebidas_mes: number;
  meta_mensal: number;
  realizado_mes: number;
  clientes_ativos: number;
  novos_clientes_mes: number;
}

export interface ChartDataPoint {
  mes: string;
  orcamentos: number;
  pedidos: number;
  valor: number;
  comissao: number;
}

export interface User {
  id: string;
  email: string;
  representante?: Representante;   // mock
  usuario?: Usuario;               // real (Supabase)
  repCodes?: RepresentanteERP[];   // rep codes do ERP vinculados (cadastro do Portal)
  // Grafias reais que o ERP usa para os MESMOS códigos — fonte do filtro de
  // dados. Vem de app_my_rep_codes(); o cadastro do Portal traz só uma grafia e
  // o ERP costuma ter outras para o mesmo representante.
  repCodesFiltro?: string[];
  grupos?: string[];               // nomes dos grupos vinculados (perfil Diretor)
}
