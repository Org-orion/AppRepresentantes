import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Sessão SEMPRE em sessionStorage (padrão Nexus Labs) ───────────────────────
// A sessão do Supabase Auth (GoTrue) vive apenas em sessionStorage: fechar a aba
// ou abrir uma aba nova exige NOVO login. Nada de sessão persiste em localStorage
// e não há opção de "permanecer conectado".
//
// Limpeza defensiva: remove tokens de sessão que porventura tenham ficado em
// localStorage (de versões anteriores que ofereciam "permanecer conectado").
try {
  Object.keys(localStorage)
    .filter(k => k.startsWith('sb-') || k === 'concrem_remember')
    .forEach(k => localStorage.removeItem(k));
} catch { /* storage indisponível */ }

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: sessionStorage,
  },
});
