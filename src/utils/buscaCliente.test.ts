import { describe, it, expect } from 'vitest';
import { clienteCasaBusca, soDigitos } from './buscaCliente';

const HELIO = {
  cliente_nome: '53.053.766 HELIO DE DEUS DA SILVA',
  cliente_fantasia: null,
  cliente_cnpj: '76451879304',
};

const PREDILAR = {
  cliente_nome: 'A PREDILAR',
  cliente_fantasia: 'PREDILAR MATERIAIS',
  cliente_cnpj: '12.345.678/0001-99',
};

describe('clienteCasaBusca', () => {
  it('casa por nome', () => {
    expect(clienteCasaBusca(HELIO, 'helio')).toBe(true);
    expect(clienteCasaBusca(HELIO, 'DEUS DA SILVA')).toBe(true);
  });

  it('NÃO casa quem não tem o termo no nome', () => {
    // O bug: o predicado de CNPJ casava com todos quando o termo era texto,
    // então a busca por nome devolvia a lista inteira.
    expect(clienteCasaBusca(PREDILAR, 'helio')).toBe(false);
  });

  it('casa por nome fantasia', () => {
    expect(clienteCasaBusca(PREDILAR, 'materiais')).toBe(true);
  });

  it('casa por CNPJ com ou sem máscara', () => {
    expect(clienteCasaBusca(PREDILAR, '12345678')).toBe(true);
    expect(clienteCasaBusca(PREDILAR, '12.345.678/0001-99')).toBe(true);
    expect(clienteCasaBusca(PREDILAR, '0001')).toBe(true);
  });

  it('não casa CNPJ de outro cliente', () => {
    expect(clienteCasaBusca(HELIO, '12345678')).toBe(false);
  });

  it('termo vazio ou só espaços casa com todos — a tela decide se filtra', () => {
    expect(clienteCasaBusca(HELIO, '')).toBe(true);
    expect(clienteCasaBusca(HELIO, '   ')).toBe(true);
  });

  it('ignora espaços em volta do termo', () => {
    expect(clienteCasaBusca(HELIO, '  helio  ')).toBe(true);
  });

  it('é indiferente a maiúsculas', () => {
    expect(clienteCasaBusca(PREDILAR, 'PrEdIlAr')).toBe(true);
  });

  it('lida com campos nulos sem quebrar', () => {
    const vazio = { cliente_nome: null, cliente_fantasia: null, cliente_cnpj: null };
    expect(clienteCasaBusca(vazio, 'algo')).toBe(false);
    expect(clienteCasaBusca(vazio, '123')).toBe(false);
  });

  it('nome que contém dígitos casa como texto', () => {
    // O nome do cliente começa com "53.053.766" — buscar isso deve funcionar.
    expect(clienteCasaBusca(HELIO, '53.053.766')).toBe(true);
  });
});

describe('soDigitos', () => {
  it('remove tudo que não é dígito', () => {
    expect(soDigitos('12.345.678/0001-99')).toBe('12345678000199');
    expect(soDigitos('abc')).toBe('');
    expect(soDigitos(null)).toBe('');
    expect(soDigitos(undefined)).toBe('');
  });
});
