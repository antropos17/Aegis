import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const require = createRequire(import.meta.url);
const {
  startActionObservation,
  runObservedMcp,
} = require('../../src/main/action-observation-server');
const { observeActionRoute } = require('../../src/main/action-observation-client');
const schema = require('../../src/main/action-observation-schema');
const mcp = require('../../src/main/action-mcp');
const cleanups = [];
const metadata = {
  state: 'observed',
  client: { name: 'claude-code', version: '2.1.263' },
  selection: 'single-action',
  selectedActionCount: 1,
  actionAttempts: 0,
  selectionRejected: 0,
  ownerInvocations: 0,
  ownerSettled: 0,
  ownerFailures: 0,
  cancellationRequests: 0,
};
const frame = (extra = {}) => ({
  schemaVersion: 1,
  connectionId: '12345678-1234-1234-1234-123456789012',
  sequence: 1,
  route: 'mcp-stdio',
  ...metadata,
  ...extra,
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'aegis-observation-'));
  cleanups.push(async () => {
    expect(path.dirname(dir)).toBe(path.resolve(tmpdir()));
    expect((await lstat(dir)).isSymbolicLink()).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
  return path.join(dir, 'endpoint.json');
}
afterEach(async () => {
  mcp._resetForTest();
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('observes a real MCP lifecycle without spending action or message budgets; disconnection is sticky', async () => {
  const execute = vi.fn();
  mcp._setDepsForTest({ capture: async () => ({}), revoke: vi.fn(), execute });
  const owner = mcp.createActionMcp({
    policyPath: 'PRIVATE_POLICY',
    requestPath: 'PRIVATE_REQUEST',
  });
  cleanups.push(() => owner.close());
  const file = await fixture();
  const server = await startActionObservation(file, 'mcp-stdio', 'single-action');
  cleanups.push(() => server.close());
  server.observe(owner.observation);
  const observer = observeActionRoute(file);
  cleanups.push(() => observer.close());
  await vi.waitFor(() => expect(observer.snapshot().state).toBe('awaiting-client'));
  await owner.receive({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '2.1.263', PRIVATE_EXTRA: 'secret' },
    },
  });
  expect(owner.observation().state).toBe('awaiting-client');
  await owner.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await vi.waitFor(() => expect(observer.snapshot().state).toBe('observed'), { timeout: 2500 });
  expect(observer.snapshot().snapshot.client).toEqual(metadata.client);
  expect(observer.snapshot().snapshot.actionAttempts).toBe(0);
  expect(execute).not.toHaveBeenCalled();
  expect(JSON.stringify(observer.snapshot())).not.toMatch(/PRIVATE|token|policyPath/);
  owner.close();
  await vi.waitFor(() => expect(observer.snapshot().state).toBe('coverage-lost'), {
    timeout: 2500,
  });
  const final = observer.snapshot();
  expect(final.reason).toBe('owner-closed');
  await server.close();
  expect(observer.snapshot()).toEqual(final);
});

it('removes its descriptor on normal cleanup and leaves existing files unchanged', async () => {
  const file = await fixture();
  await writeFile(file, 'PRIVATE_EXISTING');
  await expect(startActionObservation(file, 'mcp-stdio', 'single-action')).rejects.toThrow(
    'observation-unavailable',
  );
  expect(await readFile(file, 'utf8')).toBe('PRIVATE_EXISTING');
  const next = file + '.new';
  const server = await startActionObservation(next, 'mcp-stdio', 'single-action');
  await server.close();
  await expect(readFile(next)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects a deletion selection on the stdio route before publishing a descriptor', async () => {
  const file = await fixture();
  await expect(startActionObservation(file, 'mcp-stdio', 'selected-file-delete')).rejects.toThrow(
    'observation-unavailable',
  );
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps executor lifetime independent from observer stop', async () => {
  const file = await fixture();
  const server = await startActionObservation(file, 'mcp-review', 'catalog');
  cleanups.push(() => server.close());
  server.observe(() => ({ ...metadata, selection: 'catalog' }));
  const observer = observeActionRoute(file);
  cleanups.push(() => observer.close());
  await vi.waitFor(() => expect(observer.snapshot().state).toBe('observed'));
  observer.close();
  expect(observer.snapshot().state).toBe('stopped');
  expect(JSON.parse(await readFile(file, 'utf8')).purpose).toBe('aegis-action-observation');
});

it('rejects a review relay descriptor before connecting', async () => {
  const file = await fixture();
  await writeFile(file, JSON.stringify({ schemaVersion: 1, port: 1, token: 'a'.repeat(64) }));
  const observer = observeActionRoute(file);
  cleanups.push(() => observer.close());
  await vi.waitFor(() => expect(observer.snapshot().reason).toBe('invalid-endpoint'));
});

async function publisher(file, send) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('data', () => send(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      purpose: 'aegis-action-observation',
      port: server.address().port,
      token: 'a'.repeat(64),
    }),
  );
}
it.each(['replay', 'wrong-generation', 'private-field', 'regression', 'oversize'])(
  'rejects %s updates and retains the last good evidence',
  async (kind) => {
    const file = await fixture();
    let peer;
    await publisher(file, (socket) => {
      peer = socket;
      socket.write(JSON.stringify(frame({ actionAttempts: 1 })) + '\n');
    });
    const observer = observeActionRoute(file);
    cleanups.push(() => observer.close());
    await vi.waitFor(() => expect(observer.snapshot().state).toBe('observed'));
    const next = frame({ sequence: 2, actionAttempts: 1 });
    if (kind === 'replay') next.sequence = 1;
    if (kind === 'wrong-generation') next.connectionId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    if (kind === 'private-field') next.PRIVATE = 'secret';
    if (kind === 'regression') next.actionAttempts = 0;
    peer.write(kind === 'oversize' ? 'x'.repeat(4097) : JSON.stringify(next) + '\n');
    await vi.waitFor(() => expect(observer.snapshot().state).toBe('coverage-lost'));
    expect(observer.snapshot().snapshot.sequence).toBe(1);
    expect(observer.snapshot().reason).toBe('invalid-update');
  },
);
it('expires a silent connection using receiver time and retains its last receipt', async () => {
  const file = await fixture();
  await publisher(file, (peer) => peer.write(JSON.stringify(frame()) + '\n'));
  const observer = observeActionRoute(file);
  cleanups.push(() => observer.close());
  await vi.waitFor(() => expect(observer.snapshot().state).toBe('observed'));
  const received = observer.snapshot().lastObservedAt;
  await vi.waitFor(() => expect(observer.snapshot().state).toBe('coverage-lost'), {
    timeout: 4500,
  });
  expect(observer.snapshot().reason).toBe('updates-expired');
  expect(observer.snapshot().lastObservedAt).toBe(received);
});

