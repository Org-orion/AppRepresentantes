// ─────────────────────────────────────────────────────────────────────────────
// Motor de regras: transforma os dados reais do portal em alertas acionáveis.
// Funções puras — recebem dados, devolvem Alerta[]. O agrupamento ("4 clientes
// ultrapassaram a previsão...") acontece AQUI, antes de chegar à tela.
// IDs são estáveis (derivados dos dados) para persistir lida/excluída.
// ─────────────────────────────────────────────────────────────────────────────
import type { Orcamento } from '@/types';
import type { ClienteCarteira } from '@/services/carteira';
import type { PedidoComAnexos } from '@/services/financeiro';
import type { NotificacaoDB } from '@/services/notificacoes';
import { ALERT_DEFS, type Alerta } from './registry';
import { formatCurrency } from '@/utils/formatters';

const DAY = 86_400_000;

function parseISO(d?: string | null): Date | null {
  if (!d) return null;
  const s = d.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(d);
}
function diasDesde(d: string | null | undefined, hoje: Date): number {
  const p = parseISO(d);
  return p ? Math.floor((hoje.getTime() - p.getTime()) / DAY) : 0;
}
function valorOrcamento(o: Orcamento): number {
  return (o.itens ?? []).reduce((s, it) => s + (it.preco_unitario ?? 0) * it.quantidade, 0);
}
function nomeCliente(nome: string, fantasia?: string | null): string {
  return fantasia?.trim() || nome || 'Cliente';
}
function classifyAnexo(tipo: string): 'nf' | 'boleto' | 'outro' {
  const t = (tipo ?? '').toLowerCase();
  if (t.includes('boleto')) return 'boleto';
  if (t.includes('nota') || t.includes('nf') || t.includes('fiscal')) return 'nf';
  return 'outro';
}

export interface EngineInput {
  orcamentos: Orcamento[];
  clientes: ClienteCarteira[];
  pedidosAnexos: PedidoComAnexos[];
  notificacoesDB: NotificacaoDB[];
  hoje: Date;
}

// ─── Orçamentos: aprovado / recusado / parado / expirando ───────────────────
function alertasOrcamentos({ orcamentos, hoje }: EngineInput): Alerta[] {
  const out: Alerta[] = [];

  for (const o of orcamentos) {
    const valor = valorOrcamento(o);

    // Aprovado / recusado nos últimos 30 dias (decisões antigas não são "novidade")
    if (o.status === 'aprovado' && diasDesde(o.updated_at, hoje) <= 30) {
      out.push({
        id: `aprovado:${o.id}:${(o.updated_at ?? '').slice(0, 10)}`,
        tipo: 'orcamento_aprovado',
        prioridade: ALERT_DEFS.orcamento_aprovado.prioridade,
        titulo: `Orçamento #${o.numero} aprovado`,
        descricao: nomeCliente(o.cliente_nome, o.cliente_fantasia),
        detalhe: valor > 0 ? `Valor: ${formatCurrency(valor)}` : undefined,
        data: o.updated_at,
        rota: '/orcamentos?status=aprovado',
        acao: 'Abrir orçamento',
      });
    }

    if (o.status === 'rejeitado' && diasDesde(o.updated_at, hoje) <= 30) {
      out.push({
        id: `recusado:${o.id}:${(o.updated_at ?? '').slice(0, 10)}`,
        tipo: 'orcamento_recusado',
        prioridade: ALERT_DEFS.orcamento_recusado.prioridade,
        titulo: `Orçamento #${o.numero} recusado`,
        descricao: nomeCliente(o.cliente_nome, o.cliente_fantasia),
        detalhe: o.observacoes ? `Motivo: ${o.observacoes}` : undefined,
        data: o.updated_at,
        rota: '/orcamentos?status=rejeitado',
        acao: 'Ver detalhes',
      });
    }

    const pendente = o.status === 'enviado' || o.status === 'em_analise';

    // Parado: aguardando aprovação há mais de 30 dias
    if (pendente) {
      const dias = diasDesde(o.created_at, hoje);
      if (dias > 30) {
        out.push({
          id: `parado:${o.id}`,
          tipo: 'orcamento_parado',
          prioridade: ALERT_DEFS.orcamento_parado.prioridade,
          titulo: `Orçamento #${o.numero} parado há ${dias} dias`,
          descricao: `${nomeCliente(o.cliente_nome, o.cliente_fantasia)} · aguardando aprovação`,
          data: o.created_at,
          rota: '/aprovacoes',
          acao: 'Ver aprovações',
        });
      }

      // Expirando: validade nos próximos 5 dias (ou vencida há até 7)
      if (o.validade) {
        const diasAteVencer = -diasDesde(o.validade, hoje); // futuro = positivo
        if (diasAteVencer <= 5 && diasAteVencer >= -7) {
          out.push({
            id: `expirando:${o.id}:${o.validade}`,
            tipo: 'orcamento_expirando',
            prioridade: ALERT_DEFS.orcamento_expirando.prioridade,
            titulo: diasAteVencer < 0
              ? `Orçamento #${o.numero} venceu`
              : diasAteVencer === 0
                ? `Orçamento #${o.numero} vence hoje`
                : `Orçamento #${o.numero} vence em ${diasAteVencer} dia(s)`,
            descricao: nomeCliente(o.cliente_nome, o.cliente_fantasia),
            data: o.validade,
            rota: '/aprovacoes',
            acao: 'Ver orçamento',
          });
        }
      }
    }
  }
  return out;
}

