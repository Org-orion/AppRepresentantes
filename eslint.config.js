// ─────────────────────────────────────────────────────────────────────────────
// ESLint — flat config (ESLint 10).
//
// Escopo: apenas o código da aplicação (`src/`). Ficam de fora:
//   • dist/ e dist-ssr/    → build
//   • src-tauri/           → shell Rust
//   • scripts/             → utilitários Node (.mjs), fora do bundle
//   • supabase/functions/  → runtime Deno, com globals e imports próprios
//
// Sobre react-hooks v7: o preset `recommended` desta versão já embute as regras
// do React Compiler (purity, immutability, static-components…). Adotá-las de uma
// vez num código existente seria uma refatoração grande disfarçada de lint, então
// aqui ficam apenas as duas regras clássicas. Ligar o preset completo é uma
// decisão própria, para outro momento.
// ─────────────────────────────────────────────────────────────────────────────
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-ssr', 'node_modules', 'src-tauri', 'scripts', 'supabase/functions'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    linterOptions: {
      // Diretiva `eslint-disable` que não suprime nada vira erro: comentário de
      // supressão obsoleto engana quem lê o código.
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // EXCEÇÃO DOCUMENTADA — desligada de propósito.
      // A regra é sobre *hot reload* (arquivo que exporta um componente junto de
      // uma constante ou hook perde o fast refresh e faz reload inteiro). É custo
      // de DX, não defeito: não afeta o build, o comportamento nem a segurança.
      // Este código co-loca deliberadamente o hook com o contexto (AuthContext +
      // useAuth, SidebarContext + useSidebar) e os tokens com o componente que os
      // usa — padrão idiomático em React. Fatiar 10 arquivos para satisfazer a
      // regra seria churn sem valor para o usuário. Reavaliar só se o fast refresh
      // virar incômodo real no dia a dia.
      'react-refresh/only-export-components': 'off',
    },
  },
);
