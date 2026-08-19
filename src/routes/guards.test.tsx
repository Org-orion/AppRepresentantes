// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Perfil } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Criticidade C3 — matriz perfil × rota, com os casos POSITIVOS e os NEGATIVOS.
// O caso negativo é o que importa: provar que quem não pode, não entra — e que
// vai parar no lugar certo, não numa tela em branco.
//
// Lembrete que vale repetir: isto verifica NAVEGAÇÃO. A autorização de verdade é
// a RLS no banco e precisa de teste próprio (fase 2 desta etapa).
// ─────────────────────────────────────────────────────────────────────────────

const perfilAtual = vi.hoisted(() => ({ valor: null as Perfil | null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: perfilAtual.valor === null
      ? null
      : { id: 'u', email: 'e', usuario: { id: 'u', nome: 'n', email: 'e', admin: false, operador: false, perfil: perfilAtual.valor, ativo: true, created_at: '' } },
  }),
}));

const { AdminRoute, OperadorRoute, RepRoute, OrcEditorRoute } = await import('./guards');

type Guard = typeof AdminRoute;

/** Renderiza a guarda como perfil X e devolve o que aconteceu: entrou ou foi para onde. */
function acessar(Guard: Guard, perfil: Perfil | null): 'entrou' | string {
  // A suíte roda com `globals: false`, então o Testing Library não consegue
  // registrar o cleanup automático — sem isto o DOM da renderização anterior
  // sobra e o teste seguinte acha o conteúdo de quem já tinha entrado.
  cleanup();
  perfilAtual.valor = perfil;
  render(
    <MemoryRouter initialEntries={['/alvo']}>
      <Routes>
        <Route path="/alvo" element={<Guard><div>CONTEUDO</div></Guard>} />
        <Route path="/dashboard" element={<div>REDIR:/dashboard</div>} />
        <Route path="/aprovacoes" element={<div>REDIR:/aprovacoes</div>} />
        <Route path="/orcamentos" element={<div>REDIR:/orcamentos</div>} />
      </Routes>
    </MemoryRouter>,
  );
  if (screen.queryByText('CONTEUDO')) return 'entrou';
  const redir = screen.getByText(/^REDIR:/).textContent!;
  return redir.replace('REDIR:', '');
}

const TODOS: Perfil[] = ['representante', 'operador', 'admin', 'diretor', 'diretor_geral'];

describe('AdminRoute — gestão de usuários, representantes e grupos', () => {
  it('só o admin entra', () => {
    expect(acessar(AdminRoute, 'admin')).toBe('entrou');
  });

  it('todos os outros são mandados para o dashboard — inclusive o diretor geral', () => {
    // Diretor geral vê todos os DADOS, mas gestão é outra coisa.
    for (const p of TODOS.filter(p => p !== 'admin')) {
      expect(acessar(AdminRoute, p)).toBe('/dashboard');
    }
  });

  it('sem usuário, não entra', () => {
    expect(acessar(AdminRoute, null)).toBe('/dashboard');
  });
});

describe('OperadorRoute — aprovações', () => {
  it('entram operador, admin e diretor geral', () => {
    for (const p of ['operador', 'admin', 'diretor_geral'] as Perfil[]) {
      expect(acessar(OperadorRoute, p)).toBe('entrou');
    }
  });

  it('representante e diretor não aprovam', () => {
    // Diretor é somente-leitura: aprovar é ação de gestão.
    expect(acessar(OperadorRoute, 'representante')).toBe('/dashboard');
    expect(acessar(OperadorRoute, 'diretor')).toBe('/dashboard');
  });
});

describe('RepRoute — telas operacionais', () => {
  it('bloqueia só o operador puro, e o manda para Aprovações', () => {
    expect(acessar(RepRoute, 'operador')).toBe('/aprovacoes');
  });

  it('todos os outros entram', () => {
    for (const p of TODOS.filter(p => p !== 'operador')) {
      expect(acessar(RepRoute, p)).toBe('entrou');
    }
  });
});

describe('OrcEditorRoute — criar/editar orçamento', () => {
  it('entram representante, admin e diretor geral', () => {
    for (const p of ['representante', 'admin', 'diretor_geral'] as Perfil[]) {
      expect(acessar(OrcEditorRoute, p)).toBe('entrou');
    }
  });

  it('operador e diretor não criam nem editam — voltam para a lista', () => {
    expect(acessar(OrcEditorRoute, 'operador')).toBe('/orcamentos');
    expect(acessar(OrcEditorRoute, 'diretor')).toBe('/orcamentos');
  });
});

describe('regra que vale para todas as guardas', () => {
  it('nenhuma guarda deixa o operador puro nas telas de representante', () => {
    expect(acessar(RepRoute, 'operador')).not.toBe('entrou');
    expect(acessar(OrcEditorRoute, 'operador')).not.toBe('entrou');
  });

  it('nenhuma guarda entrega gestão a quem não é admin', () => {
    for (const p of TODOS.filter(p => p !== 'admin')) {
      expect(acessar(AdminRoute, p)).not.toBe('entrou');
    }
  });
});
