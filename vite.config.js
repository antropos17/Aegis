import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig(({ mode, command }) => {
  const isDemo = mode === 'demo';
  // The demo scenario engine ships in the demo build and in the dev server (the browser
  // preview `npm run dev` gives, which has no preload bridge and would otherwise render
  // an empty, unavailable dashboard). `npm start` builds the renderer and launches
  // Electron, so it is unaffected. Everything else — every artifact that reaches a user —
  // is built with this false, which is what drops the engine and its pools.
  const withDemoEngine = isDemo || command === 'serve';
  return {
    plugins: [svelte()],
    base: './',
    resolve: {
      extensions: ['.ts', '.js', '.svelte'],
    },
    root: 'src/renderer',
    define: {
      // Replaced at build time with a string literal, so `=== 'true'` folds to a constant
      // and Rollup can delete the demo branch in stores/ipc.ts and ThreatAnalysis.svelte
      // — along with demo-data.js, demo-analysis.js and demo-pools.js, which are reached
      // only from inside it.
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(withDemoEngine ? 'true' : 'false'),
    },
    server: {
      port: 5174,
      strictPort: true,
    },
    build: {
      outDir: isDemo ? '../../dist/demo' : '../../dist/renderer',
      emptyOutDir: true,
      // Convert project CJS helpers under src/shared (e.g. instance-key.js) so
      // named ESM imports from the renderer resolve at Rollup time.
      commonjsOptions: {
        include: [/node_modules/, /src[\\/]shared[\\/]/],
      },
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  };
});