it('never forwards observer input and rejects a wrong bearer', async () => {
  const file = await fixture();
  const server = await startActionObservation(file, 'mcp-stdio', 'single-action');
  cleanups.push(() => server.close());
  const descriptor = JSON.parse(await readFile(file, 'utf8'));
  for (const token of ['0'.repeat(64), descriptor.token]) {
    const peer = net.createConnection({ host: '127.0.0.1', port: descriptor.port });
    cleanups.push(() => peer.destroy());
    let bytes = '';
    peer.on('data', (chunk) => {
      bytes += chunk;
      peer.write('EXECUTE\n');
    });
    peer.on('error', () => {});
    peer.write(token + '\n');
    await new Promise((resolve) => peer.once('close', resolve));
    if (token !== descriptor.token) expect(bytes).toBe('');
    else expect(JSON.parse(bytes).state).toBe('awaiting-client');
  }
});

it('starts no owner for invalid opt-in arguments and closes the endpoint after owner failure', async () => {
  const file = await fixture(),
    run = vi.fn();
  expect(
    await runObservedMcp(['--action-mcp-stdio', 'p', '--observe', file], run, 'mcp-stdio'),
  ).toBe(2);
  expect(run).not.toHaveBeenCalled();
  const failing = vi.fn(async (_, options) => {
    expect(options.observe).toBeTypeOf('function');
    throw new Error('PRIVATE_FAILURE');
  });
  expect(
    await runObservedMcp(['--action-mcp-stdio', 'p', 'r', '--observe', file], failing, 'mcp-stdio'),
  ).toBe(2);
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('bounds self-reported metadata and rejects contradictory counts', () => {
  expect(schema.clientMetadata({ name: 'PRIVATE_NAME', version: 'PRIVATE_VERSION' })).toEqual({
    name: 'other',
    version: null,
  });
  expect(schema.validObservation(frame({ ownerSettled: 1 }))).toBe(false);
  expect(schema.validObservation(frame({ state: 'observed', client: null }))).toBe(false);
  expect(schema.validObservation(frame({ selectedActionCount: 9 }))).toBe(false);
  const deletion = frame({ route: 'mcp-review', selection: 'selected-file-delete' });
  expect(schema.validObservation(deletion)).toBe(true);
  expect(schema.validObservation({ ...deletion, route: 'mcp-stdio' })).toBe(false);
  expect(schema.validObservation({ ...deletion, selectedActionCount: 2 })).toBe(false);
  expect(schema.validObservation({ ...deletion, selection: 'selected-file' })).toBe(false);
  expect(schema.follows(deletion, { ...deletion, sequence: 2, selection: 'single-action' })).toBe(
    false,
  );
});
