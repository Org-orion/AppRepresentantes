// ─────────────────────────────────────────────────────────────────────────────
// Escopo de dados CENTRALIZADO. Toda leitura de dados sensíveis (pedidos,
// clientes, orçamentos, financeiro, alertas, representantes) deve derivar o
// escopo daqui — evita filtros duplicados/inconsistentes por tela.
//
//   global         → admin / diretor_geral: vê tudo (sem filtro).
//   director       → diretor: só os grupos vinculados (grupo_cliente).
//   representative → representante/operador: só seus rep codes (como hoje).
//
// A segurança de verdade é reforçada por RLS no banco (ver
// supabase/migrations/20260706000100_diretores_e_grupos.sql). Este escopo aplica o mesmo
// filtro na camada de service para consistência de UI e defesa em profundidade.
// ─────────────────────────────────────────────────────────────────────────────
import type { User } from '@/types';
import { perfilDoUsuario, isGlobal } from '@/constants/perfis';

export type DataScope =
  | { type: 'global' }
  | { type: 'director'; groups: string[] }
  | { type: 'representative'; repCodes: string[] };

export function getUserDataScope(user?: User | null): DataScope {
  const p = perfilDoUsuario(user?.usuario);
  if (isGlobal(p)) return { type: 'global' };
  if (p === 'diretor') return { type: 'director', groups: user?.grupos ?? [] };
  return { type: 'representative', repCodes: (user?.repCodes ?? []).map(r => r.representante_erp) };
}

/** Normaliza grupo_cliente: null/vazio → 'SEM GRUPO' (espelha app_norm_grupo no SQL). */
export function normalizaGrupo(g?: string | null): string {
  const t = (g ?? '').trim();
  return t === '' ? 'SEM GRUPO' : t;
}
