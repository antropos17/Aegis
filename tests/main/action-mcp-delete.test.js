import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const broker = require('../../src/main/action-mcp-review');
const terminal = require('../../src/main/action-confirmation-terminal');
const { DELETE_NAME } = require('../../src/main/action-mcp');
const owners = [];
const peers = [];
let directory, policyPath, requestPath, target, operation;

function writeSelection(decision = 'allow', selected = operation) {
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, operation: selected }));
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultDecision: 'deny',
      rules: [{ operation: selected, decision }],
    }),
  );
}

async function start() {
  const endpointPath = path.join(directory, 'new-endpoint.json');
  const host = new EventEmitter();
  let ready;
  const waiting = new Promise((resolve) => {
    ready = resolve;
  });
  broker._setDepsForTest({
    available: () => true,
    process: host,
    watchTerminal: () => () => {},
    monitorInput: () => () => {},
    output: {
      write: (_value, callback) => {
        callback();
        ready();
      },
    },
  });
  const done = broker.handleActionMcpReview([
    '--action-mcp-delete-review',
    policyPath,
    requestPath,
    endpointPath,
  ]);
  owners.push({ host, done });
  await waiting;
  const endpoint = JSON.parse(fs.readFileSync(endpointPath, 'utf8'));
  const peer = net.connect({ host: '127.0.0.1', port: endpoint.port });
  peers.push(peer);
  peer.on('error', () => {});
  await new Promise((resolve, reject) => {
    peer.once('connect', resolve);
    peer.once('error', reject);
  });
  peer.write(endpoint.token + '\n');
  const client = createClient(peer);
  await client.call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1' },
  });
  client.notify('notifications/initialized');
  return { client, peer, host, done, endpointPath };
}

function createClient(peer) {
  let serial = 0;
  let buffer = '';
  const replies = new Map();
  peer.on('data', (bytes) => {
    buffer += bytes;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    }
  });
  const send = (message) => peer.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  return {
    send,
    notify: (method, params) => send({ method, ...(params ? { params } : {}) }),
    call: (method, params, id = ++serial, timeoutMs = 4000) =>
      new Promise((resolve, reject) => {
        const timer =
          timeoutMs && setTimeout(() => reject(Error('fixture-response-timeout')), timeoutMs);
        replies.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        send({ id, method, ...(params ? { params } : {}) });
      }),
  };
}

const deleteCall = (client, id, args = {}) =>
  client.call('tools/call', { name: DELETE_NAME, arguments: args }, id);

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-delete-'));
  policyPath = path.join(directory, 'policy.json');
  requestPath = path.join(directory, 'request.json');
  target = path.join(directory, 'selected.txt');
  operation = { kind: 'delete-file', path: target };
  fs.writeFileSync(target, 'selected sentinel');
  writeSelection();
  vi.spyOn(terminal, 'isTerminalAvailable').mockReturnValue(true);
  vi.spyOn(terminal, 'watchTerminalLifetime').mockReturnValue(() => {});
  vi.spyOn(terminal, 'monitorTerminalInput').mockReturnValue(() => {});
  vi.spyOn(terminal, 'confirmInTerminal').mockResolvedValue(true);
});

afterEach(async () => {
  for (const peer of peers.splice(0)) peer.destroy();
  for (const owner of owners.splice(0)) {
    owner.host.emit('SIGTERM');
    await owner.done;
  }
  broker._resetForTest();
  terminal._resetForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
  fs.rmSync(directory, { recursive: true, force: true });
});

