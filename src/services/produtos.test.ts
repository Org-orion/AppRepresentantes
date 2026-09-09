import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Fronteira única desta bateria: `supabase.from`. Mockar o módulo do client
// também impede que ele seja avaliado — ele lê `sessionStorage` no topo, e o
// ambiente da suíte é `node`.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from '@/lib/supabase/client';
import { fetchProdutos } from './produtos';
import { API_MAX_ROWS } from '@/constants/apiLimits';

// ─────────────────────────────────────────────────────────────────────────────
// O catálogo vinha TRUNCADO.
//
// `fetchProdutos` fazia UMA leitura sem `range`, e o Data API corta em 1.000.
// O que chegava era um prefixo por `codigo`, tratado como se fosse o catálogo.
// Sintoma que revelou o problema: com KIT PORTA + CORRER + Sarrafo 6mm +
// Lacca Touch, a cor VELAR não aparecia no filtro — porque as opções dos chips
// saem de `new Set()` sobre esta lista, e nenhum produto VELAR daquele recorte
// cabia nas primeiras 1.000 linhas. Pior que o filtro: a busca por código
// também roda em memória sobre esta lista, então o produto era inorçável.
//
// O que estes testes protegem:
//   1. a leitura pagina e devolve o conjunto INTEIRO, de todos os tipos;
//   2. o laço termina — página curta, página vazia e múltiplo exato do teto;
//   3. nenhuma linha se perde nem se repete entre páginas;
//   4. a ordenação é TOTAL (`codigo` + `id`), sem a qual paginar é inseguro;
//   5. erro do servidor propaga, em vez de devolver catálogo pela metade;
//   6. nenhum filtro de negócio é aplicado nesta camada.
// ─────────────────────────────────────────────────────────────────────────────

const from = supabase.from as unknown as Mock;

interface Resposta { data: unknown; error: unknown }

/** Uma chamada ao builder, com o que foi encadeado nela. */
interface Chamada {
  tabela: string;
  select?: string;
  orders: string[];
  range?: [number, number];
}

const chamadas: Chamada[] = [];

/** Stub do query builder do PostgREST: encadeável e *thenable*. */
function programar(respostas: Resposta[]) {
  let i = 0;
  from.mockImplementation(((tabela: string) => {
    const registro: Chamada = { tabela, orders: [] };
    chamadas.push(registro);
    const resposta = respostas[i++] ?? { data: [], error: null };

    const q = {
      select: (s: string) => { registro.select = s; return q; },
      order:  (col: string) => { registro.orders.push(col); return q; },
      range:  (de: number, ate: number) => { registro.range = [de, ate]; return q; },
      then: <T>(
        onOk?: ((v: Resposta) => T | PromiseLike<T>) | null,
        onErr?: ((e: unknown) => T | PromiseLike<T>) | null,
      ) => Promise.resolve(resposta).then(onOk, onErr),
    };
    return q;
  }) as never);
}

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (error: unknown): Resposta => ({ data: null, error });