// ─── Clientes: ultrapassaram o prazo padrão de recompra (30 dias) ───────────
export interface ClienteAtrasado {
  cliente: ClienteCarteira;
  ciclo: number | null;      // frequência média histórica (dias), se houver 3+ pedidos
  diasSemComprar: number;
  diasAtraso: number;        // dias além do prazo padrão de 30 dias
  proximaCompra: string;     // ISO — último pedido + 30 dias
  bucket: string;            // janela de notificação (controle anti-spam)
}

const PRAZO_RECOMPRA = 30; // dias — prazo padrão fixo de recompra

// Clientes que passaram do prazo padrão de 30 dias desde a última compra.
// Regra FIXA (não usa mais o ciclo médio para decidir o atraso). O ciclo médio
// segue apenas como informação de comportamento no card.
export function clientesAtrasados(clientes: ClienteCarteira[], hoje: Date): ClienteAtrasado[] {
  const out: ClienteAtrasado[] = [];
  for (const c of clientes) {
    if (c.total_pedidos < 1 || !c.ultimo_pedido) continue; // sem pedidos → sem alerta
    const ultimo = parseISO(c.ultimo_pedido);
    if (!ultimo) continue;
    const diasSemComprar = diasDesde(c.ultimo_pedido, hoje);
    const diasAtraso = diasSemComprar - PRAZO_RECOMPRA;
    if (diasAtraso <= 0) continue; // dentro do prazo de 30 dias
    // Frequência média histórica (informativa) — requer 3+ pedidos com datas válidas
    let ciclo: number | null = null;
    const primeiro = parseISO(c.primeiro_pedido);
    if (c.total_pedidos >= 3 && primeiro && ultimo > primeiro) {
      const cc = (ultimo.getTime() - primeiro.getTime()) / DAY / (c.total_pedidos - 1);
      if (cc >= 5) ciclo = Math.round(cc);
    }
    const proximaCompra = new Date(ultimo.getTime() + PRAZO_RECOMPRA * DAY).toISOString().slice(0, 10);
    // Janela anti-spam: entrada (1–6d), +7 (7–14d), +15 e depois no máx. 1x/semana.
    // O id do alerta muda a cada janela → só re-notifica nesses marcos.
    const bucket = diasAtraso < 7 ? 'm0' : diasAtraso < 15 ? 'm7' : `w${Math.floor((diasAtraso - 15) / 7)}`;
    out.push({ cliente: c, ciclo, diasSemComprar, diasAtraso, proximaCompra, bucket });
  }
  return out.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

function fmtBR(iso: string | null | undefined): string {
  const d = parseISO(iso ?? null);
  return d ? d.toLocaleDateString('pt-BR') : '—';
}

function alertasRecompra(input: EngineInput): Alerta[] {
  const atrasados = clientesAtrasados(input.clientes, input.hoje);
  if (atrasados.length === 0) return [];

  // Poucos → um card por cliente (id muda a cada janela → re-notifica só nos marcos)
  if (atrasados.length <= 3) {
    return atrasados.map(a => {
      const nome = nomeCliente(a.cliente.cliente_nome, a.cliente.cliente_fantasia);
      return {
        id: `recompra:${a.cliente.cliente_cnpj}:${a.bucket}`,
        tipo: 'cliente_recompra' as const,
        prioridade: ALERT_DEFS.cliente_recompra.prioridade,
        titulo: `${nome} com compra atrasada`,
        descricao: `Ultrapassou o prazo padrão de recompra (30 dias). Último pedido ${fmtBR(a.cliente.ultimo_pedido)}, esperado ${fmtBR(a.proximaCompra)} — atrasado há ${a.diasAtraso} dia(s).`,
        detalhe: a.ciclo ? `Frequência histórica: a cada ~${a.ciclo} dias.` : undefined,
        data: a.cliente.ultimo_pedido,
        rota: `/clientes?cnpj=${encodeURIComponent(a.cliente.cliente_cnpj)}`,
        acao: 'Abrir cliente',
      };
    });
  }
  // Muitos → card agrupado, em janela SEMANAL para não repetir todo dia
  const semana = Math.floor(input.hoje.getTime() / (7 * DAY));
  return [{
    id: `recompra-grupo:${semana}`,
    tipo: 'cliente_recompra',
    prioridade: ALERT_DEFS.cliente_recompra.prioridade,
    titulo: `${atrasados.length} clientes com compra atrasada`,
    descricao: atrasados.slice(0, 3).map(a => nomeCliente(a.cliente.cliente_nome, a.cliente.cliente_fantasia)).join(', ')
      + (atrasados.length > 3 ? ` e mais ${atrasados.length - 3}` : ''),
    detalhe: 'Ultrapassaram o prazo padrão de 30 dias sem novo pedido.',
    data: input.hoje.toISOString().slice(0, 10),
    rota: '/clientes',
    acao: 'Ver carteira',
    agrupado: atrasados.length,
  }];
}

// ─── Pedidos: faturado (NF + boleto) / NF / boleto disponível ────────────────
function alertasFaturamento({ pedidosAnexos, hoje }: EngineInput): Alerta[] {
  const out: Alerta[] = [];
  // Janela de relevância: pedidos emitidos nos últimos 45 dias
  const recentes = pedidosAnexos.filter(p => p.data_emissao && diasDesde(p.data_emissao, hoje) <= 45);

  const faturados: PedidoComAnexos[] = [];
  for (const p of recentes) {
    const temNF = p.anexos.some(a => classifyAnexo(a.tipo) === 'nf');
    const temBoleto = p.anexos.some(a => classifyAnexo(a.tipo) === 'boleto');
    if (temNF && temBoleto) {
      faturados.push(p);
    } else if (temNF) {
      out.push({
        id: `nf:${p.numero_pedido}`,
        tipo: 'nf_disponivel',
        prioridade: ALERT_DEFS.nf_disponivel.prioridade,
        titulo: `Nota Fiscal disponível — pedido ${p.numero_pedido}`,
        descricao: nomeCliente(p.cliente_nome, p.cliente_fantasia),
        data: p.data_emissao,
        rota: '/financeiro',
        acao: 'Baixar NF',
      });
    } else if (temBoleto) {
      out.push({
        id: `boleto:${p.numero_pedido}`,
        tipo: 'boleto_disponivel',
        prioridade: ALERT_DEFS.boleto_disponivel.prioridade,
        titulo: `Boleto disponível — pedido ${p.numero_pedido}`,
        descricao: nomeCliente(p.cliente_nome, p.cliente_fantasia),
        data: p.data_emissao,
        rota: '/financeiro',
        acao: 'Baixar boleto',
      });
    }
  }

  // Faturados: até 4 cards individuais; acima disso, agrupa
  if (faturados.length <= 4) {
    for (const p of faturados) {
      out.push({
        id: `faturado:${p.numero_pedido}`,
        tipo: 'pedido_faturado',
        prioridade: ALERT_DEFS.pedido_faturado.prioridade,
        titulo: `Pedido ${p.numero_pedido} foi faturado`,
        descricao: nomeCliente(p.cliente_nome, p.cliente_fantasia),
        detalhe: 'Nota Fiscal e boleto disponíveis.',
        data: p.data_emissao,
        rota: '/financeiro',
        acao: 'Baixar documentos',
      });
    }
  } else if (faturados.length > 0) {
    const hojeStr = hoje.toISOString().slice(0, 10);
    out.push({
      id: `faturado-grupo:${hojeStr}`,
      tipo: 'pedido_faturado',
      prioridade: ALERT_DEFS.pedido_faturado.prioridade,
      titulo: `${faturados.length} pedidos faturados recentemente`,
      descricao: 'Notas fiscais e boletos disponíveis para download.',
      data: hojeStr,
      rota: '/financeiro',
      acao: 'Baixar documentos',
      agrupado: faturados.length,
    });
  }
  return out;
}

// ─── Avisos do sistema (tabela concremapprep_notificacoes) ──────────────────
function alertasSistema({ notificacoesDB }: EngineInput): Alerta[] {
  return notificacoesDB.map(n => ({
    id: `db:${n.id}`,
    tipo: (n.tipo === 'sistema' ? 'aviso_sistema' : 'atualizacao') as Alerta['tipo'],
    prioridade: ALERT_DEFS.aviso_sistema.prioridade,
    titulo: n.titulo,
    descricao: n.mensagem,
    data: n.created_at,
    rota: n.link ?? '/alertas',
    acao: n.link ? 'Abrir' : 'Ver',
  }));
}

// ─── Entrada principal ───────────────────────────────────────────────────────
export function gerarAlertas(input: EngineInput): Alerta[] {
  const todos = [
    ...alertasOrcamentos(input),
    ...alertasRecompra(input),
    ...alertasFaturamento(input),
    ...alertasSistema(input),
    // Tipos meta_atingida / comissao_liberada estão registrados e prontos na
    // arquitetura; geradores entram quando houver dados de metas no banco.
  ];
  // Mais recente primeiro dentro do conjunto
  return todos.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
}
