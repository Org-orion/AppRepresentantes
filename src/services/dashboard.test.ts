import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// O client real é substituído por completo. Isso serve a dois propósitos:
//   1. mockar a ÚNICA fronteira desta etapa — `supabase.rpc`;
//   2. impedir que `@/lib/supabase/client` seja avaliado, já que ele lê
//      `sessionStorage` no topo do módulo e o ambiente da suíte é `node`.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

import { supabase } from '@/lib/supabase/client';
import {
  dashboardJanelas,
  dashboardRpcRange,
  periodoRange,
  diffDias,
  fetchDashboardSerieDiaria,
  consolidarDashboardSerie,
  fetchDashboardStats,
  RPC_JANELA_MAX_DIAS,
  type DashboardSerieDiariaRow,
} from './dashboard';

const rpc = vi.mocked(supabase.rpc);
const from = vi.mocked(supabase.from);

/** Resposta no formato do supabase-js: `{ data, error }`. */
function respondeCom(data: unknown, error: unknown = null) {
  rpc.mockResolvedValueOnce({ data, error } as never);
}

// ── Stub do query builder do PostgREST ──────────────────────────────────────
// O builder é *thenable*: `await query` resolve `{ data, error }`. Reproduzimos
// só isso, mais os métodos encadeáveis que `fetchDashboardStats` usa. Assim o
// teste não precisa saber nada do supabase-js além do contrato real.

interface RespostaTabela { data: unknown; error: unknown }

type QueryStub = {
  select: (...a: unknown[]) => QueryStub;
  in:     (...a: unknown[]) => QueryStub;
  eq:     (...a: unknown[]) => QueryStub;
  not:    (...a: unknown[]) => QueryStub;
  then:   <T>(
    onOk?:  ((v: RespostaTabela) => T | PromiseLike<T>) | null,
    onErr?: ((e: unknown) => T | PromiseLike<T>) | null,
  ) => Promise<T>;
};

function queryStub(resposta: RespostaTabela): QueryStub {
  const q: QueryStub = {
    select: () => q,
    in:     () => q,
    eq:     () => q,
    not:    () => q,
    then:   (onOk, onErr) => Promise.resolve(resposta).then(onOk, onErr),
  };
  return q;
}

/**
 * Programa as respostas por tabela. Tabela não declarada devolve lista vazia,
 * que é o que o PostgREST faria para um filtro sem resultado.
 */
function tabelasRespondem(mapa: Record<string, RespostaTabela>) {
  from.mockImplementation(((tabela: string) =>
    queryStub(mapa[tabela] ?? { data: [], error: null })) as never);
}

/** Registro da lista bruta `concrem_pedidos_venda`, como o service a lê. */
const pedidoBruto = (
  numero_pedido: string, data_emissao: string, total_pedido_venda: number,
) => ({ id: numero_pedido, numero_pedido, data_emissao, total_pedido_venda, representante: 'R1' });

// ─────────────────────────────────────────────────────────────────────────────
// E5-1 — janela única da chamada a `app_dashboard_serie_diaria`.
//
// Duas coisas precisam estar certas aqui, e a segunda é a perigosa:
//
//   1. A janela tem que CONTER as três que o dashboard usa (período, período
//      anterior e os 6 meses da série). Se faltar um dia, o número da tela muda.
//
//   2. A janela NÃO pode passar de 730 dias. A RPC levanta `22023` acima disso,
//      e o pior caso — `periodo='ano'` — bate EXATAMENTE em 730 quando a união
//      contém um 29/02. Margem zero. Este arquivo é o que trava esse limite.
//
// Função pura: nada de Supabase, nada de mock de rede.
// ─────────────────────────────────────────────────────────────────────────────

// `dashboardJanelas` lê `new Date()` para o ano/mês padrão e para a janela móvel
// do trimestre. Sem relógio fixo, metade destes testes mudaria de resultado a
// cada mês.
const AGORA = new Date(2026, 7, 21);   // 21/08/2026, local — mês corrente = agosto (índice 7)

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  // `restoreMocks: true` do vitest.config restaura spies de `vi.spyOn`, mas NÃO
  // limpa um `vi.fn()` criado dentro da factory de `vi.mock` — sem isto, as
  // chamadas se acumulam e `expect(rpc).not.toHaveBeenCalled()` passa a ver o
  // histórico do arquivo inteiro.
  rpc.mockReset();
  from.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Contém = a janela da RPC engloba `[ini, fim]` por inteiro. */
function contem(range: { ini: string; fim: string }, ini: string, fim: string) {
  return range.ini <= ini && range.fim >= fim;
}

describe('diffDias', () => {
  it('conta a diferença como o PostgreSQL, não como duração', () => {
    expect(diffDias('2026-01-01', '2026-01-01')).toBe(0);
    expect(diffDias('2026-01-01', '2026-01-02')).toBe(1);
  });

  it('conta o 29/02 de um ano bissexto', () => {
    expect(diffDias('2024-02-28', '2024-03-01')).toBe(2);   // passa por 29/02
    expect(diffDias('2026-02-28', '2026-03-01')).toBe(1);   // não existe 29/02
  });

  it('não é afetado por horário de verão', () => {
    // Outubro/fevereiro no hemisfério sul foram épocas de virada de DST no
    // Brasil. Com aritmética local, um destes daria 0,958 ou 1,042 dia.
    expect(diffDias('2018-10-20', '2018-10-21')).toBe(1);
    expect(diffDias('2018-02-17', '2018-02-18')).toBe(1);
    expect(diffDias('2018-01-01', '2018-12-31')).toBe(364);
  });
});

describe('dashboardJanelas — semântica atual preservada', () => {
  it('1. mês comum: agosto/2026', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });
    expect(j).toEqual({
      mesIni: '2026-08-01', mesFim: '2026-08-31',
      mesAntIni: '2026-07-01', mesAntFim: '2026-07-31',
      serieIni: '2026-03-01', serieFim: '2026-08-31',
    });
  });

  it('2. janeiro: período anterior e série caem no ano anterior', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 1 });
    expect(j).toEqual({
      mesIni: '2026-01-01', mesFim: '2026-01-31',
      mesAntIni: '2025-12-01', mesAntFim: '2025-12-31',
      serieIni: '2025-08-01', serieFim: '2026-01-31',
    });
  });

  it('3. trimestre no ano ATUAL: janela móvel terminando no mês corrente', () => {
    // Relógio em agosto/2026 (índice 7) ⇒ mFim = 7, período = jun–ago.
    const j = dashboardJanelas({ periodo: 'trimestre', ano: 2026 });
    expect(j).toEqual({
      mesIni: '2026-06-01', mesFim: '2026-08-31',
      mesAntIni: '2026-03-01', mesAntFim: '2026-05-31',
      serieIni: '2026-03-01', serieFim: '2026-08-31',
    });
  });

  it('4. trimestre de ano PASSADO: termina em dezembro, como hoje', () => {
    const j = dashboardJanelas({ periodo: 'trimestre', ano: 2025 });
    expect(j).toEqual({
      mesIni: '2025-10-01', mesFim: '2025-12-31',
      mesAntIni: '2025-07-01', mesAntFim: '2025-09-30',
      serieIni: '2025-07-01', serieFim: '2025-12-31',
    });
  });

  it('5. ano: período anterior é o ano civil anterior inteiro', () => {
    const j = dashboardJanelas({ periodo: 'ano', ano: 2026 });
    expect(j).toEqual({
      mesIni: '2026-01-01', mesFim: '2026-12-31',
      mesAntIni: '2025-01-01', mesAntFim: '2025-12-31',
      serieIni: '2026-07-01', serieFim: '2026-12-31',
    });
  });

  it('6. sem filtro: usa o mês corrente do relógio', () => {
    expect(dashboardJanelas()).toEqual(dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 }));
  });

  it('7. trimestre em janeiro do ano corrente atravessa o ano para trás', () => {
    vi.setSystemTime(new Date(2026, 0, 15));   // 15/01/2026 ⇒ mFim = 0
    expect(dashboardJanelas({ periodo: 'trimestre', ano: 2026 })).toEqual({
      mesIni: '2025-11-01', mesFim: '2026-01-31',
      mesAntIni: '2025-08-01', mesAntFim: '2025-10-31',
      serieIni: '2025-08-01', serieFim: '2026-01-31',
    });
  });
});