/** N produtos com código sequencial previsível, a partir de um deslocamento. */
const pagina = (n: number, base: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${base + i}`,
    codigo: String(1000000 + base + i),
    descricao: `PRODUTO ${base + i}`,
    tipo_produto: 'KIT PORTA',
    cor: 'BIANCO',
  }));

beforeEach(() => {
  chamadas.length = 0;
  from.mockReset();
});

describe('fetchProdutos — paginação do catálogo', () => {
  it('A. catálogo menor que o teto: uma leitura só, e o laço para', async () => {
    programar([ok(pagina(37, 0))]);

    const produtos = await fetchProdutos();

    expect(produtos).toHaveLength(37);
    expect(produtos.truncado).toBe(false);   // completa, e diz isso
    expect(from).toHaveBeenCalledTimes(1);
    expect(chamadas[0].tabela).toBe('concremprodutos_produtos');
    expect(chamadas[0].range).toEqual([0, API_MAX_ROWS - 1]);
  });

  it('B. catálogo maior que o teto: percorre TODAS as páginas', async () => {
    programar([
      ok(pagina(API_MAX_ROWS, 0)),
      ok(pagina(API_MAX_ROWS, API_MAX_ROWS)),
      ok(pagina(412, API_MAX_ROWS * 2)),
    ]);

    const produtos = await fetchProdutos();

    expect(produtos).toHaveLength(API_MAX_ROWS * 2 + 412);
    expect(from).toHaveBeenCalledTimes(3);
    expect(chamadas.map(c => c.range)).toEqual([
      [0, API_MAX_ROWS - 1],
      [API_MAX_ROWS, API_MAX_ROWS * 2 - 1],
      [API_MAX_ROWS * 2, API_MAX_ROWS * 3 - 1],
    ]);
  });

  it('C. o produto que estava fora das 1.000 agora chega', async () => {
    // Reproduz o caso real: VELAR só existe depois da linha 1.000.
    const primeira = pagina(API_MAX_ROWS, 0);
    const segunda = [
      { id: 'id-velar-1', codigo: '1011872', descricao: 'KIT PORTA CORRER INNOV.', tipo_produto: 'KIT PORTA', cor: 'VELAR' },
      { id: 'id-velar-2', codigo: '1015356', descricao: 'KIT PORTA CORRER ESSENZ.', tipo_produto: 'KIT PORTA', cor: 'VELAR' },
    ];
    programar([ok(primeira), ok(segunda)]);

    const produtos = await fetchProdutos();
    const cores = [...new Set(produtos.map(p => p.cor).filter(Boolean))];

    expect(produtos).toHaveLength(API_MAX_ROWS + 2);
    expect(cores).toContain('VELAR');
    expect(produtos.map(p => p.codigo)).toEqual(
      expect.arrayContaining(['1011872', '1015356']),
    );
  });

  it('D. múltiplo exato do teto: página cheia seguida de vazia encerra', async () => {
    programar([ok(pagina(API_MAX_ROWS, 0)), ok([])]);

    const produtos = await fetchProdutos();

    expect(produtos).toHaveLength(API_MAX_ROWS);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('E. catálogo vazio devolve lista vazia, sem laço extra', async () => {
    programar([ok([])]);

    // `toHaveLength` e nao `toEqual([])`: a lista volta marcada com
    // `truncado: false`, que e propriedade propria do array e conta no toEqual.
    await expect(fetchProdutos()).resolves.toHaveLength(0);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('F. `data` nulo é tratado como página vazia', async () => {
    programar([{ data: null, error: null }]);

    await expect(fetchProdutos()).resolves.toHaveLength(0);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('G. nenhuma linha se perde nem se repete entre páginas', async () => {
    programar([
      ok(pagina(API_MAX_ROWS, 0)),
      ok(pagina(500, API_MAX_ROWS)),
    ]);

    const produtos = await fetchProdutos();
    const ids = produtos.map(p => p.id);

    expect(new Set(ids).size).toBe(ids.length);           // sem duplicados
    expect(ids[0]).toBe('id-0');                          // começo preservado
    expect(ids[ids.length - 1]).toBe(`id-${API_MAX_ROWS + 499}`); // fim preservado
  });
});

describe('fetchProdutos — contrato da consulta', () => {
  it('H. ordenação TOTAL: `codigo` com desempate por `id`', async () => {
    programar([ok(pagina(3, 0))]);
    await fetchProdutos();

    // Sem o desempate, códigos repetidos fariam linhas trocar de página.
    expect(chamadas[0].orders).toEqual(['codigo', 'id']);
  });

  it('I. traz TODOS os tipos de produto — nenhum filtro nesta camada', async () => {
    programar([ok([
      { id: 'a', codigo: '1', tipo_produto: 'KIT PORTA', situacao: 'ATIVO' },
      { id: 'b', codigo: '2', tipo_produto: 'ALIZAR', situacao: 'ATIVO' },
      { id: 'c', codigo: '3', tipo_produto: 'BATENTE', situacao: 'INATIVO' },
    ])]);

    const produtos = await fetchProdutos();
    const tipos = produtos.map(p => p.tipo_produto);

    expect(tipos).toEqual(['KIT PORTA', 'ALIZAR', 'BATENTE']);
    // `situacao` continua vindo do banco e sendo decidida na tela, não aqui.
    expect(produtos.map(p => p.situacao)).toEqual(['ATIVO', 'ATIVO', 'INATIVO']);
  });

  it('J. o select carrega os campos usados pelos filtros das telas', async () => {
    programar([ok([])]);
    await fetchProdutos();

    for (const campo of [
      'id', 'codigo', 'descricao', 'tipo_produto', 'movimento', 'enchimento',
      'linha', 'perfil', 'revestimento', 'cor', 'altura_cm', 'largura_cm',
      'protect_plus', 'veneziana', 'visor', 'situacao',
    ]) {
      expect(chamadas[0].select).toContain(campo);
    }
  });
});

describe('fetchProdutos — falhas', () => {
  it('K. erro na primeira página propaga', async () => {
    const erro = { code: '42501', message: 'permission denied', details: null, hint: null };
    programar([falha(erro)]);

    await expect(fetchProdutos()).rejects.toEqual(erro);
  });

  it('L. erro numa página do meio propaga — nada de catálogo pela metade', async () => {
    const erro = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null };
    programar([ok(pagina(API_MAX_ROWS, 0)), falha(erro)]);

    // Devolver as 1.000 primeiras aqui seria repetir o defeito original: uma
    // lista incompleta que a tela trataria como o catálogo inteiro.
    await expect(fetchProdutos()).rejects.toEqual(erro);
  });
});
