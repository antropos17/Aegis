import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-mcp-connect');
const token = 'ab'.repeat(32);
const directories = [];
const servers = [];
const sockets = [];
const streams = [];
const tick = () => new Promise(setImmediate);
function descriptor(value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-connect-'));
  directories.push(root);
  const file = path.join(root, 'PRIVATE_DESCRIPTOR.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
function io(extra = {}) {
  const input = new PassThrough();
  const output = extra.output || new PassThrough();
  let text = '';
  if (!extra.output)
    output.on('data', (b) => {
      text += b;
    });
  const host = new EventEmitter();
  streams.push(input, output);
  api._setDepsForTest({ ...extra, input, output, process: host });
  return {
    input,
    output,
    host,
    text: () => text,
    run: (file) => api.handleActionMcpConnect(['--action-mcp-connect', file]),
  };
}
async function listen(onConnection) {
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    onConnection(socket);
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
function fake({ connect = true, auth = true, writes = true, output } = {}) {
  const socket = Object.assign(new EventEmitter(), {
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
  });
  sockets.push(socket);
  const sent = [];
  socket.write = vi.fn((bytes, cb) => {
    sent.push(Buffer.from(bytes));
    if (sent.length === 1 ? auth : writes) cb();
    return true;
  });
  const readBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, port: 1234, token }));
  const connectFn = vi.fn(() => {
    if (connect) queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  const t = io({ read: async () => readBytes, connect: connectFn, output });
  return { ...t, socket, sent, readBytes, connectFn, run: () => t.run('PRIVATE_FILE') };
}
afterEach(async () => {
  api._resetForTest();
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const stream of streams.splice(0)) stream.destroy();
  for (const server of servers.splice(0))
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  for (const root of directories.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('sends authentication first and relays opaque coalesced protocol bytes without exposing bearer', async () => {
  const request = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"private":"CLIENT"}\n');
  const response = '{"jsonrpc":"2.0","id":1,"result":{}}\n';
  let received = Buffer.alloc(0);
  const port = await listen((socket) =>
    socket.on('data', (b) => {
      received = Buffer.concat([received, b]);
      if (received.length === 65 + request.length) socket.end(response);
    }),
  );
  const t = io();
  const done = t.run(descriptor({ schemaVersion: 1, port, token }));
  t.input.write(request);
  expect(await done).toBe(0);
  expect(received.toString()).toBe(token + '\n' + request.toString());
  expect(t.text()).toBe(response);
  expect(t.text()).not.toContain(token);
});

it('destroys the broker connection when the agent stdin ends', async () => {
  let authenticated;
  let disconnected;
  const gotAuth = new Promise((resolve) => {
    authenticated = resolve;
  });
  const gotClose = new Promise((resolve) => {
    disconnected = resolve;
  });
  const port = await listen((socket) => {
    socket.once('data', authenticated);
    socket.once('close', disconnected);
  });
  const t = io();
  const done = t.run(descriptor({ schemaVersion: 1, port, token }));
  await gotAuth;
  t.input.end();
  expect(await done).toBe(0);
  await gotClose;
  expect(t.text()).toBe('');
});

it.each([
  { schemaVersion: 1, port: 1234, token, host: 'remote.invalid' },
  { schemaVersion: 1, port: 0, token },
  { schemaVersion: 2, port: 1234, token },
  { schemaVersion: 1, port: 1234, token: token.toUpperCase() },
  { schemaVersion: 1, port: 1234 },
])('rejects malformed descriptors and arbitrary destination fields %#', async (value) => {
  const connect = vi.fn();
  const t = io({ connect });
  expect(await t.run(descriptor(value))).toBe(2);
  expect(connect).not.toHaveBeenCalled();
  expect(t.text()).toBe('');
});

it('rejects unreadable descriptors and invalid arguments without diagnostics', async () => {
  const t = io();
  expect(await t.run('PRIVATE_MISSING')).toBe(2);
  expect(t.text()).toBe('');
  expect(await api.handleActionMcpConnect(['--action-mcp-connect'])).toBe(2);
  expect(t.text()).toBe('');
});

it('handles real connection refusal with empty stdout', async () => {
  const port = await listen(() => {});
  await new Promise((resolve) => servers[0].close(resolve));
  const t = io();
  expect(await t.run(descriptor({ schemaVersion: 1, port, token }))).toBe(2);
  expect(t.text()).toBe('');
});

it.each([{ connect: false }, { auth: false }])(
  'bounds connection and authentication write stalls %#',
  async (extra) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = fake(extra);
    const done = t.run();
    await vi.advanceTimersByTimeAsync(api.LIMITS.connectMs + 1);
    expect(await done).toBe(2);
    expect(t.socket.destroy).toHaveBeenCalled();
    expect(t.text()).toBe('');
  },
);

it('uses only loopback and clears the descriptor read buffer', async () => {
  const t = fake();
  const done = t.run();
  await tick();
  expect(t.connectFn).toHaveBeenCalledWith({ host: '127.0.0.1', port: 1234, allowHalfOpen: false });
  expect(t.readBytes.every((b) => b === 0)).toBe(true);
  t.input.end();
  expect(await done).toBe(0);
  expect(t.sent[0].toString()).toBe(token + '\n');
});

it.each(['SIGINT', 'SIGTERM', 'error'])('closes the broker on %s', async (event) => {
  const t = fake();
  const done = t.run();
  await tick();
  if (event === 'error') t.input.emit('error', Error('PRIVATE_ERROR'));
  else t.host.emit(event);
  expect(await done).toBe(2);
  expect(t.socket.destroy).toHaveBeenCalled();
  expect(t.text()).toBe('');
});

it('bounds a queued stdin chunk and cumulative input bytes', async () => {
  for (const mode of ['queued', 'total']) {
    const t = fake();
    const done = t.run();
    await tick();
    if (mode === 'queued') t.input.write(Buffer.alloc(api.LIMITS.queuedBytes + 1));
    else
      for (let i = 0; i <= api.LIMITS.bytes / api.LIMITS.queuedBytes; i++) {
        t.input.write(Buffer.alloc(api.LIMITS.queuedBytes));
        await tick();
      }
    expect(await done).toBe(2);
    expect(t.text()).toBe('');
  }
});

it('bounds oversized inbound chunks before forwarding them', async () => {
  const t = fake();
  const done = t.run();
  await tick();
  t.socket.emit('data', Buffer.alloc(api.LIMITS.queuedBytes + 1));
  expect(await done).toBe(2);
  expect(t.text()).toBe('');
});

it('bounds cumulative broker output across individually acceptable chunks', async () => {
  const t = fake();
  const done = t.run();
  await tick();
  for (let i = 0; i <= api.LIMITS.bytes / api.LIMITS.queuedBytes; i++) {
    t.socket.emit('data', Buffer.alloc(api.LIMITS.queuedBytes, 65));
    await tick();
  }
  expect(await done).toBe(2);
  expect(Buffer.byteLength(t.text())).toBe(api.LIMITS.bytes);
});

it('closes a relay after stdout errors without emitting diagnostics', async () => {
  const t = fake();
  const done = t.run();
  await tick();
  t.output.emit('error', Error('PRIVATE_OUTPUT_FAILURE'));
  expect(await done).toBe(2);
  expect(t.socket.destroy).toHaveBeenCalled();
  expect(t.text()).toBe('');
});

it('bounds socket write backpressure without accepting more stdin', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const t = fake({ writes: false });
  const done = t.run();
  await vi.advanceTimersByTimeAsync(0);
  t.input.write('request');
  expect(t.input.isPaused()).toBe(true);
  await vi.advanceTimersByTimeAsync(api.LIMITS.drainMs + 1);
  expect(await done).toBe(2);
});

it('bounds a blocked stdout drain even after broker EOF', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const output = new Writable({ write(_bytes, _encoding, _callback) {} });
  const t = fake({ output });
  const done = t.run();
  await vi.advanceTimersByTimeAsync(0);
  t.socket.emit('data', Buffer.from('response'));
  t.socket.emit('end');
  await vi.advanceTimersByTimeAsync(api.LIMITS.drainMs + 1);
  expect(await done).toBe(2);
  expect(t.socket.destroy).toHaveBeenCalled();
});

