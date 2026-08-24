import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Fronteira única desta bateria: `supabase.from`. Mockar o módulo do client
// também impede que ele seja avaliado — ele lê `sessionStorage` no topo, e o
// ambiente da suíte é `node`.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from '@/lib/supabase/client';
import { fetchRepresentantesUnicos, fetchSituacoesEntrega, REP_EXCLUIDOS } from './pedidosVenda';
import { VALID_ID_NOTA_CONF } from '@/constants/orderFilters';
import { API_MAX_ROWS } from '@/constants/apiLimits';

// ─────────────────────────────────────────────────────────────────────────────
// Achado A19 — a lista de valores distintos vinha TRUNCADA.
//
// A consulta antiga fazia UMA leitura, ordenada por `order(coluna)` e sem
// `range`. O Data API corta em 1.000, então o que chegava era um PREFIXO
// ALFABÉTICO — não uma amostra. Medido em produção: 243 representantes
// distintos, dos quais apenas 14 apareciam nas primeiras 1.000 linhas.
//
// A tentativa agregada (`select=coluna,count()`) resolveria isso no banco, mas
// o PostgREST deste projeto responde `PGRST123 — Use of aggregate functions is
// not allowed`. Por isso o fallback existe, e por isso ele precisa paginar.
//
// O que estes testes protegem:
//   1. o agregado, quando funciona, NÃO pagina — é o caminho barato;
//   2. quando ele falha, o fallback assume e percorre TODAS as páginas;
//   3. nenhum valor se perde entre páginas, e duplicados viram um só;
//   4. o laço termina — inclusive no caso de página cheia seguida de vazia;
//   5. os filtros de negócio continuam exatamente os mesmos.
// ─────────────────────────────────────────────────────────────────────────────

const from = supabase.from as unknown as Mock;

interface Resposta { data: unknown; error: unknown }

/** Uma chamada ao builder, com o que foi encadeado nela. */
interface Chamada {
  tabela: string;
  select?: string;
  in?: [string, unknown];
  not: [string, string, unknown][];
  order?: string;
  range?: [number, number];
}

const chamadas: Chamada[] = [];

/**
 * Stub do query builder do PostgREST: encadeável e *thenable*, registrando o
 * que foi pedido. `respostas` é consumida em ordem, uma por `from()`.
 */
function programar(respostas: Resposta[]) {
  let i = 0;
  from.mockImplementation(((tabela: string) => {
    const registro: Chamada = { tabela, not: [] };
    chamadas.push(registro);
    const resposta = respostas[i++] ?? { data: [], error: null };

    const q = {
      select: (s: string) => { registro.select = s; return q; },
      in:     (col: string, vals: unknown) => { registro.in = [col, vals]; return q; },
      not:    (col: string, op: string, val: unknown) => { registro.not.push([col, op, val]); return q; },
      order:  (col: string) => { registro.order = col; return q; },
      range:  (de: number, ate: number) => { registro.range = [de, ate]; return q; },
      then: <T>(
        onOk?: ((v: Resposta) => T | PromiseLike<T>) | null,
        onErr?: ((e: unknown) => T | PromiseLike<T>) | null,
      ) => Promise.resolve(resposta).then(onOk, onErr),
    };
    return q;
  }) as never);
}

const ERRO_AGREGADO = {
  code: 'PGRST123',
  message: 'Use of aggregate functions is not allowed',
  details: null,
  hint: null,
};

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (error: unknown): Resposta => ({ data: null, error });

/** N linhas de `representante`, com valores distintos e previsíveis. */
const pagina = (n: number, prefixo: string) =>
  Array.from({ length: n }, (_, i) => ({ representante: `${prefixo}-${String(i).padStart(4, '0')}` }));

beforeEach(() => {
  chamadas.length = 0;
  from.mockReset();
});

describe('valoresDistintos — caminho agregado', () => {
  it('A. quando o agregado funciona, devolve os distintos SEM paginar', async () => {
    programar([ok([
      { representante: 'REP A', count: 120 },
      { representante: 'REP B', count: 7 },
    ])]);

    const reps = await fetchRepresentantesUnicos();

    expect(reps).toEqual(['REP A', 'REP B']);
    expect(from).toHaveBeenCalledTimes(1);            // uma leitura só
    expect(chamadas[0].select).toBe('representante, count()');
    expect(chamadas[0].range).toBeUndefined();        // agregado não usa range
  });

  it('A2. o agregado descarta o campo count e devolve só os nomes', async () => {
    programar([ok([{ representante: 'REP A', count: 999 }])]);
    await expect(fetchRepresentantesUnicos()).resolves.toEqual(['REP A']);
  });
});

