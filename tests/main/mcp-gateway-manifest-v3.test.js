import { expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validManifest } = require('../../src/main/mcp-gateway-schema');
const route = { transport: 'http', url: 'http://127.0.0.1:4567/mcp' };
const manifest = (selectedRoute = route) => ({
  schemaVersion: 3,
  route: selectedRoute,
  tools: [
    {
      name: 'record',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
  grants: [
    {
      id: 'g'.repeat(32),
      taskId: 't'.repeat(32),
      notBefore: 1,
      expiresAt: 2000,
      tool: 'record',
      arguments: {},
    },
  ],
});

it('requires a closed, explicit route on a durable v3 manifest', () => {
  expect(validManifest(manifest())).toBe(true);
  expect(validManifest(manifest({ ...route, bearerToken: 'secret' }))).toBe(false);
  expect(validManifest(manifest({ transport: 'https', url: 'https://server.test/mcp' }))).toBe(
    false,
  );
  expect(validManifest(manifest({ ...route, url: '' }))).toBe(false);
});
