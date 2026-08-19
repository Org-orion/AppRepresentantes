// TURNSTILE: configure VITE_TURNSTILE_SITE_KEY no .env e faça deploy da Edge Function verificar-turnstile
import { useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Turnstile } from 'react-turnstile';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import CinematicBackdrop from '@/components/login/CinematicBackdrop';
import LoginField, { loginItemVariants } from '@/components/login/LoginField';
import PremiumButton from '@/components/login/PremiumButton';

const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const reduce = !!useReducedMotion();

  // "Reseta" o Turnstile remontando o widget (via key) — o react-turnstile cuida
  // do próprio ciclo de vida, evitando o erro "Nothing to reset" do reset manual.
  const resetTurnstile = () => {
    setTurnstileToken(null);
    setTurnstileKey(k => k + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTurnstileError(null);

    // Verificar token Turnstile na Edge Function antes do login
    try {
      const { data, error: fnError } = await supabase.functions.invoke('verificar-turnstile', {
        body: { token: turnstileToken },
      });
      if (fnError || !data?.success) {
        setTurnstileError(data?.error ?? 'Verificação de segurança falhou. Tente novamente.');
        resetTurnstile();
        return;
      }
    } catch {
      setTurnstileError('Erro ao verificar segurança. Tente novamente.');
      resetTurnstile();
      return;
    }

    await login({ email, password });
    resetTurnstile();
  };

  const emailInvalid = !!error && /email|usuário/i.test(error);
  const passInvalid = !!error && /senha|password/i.test(error);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#06110A] text-white">
      <CinematicBackdrop reduce={reduce} />

      <div
        className="relative min-h-dvh flex flex-col items-center justify-center px-5"
        style={{
          paddingTop: 'max(2.5rem, env(safe-area-inset-top, 0px))',
          paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="w-full max-w-[400px]">
          {/* ── Marca ── */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="flex flex-col items-center text-center mb-8"
          >
            <motion.div
              variants={loginItemVariants}
              initial={reduce ? undefined : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-16 h-16 rounded-[20px] bg-white/[0.06] backdrop-blur-md ring-1 ring-white/15 flex items-center justify-center mb-5"
            >
              {/* Glow do logo */}
              {!reduce && (
                <motion.span
                  className="absolute inset-0 rounded-[20px]"
                  style={{ boxShadow: '0 0 40px 4px rgba(46,175,105,0.35)' }}
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <img
                src="/logos/Isotipo-Branco.png"
                alt="Concrem"
                className="relative w-9 h-9 object-contain"
              />
            </motion.div>

            <motion.p variants={loginItemVariants} className="text-[11px] tracking-[0.28em] text-emerald-300/70 mb-2">
              PORTAL DO REPRESENTANTE
            </motion.p>
            <motion.h1 variants={loginItemVariants} className="text-3xl font-semibold tracking-tight">
              Concrem Connect
            </motion.h1>
            <motion.p variants={loginItemVariants} className="mt-2 text-sm text-white/45">
              Acesse sua conta para continuar.
            </motion.p>
          </motion.div>

          {/* ── Painel de glass (flutuante, respira) ── */}
          <motion.div
            animate={reduce ? undefined : { y: [0, -6, 0] }}
            transition={reduce ? undefined : { duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            className="relative"
          >
            {/* Halo animado atrás do card */}
            {!reduce && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute -inset-4 rounded-[36px] bg-emerald-500/10 blur-2xl"
                animate={{ opacity: [0.45, 0.9, 0.45] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.97, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
              className="relative rounded-[28px] border border-white/[0.1] bg-white/[0.05] backdrop-blur-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 sm:p-8"
            >
            <motion.form
              onSubmit={handleSubmit}
              variants={stagger}
              initial="hidden"
              animate="show"
              className="space-y-4"
            >
              {error && (
                <motion.div
                  variants={loginItemVariants}
                  className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {error}
                </motion.div>
              )}

              <LoginField
                icon={Mail}
                label="E-mail"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoComplete="email"
                maxLength={254}
                disabled={loading}
                invalid={emailInvalid}
                required
              />

              <LoginField
                icon={Lock}
                label="Senha"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                maxLength={128}
                disabled={loading}
                invalid={passInvalid}
                required
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    tabIndex={-1}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/35 hover:text-emerald-200 transition-colors"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              {turnstileError && (
                <motion.div
                  variants={loginItemVariants}
                  className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {turnstileError}
                </motion.div>
              )}

              {/* Turnstile — proteção de login (NÃO remover). Integrado ao painel. */}
              <motion.div variants={loginItemVariants} className="flex justify-center pt-1">
                <Turnstile
                  key={turnstileKey}
                  sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                  theme="dark"
                  onSuccess={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken(null)}
                  onError={() => setTurnstileToken(null)}
                />
              </motion.div>

              <PremiumButton loading={loading} disabled={loading || !turnstileToken} reduce={reduce} />
            </motion.form>
            </motion.div>
          </motion.div>

          {/* ── Rodapé ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.6 }}
            className="touch-compact mt-7 flex flex-nowrap items-center justify-center gap-x-2 text-[10px] text-white/30 whitespace-nowrap"
          >
            <span>© 2026 Concrem</span>
            <span className="text-white/15">•</span>
            <a href="/privacidade" target="_blank" rel="noopener" className="hover:text-white/60 transition-colors">Privacidade</a>
            <span className="text-white/15">•</span>
            <a href="/privacidade#termos" target="_blank" rel="noopener" className="hover:text-white/60 transition-colors">Termos</a>
            <span className="text-white/15">•</span>
            <span>v1.0</span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
