// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ExecutivePeriod } from '@/hooks/useExecutiveSummary';

// ─────────────────────────────────────────────────────────────────────────────
// Cabeçalho da Sala de Comando — controles de período.
//
// O que estes testes protegem:
//
//   1. O seletor de mês só existe quando o período é MENSAL. Em trimestre e ano
//      ele não teria efeito: `dashboardJanelas` ignora `filtros.mes` nesses
//      ramos, e um controle que não muda número nenhum é pior que nenhum.
//
//   2. Todo controle ESPALHA o período e altera só o próprio campo. É o ponto
//      mais fácil de quebrar em silêncio: um `onPeriodChange({ mes })` sem o
//      spread apagaria o ano, e a tela passaria a mostrar outro período sem
//      ninguém perceber.
//
//   3. Sem `mes` no estado, o select mostra o mês CORRENTE — o mesmo valor que
//      `dashboardJanelas` já assumia por omissão. Divergir aqui faria o controle
//      exibir um mês e os dados virem de outro.
//
// Testa comportamento observável e callbacks. Nada de estado interno.
// ─────────────────────────────────────────────────────────────────────────────

// Os dois hooks alimentam APENAS a identidade do cabeçalho (nome e grupos), que
// não é o objeto deste teste. Mockados nos módulos que o componente importa —
// isso também impede que `@/contexts/AuthContext` e, por tabela, o client do
// Supabase sejam avaliados.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { usuario: { nome: 'Diretor Teste' } } }),
}));

vi.mock('@/hooks/useDataScope', () => ({
  useDataScope: () => ({ admin: false, repCodes: [], grupos: ['DAG COMERCIO'], scopeKey: 'd:DAG COMERCIO' }),
}));

const { default: ExecutiveHeader } = await import('./ExecutiveHeader');

// Relógio fixo: o componente monta a lista de anos a partir de `new Date()`
// (`[atual, atual-1, atual-2]`) e usa o mês corrente como fallback. Sem relógio
// fixo, metade destes testes mudaria de resultado com o passar do tempo.
const AGORA = new Date(2026, 7, 21);   // 21/08/2026 — mês corrente = agosto (8)

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  // A suíte roda com `globals: false`, então o Testing Library não registra o
  // cleanup automático — sem isto o DOM da renderização anterior sobra e o
  // teste seguinte encontra o seletor de quem já tinha renderizado.
  cleanup();
  vi.useRealTimers();
});

/** Renderiza o cabeçalho e devolve o espião de `onPeriodChange`. */
function montar(period: ExecutivePeriod) {
  const onPeriodChange = vi.fn();
  render(
    <ExecutiveHeader
      period={period}
      onPeriodChange={onPeriodChange}
      onRefresh={vi.fn()}
      atualizadoEm={AGORA}
    />,
  );
  return onPeriodChange;
}

const selectMes = () => screen.queryByLabelText('Mês') as HTMLSelectElement | null;
const selectAno = () => screen.getByLabelText('Ano') as HTMLSelectElement;

describe('ExecutiveHeader — quando o seletor de mês aparece', () => {
  it('1. período MENSAL: renderiza o select de mês, com os 12 meses', () => {
    montar({ periodo: 'mes', ano: 2026, mes: 8 });

    const select = selectMes();
    expect(select).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: /^(Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)$/ }))
      .toHaveLength(12);
  });

  it('2. período TRIMESTRE: NÃO renderiza o select de mês', () => {
    montar({ periodo: 'trimestre', ano: 2026, mes: 8 });

    expect(selectMes()).not.toBeInTheDocument();
    // O de ano continua, para não confundir ausência de mês com header quebrado.
    expect(selectAno()).toBeInTheDocument();
  });

  it('3. período ANO: NÃO renderiza o select de mês', () => {
    montar({ periodo: 'ano', ano: 2026, mes: 8 });

    expect(selectMes()).not.toBeInTheDocument();
    expect(selectAno()).toBeInTheDocument();
  });
});

