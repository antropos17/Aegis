import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig(({ mode, command }) => {
  const preview = mode === 'preview';
  return {
    root: resolve(__dirname, 'frontend/observatory'),
    base: './',
    plugins: [
      svelte(),
      {
        // These allowlisted CJS helpers are shared with Electron main.
        // Rollup converts them in builds; native dev ESM needs the same export surface.
        name: 'observatory-shared-dev-exports',
        apply: 'serve',
        transform(code, id) {
          const normalized = id.replaceAll('\\', '/');
          if (!/\/src\/shared\/(instance-key|skill-path|observation-display)\.js$/.test(normalized))
            return null;
          return {
            code: code
              .replace(
                "const { skillFromPath } = require('./skill-path');",
                "import { skillFromPath } from './skill-path.js';",
              )
              .replace(/module\.exports\s*=\s*\{([\s\w,]+)\};?/, 'export {$1};'),
            map: null,
          };
        },
      },
      {
        name: 'observatory-preview-csp',
        transformIndexHtml(html) {
          return command === 'serve'
            ? html.replace(
                "connect-src 'none'",
                "connect-src 'self' ws://127.0.0.1:8770 ws://localhost:8770",
              )
            : html;
        },
      },
    ],
    define: { __FRONTEND_PREVIEW__: JSON.stringify(preview) },
    optimizeDeps: {
      include: [
        resolve(__dirname, 'src/shared/instance-key.js'),
        resolve(__dirname, 'src/shared/skill-path.js'),
        resolve(__dirname, 'src/shared/observation-display.js'),
      ],
    },
    server: { host: '127.0.0.1', port: 8770, strictPort: true },
    build: {
      commonjsOptions: { include: [/node_modules/, /src[\\/]shared[\\/]/] },
      outDir: resolve(__dirname, preview ? 'dist/frontend-preview' : 'dist/renderer'),
      emptyOutDir: true,
    },
  };
});
