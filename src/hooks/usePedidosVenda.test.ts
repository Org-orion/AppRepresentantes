import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Achado A19 — a chave de cache destas duas listas não tinha escopo.
//
// O conteúdo delas sai da view `concrem_pedidos_venda`, que aplica RLS: depende
// de QUEM está logado. Com `['representantes-unicos']` fixa, trocar de usuário
// na mesma aba (a sessão vive em sessionStorage — logout + login não recarrega
// a página) reaproveitava a lista do usuário anterior enquanto o cache estivesse
// quente. Não era falha de acesso a dado, mas o filtro de Pedidos — que não tem
// guarda de perfil — exibiria nomes que aquele usuário não deveria ver.
//
// Estes testes fixam a chave. Nada de React: `useQuery`, `useAuth` e
// `useDataScope` são substituídos por funções simples, então os hooks são
// chamadas comuns e a bateria roda em `node`.
// ─────────────────────────────────────────────────────────────────────────────

const contexto = vi.hoisted(() => ({
  scopeKey: 'global',
  user: { id: 'u1' } as { id: string } | null,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((opts: unknown) => opts),   // devolve as opções para inspeção
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: contexto.user }),
}));

vi.mock('@/hooks/useDataScope', () => ({
  useDataScope: () => ({
    admin: false, repCodes: [], grupos: null, scopeKey: contexto.scopeKey,
  }),
}));

// O service é mockado porque aqui só interessa a CHAVE, não a busca.
vi.mock('@/services/pedidosVenda', () => ({
  fetchPedidosVenda: vi.fn(),
  fetchPedidosCompleto: vi.fn(),
  fetchRepresentantesUnicos: vi.fn(),
  fetchSituacoesEntrega: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';
import { useRepresentantesUnicos, useSituacoesEntrega } from './usePedidosVenda';

const useQueryMock = useQuery as unknown as Mock;

/** Opções passadas ao `useQuery` na última chamada do hook. */
function opcoesDe(hook: () => unknown) {
  useQueryMock.mockClear();
  hook();
  return useQueryMock.mock.calls[0][0] as { queryKey: unknown[]; staleTime: number; enabled: boolean };
}

beforeEach(() => {
  contexto.scopeKey = 'global';
  contexto.user = { id: 'u1' };
});

describe('useRepresentantesUnicos — chave com escopo', () => {
  it('a queryKey inclui o scopeKey', () => {
    contexto.scopeKey = 'r:10008082';
    expect(opcoesDe(useRepresentantesUnicos).queryKey).toEqual(['representantes-unicos', 'r:10008082']);
  });

  it('preserva staleTime e enabled', () => {
    const o = opcoesDe(useRepresentantesUnicos);
    expect(o.staleTime).toBe(1000 * 60 * 30);
    expect(o.enabled).toBe(true);
  });

  it('sem usuário, a busca não é habilitada', () => {
    contexto.user = null;
    expect(opcoesDe(useRepresentantesUnicos).enabled).toBe(false);
  });
});

describe('useSituacoesEntrega — chave com escopo', () => {
  it('a queryKey inclui o scopeKey', () => {
    contexto.scopeKey = 'd:DAG COMERCIO';
    expect(opcoesDe(useSituacoesEntrega).queryKey).toEqual(['situacoes-entrega', 'd:DAG COMERCIO']);
  });

  it('preserva staleTime', () => {
    expect(opcoesDe(useSituacoesEntrega).staleTime).toBe(1000 * 60 * 60);
  });
});

describe('escopos diferentes produzem chaves diferentes', () => {
  // É este teste que impede a regressão: se a chave voltar a ser fixa, as duas
  // comparações abaixo passam a devolver a MESMA chave e ele falha.
  const ESCOPOS = ['global', 'r:10008082', 'r:10006795', 'd:DAG COMERCIO', 'd:'];

  it('representantes: uma chave distinta por escopo', () => {
    const chaves = ESCOPOS.map(s => {
      contexto.scopeKey = s;
      return JSON.stringify(opcoesDe(useRepresentantesUnicos).queryKey);
    });
    expect(new Set(chaves).size).toBe(ESCOPOS.length);
  });

  it('situações: uma chave distinta por escopo', () => {
    const chaves = ESCOPOS.map(s => {
      contexto.scopeKey = s;
      return JSON.stringify(opcoesDe(useSituacoesEntrega).queryKey);
    });
    expect(new Set(chaves).size).toBe(ESCOPOS.length);
  });

  it('o cenário do achado: admin e representante não compartilham entrada', () => {
    contexto.scopeKey = 'global';
    const doAdmin = opcoesDe(useRepresentantesUnicos).queryKey;

    contexto.scopeKey = 'r:10008082';
    const doRepresentante = opcoesDe(useRepresentantesUnicos).queryKey;

    expect(doAdmin).not.toEqual(doRepresentante);
  });

  it('o mesmo escopo continua reaproveitando o cache — a correção não desliga o cache', () => {
    contexto.scopeKey = 'global';
    const a = opcoesDe(useRepresentantesUnicos).queryKey;
    const b = opcoesDe(useRepresentantesUnicos).queryKey;
    expect(a).toEqual(b);
  });
});
