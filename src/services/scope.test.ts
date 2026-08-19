import { describe, it, expect } from 'vitest';
import { getUserDataScope, normalizaGrupo } from './scope';
import type { User, Perfil } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Criticidade C3 — este é o ponto que decide QUEM VÊ O QUÊ na camada de serviço.
// Um erro aqui não quebra a tela: ele mostra dados de outra pessoa. A RLS no
// banco é a garantia final, mas isto é a defesa em profundidade — e precisa
// estar certa por si só.
// ─────────────────────────────────────────────────────────────────────────────

function usuario(perfil: Perfil | null, extras: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'teste@exemplo.com',
    usuario: {
      id: 'u1', nome: 'Teste', email: 'teste@exemplo.com',
      admin: false, operador: false, perfil, ativo: true, created_at: '',
    },
    ...extras,
  };
}

const repCode = (codigo: string) => ({
  id: codigo, codigo, nome_erp: codigo, representante_erp: codigo,
  comissao_percentual: 0, ativo: true, created_at: '',
});

describe('getUserDataScope', () => {
  it('dá visão global ao admin', () => {
    expect(getUserDataScope(usuario('admin'))).toEqual({ type: 'global' });
  });

  it('dá visão global ao diretor geral', () => {
    expect(getUserDataScope(usuario('diretor_geral'))).toEqual({ type: 'global' });
  });

  it('limita o diretor aos grupos vinculados', () => {
    const scope = getUserDataScope(usuario('diretor', { grupos: ['GRUPO A', 'GRUPO B'] }));
    expect(scope).toEqual({ type: 'director', groups: ['GRUPO A', 'GRUPO B'] });
  });

  it('limita o representante aos próprios rep codes', () => {
    const scope = getUserDataScope(usuario('representante', { repCodes: [repCode('40055415')] }));
    expect(scope).toEqual({ type: 'representative', repCodes: ['40055415'] });
  });

  it('trata operador como escopo por rep code, não global', () => {
    expect(getUserDataScope(usuario('operador')).type).toBe('representative');
  });

  // ── Casos negativos: o que NÃO pode acontecer ──

  it('nunca dá escopo global a representante, operador ou diretor', () => {
    for (const perfil of ['representante', 'operador', 'diretor'] as Perfil[]) {
      expect(getUserDataScope(usuario(perfil)).type).not.toBe('global');
    }
  });

  it('sem usuário, cai no escopo mais restrito e sem rep codes', () => {
    expect(getUserDataScope(null)).toEqual({ type: 'representative', repCodes: [] });
    expect(getUserDataScope(undefined)).toEqual({ type: 'representative', repCodes: [] });
  });

  it('diretor sem grupos vinculados não vira global — fica com lista vazia', () => {
    const scope = getUserDataScope(usuario('diretor'));
    expect(scope).toEqual({ type: 'director', groups: [] });
  });

  it('ignora grupos e rep codes de quem não é do perfil correspondente', () => {
    // Um representante com `grupos` preenchido não pode passar a filtrar por grupo.
    const scope = getUserDataScope(
      usuario('representante', { grupos: ['GRUPO A'], repCodes: [repCode('X')] }),
    );
    expect(scope).toEqual({ type: 'representative', repCodes: ['X'] });
  });

  it('sem a coluna perfil, cai nos flags admin/operador (compatibilidade)', () => {
    const semPerfil = usuario(null);
    expect(getUserDataScope(semPerfil).type).toBe('representative');

    semPerfil.usuario!.admin = true;
    expect(getUserDataScope(semPerfil)).toEqual({ type: 'global' });
  });
});

describe('normalizaGrupo', () => {
  it('espelha o app_norm_grupo do SQL: vazio vira SEM GRUPO', () => {
    expect(normalizaGrupo(null)).toBe('SEM GRUPO');
    expect(normalizaGrupo(undefined)).toBe('SEM GRUPO');
    expect(normalizaGrupo('')).toBe('SEM GRUPO');
    expect(normalizaGrupo('   ')).toBe('SEM GRUPO');
  });

  it('preserva o nome do grupo, sem espaços nas pontas', () => {
    expect(normalizaGrupo('  GRUPO A  ')).toBe('GRUPO A');
  });
});