describe('ExecutiveHeader — seleção de mês', () => {
  it('4. escolher Abril altera SÓ o mês, preservando período e ano', () => {
    const onPeriodChange = montar({ periodo: 'mes', ano: 2026, mes: 8 });

    fireEvent.change(selectMes()!, { target: { value: '4' } });

    expect(onPeriodChange).toHaveBeenCalledTimes(1);
    expect(onPeriodChange).toHaveBeenCalledWith({ periodo: 'mes', ano: 2026, mes: 4 });
  });

  it('4b. o valor enviado é numérico, não a string do <option>', () => {
    const onPeriodChange = montar({ periodo: 'mes', ano: 2026, mes: 8 });

    fireEvent.change(selectMes()!, { target: { value: '12' } });

    const enviado = onPeriodChange.mock.calls[0][0] as ExecutivePeriod;
    expect(enviado.mes).toBe(12);
    expect(typeof enviado.mes).toBe('number');
  });

  it('4c. "Abr" corresponde ao mês 4 — rótulo e valor não estão fora de sincronia', () => {
    montar({ periodo: 'mes', ano: 2026, mes: 8 });

    expect((screen.getByRole('option', { name: 'Abr' }) as HTMLOptionElement).value).toBe('4');
    expect((screen.getByRole('option', { name: 'Jan' }) as HTMLOptionElement).value).toBe('1');
    expect((screen.getByRole('option', { name: 'Dez' }) as HTMLOptionElement).value).toBe('12');
  });

  it('o mês que está no período é o selecionado', () => {
    montar({ periodo: 'mes', ano: 2026, mes: 4 });
    expect(selectMes()!.value).toBe('4');
  });
});

describe('ExecutiveHeader — período sem `mes` definido', () => {
  it('5. usa o mês CORRENTE como fallback', () => {
    // Relógio deslocado de propósito: se o fallback estivesse fixo em algum
    // valor, este teste passaria por acidente com AGORA (agosto).
    vi.setSystemTime(new Date(2026, 2, 15));   // 15/03/2026 — março (3)

    montar({ periodo: 'mes', ano: 2026 });     // sem `mes`

    expect(selectMes()!.value).toBe('3');
    expect((screen.getByRole('option', { name: 'Mar' }) as HTMLOptionElement).selected).toBe(true);
  });

  it('5b. o fallback acompanha o relógio, não é um valor fixo', () => {
    vi.setSystemTime(new Date(2026, 10, 2));   // 02/11/2026 — novembro (11)

    montar({ periodo: 'mes', ano: 2026 });

    expect(selectMes()!.value).toBe('11');
  });

  it('5c. mesmo sem `mes`, escolher um mês envia o período completo', () => {
    const onPeriodChange = montar({ periodo: 'mes', ano: 2026 });

    fireEvent.change(selectMes()!, { target: { value: '4' } });

    expect(onPeriodChange).toHaveBeenCalledWith({ periodo: 'mes', ano: 2026, mes: 4 });
  });
});

describe('ExecutiveHeader — os outros controles não descartam o mês', () => {
  it('6. trocar o ANO preserva `mes` e `periodo`', () => {
    const onPeriodChange = montar({ periodo: 'mes', ano: 2026, mes: 4 });

    fireEvent.change(selectAno(), { target: { value: '2025' } });

    expect(onPeriodChange).toHaveBeenCalledTimes(1);
    expect(onPeriodChange).toHaveBeenCalledWith({ periodo: 'mes', ano: 2025, mes: 4 });
  });

  it('7. clicar em TRIMESTRE preserva `mes` — voltar para Mês recupera a escolha', () => {
    const onPeriodChange = montar({ periodo: 'mes', ano: 2026, mes: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Trimestre' }));

    expect(onPeriodChange).toHaveBeenCalledTimes(1);
    expect(onPeriodChange).toHaveBeenCalledWith({ periodo: 'trimestre', ano: 2026, mes: 4 });
  });

  it('7b. clicar em ANO também preserva `mes`', () => {
    const onPeriodChange = montar({ periodo: 'mes', ano: 2026, mes: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Ano' }));

    expect(onPeriodChange).toHaveBeenCalledWith({ periodo: 'ano', ano: 2026, mes: 4 });
  });

  it('7c. voltar de Trimestre para MÊS preserva `mes`', () => {
    const onPeriodChange = montar({ periodo: 'trimestre', ano: 2026, mes: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));

    expect(onPeriodChange).toHaveBeenCalledWith({ periodo: 'mes', ano: 2026, mes: 4 });
  });

  it('7d. o mês sobrevive a Mês → Trimestre → Ano → Mês', () => {
    // Cada clique é uma renderização nova com o período que o pai devolveria.
    let atual: ExecutivePeriod = { periodo: 'mes', ano: 2026, mes: 4 };

    for (const destino of ['Trimestre', 'Ano', 'Mês'] as const) {
      cleanup();
      const onPeriodChange = montar(atual);
      fireEvent.click(screen.getByRole('button', { name: destino }));
      atual = onPeriodChange.mock.calls[0][0] as ExecutivePeriod;
      expect(atual.mes).toBe(4);
    }

    expect(atual).toEqual({ periodo: 'mes', ano: 2026, mes: 4 });
    // E de volta em Mês o seletor reaparece, já em Abril.
    cleanup();
    montar(atual);
    expect(selectMes()!.value).toBe('4');
  });
});
