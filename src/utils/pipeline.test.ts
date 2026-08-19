import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseAppDate, classifyAnexo, computeGargalos } from './pipeline';
import type { PedidoAcompanhamento } from '@/services/acompanhamento';

// Criticidade C2 — "parados", "atrasados" e "documentos pendentes" são os
// números que orientam prioridade de produção. Dependem de data, então o
// relógio é fixado: teste que muda de resultado conforme o dia não vale nada.

const HOJE = new Date('2026-08-19T12:00:00');

function pedido(p: Partial<PedidoAcompanhamento> = {}): PedidoAcompanhamento {
  return {
    id: '1', numero_pedido: '1', cliente_nome: 'C', cliente_fantasia: null,
    cliente_cnpj: '', cliente_cidade: null, cliente_uf: null,
    data_emissao: '2026-08-19', previsao_embarque: null, situacao_entrega: null,
    total_pedido_venda: 0, representante: null, status: 'aprovado',
    status_observacao: null, status_updated_at: '2026-08-19',
    anexos: [], logs: [],
    ...p,
  } as PedidoAcompanhamento;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOJE); });
afterEach(() => { vi.useRealTimers(); });

describe('parseAppDate', () => {
  it('lê data ISO curta ao meio-dia, para não escorregar de fuso', () => {
    expect(parseAppDate('2026-08-19')?.getDate()).toBe(19);
    expect(parseAppDate('2026-08-19T23:30:00')?.getDate()).toBe(19);
  });

  it('devolve null para vazio ou formato inesperado', () => {
    expect(parseAppDate(null)).toBeNull();
    expect(parseAppDate('')).toBeNull();
    expect(parseAppDate('19/08/2026')).toBeNull();
  });
});

describe('classifyAnexo', () => {
  it('reconhece boleto e nota fiscal', () => {
    expect(classifyAnexo('BOLETO')).toBe('boleto');
    expect(classifyAnexo('Nota Fiscal')).toBe('nf');
    expect(classifyAnexo('nf-e')).toBe('nf');
    expect(classifyAnexo('DANFE')).toBe('nf');   // DANFE é documento de nota fiscal
  });

  it('boleto vence quando o nome cita os dois', () => {
    expect(classifyAnexo('boleto da nota fiscal')).toBe('boleto');
  });

  // ── TESTE DE CARACTERIZAÇÃO ──
  // Registra o comportamento ATUAL, que não é necessariamente o desejado.
  // A regra é `tipo.includes('nf')`, então qualquer palavra que contenha essas
  // duas letras vira "nota fiscal" — "conferência" é o exemplo mais provável de
  // aparecer num nome de arquivo real. Um falso positivo aqui faz um pedido
  // parecer documentado e sumir da lista de pendências.
  // Ver achado A8 em docs/PLANO-SANEAMENTO.md. NÃO alterar este teste sem
  // decidir a regra nova junto — ele existe para a mudança ser consciente.
  it('classifica como NF qualquer texto que contenha "nf" (comportamento atual)', () => {
    expect(classifyAnexo('conferencia')).toBe('nf');
    expect(classifyAnexo('Comprovante de Conferência')).toBe('nf');
  });
});

describe('computeGargalos', () => {
  it('conta pedidos por estágio', () => {
    const g = computeGargalos([pedido({ status: 'producao' }), pedido({ status: 'producao' }), pedido()]);
    expect(g.counts.producao).toBe(2);
    expect(g.counts.aprovado).toBe(1);
  });

  it('parado é mais de 7 dias no mesmo estágio — 7 exatos ainda não conta', () => {
    const seteDias = pedido({ status_updated_at: '2026-08-12' });   // 7 dias
    const oitoDias = pedido({ status_updated_at: '2026-08-11' });   // 8 dias
    expect(computeGargalos([seteDias]).parados).toBe(0);
    expect(computeGargalos([oitoDias]).parados).toBe(1);
  });

  it('pedido finalizado nunca entra em parados nem em atrasados', () => {
    const antigo = pedido({
      status: 'finalizado', status_updated_at: '2025-01-01', previsao_embarque: '2025-01-01',
    });
    const g = computeGargalos([antigo]);
    expect(g.parados).toBe(0);
    expect(g.atrasados).toBe(0);
  });

  it('atrasado é previsão de embarque vencida', () => {
    expect(computeGargalos([pedido({ previsao_embarque: '2026-08-18' })]).atrasados).toBe(1);
    expect(computeGargalos([pedido({ previsao_embarque: '2026-08-20' })]).atrasados).toBe(0);
  });

  it('sem previsão de embarque, não é atraso — é ausência de informação', () => {
    expect(computeGargalos([pedido({ previsao_embarque: null })]).atrasados).toBe(0);
  });

  it('documento pendente só conta de faturado em diante', () => {
    const emProducaoSemDocs = pedido({ status: 'producao' });
    const faturadoSemDocs   = pedido({ status: 'faturado' });
    expect(computeGargalos([emProducaoSemDocs]).docs).toBe(0);
    expect(computeGargalos([faturadoSemDocs]).docs).toBe(1);
  });

  it('faturado com NF mas sem boleto ainda é pendência', () => {
    const p = pedido({
      status: 'faturado',
      anexos: [{ tipo: 'Nota Fiscal', arquivo_nome: 'nf.pdf', arquivo_url: 'u' }],
    } as Partial<PedidoAcompanhamento>);
    expect(computeGargalos([p]).docs).toBe(1);
  });

  it('faturado com NF e boleto não é pendência', () => {
    const p = pedido({
      status: 'faturado',
      anexos: [
        { tipo: 'Nota Fiscal', arquivo_nome: 'nf.pdf', arquivo_url: 'u' },
        { tipo: 'Boleto', arquivo_nome: 'b.pdf', arquivo_url: 'u' },
      ],
    } as Partial<PedidoAcompanhamento>);
    expect(computeGargalos([p]).docs).toBe(0);
  });

  it('lista vazia devolve tudo zerado, sem estourar', () => {
    expect(computeGargalos([])).toEqual({ counts: {}, parados: 0, atrasados: 0, docs: 0 });
  });
});