it('publishes only the dedicated empty-argument tool and removes one reviewed regular file', async () => {
  const neighbor = path.join(directory, 'neighbor.txt');
  fs.writeFileSync(neighbor, 'outside selection');
  const { client } = await start();
  const list = await client.call('tools/list');
  expect(list.result.tools.map((tool) => tool.name)).toEqual([DELETE_NAME, 'aegis_route_status']);
  expect(list.result.tools[0].inputSchema).toEqual({
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
  const reply = await deleteCall(client, 10);
  expect(reply.result.isError).toBe(false);
  expect(reply.result.structuredContent).toMatchObject({
    mode: 'action-delete-file',
    decision: 'allow',
    operation: { state: 'deleted' },
    control: 'selected-file-only',
    outsideRouteCoverage: 'unknown',
  });
  expect(JSON.stringify(reply)).not.toContain(directory);
  expect(fs.existsSync(target)).toBe(false);
  expect(fs.readFileSync(neighbor, 'utf8')).toBe('outside selection');
  expect(terminal.confirmInTerminal).toHaveBeenCalledExactlyOnceWith(operation, {
    signal: expect.any(AbortSignal),
    kind: 'delete-file',
  });
  const status = await client.call('tools/call', {
    name: 'aegis_route_status',
    arguments: {},
  });
  expect(status.result.structuredContent).toMatchObject({
    actionAttempts: 1,
    ownerInvocations: 1,
    control: 'selected-file-only',
    outsideRouteCoverage: 'unknown',
  });
});

it('rejects client-selected paths and malformed arguments before review or unlink', async () => {
  const { client } = await start();
  for (const [id, params] of [
    [2, { name: DELETE_NAME, arguments: { path: target } }],
    [3, { name: DELETE_NAME, arguments: { extra: true } }],
    [4, { name: DELETE_NAME, arguments: 'malformed' }],
    [5, { name: DELETE_NAME, arguments: null }],
    [6, { name: DELETE_NAME, arguments: [] }],
    [7, { name: DELETE_NAME, arguments: {}, path: target }],
    [8, { name: 'aegis_execute_selected', arguments: {} }],
  ]) {
    expect((await client.call('tools/call', params, id)).error.code).toBe(-32602);
  }
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
  expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
});

it('keeps the selected file on policy denial, refusal and a second refused review', async () => {
  writeSelection('deny');
  const denied = await start();
  expect((await deleteCall(denied.client, 2)).result.structuredContent.reason).toBe('policy-deny');
  expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
  denied.host.emit('SIGTERM');
  await denied.done;
  denied.peer.destroy();

  writeSelection();
  terminal.confirmInTerminal.mockResolvedValue(false);
  const refused = await start();
  for (const id of [3, 4]) {
    const reply = await deleteCall(refused.client, id);
    expect(reply.result.isError).toBe(true);
    expect(reply.result.structuredContent.reason).toBe('confirmation-denied');
    expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
  }
  expect(terminal.confirmInTerminal).toHaveBeenCalledTimes(2);
});

it('rejects duplicate IDs after invalid parameters without another execution', async () => {
  const { client } = await start();
  expect((await deleteCall(client, 9, { path: target })).error.code).toBe(-32602);
  expect((await deleteCall(client, 9)).error.message).toBe('Duplicate request identifier');
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
  expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
});

it('does not repeat a successful deletion when the same request ID is replayed', async () => {
  const { client } = await start();
  expect((await deleteCall(client, 9)).result.isError).toBe(false);
  expect(fs.existsSync(target)).toBe(false);
  fs.writeFileSync(target, 'recreated sentinel');
  expect((await deleteCall(client, 9)).error.message).toBe('Duplicate request identifier');
  expect(fs.readFileSync(target, 'utf8')).toBe('recreated sentinel');
  expect(terminal.confirmInTerminal).toHaveBeenCalledTimes(1);
});

it.each(['policy', 'request'])(
  'rejects changed %s bytes for the connection even after restoration',
  async (file) => {
    const { client } = await start();
    const selected = file === 'policy' ? policyPath : requestPath;
    const original = fs.readFileSync(selected);
    fs.appendFileSync(selected, ' ');
    expect((await deleteCall(client, 2)).result.structuredContent.reason).toBe(
      'preparation-unavailable',
    );
    fs.writeFileSync(selected, original);
    expect((await deleteCall(client, 3)).result.structuredContent.reason).toBe(
      'configuration-changed',
    );
    expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
    expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
  },
);

it('keeps the connection revoked after a selected-file read failure', async () => {
  const { client } = await start();
  const held = requestPath + '.held';
  fs.renameSync(requestPath, held);
  expect((await deleteCall(client, 2)).result.structuredContent.reason).toBe(
    'preparation-unavailable',
  );
  fs.renameSync(held, requestPath);
  expect((await deleteCall(client, 3)).result.structuredContent.reason).toBe(
    'configuration-changed',
  );
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
  expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
});

it('refuses a changed target after affirmative terminal review', async () => {
  terminal.confirmInTerminal.mockImplementation(async () => {
    fs.writeFileSync(target, 'modified during review');
    return true;
  });
  const { client } = await start();
  const reply = await deleteCall(client, 2);
  expect(reply.result.isError).toBe(true);
  expect(reply.result.structuredContent.reason).toBe('target-changed');
  expect(fs.readFileSync(target, 'utf8')).toBe('modified during review');
});

it('leaves the selected file when the real terminal challenge expires', async () => {
  const { client } = await start();
  terminal.confirmInTerminal.mockRestore();
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  const prompted = new Promise((resolve) => output.once('data', resolve));
  terminal._setDepsForTest({ input, output, randomBytes: () => Buffer.from('01020304', 'hex') });
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = client.call('tools/call', { name: DELETE_NAME, arguments: {} }, 2, 0);
    await prompted;
    await vi.advanceTimersByTimeAsync(terminal.LIMITS.reviewMs + 1);
    vi.useRealTimers();
    const reply = await pending;
    expect(reply.result.isError).toBe(true);
    expect(reply.result.structuredContent.reason).toBe('confirmation-denied');
    expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
  } finally {
    vi.useRealTimers();
    input.destroy();
    output.destroy();
  }
});

it('cancels pending review and suppresses a late affirmative answer', async () => {
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  terminal.confirmInTerminal.mockImplementation(
    (_selected, { signal }) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(true), { once: true });
        entered();
      }),
  );
  const { client, peer } = await start();
  client.send({ id: 8, method: 'tools/call', params: { name: DELETE_NAME, arguments: {} } });
  await waiting;
  client.notify('notifications/cancelled', { requestId: 8 });
  await vi.waitFor(() =>
    expect(terminal.confirmInTerminal.mock.calls[0][1].signal.aborted).toBe(true),
  );
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
  peer.destroy();
});

