import { expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validManifest } = require('../../src/main/mcp-gateway-schema');
const shape = { type: 'object', properties: {}, required: [], additionalProperties: false };
const manifest = (credentialTag = 'a'.repeat(64)) => ({
  schemaVersion: 4,
  route: { transport: 'http', url: 'http://127.0.0.1:4567/mcp' },
  credentialTag,
  tools: [{ name: 'record', inputSchema: shape, outputSchema: shape }],
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

it('requires an opaque credential tag for a durable v4 route grant', () => {
  expect(validManifest(manifest())).toBe(true);
  expect(validManifest(manifest('a'.repeat(63)))).toBe(false);
  expect(validManifest(manifest('A'.repeat(64)))).toBe(false);
  expect(validManifest({ ...manifest(), bearerToken: 'private' })).toBe(false);
});
