import { describe, it, expect } from 'vitest';
import { API_MAX_ROWS, atingiuTeto, marcarComo, marcarTruncamento } from './apiLimits';

// Guarda o achado A5: o Data API corta em 1.000 linhas e o app precisa perceber.
// Se alguém trocar o teto no painel do Supabase e esquecer da constante, ou
// afrouxar a comparação, as telas voltam a mentir em silêncio.

describe('atingiuTeto', () => {
  it('acusa quando a consulta encosta no teto', () => {
    expect(atingiuTeto(API_MAX_ROWS)).toBe(true);
    expect(atingiuTeto(API_MAX_ROWS + 1)).toBe(true);
  });

  it('não acusa abaixo do teto — inclusive uma linha antes', () => {
    expect(atingiuTeto(API_MAX_ROWS - 1)).toBe(false);
    expect(atingiuTeto(0)).toBe(false);
  });
});

describe('marcação de listas truncadas', () => {
  it('marcarTruncamento usa as linhas CRUAS, não o tamanho da lista devolvida', () => {
    // Cenário real da carteira: 1.000 pedidos lidos viram 300 clientes.
    // Quem foi cortado foram os pedidos — a lista de clientes é derivada.
    const clientes = marcarTruncamento(new Array(300).fill({}), API_MAX_ROWS);
    expect(clientes.truncado).toBe(true);
    expect(clientes.length).toBe(300);
  });

  it('não marca quando as linhas cruas ficaram abaixo do teto', () => {
    expect(marcarTruncamento([{}], 10).truncado).toBe(false);
  });

  it('marcarComo aceita o veredito de quem tem mais de uma consulta cortável', () => {
    expect(marcarComo([{}], true).truncado).toBe(true);
    expect(marcarComo([{}], false).truncado).toBe(false);
  });

  it('a lista marcada continua sendo um array normal', () => {
    const l = marcarComo([1, 2, 3], true);
    expect(Array.isArray(l)).toBe(true);
    expect(l.map(n => n * 2)).toEqual([2, 4, 6]);
  });
});
