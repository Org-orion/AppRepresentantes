export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

/**
 * Formata um valor monetário, mas exibe um travessão "—" quando o valor é
 * 0, null ou undefined. Usar SÓ onde o zero é ruído (valor unitário de pedido
 * nas listas de Pedidos/Acompanhamento) — nunca onde R$ 0,00 é informação legítima.
 */
export function formatValorOuTraco(valor: number | null | undefined): string {
  if (!valor || valor === 0) return '—';
  return formatCurrency(valor);
}

/**
 * Quebra uma string de contatos (emails/telefones) em uma lista limpa.
 * Os campos do ERP vêm com vários endereços separados por ";" ou ",".
 * Ex: "a@x.com;b@y.com, c@z.com" → ["a@x.com", "b@y.com", "c@z.com"].
 */
export function parseContatos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Valor abreviado (R$ 24,3M / R$ 40,2k) — use SOMENTE em eixo de gráfico.
 *
 * Substituiu `formatCurrencyK`, que abreviava em toda a interface: cards, KPIs,
 * listas e tabelas passaram a mostrar o valor inteiro, porque "R$ 24,3M" esconde
 * justamente o número que a pessoa foi conferir. No eixo de um gráfico a
 * abreviação continua sendo a escolha certa — a faixa reservada tem algo como
 * 30 a 55px de largura, e um rótulo completo ali se sobrepõe ao vizinho.
 */
export const formatCurrencyEixo = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (abs >= 1000)      return `R$ ${(value / 1000).toFixed(1).replace('.', ',')}k`;
  return formatCurrency(value);
};

/**
 * Formata data para pt-BR no fuso de Brasília (America/Sao_Paulo).
 * Strings "YYYY-MM-DD" são tratadas como data local para evitar
 * a interpretação como UTC midnight (que causaria d-1 em UTC-3).
 */
export const formatDate = (date: string | Date): string => {
  if (!date) return '';
  let d: Date;
  if (typeof date === 'string') {
    // "YYYY-MM-DD" sem hora → adiciona T12:00 para evitar UTC offset
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      d = new Date(`${date}T12:00:00`);
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(d);
};

export const formatDateLong = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);

export const formatPercent = (value: number, decimals = 0) =>
  `${value.toFixed(decimals).replace('.', ',')}%`;

export const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  devolvido: 'Devolvido',
  perdido: 'Perdido',
  liberado:   'Liberado',
  mapeamento: 'Mapeamento',
  ferragem:   'Ferragem',
  comercial:  'Comercial',
  producao:   'Produção',
  faturado:   'Faturado',
  entrega:    'Entrega',
  finalizado: 'Finalizado',
};

export const PEDIDO_STATUS_STEPS = [
  'aprovado', 'mapeamento', 'ferragem',
  'producao', 'faturado', 'entrega', 'finalizado'
] as const;

export type PedidoStatusStep = typeof PEDIDO_STATUS_STEPS[number];