describe('dashboardRpcRange — cobertura das três janelas', () => {
  const CASOS = [
    { nome: 'mês comum',            f: { periodo: 'mes' as const, ano: 2026, mes: 8 } },
    { nome: 'janeiro (cruza ano)',  f: { periodo: 'mes' as const, ano: 2026, mes: 1 } },
    { nome: 'fevereiro',            f: { periodo: 'mes' as const, ano: 2026, mes: 2 } },
    { nome: 'trimestre ano atual',  f: { periodo: 'trimestre' as const, ano: 2026 } },
    { nome: 'trimestre ano passado',f: { periodo: 'trimestre' as const, ano: 2025 } },
    { nome: 'ano sem 29/02',        f: { periodo: 'ano' as const, ano: 2026 } },
    { nome: 'ano com 29/02',        f: { periodo: 'ano' as const, ano: 2025 } },
  ];

  for (const { nome, f } of CASOS) {
    it(`contém período, anterior e os 6 meses — ${nome}`, () => {
      const j = dashboardJanelas(f);
      const r = dashboardRpcRange(f);

      expect(contem(r, j.mesIni, j.mesFim)).toBe(true);
      expect(contem(r, j.mesAntIni, j.mesAntFim)).toBe(true);
      expect(contem(r, j.serieIni, j.serieFim)).toBe(true);
    });
  }

  it('não sobra folga: ini e fim são exatamente os extremos usados', () => {
    const f = { periodo: 'mes' as const, ano: 2026, mes: 1 };
    const j = dashboardJanelas(f);
    const r = dashboardRpcRange(f);
    // Menor início entre as três, maior fim entre as três — sem margem inventada.
    const inicios = [j.mesIni, j.mesAntIni, j.serieIni].sort();
    const fins    = [j.mesFim, j.mesAntFim, j.serieFim].sort();
    expect(r.ini).toBe(inicios[0]);
    expect(r.fim).toBe(fins[fins.length - 1]);
  });

  it('8. seis meses cruzando dezembro/janeiro', () => {
    // Fevereiro/2026: a série volta a setembro/2025.
    const r = dashboardRpcRange({ periodo: 'mes', ano: 2026, mes: 2 });
    expect(r).toEqual({ ini: '2025-09-01', fim: '2026-02-28', dias: 180, excedeTeto: false });
  });
});

describe('dashboardRpcRange — teto de 730 dias da RPC', () => {
  it('ano SEM 29/02 na união: 729 dias', () => {
    // 2025 e 2026 são comuns ⇒ 365 + 365 - 1.
    const r = dashboardRpcRange({ periodo: 'ano', ano: 2026 });
    expect(r.ini).toBe('2025-01-01');
    expect(r.fim).toBe('2026-12-31');
    expect(r.dias).toBe(729);
    expect(r.excedeTeto).toBe(false);
  });

  it('ano COM 29/02 na união: 730 dias — o teto exato, sem folga', () => {
    // 2024 é bissexto ⇒ 366 + 365 - 1 = 730. Este é o pior caso do sistema.
    const r = dashboardRpcRange({ periodo: 'ano', ano: 2025 });
    expect(r.ini).toBe('2024-01-01');
    expect(r.fim).toBe('2025-12-31');
    expect(r.dias).toBe(730);
    expect(r.dias).toBe(RPC_JANELA_MAX_DIAS);   // margem ZERO
    expect(r.excedeTeto).toBe(false);
  });

  it('ano bissexto como ano SELECIONADO também dá 730', () => {
    // 2023 comum + 2024 bissexto ⇒ 365 + 366 - 1 = 730.
    const r = dashboardRpcRange({ periodo: 'ano', ano: 2024 });
    expect(r.dias).toBe(730);
    expect(r.excedeTeto).toBe(false);
  });

  it('ano de virada de século sem bissexto (2100 não é bissexto)', () => {
    const r = dashboardRpcRange({ periodo: 'ano', ano: 2101 });
    expect(r.dias).toBe(729);
    expect(r.excedeTeto).toBe(false);
  });

  // ⚠️ ESTE É O TESTE QUE IMPEDE A REGRESSÃO.
  //
  // Se alguém alargar a série de 6 para 12 meses, ou criar um período de 2 anos,
  // ele falha aqui — e não em produção, com a RPC devolvendo `22023` e a tela em
  // branco.
  it('NENHUMA combinação de período/ano/mês passa de 730 dias', () => {
    const excedentes: { periodo: string; ano: number; mes: number; dias: number }[] = [];
    let maior = 0;

    for (let ano = 2000; ano <= 2100; ano++) {
      for (const periodo of ['mes', 'trimestre', 'ano'] as const) {
        for (let mes = 1; mes <= 12; mes++) {
          const r = dashboardRpcRange({ periodo, ano, mes });
          if (r.dias > maior) maior = r.dias;
          if (r.excedeTeto) excedentes.push({ periodo, ano, mes, dias: r.dias });
        }
      }
    }

    expect(excedentes).toEqual([]);
    expect(maior).toBe(RPC_JANELA_MAX_DIAS);   // 730: cabe, e encosta
  });

  it('a diferença é sempre a mesma que a RPC calcula', () => {
    for (let ano = 2020; ano <= 2030; ano++) {
      const r = dashboardRpcRange({ periodo: 'ano', ano });
      expect(r.dias).toBe(diffDias(r.ini, r.fim));
      expect(r.dias).toBeLessThanOrEqual(RPC_JANELA_MAX_DIAS);
    }
  });
});