describe('valoresDistintos — fallback paginado', () => {
  it('B. erro no agregado (PGRST123) faz cair no fallback', async () => {
    programar([falha(ERRO_AGREGADO), ok([{ representante: 'REP A' }])]);

    const reps = await fetchRepresentantesUnicos();

    expect(reps).toEqual(['REP A']);
    expect(from).toHaveBeenCalledTimes(2);            // agregado + 1 página
    expect(chamadas[0].select).toBe('representante, count()');
    expect(chamadas[1].select).toBe('representante');
    expect(chamadas[1].range).toEqual([0, API_MAX_ROWS - 1]);
  });

  it('C. página única menor que o teto: uma leitura, deduplicada e ordenada', async () => {
    programar([
      falha(ERRO_AGREGADO),
      ok([
        { representante: 'REP A' },
        { representante: 'REP A' },
        { representante: 'REP B' },
      ]),
    ]);

    const reps = await fetchRepresentantesUnicos();

    expect(reps).toEqual(['REP A', 'REP B']);         // ordem do banco preservada
    expect(from).toHaveBeenCalledTimes(2);            // não pede a página seguinte
  });

  it('D. múltiplas páginas: 1000 + 1000 + 300, com os ranges corretos', async () => {
    programar([
      falha(ERRO_AGREGADO),
      ok(pagina(API_MAX_ROWS, 'p1')),
      ok(pagina(API_MAX_ROWS, 'p2')),
      ok(pagina(300, 'p3')),
    ]);

    const reps = await fetchRepresentantesUnicos();

    // 4 chamadas: agregado + 3 páginas. A 4ª página NÃO é pedida.
    expect(from).toHaveBeenCalledTimes(4);
    expect(chamadas[1].range).toEqual([0, 999]);
    expect(chamadas[2].range).toEqual([1000, 1999]);
    expect(chamadas[3].range).toEqual([2000, 2999]);

    // Nada se perde: 2.300 valores distintos.
    expect(reps).toHaveLength(2300);
    expect(reps[0]).toBe('p1-0000');
    expect(reps).toContain('p2-0000');
    expect(reps[reps.length - 1]).toBe('p3-0299');
  });

  it('E. duplicados entre páginas aparecem uma única vez', async () => {
    const repetido = { representante: 'REP REPETIDO' };
    programar([
      falha(ERRO_AGREGADO),
      ok([...Array.from({ length: API_MAX_ROWS - 1 }, () => repetido), { representante: 'REP A' }]),
      ok([repetido, { representante: 'REP B' }]),
    ]);

    const reps = await fetchRepresentantesUnicos();

    expect(reps.filter(r => r === 'REP REPETIDO')).toHaveLength(1);
    expect(reps).toEqual(['REP REPETIDO', 'REP A', 'REP B']);
  });

  it('F. página cheia seguida de página VAZIA encerra sem laço infinito', async () => {
    programar([
      falha(ERRO_AGREGADO),
      ok(pagina(API_MAX_ROWS, 'p1')),
      ok([]),                                          // vazia: 0 < 1000 ⇒ para
    ]);

    const reps = await fetchRepresentantesUnicos();

    expect(from).toHaveBeenCalledTimes(3);
    expect(chamadas[2].range).toEqual([1000, 1999]);
    expect(reps).toHaveLength(API_MAX_ROWS);
  });

  it('F2. `data: null` numa página também encerra', async () => {
    programar([
      falha(ERRO_AGREGADO),
      ok(pagina(API_MAX_ROWS, 'p1')),
      { data: null, error: null },
    ]);

    await expect(fetchRepresentantesUnicos()).resolves.toHaveLength(API_MAX_ROWS);
    expect(from).toHaveBeenCalledTimes(3);
  });

  it('F3. valores em branco não encurtam a página nem param o laço cedo', async () => {
    // `extrair` descarta vazios. Se a parada olhasse o total EXTRAÍDO em vez do
    // total RECEBIDO, esta página de 1.000 linhas viraria 998 e o laço pararia.
    const comBrancos = [...pagina(API_MAX_ROWS - 2, 'p1'), { representante: '' }, { representante: null }];
    programar([
      falha(ERRO_AGREGADO),
      ok(comBrancos),
      ok([{ representante: 'REP FINAL' }]),
    ]);

    const reps = await fetchRepresentantesUnicos();

    expect(from).toHaveBeenCalledTimes(3);             // buscou a página seguinte
    expect(reps).toContain('REP FINAL');
    expect(reps).not.toContain('');
  });

  it('G. erro na SEGUNDA página propaga', async () => {
    const erro = { code: 'PGRST000', message: 'boom' };
    programar([falha(ERRO_AGREGADO), ok(pagina(API_MAX_ROWS, 'p1')), falha(erro)]);

    await expect(fetchRepresentantesUnicos()).rejects.toEqual(erro);
  });

  it('G2. erro na TERCEIRA página propaga', async () => {
    const erro = { code: 'PGRST000', message: 'boom na 3a' };
    programar([
      falha(ERRO_AGREGADO),
      ok(pagina(API_MAX_ROWS, 'p1')),
      ok(pagina(API_MAX_ROWS, 'p2')),
      falha(erro),
    ]);

    await expect(fetchRepresentantesUnicos()).rejects.toEqual(erro);
  });

  it('G3. erro na primeira página do fallback propaga — não vira lista vazia', async () => {
    const erro = { code: 'PGRST000', message: 'boom na 1a' };
    programar([falha(ERRO_AGREGADO), falha(erro)]);

    await expect(fetchRepresentantesUnicos()).rejects.toEqual(erro);
  });
});

