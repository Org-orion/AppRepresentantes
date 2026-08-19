import { describe, it, expect } from 'vitest';
import { perfilDoUsuario, isGlobal, isDiretor, isRepresentante, PERFIL_LABEL } from './perfis';
import type { Usuario, Perfil } from '@/types';

// Criticidade C3 — é daqui que saem as guardas de rota e o escopo de dados.
// A coluna `perfil` é a fonte de verdade; os flags admin/operador são fallback
// de compatibilidade da migração. Se o fallback tomar a frente, alguém ganha ou
// perde acesso silenciosamente.

const u = (p: Partial<Usuario>): Usuario => ({
  id: 'u', nome: 'n', email: 'e', admin: false, operador: false,
  ativo: true, created_at: '', ...p,
});

describe('perfilDoUsuario', () => {
  it('usa a coluna perfil quando ela existe', () => {
    expect(perfilDoUsuario(u({ perfil: 'diretor' }))).toBe('diretor');
    expect(perfilDoUsuario(u({ perfil: 'diretor_geral' }))).toBe('diretor_geral');
  });

  it('a coluna perfil VENCE os flags antigos quando divergem', () => {
    // Usuário migrado que virou diretor mas manteve o flag admin ligado no banco:
    // quem manda é a coluna, senão ele ganharia a gestão de volta.
    expect(perfilDoUsuario(u({ perfil: 'diretor', admin: true }))).toBe('diretor');
  });

  it('sem a coluna, deriva dos flags — admin antes de operador', () => {
    expect(perfilDoUsuario(u({ admin: true }))).toBe('admin');
    expect(perfilDoUsuario(u({ operador: true }))).toBe('operador');
    expect(perfilDoUsuario(u({ admin: true, operador: true }))).toBe('admin');
  });

  it('no vazio, cai no perfil menos privilegiado', () => {
    expect(perfilDoUsuario(u({}))).toBe('representante');
    expect(perfilDoUsuario(null)).toBe('representante');
    expect(perfilDoUsuario(undefined)).toBe('representante');
  });
});

describe('classificação de perfis', () => {
  it('visão global é só de admin e diretor geral', () => {
    expect(isGlobal('admin')).toBe(true);
    expect(isGlobal('diretor_geral')).toBe(true);
    for (const p of ['representante', 'operador', 'diretor'] as Perfil[]) {
      expect(isGlobal(p)).toBe(false);
    }
  });

  it('diretor não é global e não é representante', () => {
    expect(isDiretor('diretor')).toBe(true);
    expect(isGlobal('diretor')).toBe(false);
    expect(isRepresentante('diretor')).toBe(false);
  });

  it('todo perfil tem rótulo — nenhuma tela mostra a chave crua', () => {
    const perfis: Perfil[] = ['representante', 'operador', 'admin', 'diretor', 'diretor_geral'];
    for (const p of perfis) {
      expect(PERFIL_LABEL[p]).toBeTruthy();
      expect(PERFIL_LABEL[p]).not.toBe(p);
    }
  });
});
