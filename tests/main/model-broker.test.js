import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const { createSessionAuthority } = require('../../src/main/session-authority');
const { createOperationLedger } = require('../../src/main/operation-ledger');
const { createBoundedModelBroker } = require('../../src/main/model-broker');
async function cleanup(root, parent) {
  if (
    path.dirname(root) !== parent ||
    !path.basename(root).startsWith('aegis-model-red-') ||
    (await fs.lstat(root)).isSymbolicLink()
  )
    throw Error('model-cleanup-unsafe');
  await fs.rm(root, { recursive: true, force: true });
}
it('discards model content if actual durable terminal persistence fails after the response', async () => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'aegis-model-red-'));
  const store = path.join(root, 'ledger');
  await fs.mkdir(store);
  const authority = createSessionAuthority(
    { sessionId: 'a'.repeat(32), epoch: 'b'.repeat(32), policyRevision: 'c'.repeat(64) },
    { operations: ['model.request'] },
  );
  let broker,
    deliveries = 0,
    sawSpent = false;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) chunk.fill(0);
    deliveries++;
    sawSpent = (await fs.readdir(store)).some((name) => name.endsWith('.spent'));
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        model: 'dummy-text-model',
        output: 'dummy-output-canary',
        finishReason: 'stop',
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const endpointPath = path.join(root, 'endpoint.json');
    await fs.writeFile(
      endpointPath,
      JSON.stringify({
        schemaVersion: 1,
        url: `http://127.0.0.1:${server.address().port}/model`,
        bearerToken: 'DUMMY_MODEL_TOKEN_'.repeat(3),
      }),
    );
    const ledger = await createOperationLedger(store);
    broker = await createBoundedModelBroker({
      authority,
      ledger: {
        ...ledger,
        settle: async () => {
          throw Error('injected settlement');
        },
      },
      endpointPath,
      model: 'dummy-text-model',
    });
    const prepared = broker.prepare(
      'd'.repeat(32),
      Buffer.from(
        JSON.stringify({
          messages: [{ role: 'user', content: 'dummy-input' }],
          maxOutputTokens: 32,
        }),
      ),
    );
    const capability = authority.issue(
      { ...prepared.binding, expiresAt: Date.now() + 30000 },
      { decision: 'allow' },
    );
    const result = await broker.request(capability, prepared);
    expect(deliveries).toBe(1);
    expect(sawSpent).toBe(true);
    expect(result.state).toBe('outcome-unknown');
    expect(result).not.toHaveProperty('text');
  } finally {
    broker?.close();
    authority.revoke();
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await cleanup(root, parent);
  }
});