describe('valoresDistintos — filtros de negócio preservados', () => {
  it('H. toda página mantém a tabela, o select, os filtros e a ordenação', async () => {
    programar([falha(ERRO_AGREGADO), ok(pagina(API_MAX_ROWS, 'p1')), ok(pagina(1, 'p2'))]);

    await fetchRepresentantesUnicos();

    for (const c of chamadas.slice(1)) {              // as páginas do fallback
      expect(c.tabela).toBe('concrem_pedidos_venda'); // a VIEW, nunca erp.*
      expect(c.select).toBe('representante');
      expect(c.in).toEqual(['id_nota_conf', VALID_ID_NOTA_CONF]);
      expect(c.order).toBe('representante');
      expect(c.not).toContainEqual(['representante', 'is', null]);
      expect(c.not).toContainEqual([
        'representante', 'in', `(${REP_EXCLUIDOS.map(r => `"${r}"`).join(',')})`,
      ]);
    }
  });

  it('H2. o representante excluído continua fora — uma única entrada na lista', () => {
    expect(REP_EXCLUIDOS).toEqual(['40001498 - JANDERSON LEROY MERLIN']);
  });

  it('H3. `situacao_entrega` usa os mesmos filtros, MENOS a exclusão de representante', async () => {
    programar([falha(ERRO_AGREGADO), ok([{ situacao_entrega: 'ENTREGUE' }])]);

    const situacoes = await fetchSituacoesEntrega();

    expect(situacoes).toEqual(['ENTREGUE']);
    const p = chamadas[1];
    expect(p.select).toBe('situacao_entrega');
    expect(p.order).toBe('situacao_entrega');
    expect(p.in).toEqual(['id_nota_conf', VALID_ID_NOTA_CONF]);
    expect(p.not).toContainEqual(['situacao_entrega', 'is', null]);
    // A exclusão de vendas diretas não se aplica a esta coluna.
    expect(p.not.some(([col]) => col === 'representante')).toBe(false);
  });

  it('H4. `situacao_entrega` também pagina', async () => {
    programar([
      falha(ERRO_AGREGADO),
      ok(Array.from({ length: API_MAX_ROWS }, (_, i) => ({ situacao_entrega: `S${i}` }))),
      ok([{ situacao_entrega: 'ULTIMA' }]),
    ]);

    const situacoes = await fetchSituacoesEntrega();

    expect(from).toHaveBeenCalledTimes(3);
    expect(situacoes).toHaveLength(API_MAX_ROWS + 1);
    expect(situacoes[situacoes.length - 1]).toBe('ULTIMA');
  });
});

describe('valoresDistintos — regressão do truncamento (A19)', () => {
  it('o cenário real: 243 valores distintos espalhados por 7.682 linhas', async () => {
    // Reproduz a forma do que foi medido em produção. Com a leitura única
    // antiga, só os valores das 1.000 primeiras linhas apareceriam.
    const linhas: { representante: string }[] = [];
    for (let i = 0; i < 243; i++) {
      const nome = `REP-${String(i).padStart(3, '0')}`;
      const repeticoes = i < 14 ? 71 : 27;            // os primeiros ocupam o começo
      for (let k = 0; k < repeticoes; k++) linhas.push({ representante: nome });
    }

    const paginas: Resposta[] = [falha(ERRO_AGREGADO)];
    for (let off = 0; off < linhas.length; off += API_MAX_ROWS) {
      paginas.push(ok(linhas.slice(off, off + API_MAX_ROWS)));
    }
    // Última página vem incompleta e encerra o laço; se ficasse exata, o laço
    // pediria mais uma — coberto em F.
    const reps = await (programar(paginas), fetchRepresentantesUnicos());

    expect(reps).toHaveLength(243);                   // TODOS, não 14
    expect(reps).toContain('REP-000');
    expect(reps).toContain('REP-242');                // o que sumia antes
  });
});