it.each([
  ['stdin', true],
  ['stdin', false],
  ['stdout', true],
  ['stdout', false],
])(
  'keeps the drain deadline after %s callback (synchronous=%s)',
  async (direction, synchronous) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = fake();
    const done = t.run();
    await vi.advanceTimersByTimeAsync(0);
    const destination = direction === 'stdin' ? t.socket : t.output;
    vi.spyOn(destination, 'write').mockImplementation((_bytes, cb) => {
      if (synchronous) cb();
      else queueMicrotask(cb);
      return false;
    });
    if (direction === 'stdin') t.input.write('request');
    else t.socket.emit('data', Buffer.from('response'));
    await vi.advanceTimersByTimeAsync(api.LIMITS.drainMs + 1);
    expect(await done).toBe(2);
    expect(t.socket.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('resumes paused stdin only after both its write callback and drain', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const t = fake();
  const done = t.run();
  await vi.advanceTimersByTimeAsync(0);
  t.socket.write.mockImplementation((_bytes, cb) => {
    cb();
    return false;
  });
  t.input.write('request');
  expect(t.input.isPaused()).toBe(true);
  t.socket.emit('drain');
  expect(t.input.isPaused()).toBe(false);
  await vi.advanceTimersByTimeAsync(api.LIMITS.drainMs + 1);
  expect(t.socket.destroy).not.toHaveBeenCalled();
  t.input.end();
  expect(await done).toBe(0);
});

it('bounds a connected but idle broker session', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const t = fake();
  const done = t.run();
  await vi.advanceTimersByTimeAsync(api.LIMITS.lifetimeMs + 1);
  expect(await done).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});
