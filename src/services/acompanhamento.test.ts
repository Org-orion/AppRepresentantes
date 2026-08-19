import { describe, it, expect, vi } from 'vitest';

// O módulo importa o client do Supabase, que cria a conexão ao ser carregado.
// Aqui só interessa a REGRA de mapeamento de status — nada de rede.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

const { mapStatus, STATUS_MAP } = await import('./acompanhamento');

// Criticidade C2 — este mapeamento decide em que etapa do pipeline cada pedido
// aparece. Errar aqui move pedido de lugar na Central de Acompanhamento e
// distorce os KPIs de produção.

describe('mapStatus', () => {
  it('traduz o vocabulário do ERP para os estágios do app', () => {
    expect(mapStatus('aguardando_avaliacao')).toBe('aprovado');
    expect(mapStatus('mapeamento_concluido')).toBe('mapeamento');
    expect(mapStatus('ferragem_recebida')).toBe('ferragem');
    expect(mapStatus('liberado_comercial')).toBe('comercial');
    expect(mapStatus('liberado_producao')).toBe('producao');
    expect(mapStatus('faturado')).toBe('faturado');
    expect(mapStatus('em_entrega')).toBe('entrega');
    expect(mapStatus('entregue')).toBe('finalizado');
  });

  it('colapsa os status de gerência em "comercial"', () => {
    expect(mapStatus('aguardando_gerencia')).toBe('comercial');
    expect(mapStatus('confirmado_gerencia')).toBe('comercial');
  });

  it('trata produção finalizada ainda como produção — quem avança é o faturamento', () => {
    expect(mapStatus('producao_finalizada')).toBe('producao');
  });

  it('pedido sem status entra no pipeline como aprovado', () => {
    expect(mapStatus(null)).toBe('aprovado');
    expect(mapStatus('')).toBe('aprovado');
  });

  it('status desconhecido não quebra a tela — cai na entrada padrão', () => {
    // Se o ERP criar um status novo, o pedido aparece no começo do pipeline em
    // vez de sumir da lista. Some seria pior: pedido invisível.
    expect(mapStatus('status_que_ainda_nao_existe')).toBe('aprovado');
  });

  it('o estágio "liberado" não é alcançável por nenhum status do banco', () => {
    // Registrado no CLAUDE.md: ele existe na UI mas nada mapeia para ele.
    // Este teste falha no dia em que alguém criar esse mapeamento — e aí a
    // documentação precisa ser atualizada junto.
    expect(Object.values(STATUS_MAP)).not.toContain('liberado');
  });
});
