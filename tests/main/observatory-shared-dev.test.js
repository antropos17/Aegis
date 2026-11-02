import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

it('loads the shared object-read identity through the actual browser development transform', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const parent = await realpath(tmpdir());
  const cache = await mkdtemp(path.join(parent, 'aegis-object-read-dev-'));
  if (path.dirname(cache) !== parent || !path.basename(cache).startsWith('aegis-object-read-dev-'))
    throw Error('fixture-cache-path-refused');
  let server;
  try {
    server = await createServer({
      configFile: path.join(root, 'vite.frontend.config.ts'),
      cacheDir: cache,
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const source = path.join(root, 'src/shared/bound-read-object.js').replaceAll('\\', '/');
    const transformed = await server.transformRequest('/@fs/' + source);
    expect(transformed).not.toBeNull();
    const url = 'data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64');
    const { boundReadObjectKey, projectBoundReadObject } = await import(/* @vite-ignore */ url);
    expect(JSON.parse(boundReadObjectKey({
      scopeGeneration: 'scope-1', policyGeneration: 'policy-2', objectKey: 'object-3',
    }))).toEqual(['scope-1', 'policy-2', 'object-3']);
    expect(projectBoundReadObject({ objectKey: 'unqualified' })).toBeNull();
  } finally {
    await server?.close();
    await rm(cache, { recursive: true, force: true });
  }
}, 15000);
