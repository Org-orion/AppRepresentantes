import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Config de teste separada do vite.config.ts para não misturar o que serve o app
// com o que roda a suíte. Herda os aliases (@/...) via mergeConfig.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Padrão `node`: a maior parte da suíte é regra de negócio pura e não
      // precisa de DOM — subir jsdom para tudo custava ~23s por execução. Testes
      // de componente declaram `// @vitest-environment jsdom` no topo do arquivo.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      restoreMocks: true,
      // Sem `globals: true` de propósito: cada teste importa describe/it/expect
      // explicitamente. Fica claro de onde vêm e não depende de config de tipos.
    },
  }),
);