it('shows the separate outside-route deletion control honestly', async () => {
  writeSelection('deny');
  const outside = path.join(directory, 'outside-route.txt');
  fs.writeFileSync(outside, 'unprotected sentinel');
  const { client } = await start();
  expect((await deleteCall(client, 2)).result.structuredContent.decision).toBe('deny');
  const otherTool = spawnSync(
    process.execPath,
    ['-e', "require('node:fs').unlinkSync(process.argv[1])", outside],
    { windowsHide: true },
  );
  expect(otherTool.status).toBe(0);
  expect(fs.existsSync(outside)).toBe(false);
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
});

it('recognizes the dedicated CLI mode and refuses a broker without a terminal', () => {
  const endpoint = path.join(directory, 'never-published.json');
  const command = spawnSync(
    process.execPath,
    ['src/main/main.js', '--action-mcp-delete-review', policyPath, requestPath, endpoint],
    { encoding: 'utf8', timeout: 4000, windowsHide: true },
  );
  expect(command.error).toBeUndefined();
  expect(command.status).toBe(2);
  expect(command.stdout).toBe('');
  expect(command.stderr).toBe('');
  expect(fs.existsSync(endpoint)).toBe(false);
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
});

it('rejects the execution-only desktop observation option for deletion review', async () => {
  const endpoint = path.join(directory, 'never-published.json');
  const observation = path.join(directory, 'never-observed.json');
  const observed = vi
    .spyOn(require('../../src/main/action-observation-server'), 'runObservedMcp')
    .mockResolvedValue(0);
  const code = await require('../../src/main/cli').handleCLI([
    '--action-mcp-delete-review',
    policyPath,
    requestPath,
    endpoint,
    '--observe',
    observation,
  ]);
  expect(code).toBe(2);
  expect(observed).not.toHaveBeenCalled();
  expect(fs.existsSync(endpoint)).toBe(false);
  expect(fs.existsSync(observation)).toBe(false);
  expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
});
