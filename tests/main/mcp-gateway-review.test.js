import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const broker = require('../../src/main/mcp-gateway-review');
const terminal = require('../../src/main/action-confirmation-terminal');
const dirs = [];
const peers = [];
const hosts = [];
const done = [];

function setupTerminal() {
  const input = Object.assign(new EventEmitter(), { isTTY: true, resume: vi.fn(), pause: vi.fn() });
  const output = Object.assign(new EventEmitter(), { isTTY: true });
  const host = new EventEmitter();
  let preview = '';
  output.write = (value, cb) => {
    preview += value;
    queueMicrotask(() => cb());
    return true;
  };
  terminal._setDepsForTest({
    input,
    output,
    process: host,
    randomBytes: () => Buffer.from('a1b2c3d4', 'hex'),
  });
  return { input, output, preview: () => preview };
}

async function start(createGateway, fixture) {
  const dir = fixture?.root || fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gateway-review-'));
  if (!fixture) dirs.push(dir);
  const endpointPath = fixture?.endpoint || path.join(dir, 'endpoint.json');
  const host = new EventEmitter();
  hosts.push(host);
  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });
  const output = new PassThrough();
  const written = [];
  output.on('data', (chunk) => {
    written.push(chunk.toString());
    ready();
  });
  const noWatch = () => () => {};
  broker._setDepsForTest({
    available: () => true,
    process: host,
    output,
    watchTerminal: noWatch,
    monitorInput: noWatch,
    createGateway,
  });
  const result = broker.handleGatewayMcpReview(
    fixture?.args || [
      '--mcp-gateway-stdio-review',
      'policy',
      'request',
      'manifest',
      endpointPath,
      'store',
      'disclosure',
      'secrets',
    ],
  );
  done.push(result);
  await readyPromise;
  return { host, result, written, endpoint: JSON.parse(fs.readFileSync(endpointPath, 'utf8')) };
}

function gatewayFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gateway-real-review-'));
  dirs.push(root);
  const files = Object.fromEntries(
    [
      'policy',
      'request',
      'manifest',
      'config',
      'effects',
      'started',
      'listed',
      'disclosure',
      'secrets',
      'store',
      'endpoint',
    ].map((name) => [name, path.join(root, name)]),
  );
  fs.mkdirSync(files.store);
  const objectSchema = (properties) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const tool = {
    name: 'record',
    inputSchema: objectSchema({ recipient: { type: 'string', maxLength: 64 } }),
    outputSchema: objectSchema({ accepted: { type: 'boolean' } }),
  };
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [
      fileURLToPath(new URL('./fixtures/mcp-gateway-server.cjs', import.meta.url)),
      files.config,
    ],
    env:
      process.platform === 'win32'
        ? { SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot }
        : {},
  };
  const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  save(files.policy, {
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'allow' }],
  });
  save(files.request, { schemaVersion: 1, action });
  save(files.config, { ...files, tool, mode: 'normal' });
  save(files.secrets, { schemaVersion: 1, values: ['Synthetic_Protected_847'] });
  save(files.disclosure, { schemaVersion: 1, tools: [{ name: 'record', paths: ['/recipient'] }] });
  const time = Date.now();
  save(files.manifest, {
    schemaVersion: 2,
    tools: [tool],
    grants: ['north', 'south', 'east'].map((recipient, index) => ({
      id: String(index + 1).repeat(32),
      taskId: 't'.repeat(32),
      notBefore: time - 1000,
      expiresAt: time + 120000,
      tool: 'record',
      arguments: { recipient },
    })),
  });
  return {
    root,
    endpoint: files.endpoint,
    effects: files.effects,
    started: files.started,
    args: [
      '--mcp-gateway-stdio-review',
      files.policy,
      files.request,
      files.manifest,
      files.endpoint,
      files.store,
      files.disclosure,
      files.secrets,
    ],
  };
}

async function connect(endpoint, token = endpoint.token) {
  const peer = net.connect({ host: '127.0.0.1', port: endpoint.port });
  peers.push(peer);
  peer.on('error', () => {});
  await new Promise((resolve, reject) => {
    peer.once('connect', resolve);
    peer.once('error', reject);
  });
  peer.write(token + '\n');
  return peer;
}

