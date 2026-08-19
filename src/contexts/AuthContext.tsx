import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { User, Representante, Usuario, RepresentanteERP } from '@/types';
import { perfilDoUsuario } from '@/constants/perfis';
import { fetchUserGroupNames } from '@/services/clientGroups';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string; captchaToken?: string }) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  /** Recarrega o perfil do usuário atual (ex.: após editar nome/telefone). */
  refreshUser: () => Promise<void>;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const MOCK_USER: User = {
  id: 'mock-rep-001',
  email: 'joao.silva@concrem.com.br',
  usuario: {
    id: 'mock-rep-001',
    nome: 'João Silva (Mock)',
    email: 'joao.silva@concrem.com.br',
    admin: false,
    operador: false,
    ativo: true,
    created_at: '',
  },
  representante: {
    id: 'mock-rep-001',
    nome: 'João Silva (Mock)',
    email: 'joao.silva@concrem.com.br',
    telefone: '',
    regiao: '',
    comissao_percentual: 3.5,
    meta_mensal: 0,
    ativo: true,
    created_at: '',
  },
  repCodes: [
    {
      id: 'mock-rep-code-001',
      codigo: 'REP-001',
      nome_erp: 'João Silva (Mock)',
      representante_erp: 'REP-001',
      comissao_percentual: 3.5,
      ativo: true,
      created_at: '',
    },
  ],
};

// ─── Monta o User do app a partir do usuário autenticado (Supabase Auth) ───────
// Carrega o perfil (concremapprep_usuarios) e os rep codes vinculados. A RLS
// garante que cada um só leia o que pode — aqui buscamos o próprio perfil.
async function buildUser(authUser: SupabaseAuthUser): Promise<User> {
  const { data: perfil } = await supabase
    .from('concremapprep_usuarios')
    .select('*')
    .eq('id', authUser.id)
    .single();

  const { data: vinculos } = await supabase
    .from('concremapprep_usuario_representantes')
    .select('representante_id')
    .eq('usuario_id', authUser.id);

  const repIds = (vinculos ?? []).map(v => v.representante_id);
  let repCodes: RepresentanteERP[] = [];
  if (repIds.length > 0) {
    const { data: reps } = await supabase
      .from('concremapprep_representantes')
      .select('*')
      .in('id', repIds);
    repCodes = (reps ?? []) as RepresentanteERP[];
  }

  const usuario: Usuario = (perfil as Usuario) ?? {
    id: authUser.id,
    nome: authUser.email ?? '',
    email: authUser.email ?? '',
    admin: false,
    operador: false,
    ativo: true,
    created_at: '',
  };

  // Diretor: carrega os grupos de cliente vinculados (escopo de dados).
  // Resiliente — [] se a migração de grupos ainda não estiver aplicada.
  const grupos = perfilDoUsuario(usuario) === 'diretor'
    ? await fetchUserGroupNames(authUser.id)
    : [];

  // Representante "legado" (compatibilidade com telas que ainda leem user.representante)
  const representante: Representante = {
    id: authUser.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone ?? '',
    regiao: '',
    comissao_percentual: repCodes[0]?.comissao_percentual ?? 0,
    meta_mensal: 0,
    ativo: usuario.ativo,
    created_at: usuario.created_at,
  };

  return {
    id: authUser.id,
    email: authUser.email ?? usuario.email,
    usuario,
    representante,
    repCodes,
    grupos,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(() =>
    USE_MOCK
      ? { user: MOCK_USER, loading: false, error: null }
      : { user: null, loading: true, error: null }
  );

  // Reage à sessão do Supabase Auth: login, logout e refresh de token.
  useEffect(() => {
    if (USE_MOCK) return;

    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // IMPORTANTE: não chamar supabase.from(...) / outros métodos do supabase
      // DENTRO do callback — o gotrue-js segura o lock de auth aqui e a query
      // tentaria readquirir o mesmo lock, causando deadlock (app trava no load).
      // Por isso adiamos com setTimeout(0): roda após o callback liberar o lock.
      setTimeout(async () => {
        if (!active) return;
        if (!session?.user) {
          setAuthState({ user: null, loading: false, error: null });
          return;
        }
        try {
          const user = await buildUser(session.user);
          if (active) setAuthState({ user, loading: false, error: null });
        } catch {
          if (active) setAuthState({ user: null, loading: false, error: 'Falha ao carregar perfil' });
        }
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async ({ email, password, captchaToken }: { email: string; password: string; captchaToken?: string }) => {
    if (USE_MOCK) {
      setAuthState({ user: MOCK_USER, loading: false, error: null });
      return { error: null };
    }

    setAuthState(prev => ({ ...prev, loading: true, error: null }));

    // captchaToken vai para o PRÓPRIO servidor de auth. É isso que fecha o
    // bypass: antes o Turnstile era conferido só no caminho da interface, e
    // signInWithPassword continuava chamável direto com a anon key (que vai no
    // bundle). Com o CAPTCHA habilitado no painel do Auth, o servidor exige o
    // token e a chamada direta é recusada.
    const { error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
      options: { captchaToken },
    });

    if (error) {
      const msg = /invalid login credentials/i.test(error.message)
        ? 'E-mail ou senha incorretos'
        : error.message;
      setAuthState(prev => ({ ...prev, loading: false, error: msg }));
      return { error: msg };
    }

    // O perfil é carregado pelo onAuthStateChange (evento SIGNED_IN).
    return { error: null };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthState({ user: null, loading: false, error: null });
  }, []);

  const refreshUser = useCallback(async () => {
    if (USE_MOCK) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    try {
      const user = await buildUser(data.user);
      setAuthState(prev => ({ ...prev, user }));
    } catch {
      /* mantém o usuário atual se o refresh falhar */
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      ...authState,
      isAuthenticated: !!authState.user,
      login,
      logout,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