describe('periodoRange — comportamento inalterado', () => {
  // `periodoRange` é consumida por OperationsPage, PipelineGargalos,
  // UFDistributionPanel e useRepPerformance. Ela passou a derivar de
  // `dashboardJanelas`; estes testes provam que o resultado não mudou.
  it('devolve exatamente o período selecionado, sem o anterior nem a série', () => {
    expect(periodoRange({ periodo: 'mes', ano: 2026, mes: 8 }))
      .toEqual({ ini: '2026-08-01', fim: '2026-08-31' });
    expect(periodoRange({ periodo: 'trimestre', ano: 2026 }))
      .toEqual({ ini: '2026-06-01', fim: '2026-08-31' });
    expect(periodoRange({ periodo: 'trimestre', ano: 2025 }))
      .toEqual({ ini: '2025-10-01', fim: '2025-12-31' });
    expect(periodoRange({ periodo: 'ano', ano: 2026 }))
      .toEqual({ ini: '2026-01-01', fim: '2026-12-31' });
    expect(periodoRange()).toEqual({ ini: '2026-08-01', fim: '2026-08-31' });
  });

  it('é a mesma coisa que mesIni/mesFim de dashboardJanelas', () => {
    for (const periodo of ['mes', 'trimestre', 'ano'] as const) {
      for (const ano of [2024, 2025, 2026]) {
        const j = dashboardJanelas({ periodo, ano, mes: 3 });
        expect(periodoRange({ periodo, ano, mes: 3 })).toEqual({ ini: j.mesIni, fim: j.mesFim });
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E5-2 — chamada isolada da RPC `app_dashboard_serie_diaria`.
//
// Fronteira mockada: SOMENTE `supabase.rpc`. Nada de rede, nada de banco.
//
// O que estes testes protegem, em ordem de gravidade:
//   1. erro NUNCA vira lista vazia — lista vazia significa "não vendeu nada", e
//      confundir as duas coisas é o defeito D-2;
//   2. valor inválido NUNCA vira 0 silenciosamente — `Number(null)` é 0;
//   3. entrada inválida não chega a gastar round-trip até o ERP;
//   4. a ordenação existe no cliente, porque a RPC deliberadamente não ordena.
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchDashboardSerieDiaria — chamada à RPC', () => {
  it('1. envia as datas e `p_representante: null` quando não há representante', async () => {
    respondeCom([]);
    await fetchDashboardSerieDiaria('2026-01-01', '2026-08-20');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('app_dashboard_serie_diaria', {
      p_data_inicio: '2026-01-01',
      p_data_fim: '2026-08-20',
      p_representante: null,
    });
  });

  it('2. envia o representante exatamente como recebido, sem normalizar', async () => {
    respondeCom([]);
    await fetchDashboardSerieDiaria(
      '2026-01-01', '2026-08-20', '10008082 - DANILO AUGUSTO REHNEIN',
    );

    expect(rpc).toHaveBeenCalledWith('app_dashboard_serie_diaria', {
      p_data_inicio: '2026-01-01',
      p_data_fim: '2026-08-20',
      p_representante: '10008082 - DANILO AUGUSTO REHNEIN',
    });
  });

  it('não aplica regra de perfil: quem decide ignorar o parâmetro é a RPC', async () => {
    // Um não-global pode mandar qualquer valor; a função repassa. A RPC ignora
    // (medido no T4 da E3). Duplicar a regra aqui criaria uma segunda verdade.
    respondeCom([]);
    await fetchDashboardSerieDiaria('2026-01-01', '2026-01-31', 'REPRESENTANTE DE OUTRA PESSOA');
    expect(rpc).toHaveBeenCalledWith(
      'app_dashboard_serie_diaria',
      expect.objectContaining({ p_representante: 'REPRESENTANTE DE OUTRA PESSOA' }),
    );
  });
});

describe('fetchDashboardSerieDiaria — resposta', () => {
  it('3. devolve [] quando `data` é null e não houve erro', async () => {
    respondeCom(null, null);
    await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31')).resolves.toEqual([]);
  });

  it('3b. devolve [] quando a RPC responde lista vazia', async () => {
    respondeCom([]);
    await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31')).resolves.toEqual([]);
  });

  it('4. PROPAGA o erro da RPC — não devolve [] nem engole', async () => {
    const erro = { code: '42501', message: 'permission denied', details: null, hint: null };
    respondeCom(null, erro);

    await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31')).rejects.toEqual(erro);
  });

  it('4b. erro tem precedência sobre `data` presente', async () => {
    const erro = { code: '22023', message: 'janela excede o máximo' };
    respondeCom([{ dia: '2026-01-02', pedidos: 1, valor_total: 10 }], erro);

    await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31')).rejects.toEqual(erro);
  });

  it('5. ordena por dia ASCENDENTE, mesmo com a RPC devolvendo fora de ordem', async () => {
    respondeCom([
      { dia: '2026-03-15', pedidos: 3, valor_total: 300 },
      { dia: '2026-01-02', pedidos: 1, valor_total: 100 },
      { dia: '2026-12-31', pedidos: 5, valor_total: 500 },
      { dia: '2026-02-28', pedidos: 2, valor_total: 200 },
    ]);

    const linhas = await fetchDashboardSerieDiaria('2026-01-01', '2026-12-31');
    expect(linhas.map(l => l.dia)).toEqual([
      '2026-01-02', '2026-02-28', '2026-03-15', '2026-12-31',
    ]);
  });

  it('5b. a ordenação não embaralha os valores de cada linha', async () => {
    respondeCom([
      { dia: '2026-03-15', pedidos: 3, valor_total: 300 },
      { dia: '2026-01-02', pedidos: 1, valor_total: 100 },
    ]);

    const linhas = await fetchDashboardSerieDiaria('2026-01-01', '2026-12-31');
    expect(linhas).toEqual([
      { dia: '2026-01-02', pedidos: 1, valor_total: 100 },
      { dia: '2026-03-15', pedidos: 3, valor_total: 300 },
    ]);
  });

  it('6. números já numéricos passam intactos, inclusive decimais', async () => {
    respondeCom([{ dia: '2026-01-02', pedidos: 12, valor_total: 61979.72 }]);

    const [linha] = await fetchDashboardSerieDiaria('2026-01-01', '2026-01-31');
    expect(linha.pedidos).toBe(12);
    expect(linha.valor_total).toBeCloseTo(61979.72, 2);
    expect(typeof linha.pedidos).toBe('number');
    expect(typeof linha.valor_total).toBe('number');
  });

  it('6b. zero legítimo continua zero', async () => {
    respondeCom([{ dia: '2026-01-02', pedidos: 0, valor_total: 0 }]);
    const [linha] = await fetchDashboardSerieDiaria('2026-01-01', '2026-01-31');
    expect(linha).toEqual({ dia: '2026-01-02', pedidos: 0, valor_total: 0 });
  });

  it('7. strings numéricas são convertidas — defesa caso o PostgREST mude', async () => {
    respondeCom([{ dia: '2026-01-02', pedidos: '12', valor_total: '61979.72' }]);

    const [linha] = await fetchDashboardSerieDiaria('2026-01-01', '2026-01-31');
    expect(linha.pedidos).toBe(12);
    expect(linha.valor_total).toBeCloseTo(61979.72, 2);
  });

  it('14. NÃO preenche dias ausentes — devolve só o que a RPC mandou', async () => {
    respondeCom([
      { dia: '2026-01-02', pedidos: 1, valor_total: 100 },
      { dia: '2026-01-05', pedidos: 2, valor_total: 200 },
    ]);

    const linhas = await fetchDashboardSerieDiaria('2026-01-01', '2026-01-31');
    expect(linhas).toHaveLength(2);
    expect(linhas.map(l => l.dia)).toEqual(['2026-01-02', '2026-01-05']);
    // 03 e 04 continuam ausentes: baldes e preenchimento são a E5-3.
    expect(linhas.some(l => l.dia === '2026-01-03')).toBe(false);
  });
});

describe('fetchDashboardSerieDiaria — valor inválido nunca vira zero', () => {
  const INVALIDOS: { nome: string; valor: unknown }[] = [
    { nome: 'null',               valor: null },
    { nome: 'undefined',          valor: undefined },
    { nome: 'string vazia',       valor: '' },
    { nome: 'string em branco',   valor: '   ' },
    { nome: 'texto nao numerico', valor: 'abc' },
    { nome: 'NaN',                valor: NaN },
    { nome: 'Infinity',           valor: Infinity },
    { nome: '-Infinity',          valor: -Infinity },
    { nome: 'boolean',            valor: true },
    { nome: 'objeto',             valor: {} },
  ];

  for (const { nome, valor } of INVALIDOS) {
    it(`8. rejeita pedidos = ${nome}`, async () => {
      respondeCom([{ dia: '2026-01-02', pedidos: valor, valor_total: 100 }]);
      await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31'))
        .rejects.toThrow(/pedidos/);
    });

    it(`8b. rejeita valor_total = ${nome}`, async () => {
      respondeCom([{ dia: '2026-01-02', pedidos: 1, valor_total: valor }]);
      await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31'))
        .rejects.toThrow(/valor_total/);
    });
  }

  it('8c. Number(null) seria 0 — este teste prova que NÃO é isso que acontece', async () => {
    respondeCom([{ dia: '2026-01-02', pedidos: null, valor_total: null }]);
    expect(Number(null)).toBe(0);   // o comportamento que estamos recusando
    await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31')).rejects.toThrow();
  });

  it('8d. rejeita `dia` fora do formato YYYY-MM-DD', async () => {
    respondeCom([{ dia: '2026-01-02T00:00:00', pedidos: 1, valor_total: 100 }]);
    await expect(fetchDashboardSerieDiaria('2026-01-01', '2026-01-31'))
      .rejects.toThrow(/dia/);
  });
});

describe('fetchDashboardSerieDiaria — validação local, ANTES da rede', () => {
  it('9. `ini` vazio é rejeitado e a RPC não é chamada', async () => {
    await expect(fetchDashboardSerieDiaria('', '2026-01-31')).rejects.toThrow(/ini/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('10. `fim` vazio é rejeitado e a RPC não é chamada', async () => {
    await expect(fetchDashboardSerieDiaria('2026-01-01', '')).rejects.toThrow(/fim/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('11. `ini` > `fim` é rejeitado e a RPC não é chamada', async () => {
    await expect(fetchDashboardSerieDiaria('2026-08-20', '2026-01-01'))
      .rejects.toThrow(/posterior/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('12. janela de 731 dias é rejeitada e a RPC não é chamada', async () => {
    // 2024-01-01 → 2025-12-31 são 730; um dia a mais estoura.
    await expect(fetchDashboardSerieDiaria('2024-01-01', '2026-01-01'))
      .rejects.toThrow(/excede o máximo/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('13. janela de EXATAMENTE 730 dias é aceita — o pior caso real do dashboard', async () => {
    const { ini, fim } = dashboardRpcRange({ periodo: 'ano', ano: 2025 });
    expect(diffDias(ini, fim)).toBe(RPC_JANELA_MAX_DIAS);

    respondeCom([]);
    await expect(fetchDashboardSerieDiaria(ini, fim)).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('data fora do formato é rejeitada e a RPC não é chamada', async () => {
    await expect(fetchDashboardSerieDiaria('01/01/2026', '2026-01-31'))
      .rejects.toThrow(/YYYY-MM-DD/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('toda saída de dashboardRpcRange é aceita pela validação', async () => {
    for (const periodo of ['mes', 'trimestre', 'ano'] as const) {
      for (const ano of [2024, 2025, 2026]) {
        const { ini, fim } = dashboardRpcRange({ periodo, ano, mes: 1 });
        respondeCom([]);
        await expect(fetchDashboardSerieDiaria(ini, fim)).resolves.toEqual([]);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E5-3 — consolidação da série diária nos números do dashboard.
//
// Função PURA: nenhum mock é usado aqui. `supabase.rpc` continua mockado no
// topo do arquivo por causa da E5-2, mas nada abaixo o exercita.
//
// O que estes testes protegem:
//   1. `pedidosNoPeriodo` soma o CAMPO `pedidos`, não conta linhas — uma linha
//      diária representa vários pedidos, e contar linhas subestimaria o número;
//   2. as janelas são inclusivas nas DUAS pontas — errar a borda esconde o
//      primeiro ou o último dia do mês;
//   3. os 6 baldes existem SEMPRE, mesmo em meses sem venda;
//   4. virada de ano e fevereiro bissexto saem certos sem depender de fuso.
// ─────────────────────────────────────────────────────────────────────────────

/** Atalho para montar linhas de série nos testes. */
const linha = (dia: string, pedidos: number, valor_total: number): DashboardSerieDiariaRow =>
  ({ dia, pedidos, valor_total });

describe('consolidarDashboardSerie — série vazia', () => {
  it('1. devolve zeros e ainda assim os 6 baldes mensais', () => {
    const janelas = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });
    const r = consolidarDashboardSerie([], janelas);

    expect(r.totalVendidoMes).toBe(0);
    expect(r.totalVendidoMesAnt).toBe(0);
    expect(r.pedidosNoPeriodo).toBe(0);
    expect(r.vendasMensais).toEqual([
      { mes: 'Mar', valor: 0 },
      { mes: 'Abr', valor: 0 },
      { mes: 'Mai', valor: 0 },
      { mes: 'Jun', valor: 0 },
      { mes: 'Jul', valor: 0 },
      { mes: 'Ago', valor: 0 },
    ]);
  });
});

describe('consolidarDashboardSerie — período selecionado', () => {
  const janelas = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });
  // mesIni 2026-08-01 · mesFim 2026-08-31 · mesAnt 2026-07-01..2026-07-31

  it('2. limites INCLUSIVOS: primeiro e último dia do mês entram', () => {
    const r = consolidarDashboardSerie([
      linha('2026-07-31', 1, 10),   // último dia do mês ANTERIOR — fora do atual
      linha('2026-08-01', 2, 100),  // primeiro dia do período
      linha('2026-08-31', 3, 200),  // último dia do período
      linha('2026-09-01', 9, 999),  // primeiro dia do mês seguinte — fora
    ], janelas);

    expect(r.totalVendidoMes).toBe(300);
    expect(r.pedidosNoPeriodo).toBe(5);
  });

  it('3. pedidosNoPeriodo SOMA o campo `pedidos` — não conta linhas', () => {
    const r = consolidarDashboardSerie([
      linha('2026-08-05', 7, 100),
      linha('2026-08-06', 5, 100),
    ], janelas);

    expect(r.pedidosNoPeriodo).toBe(12);   // 7 + 5
    expect(r.pedidosNoPeriodo).not.toBe(2);
  });

  it('3b. uma única linha com muitos pedidos conta todos', () => {
    const r = consolidarDashboardSerie([linha('2026-08-05', 137, 50)], janelas);
    expect(r.pedidosNoPeriodo).toBe(137);
  });
});

describe('consolidarDashboardSerie — período anterior', () => {
  const janelas = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });

  it('4. não mistura o período atual com o anterior', () => {
    const r = consolidarDashboardSerie([
      linha('2026-07-15', 1, 500),   // anterior
      linha('2026-08-15', 1, 900),   // atual
    ], janelas);

    expect(r.totalVendidoMes).toBe(900);
    expect(r.totalVendidoMesAnt).toBe(500);
  });

  it('14. bordas exatas de mesAntIni e mesAntFim são inclusivas', () => {
    const r = consolidarDashboardSerie([
      linha('2026-06-30', 1, 7),     // véspera — fora
      linha('2026-07-01', 1, 10),    // mesAntIni
      linha('2026-07-31', 1, 20),    // mesAntFim
    ], janelas);

    expect(r.totalVendidoMesAnt).toBe(30);
    expect(r.totalVendidoMes).toBe(0);
  });

  it('14b. um dia não pode cair nos dois períodos ao mesmo tempo', () => {
    const r = consolidarDashboardSerie([linha('2026-08-01', 1, 100)], janelas);
    expect(r.totalVendidoMes).toBe(100);
    expect(r.totalVendidoMesAnt).toBe(0);
  });
});

describe('consolidarDashboardSerie — vendasMensais', () => {
  const janelas = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });

  it('5. linha fora dos períodos atual/anterior entra SOMENTE em vendasMensais', () => {
    // Abril está nos 6 meses, mas não é nem o período nem o anterior.
    const r = consolidarDashboardSerie([linha('2026-04-10', 4, 400)], janelas);

    expect(r.totalVendidoMes).toBe(0);
    expect(r.totalVendidoMesAnt).toBe(0);
    expect(r.pedidosNoPeriodo).toBe(0);
    expect(r.vendasMensais.find(b => b.mes === 'Abr')?.valor).toBe(400);
  });

  it('6. vários dias do mesmo mês somam no mesmo balde', () => {
    const r = consolidarDashboardSerie([
      linha('2026-06-01', 1, 10),
      linha('2026-06-15', 1, 20),
      linha('2026-06-30', 1, 30),
    ], janelas);

    expect(r.vendasMensais.find(b => b.mes === 'Jun')?.valor).toBe(60);
  });

  it('7. mês sem nenhuma linha continua no array, com valor 0', () => {
    const r = consolidarDashboardSerie([linha('2026-08-10', 1, 100)], janelas);

    expect(r.vendasMensais).toHaveLength(6);
    expect(r.vendasMensais.filter(b => b.valor === 0)).toHaveLength(5);
    expect(r.vendasMensais.find(b => b.mes === 'Mai')).toEqual({ mes: 'Mai', valor: 0 });
  });

  it('8. sempre 6 baldes, em ordem cronológica, terminando no mês de mesFim', () => {
    const r = consolidarDashboardSerie([], janelas);
    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Mar','Abr','Mai','Jun','Jul','Ago']);
  });

  it('9. virada de ano: dezembro e janeiro no mesmo array', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 1 });   // mesFim 2026-01-31
    const r = consolidarDashboardSerie([
      linha('2025-08-31', 1, 80),    // primeiro balde: Ago/2025
      linha('2025-12-25', 1, 120),   // Dez/2025
      linha('2026-01-02', 1, 10),    // Jan/2026
    ], j);

    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Ago','Set','Out','Nov','Dez','Jan']);
    expect(r.vendasMensais[0]).toEqual({ mes: 'Ago', valor: 80 });
    expect(r.vendasMensais[4]).toEqual({ mes: 'Dez', valor: 120 });
    expect(r.vendasMensais[5]).toEqual({ mes: 'Jan', valor: 10 });
  });

  it('9b. dezembro como mês selecionado não vaza para o ano seguinte', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 12 });
    const r = consolidarDashboardSerie([
      linha('2026-12-31', 1, 50),
      linha('2027-01-01', 1, 999),   // ano seguinte — fora de tudo
    ], j);

    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Jul','Ago','Set','Out','Nov','Dez']);
    expect(r.vendasMensais[5]).toEqual({ mes: 'Dez', valor: 50 });
    expect(r.totalVendidoMes).toBe(50);
  });

  it('10. fevereiro de ano bissexto: 29/02 entra no período e no balde', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2024, mes: 2 });
    expect(j.mesFim).toBe('2024-02-29');   // o mês tem 29 dias

    const r = consolidarDashboardSerie([
      linha('2024-02-01', 1, 10),
      linha('2024-02-29', 3, 90),    // último dia, só existe em bissexto
    ], j);

    expect(r.totalVendidoMes).toBe(100);
    expect(r.pedidosNoPeriodo).toBe(4);
    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Set','Out','Nov','Dez','Jan','Fev']);
    expect(r.vendasMensais[5]).toEqual({ mes: 'Fev', valor: 100 });
  });

  it('10b. fevereiro de ano comum não tem dia 29', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 2 });
    expect(j.mesFim).toBe('2026-02-28');
  });

  it('15. dia ANTERIOR aos 6 meses não entra em nenhum balde', () => {
    // Fevereiro/2026 está antes do primeiro balde (Mar/2026).
    const r = consolidarDashboardSerie([linha('2026-02-20', 5, 5000)], janelas);

    expect(r.vendasMensais.every(b => b.valor === 0)).toBe(true);
    expect(r.vendasMensais).toHaveLength(6);
    expect(r.totalVendidoMes).toBe(0);
    expect(r.totalVendidoMesAnt).toBe(0);
  });

  it('15b. dia POSTERIOR ao último balde também não entra', () => {
    const r = consolidarDashboardSerie([linha('2026-09-01', 5, 5000)], janelas);
    expect(r.vendasMensais.every(b => b.valor === 0)).toBe(true);
  });
});

describe('consolidarDashboardSerie — pureza e determinismo', () => {
  const janelas = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });

  const SERIE: DashboardSerieDiariaRow[] = [
    linha('2026-03-10', 1, 11.11),
    linha('2026-05-20', 2, 22.22),
    linha('2026-07-15', 3, 33.33),
    linha('2026-08-01', 4, 44.44),
    linha('2026-08-31', 5, 55.55),
  ];

  it('11. entrada fora de ordem produz EXATAMENTE o mesmo resultado', () => {
    const ordenada  = [...SERIE];
    const invertida = [...SERIE].reverse();
    const bagunçada = [SERIE[3], SERIE[0], SERIE[4], SERIE[2], SERIE[1]];

    const a = consolidarDashboardSerie(ordenada,  janelas);
    const b = consolidarDashboardSerie(invertida, janelas);
    const c = consolidarDashboardSerie(bagunçada, janelas);

    // `toEqual` compara os números bit a bit — soma de float depende da ordem,
    // e é por isso que a função ordena uma cópia antes de somar.
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('12. NÃO muta o array recebido nem os objetos dentro dele', () => {
    const entrada = [...SERIE].reverse();
    const copiaProfunda = entrada.map(l => ({ ...l }));

    consolidarDashboardSerie(entrada, janelas);

    expect(entrada).toEqual(copiaProfunda);
    expect(entrada[0].dia).toBe(SERIE[4].dia);   // continua invertida
  });

  it('12b. não altera as janelas recebidas', () => {
    const j = dashboardJanelas({ periodo: 'mes', ano: 2026, mes: 8 });
    const copia = { ...j };
    consolidarDashboardSerie(SERIE, j);
    expect(j).toEqual(copia);
  });

  it('13. valores decimais não são arredondados', () => {
    const r = consolidarDashboardSerie([
      linha('2026-08-05', 1, 0.1),
      linha('2026-08-06', 1, 0.2),
    ], janelas);

    // 0.1 + 0.2 = 0.30000000000000004 em IEEE-754. A função preserva a soma do
    // JavaScript, exatamente como o service faz hoje — arredondar aqui seria
    // mudar o número da tela numa etapa que não deveria mudar número nenhum.
    expect(r.totalVendidoMes).toBe(0.1 + 0.2);
    expect(r.totalVendidoMes).not.toBe(0.3);
  });

  it('13b. centavos de valor real são preservados', () => {
    const r = consolidarDashboardSerie([
      linha('2026-08-05', 3, 203542.70),
      linha('2026-08-06', 12, 61979.72),
    ], janelas);

    expect(r.totalVendidoMes).toBe(203542.70 + 61979.72);
    expect(r.pedidosNoPeriodo).toBe(15);
  });

  it('chamadas repetidas com a mesma entrada dão o mesmo resultado', () => {
    expect(consolidarDashboardSerie(SERIE, janelas))
      .toEqual(consolidarDashboardSerie(SERIE, janelas));
  });
});

describe('consolidarDashboardSerie — casos com janelas reais', () => {
  it('trimestre: período de 3 meses, anterior de 3 meses, 6 baldes', () => {
    const j = dashboardJanelas({ periodo: 'trimestre', ano: 2026 });
    // mesIni 2026-06-01 · mesFim 2026-08-31 · mesAnt 2026-03-01..2026-05-31
    const r = consolidarDashboardSerie([
      linha('2026-03-01', 1, 10),    // anterior (borda)
      linha('2026-05-31', 1, 20),    // anterior (borda)
      linha('2026-06-01', 2, 100),   // atual (borda)
      linha('2026-08-31', 3, 200),   // atual (borda)
    ], j);

    expect(r.totalVendidoMesAnt).toBe(30);
    expect(r.totalVendidoMes).toBe(300);
    expect(r.pedidosNoPeriodo).toBe(5);
    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Mar','Abr','Mai','Jun','Jul','Ago']);
    // Todos os 4 dias caem dentro dos 6 baldes.
    expect(r.vendasMensais.reduce((s, b) => s + b.valor, 0)).toBe(330);
  });

  it('ano: o anterior é o ano inteiro, mas os baldes são só os 6 últimos meses', () => {
    const j = dashboardJanelas({ periodo: 'ano', ano: 2026 });
    // mesIni 2026-01-01 · mesFim 2026-12-31 · mesAnt 2025-01-01..2025-12-31
    const r = consolidarDashboardSerie([
      linha('2025-01-01', 1, 10),    // anterior (borda)
      linha('2025-12-31', 1, 20),    // anterior (borda)
      linha('2026-01-01', 2, 100),   // atual, mas ANTES do primeiro balde (Jul)
      linha('2026-07-01', 3, 300),   // atual e no primeiro balde
      linha('2026-12-31', 4, 400),   // atual e no último balde
    ], j);

    expect(r.totalVendidoMesAnt).toBe(30);
    expect(r.totalVendidoMes).toBe(800);
    expect(r.pedidosNoPeriodo).toBe(9);
    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Jul','Ago','Set','Out','Nov','Dez']);
    // Janeiro está no período mas FORA dos baldes: os 100 não aparecem no gráfico.
    expect(r.vendasMensais.reduce((s, b) => s + b.valor, 0)).toBe(700);
  });

  it('toda a saída de dashboardJanelas produz exatamente 6 baldes', () => {
    for (const periodo of ['mes', 'trimestre', 'ano'] as const) {
      for (let mes = 1; mes <= 12; mes++) {
        for (const ano of [2024, 2025, 2026]) {
          const r = consolidarDashboardSerie([], dashboardJanelas({ periodo, ano, mes }));
          expect(r.vendasMensais).toHaveLength(6);
          expect(r.vendasMensais.every(b => b.valor === 0)).toBe(true);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E5-4 — integração em `fetchDashboardStats`.
//
// Quatro campos passaram a vir da RPC; o resto continua na lista bruta. Os dois
// testes que realmente importam aqui:
//
//   • o early-return por lista vazia SUMIU. Ele zerava a série de um diretor
//     cujo filtro bruto (só grupo) não acha nada, mas cuja RPC (reps OR grupos)
//     acha — DIV-1, medida na E5-0 em +12 pedidos e +R$ 61.979,72;
//   • erro da RPC PROPAGA. Vira `isError` no React Query, não R$ 0,00 na tela.
//
// Mocks: `supabase.rpc` e `supabase.from`. Nada de React aqui.
// ─────────────────────────────────────────────────────────────────────────────

/** Chamada padrão: representante/operador com um rep code. */
const stats = (filtros: Parameters<typeof fetchDashboardStats>[2] = {}) =>
  fetchDashboardStats(['R1'], false, filtros);

const FILTRO_AGO = { periodo: 'mes' as const, ano: 2026, mes: 8 };

describe('fetchDashboardStats — chamada à RPC', () => {
  beforeEach(() => { tabelasRespondem({}); });

  it('1. chama a RPC exatamente UMA vez', async () => {
    respondeCom([]);
    await stats(FILTRO_AGO);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('2. usa exatamente o range de dashboardRpcRange', async () => {
    const range = dashboardRpcRange(FILTRO_AGO);
    respondeCom([]);
    await stats(FILTRO_AGO);

    expect(rpc).toHaveBeenCalledWith('app_dashboard_serie_diaria', {
      p_data_inicio: range.ini,
      p_data_fim: range.fim,
      p_representante: null,
    });
  });

  it('3. representante undefined vira null na RPC', async () => {
    respondeCom([]);
    await stats(FILTRO_AGO);
    expect(rpc).toHaveBeenCalledWith(
      'app_dashboard_serie_diaria',
      expect.objectContaining({ p_representante: null }),
    );
  });

  it('4. representante explícito é encaminhado sem alteração', async () => {
    respondeCom([]);
    await stats({ ...FILTRO_AGO, representante: '10008082 - DANILO AUGUSTO REHNEIN' });
    expect(rpc).toHaveBeenCalledWith(
      'app_dashboard_serie_diaria',
      expect.objectContaining({ p_representante: '10008082 - DANILO AUGUSTO REHNEIN' }),
    );
  });

  it('14. periodo=ano usa janela dentro do teto — inclusive o caso de 730 dias', async () => {
    for (const ano of [2025, 2026]) {
      const range = dashboardRpcRange({ periodo: 'ano', ano });
      expect(range.dias).toBeLessThanOrEqual(RPC_JANELA_MAX_DIAS);

      respondeCom([]);
      await stats({ periodo: 'ano', ano });
      expect(rpc).toHaveBeenLastCalledWith(
        'app_dashboard_serie_diaria',
        expect.objectContaining({ p_data_inicio: range.ini, p_data_fim: range.fim }),
      );
    }
    // 2025 é o caso de margem zero.
    expect(dashboardRpcRange({ periodo: 'ano', ano: 2025 }).dias).toBe(RPC_JANELA_MAX_DIAS);
  });
});

describe('fetchDashboardStats — os quatro campos vêm da RPC', () => {
  it('5. lista bruta e RPC discordam de propósito: vence a RPC', async () => {
    // Bruto: 1 pedido de R$ 7,00 em agosto. Se algum dos quatro campos ainda
    // fosse calculado daqui, apareceria 7 em vez dos valores da RPC.
    tabelasRespondem({
      concrem_pedidos_venda: {
        data: [pedidoBruto('P1', '2026-08-10', 7)],
        error: null,
      },
    });
    respondeCom([
      { dia: '2026-07-20', pedidos: 4, valor_total: 500 },    // período anterior
      { dia: '2026-08-05', pedidos: 9, valor_total: 1000 },   // período atual
      { dia: '2026-08-06', pedidos: 3, valor_total: 234.56 }, // período atual
    ]);

    const r = await stats(FILTRO_AGO);

    expect(r.totalVendidoMes).toBeCloseTo(1234.56, 2);
    expect(r.totalVendidoMesAnt).toBe(500);
    expect(r.pedidosNoPeriodo).toBe(12);                 // 9 + 3, não 1 linha bruta
    expect(r.vendasMensais.find(b => b.mes === 'Ago')?.valor).toBeCloseTo(1234.56, 2);
    expect(r.vendasMensais.find(b => b.mes === 'Jul')?.valor).toBe(500);

    // Nenhum dos quatro reflete os R$ 7,00 do bruto.
    expect(r.totalVendidoMes).not.toBe(7);
    expect(r.pedidosNoPeriodo).not.toBe(1);
  });

  it('7. RPC vazia zera os quatro campos, mas mantém os 6 baldes', async () => {
    tabelasRespondem({
      concrem_pedidos_venda: {
        data: [pedidoBruto('P1', '2026-08-10', 999)],
        error: null,
      },
    });
    respondeCom([]);

    const r = await stats(FILTRO_AGO);

    expect(r.totalVendidoMes).toBe(0);
    expect(r.totalVendidoMesAnt).toBe(0);
    expect(r.pedidosNoPeriodo).toBe(0);
    expect(r.vendasMensais).toHaveLength(6);
    expect(r.vendasMensais.every(b => b.valor === 0)).toBe(true);

    // As métricas brutas seguem independentes.
    expect(r.totalPedidos).toBe(1);
    expect(r.ticketMedio).toBe(999);
  });

  it('13. atravessa dezembro/janeiro corretamente', async () => {
    tabelasRespondem({});
    respondeCom([
      { dia: '2025-12-20', pedidos: 2, valor_total: 200 },   // período anterior
      { dia: '2026-01-15', pedidos: 5, valor_total: 700 },   // período atual
      { dia: '2025-08-10', pedidos: 1, valor_total: 80 },    // só o primeiro balde
    ]);

    const r = await stats({ periodo: 'mes', ano: 2026, mes: 1 });

    expect(r.totalVendidoMes).toBe(700);
    expect(r.pedidosNoPeriodo).toBe(5);
    expect(r.totalVendidoMesAnt).toBe(200);
    expect(r.vendasMensais.map(b => b.mes)).toEqual(['Ago','Set','Out','Nov','Dez','Jan']);
    expect(r.vendasMensais[0].valor).toBe(80);
    expect(r.vendasMensais[4].valor).toBe(200);
    expect(r.vendasMensais[5].valor).toBe(700);
  });
});

describe('fetchDashboardStats — lista bruta vazia NÃO zera a série (DIV-1)', () => {
  it('6. CRÍTICO: bruto vazio + RPC com vendas ⇒ série preservada', async () => {
    // É o cenário do diretor: filtro bruto só por grupo não acha nada; a RPC,
    // com `reps OR grupos`, acha. Antes da E5-4 o early-return devolvia
    // EMPTY_STATS e a tela mostrava R$ 0,00.
    tabelasRespondem({ concrem_pedidos_venda: { data: [], error: null } });
    respondeCom([
      { dia: '2026-07-10', pedidos: 3, valor_total: 203542.70 },
      { dia: '2026-08-10', pedidos: 12, valor_total: 61979.72 },
    ]);

    const r = await stats(FILTRO_AGO);

    // Métricas brutas: zeradas, como manda a lista vazia.
    expect(r.totalPedidos).toBe(0);
    expect(r.ticketMedio).toBe(0);
    expect(r.pipeline.total).toBe(0);
    expect(r.totalFaturadoMes).toBe(0);
    expect(r.faturadosNoPeriodo).toBe(0);
    expect(r.truncado).toBe(false);

    // Série: NÃO zerada.
    expect(r.totalVendidoMes).toBeCloseTo(61979.72, 2);
    expect(r.pedidosNoPeriodo).toBe(12);
    expect(r.totalVendidoMesAnt).toBeCloseTo(203542.70, 2);
    expect(r.vendasMensais.find(b => b.mes === 'Jul')?.valor).toBeCloseTo(203542.70, 2);
    expect(r.vendasMensais.find(b => b.mes === 'Ago')?.valor).toBeCloseTo(61979.72, 2);
  });

  it('6b. `data: null` no bruto também não bloqueia a série', async () => {
    tabelasRespondem({ concrem_pedidos_venda: { data: null, error: null } });
    respondeCom([{ dia: '2026-08-10', pedidos: 7, valor_total: 700 }]);

    const r = await stats(FILTRO_AGO);
    expect(r.totalPedidos).toBe(0);
    expect(r.totalVendidoMes).toBe(700);
    expect(r.pedidosNoPeriodo).toBe(7);
  });

  it('6c. bruto vazio não dispara batch de status nem de anexos', async () => {
    tabelasRespondem({ concrem_pedidos_venda: { data: [], error: null } });
    respondeCom([{ dia: '2026-08-10', pedidos: 1, valor_total: 10 }]);

    await stats(FILTRO_AGO);

    const tabelas = from.mock.calls.map(c => c[0]);
    expect(tabelas).toEqual(['concrem_pedidos_venda']);
    expect(tabelas).not.toContain('concrem_pedidos_status');
    expect(tabelas).not.toContain('relatorio_entrega_anexos');
  });
});

describe('fetchDashboardStats — erro', () => {
  it('8. erro da RPC PROPAGA, com o mesmo objeto e o mesmo code', async () => {
    const erro = { code: '42501', message: 'permission denied', details: null, hint: null };
    tabelasRespondem({});
    respondeCom(null, erro);
    respondeCom(null, erro);   // `mockResolvedValueOnce` — uma resposta por chamada

    await expect(stats(FILTRO_AGO)).rejects.toEqual(erro);
    await expect(stats(FILTRO_AGO)).rejects.toMatchObject({ code: '42501' });
  });

  it('8b. erro da RPC não vira EMPTY_STATS', async () => {
    tabelasRespondem({
      concrem_pedidos_venda: { data: [pedidoBruto('P1', '2026-08-10', 100)], error: null },
    });
    respondeCom(null, { code: '22023', message: 'janela excede o máximo' });

    await expect(stats(FILTRO_AGO)).rejects.toMatchObject({ code: '22023' });
  });

  it('erro da lista BRUTA mantém o comportamento antigo (EMPTY_STATS)', async () => {
    // Comportamento preservado de propósito: a E5 não redesenha erro.
    // ⚠️ Sabidamente imperfeito — descarta uma série válida. Revisar na E5-6.
    tabelasRespondem({
      concrem_pedidos_venda: { data: null, error: { code: 'PGRST000', message: 'boom' } },
    });
    respondeCom([{ dia: '2026-08-10', pedidos: 5, valor_total: 500 }]);

    const r = await stats(FILTRO_AGO);
    expect(r.totalVendidoMes).toBe(0);
    expect(r.totalPedidos).toBe(0);
    expect(r.vendasMensais).toEqual([]);
  });
});

describe('fetchDashboardStats — o que continua vindo da lista bruta', () => {
  it('9. totalPedidos e ticketMedio saem da lista bruta, não da RPC', async () => {
    tabelasRespondem({
      concrem_pedidos_venda: {
        data: [
          pedidoBruto('P1', '2026-08-10', 100),
          pedidoBruto('P2', '2026-08-11', 300),
          pedidoBruto('P3', '2026-02-01', 200),   // fora do período: ainda conta aqui
        ],
        error: null,
      },
    });
    respondeCom([{ dia: '2026-08-10', pedidos: 99, valor_total: 99999 }]);

    const r = await stats(FILTRO_AGO);

    expect(r.totalPedidos).toBe(3);              // 3 linhas brutas
    expect(r.ticketMedio).toBe(200);             // (100+300+200)/3
    expect(r.pedidosNoPeriodo).toBe(99);         // este vem da RPC
    expect(r.totalVendidoMes).toBe(99999);       // este também
  });

  it('10. pipeline deriva dos pedidos BRUTOS e do status, não da RPC', async () => {
    tabelasRespondem({
      concrem_pedidos_venda: {
        data: [
          pedidoBruto('P1', '2026-08-10', 100),
          pedidoBruto('P2', '2026-08-11', 100),
          pedidoBruto('P3', '2026-08-12', 100),
        ],
        error: null,
      },
      concrem_pedidos_status: {
        // 'faturado' é chave real do STATUS_MAP (services/acompanhamento.ts).
        // P2 e P3 não têm status → entram como 'aprovado', que é a regra atual.
        data: [{ numero_pedido: 'P1', status_atual: 'faturado' }],
        error: null,
      },
    });
    respondeCom([{ dia: '2026-08-10', pedidos: 500, valor_total: 500 }]);

    const r = await stats(FILTRO_AGO);

    // 3 pedidos brutos no pipeline — e não os 500 que a RPC informou.
    expect(r.pipeline.total).toBe(3);
    expect(r.pipeline.faturado).toBe(1);   // P1, via STATUS_MAP
    expect(r.pipeline.aprovado).toBe(2);   // P2 e P3, sem status
    expect(r.pedidosNoPeriodo).toBe(500);
  });

  it('11. faturado exige NF E boleto anexados — lógica preservada', async () => {
    tabelasRespondem({
      concrem_pedidos_venda: {
        data: [
          pedidoBruto('P1', '2026-08-10', 100),   // NF + boleto  → faturado
          pedidoBruto('P2', '2026-08-11', 200),   // só NF        → não
          pedidoBruto('P3', '2026-08-12', 400),   // nada         → não
        ],
        error: null,
      },
      relatorio_entrega_anexos: {
        data: [
          { pedido_id: 'P1', tipo: 'Nota Fiscal' },
          { pedido_id: 'P1', tipo: 'Boleto' },
          { pedido_id: 'P2', tipo: 'nota fiscal' },
        ],
        error: null,
      },
    });
    respondeCom([{ dia: '2026-08-10', pedidos: 3, valor_total: 700 }]);

    const r = await stats(FILTRO_AGO);

    expect(r.faturadosNoPeriodo).toBe(1);
    expect(r.totalFaturadoMes).toBe(100);
    // A RPC não influencia o faturado.
    expect(r.totalVendidoMes).toBe(700);
  });

  it('12. truncado depende SÓ do tamanho da lista bruta', async () => {
    const mil = Array.from({ length: 1000 }, (_, i) =>
      pedidoBruto(`P${i}`, '2026-08-10', 1));

    tabelasRespondem({ concrem_pedidos_venda: { data: mil, error: null } });
    respondeCom([{ dia: '2026-08-10', pedidos: 3, valor_total: 300 }]);

    const r = await stats(FILTRO_AGO);
    expect(r.truncado).toBe(true);
    expect(r.totalPedidos).toBe(1000);
    // A série da RPC não é truncável, mas o aviso continua — ele agora fala de
    // pipeline, faturado e ticket médio.
    expect(r.totalVendidoMes).toBe(300);
  });

  it('12b. abaixo do teto, truncado é false mesmo com série grande', async () => {
    tabelasRespondem({
      concrem_pedidos_venda: { data: [pedidoBruto('P1', '2026-08-10', 1)], error: null },
    });
    respondeCom(
      Array.from({ length: 300 }, (_, i) => ({
        dia: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
        pedidos: 1, valor_total: 1,
      })),
    );

    const r = await stats(FILTRO_AGO);
    expect(r.truncado).toBe(false);
  });

  it('o contrato DashboardStats continua com os mesmos 10 campos', async () => {
    tabelasRespondem({});
    respondeCom([]);
    const r = await stats(FILTRO_AGO);

    expect(Object.keys(r).sort()).toEqual([
      'faturadosNoPeriodo',
      'pedidosNoPeriodo',
      'pipeline',
      'ticketMedio',
      'totalFaturadoMes',
      'totalPedidos',
      'totalVendidoMes',
      'totalVendidoMesAnt',
      'truncado',
      'vendasMensais',
    ]);
  });
});