afterEach(async () => {
  for (const peer of peers.splice(0)) peer.destroy();
  for (const host of hosts.splice(0)) host.emit('SIGTERM');
  await Promise.all(done.splice(0));
  broker._resetForTest();
  terminal._resetForTest();
  for (const dir of dirs.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('prompts once on a private owner terminal and keeps its preview off MCP and readiness output', async () => {
  const tty = setupTerminal();
  let review;
  const gateway = {
    close: vi.fn(),
    finish: vi.fn(async () => true),
    receive: async (message) => {
      const approved = await review('Current: SAFE_PRIVATE_VALUE\nBaseline: none', {
        signal: new AbortController().signal,
      });
      return { jsonrpc: '2.0', id: message.id, result: { approved } };
    },
  };
  const owner = await start((options) => {
    review = options.reviewCall;
    return gateway;
  });
  const peer = await connect(owner.endpoint);
  const received = [];
  peer.on('data', (chunk) => received.push(chunk.toString()));
  peer.write('{"jsonrpc":"2.0","id":1,"method":"call"}\n');
  await vi.waitFor(() => expect(tty.preview()).toContain('SAFE_PRIVATE_VALUE'));
  expect(tty.preview()).toContain('unknown secrets may be displayed');
  expect(tty.preview()).toContain('does not authenticate a human');
  expect(owner.written.join('')).not.toContain('SAFE_PRIVATE_VALUE');
  expect(received.join('')).not.toContain('SAFE_PRIVATE_VALUE');
  tty.input.emit('data', Buffer.from('APPROVE a1b2c3d4\n'));
  await vi.waitFor(() => expect(received.join('')).toContain('"approved":true'));
  peer.end();
  expect(await owner.result).toBe(0);
  expect(gateway.close).toHaveBeenCalled();
});

it('reviews two real gateway calls in the owner terminal and forwards only approved calls', async () => {
  const fixture = gatewayFixture();
  const tty = setupTerminal();
  const owner = await start(undefined, fixture);
  const peer = await connect(owner.endpoint);
  let wire = '';
  peer.on('data', (chunk) => {
    wire += chunk.toString();
  });
  const send = (id, method, params) =>
    peer.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  send(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {} });
  await vi.waitFor(() => expect(wire).toContain('"id":1'), { timeout: 8000 });
  peer.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  send(2, 'tools/call', { name: 'record', arguments: { recipient: 'north' } });
  await vi.waitFor(() => expect(tty.preview()).toContain('"baseline": "none"'), { timeout: 8000 });
  expect(tty.preview()).toContain('"recipient": "north"');
  expect(fs.existsSync(fixture.effects)).toBe(false);
  tty.input.emit('data', Buffer.from('APPROVE a1b2c3d4\n'));
  await vi.waitFor(() => expect(wire).toContain('"id":2'), { timeout: 8000 });
  send(3, 'tools/call', { name: 'record', arguments: { recipient: 'south' } });
  await vi.waitFor(
    () => expect(tty.preview()).toContain('"baseline": "previous-owner-approved-call"'),
    { timeout: 8000 },
  );
  expect(tty.preview()).toContain('"type": "changed"');
  tty.input.emit('data', Buffer.from('APPROVE a1b2c3d4\n'));
  await vi.waitFor(() => expect(wire).toContain('"id":3'), { timeout: 8000 });
  const effects = fs.readFileSync(fixture.effects, 'utf8').trim().split('\n').map(JSON.parse);
  expect(effects.map((effect) => effect.arguments.recipient)).toEqual(['north', 'south']);
  expect(owner.written.join('')).not.toContain('north');
  expect(owner.written.join('')).not.toContain('south');
  expect(wire).not.toContain('north');
  expect(wire).not.toContain('south');
  send(4, 'tools/call', { name: 'record', arguments: { recipient: 'east' } });
  await vi.waitFor(() => expect(tty.preview()).toContain('"recipient": "east"'), { timeout: 8000 });
  peer.destroy();
  await owner.result;
  tty.input.emit('data', Buffer.from('APPROVE a1b2c3d4\n'));
  expect(
    fs
      .readFileSync(fixture.effects, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
      .map((effect) => effect.arguments.recipient),
  ).toEqual(['north', 'south']);
  const pid = Number(fs.readFileSync(fixture.started, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow();
}, 20000);

it('rejects terminal controls and oversized previews without accepting buffered responses', async () => {
  const tty = setupTerminal();
  expect(await terminal.confirmInTerminal('bad\x1b[31m', { kind: 'mcp-call' })).toBe(false);
  expect(await terminal.confirmInTerminal('x'.repeat(16384), { kind: 'mcp-call' })).toBe(false);
  expect(tty.preview()).toBe('');
});

it('rejects a wrong bearer without starting a gateway and still accepts the selected client', async () => {
  setupTerminal();
  const createGateway = vi.fn(() => ({
    close: vi.fn(),
    finish: async () => true,
    receive: async (message) => ({ jsonrpc: '2.0', id: message.id, result: {} }),
  }));
  const owner = await start(createGateway);
  const denied = await connect(owner.endpoint, '0'.repeat(64));
  await new Promise((resolve) => denied.once('close', resolve));
  expect(createGateway).not.toHaveBeenCalled();
  const peer = await connect(owner.endpoint);
  let reply = '';
  peer.on('data', (chunk) => {
    reply += chunk.toString();
  });
  peer.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  await vi.waitFor(() => expect(reply).toContain('"id":2'));
  expect(createGateway).toHaveBeenCalledOnce();
  peer.end();
  expect(await owner.result).toBe(0);
});

it('aborts a waiting terminal review when its sole client disconnects', async () => {
  const tty = setupTerminal();
  let review, aborted;
  const controller = new AbortController();
  const gateway = {
    close: vi.fn(() => controller.abort()),
    finish: async () => true,
    receive: async (message) => {
      const approved = await review('Current: safe', { signal: controller.signal });
      aborted = !approved && controller.signal.aborted;
      return { jsonrpc: '2.0', id: message.id, result: { approved } };
    },
  };
  const owner = await start((options) => {
    review = options.reviewCall;
    return gateway;
  });
  const peer = await connect(owner.endpoint);
  peer.write('{"jsonrpc":"2.0","id":1,"method":"call"}\n');
  await vi.waitFor(() => expect(tty.preview()).toContain('Current: safe'));
  peer.destroy();
  await owner.result;
  expect(aborted).toBe(true);
  tty.input.emit('data', Buffer.from('APPROVE a1b2c3d4\n'));
});

it('refuses invalid setup and never opens a listener', async () => {
  broker._setDepsForTest({
    available: () => true,
    createServer: vi.fn(() => {
      throw Error('unexpected');
    }),
  });
  expect(await broker.handleGatewayMcpReview(['--mcp-gateway-stdio-review', 'incomplete'])).toBe(2);
  const cli = require('../../src/main/cli');
  expect(await cli.handleCLI(['--mcp-gateway-stdio-review', 'incomplete'])).toBe(2);
});
