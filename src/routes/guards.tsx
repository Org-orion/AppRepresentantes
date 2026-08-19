// ─────────────────────────────────────────────────────────────────────────────
// Guardas de rota — quem entra em quê, por perfil.
//
// Estavam embutidas no App.tsx, onde não dava para testá-las sem carregar todas
// as páginas do sistema. Isoladas aqui, viram unidade verificável: existe
// `guards.test.tsx` com a matriz perfil × rota, casos positivos e negativos.
//
// ⚠️ Isto é UX de navegação, NÃO é autorização. Quem garante acesso é a RLS no
// banco: a guarda só evita que a pessoa chegue numa tela que não vai conseguir
// usar. Esconder rota nunca substituiu policy — ver Cérebro — Configurações e
// Permissões.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { perfilDoUsuario, isGlobal } from '@/constants/perfis';

/** GESTÃO (Representantes/Usuários/Grupos) — somente administrador.
 *  Diretor Geral vê todos os dados do sistema, mas não acessa a gestão. */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (perfilDoUsuario(user?.usuario) !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Aprovações — operador, admin e diretor geral.
 *  Diretor é somente-leitura: não aprova nem rejeita (ação de gestão). */
export function OperadorRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const p = perfilDoUsuario(user?.usuario);
  const ok = isGlobal(p) || p === 'operador';
  if (!ok) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Telas operacionais — bloqueia apenas o operador puro, que vai para Aprovações. */
export function RepRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (perfilDoUsuario(user?.usuario) === 'operador') return <Navigate to="/aprovacoes" replace />;
  return <>{children}</>;
}

/** Criar/editar orçamento — diretor é somente-leitura; operador não cria. */
export function OrcEditorRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const p = perfilDoUsuario(user?.usuario);
  if (p === 'operador' || p === 'diretor') return <Navigate to="/orcamentos" replace />;
  return <>{children}</>;
}
