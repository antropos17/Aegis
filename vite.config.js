import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  return {
    plugins: [svelte()],
    base: './',
    root: 'src/renderer',
    define: {
      // Replaced at build time — no runtime cost, tree-shakeable
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(isDemo ? 'true' : 'false'),
    },
    server: {
      port: 5174,
      strictPort: true,
    },
    build: {
      outDir: isDemo ? '../../dist/demo' : '../../dist/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  };
});
