import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const broker = require('../../src/main/action-mcp-review');
const confirmation = require('../../src/main/action-confirmation');
const dirs = [];
const peers = [];
const owners = [];
function fixture(decision = 'ask') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-review-'));
  dirs.push(dir);
  const policy = path.join(dir, 'PRIVATE_POLICY.json');
  const request = path.join(dir, 'PRIVATE_REQUEST.json');
  const endpoint = path.join(dir, 'endpoint.json');
  const action = {
    executable: process.execPath,
    cwd: dir,
    args: ['-e', "require('node:fs').appendFileSync('sentinel','x')"],
    env:
      process.platform === 'win32'
        ? {
            SYSTEMROOT: process.env.SystemRoot,
            WINDIR: process.env.SystemRoot,
            TEMP: dir,
            TMP: dir,
          }
        : {},
  };
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      defaultDecision: decision === 'allow' ? 'deny' : decision,
      rules: decision === 'allow' ? [{ action, decision }] : [],
    }),
  );
  return { dir, policy, request, endpoint, action };
}
async function start(f, confirm = async () => true, options = {}) {
  const host = new EventEmitter();
  const output = [];
  let ready;
  const waiting = new Promise((resolve) => {
    ready = resolve;
  });
  const noopWatch = () => () => {};
  confirmation._setDepsForTest({
    available: () => true,
    confirm,
    watchTerminal: noopWatch,
    monitorInput: noopWatch,
  });
  broker._setDepsForTest({
    available: () => true,
    process: host,
    watchTerminal: noopWatch,
    monitorInput: noopWatch,
    output: {
      write: (value, callback) => {
        output.push(value);
        callback();
        ready();
      },
    },
  });
  const done = broker.handleActionMcpReview(
    f.catalog
      ? ['--action-mcp-catalog-review', f.catalog, f.endpoint]
      : ['--action-mcp-review', f.policy, f.request, f.endpoint],
    options,
  );
  owners.push({ host, done });
  await waiting;
  return { host, done, output, endpoint: JSON.parse(fs.readFileSync(f.endpoint, 'utf8')) };
}
async function connect(endpoint, auth = endpoint.token + '\n') {
  const peer = net.connect({ host: '127.0.0.1', port: endpoint.port });
  peers.push(peer);
  peer.on('error', () => {});
  await new Promise((resolve, reject) => {
    peer.once('connect', resolve);
    peer.once('error', reject);
  });
  if (auth) peer.write(auth);
  return peer;
}
function client(peer) {
  let pending = '';
  let serial = 0;
  const replies = new Map();
  const received = [];
  peer.on('data', (chunk) => {
    pending += chunk;
    while (pending.includes('\n')) {
      const end = pending.indexOf('\n');
      const message = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      received.push(message);
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    }
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => reject(Error('fixture response timeout')), 4000);
      replies.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      peer.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  return {
    call,
    received,
    ready: async () => {
      const response = await call('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'fixture', version: '1' },
      });
      expect(response.error).toBeUndefined();
      peer.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    },
  };
}
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.destroy();
  for (const owner of owners.splice(0)) {
    owner.host.emit('SIGTERM');
    await owner.done;
  }
  broker._resetForTest();
  confirmation._resetForTest();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function catalogFixture(firstDecision = 'ask', secondDecision = 'ask') {
  const first = fixture(firstDecision);
  const second = fixture(secondDecision);
  first.catalog = path.join(first.dir, 'PRIVATE_CATALOG.json');
  fs.writeFileSync(
    first.catalog,
    JSON.stringify({
      schemaVersion: 1,
      actions: [
        { id: 'first', policyPath: first.policy, requestPath: first.request },
        { id: 'second', policyPath: second.policy, requestPath: second.request },
      ],
    }),
  );
  return { first, second };
}

it('catalog broker reviews the selected action on each call without sharing approvals', async () => {
  const { first, second } = catalogFixture('ask', 'allow');
  let count = 0;
  const previewed = [];
  const owner = await start(first, async (launch) => {
    previewed.push(launch.cwd);
    return ++count !== 2;
  });
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  expect((await c.call('tools/list')).result.tools.map((tool) => tool.name)).toEqual([
    'aegis_action_first',
    'aegis_action_second',
  ]);
  for (const [name, decision] of [
    ['first', 'allow'],
    ['second', 'deny'],
    ['second', 'allow'],
  ]) {
    const reply = await c.call('tools/call', { name: `aegis_action_${name}`, arguments: {} });
    expect(reply.result.structuredContent.decision).toBe(decision);
    if (decision === 'deny') expect(fs.existsSync(path.join(second.dir, 'sentinel'))).toBe(false);
    else expect(reply.result.structuredContent.authorization).toBe('operator-confirmed');
  }
  expect(previewed).toEqual([first.dir, second.dir, second.dir]);
  for (const f of [first, second])
    expect(fs.readFileSync(path.join(f.dir, 'sentinel'), 'utf8')).toBe('x');
  const visible = JSON.stringify(c.received) + owner.output.join('');
  for (const secret of [first.dir, second.dir, owner.endpoint.token, 'PRIVATE'])
    expect(visible).not.toContain(secret);
  peer.end();
  await owner.done;
  expect(fs.existsSync(first.endpoint)).toBe(false);
});

it('catalog disconnect during a second action review cancels that action and cleans its scope', async () => {
  const { first, second } = catalogFixture();
  let entered, answer, signal;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const owner = await start(first, (launch, options) => {
    if (launch.cwd === first.dir) return true;
    signal = options.signal;
    entered();
    return new Promise((resolve) => {
      answer = resolve;
    });
  });
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  const doneFirst = await c.call('tools/call', { name: 'aegis_action_first' });
  expect(doneFirst.result.structuredContent.execution.exitCode).toBe(0);
  peer.write(
    '{"jsonrpc":"2.0","id":77,"method":"tools/call","params":{"name":"aegis_action_second"}}\n',
  );
  await waiting;
  peer.destroy();
  await owner.done;
  expect(signal.aborted).toBe(true);
  answer(true);
  await new Promise(setImmediate);
  expect(fs.readFileSync(path.join(first.dir, 'sentinel'), 'utf8')).toBe('x');
  expect(fs.existsSync(path.join(second.dir, 'sentinel'))).toBe(false);
  expect(c.received.some((reply) => reply.id === 77)).toBe(false);
  expect(fs.existsSync(first.endpoint)).toBe(false);
});

it.each(['ask', 'allow'])(
  'reviews each %s call with the same connection binding, then launches once',
  async (decision) => {
    const f = fixture(decision);
    const review = vi.fn(async (launch) => {
      expect(launch.args).toEqual(f.action.args);
      return true;
    });
    const owner = await start(f, review);
    const peer = await connect(owner.endpoint);
    const c = client(peer);
    await c.ready();
    for (let i = 0; i < 2; i++) {
      const result = await c.call('tools/call', { name: 'aegis_execute_selected', arguments: {} });
      expect(result.result.structuredContent).toMatchObject({
        decision: 'allow',
        policyDecision: decision,
        authorization: 'operator-confirmed',
        execution: { state: 'exited', exitCode: 0 },
      });
    }
    expect(review).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(f.dir, 'sentinel'), 'utf8')).toBe('xx');
    const publicText = JSON.stringify(c.received) + owner.output.join('');
    for (const privateText of [f.policy, f.request, f.dir, owner.endpoint.token, f.action.args[1]])
      expect(publicText).not.toContain(privateText);
    peer.end();
    await owner.done;
    expect(fs.existsSync(f.endpoint)).toBe(false);
  },
);

it('cannot override deny or prompt for it', async () => {
  const f = fixture('deny');
  const review = vi.fn(async () => true);
  const owner = await start(f, review);
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  const result = await c.call('tools/call', { name: 'aegis_execute_selected' });
  expect(result.result.structuredContent.execution.state).toBe('not-started');
  expect(review).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(f.dir, 'sentinel'))).toBe(false);
});

it('rejects negative review and changes observed after confirmation', async () => {
  const f = fixture();
  let count = 0;
  const owner = await start(f, async () => {
    if (++count === 1) return false;
    fs.appendFileSync(f.request, ' ');
    return true;
  });
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  for (let i = 0; i < 2; i++) {
    const reply = await c.call('tools/call', { name: 'aegis_execute_selected' });
    expect(reply.result.structuredContent.execution.state).toBe('not-started');
  }
  expect(fs.existsSync(path.join(f.dir, 'sentinel'))).toBe(false);
});

it('disconnect during pending review aborts it and suppresses a late yes', async () => {
  const f = fixture();
  let answer;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  let signal;
  const owner = await start(f, (_launch, options) => {
    signal = options.signal;
    entered();
    return new Promise((resolve) => {
      answer = resolve;
    });
  });
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  peer.write(
    '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"aegis_execute_selected"}}\n',
  );
  await waiting;
  peer.destroy();
  await owner.done;
  expect(signal.aborted).toBe(true);
  answer(true);
  await Promise.resolve();
  expect(fs.existsSync(path.join(f.dir, 'sentinel'))).toBe(false);
});

it('rejects wrong or overlong auth without exposing protocol, then permits a valid client', async () => {
  const f = fixture();
  const owner = await start(f);
  for (const auth of [
    '0'.repeat(64) + '\n',
    'a'.repeat(66),
    Buffer.concat([Buffer.from(owner.endpoint.token).map((byte) => byte | 128), Buffer.from('\n')]),
  ]) {
    const peer = await connect(owner.endpoint, '');
    let leaked = '';
    peer.on('data', (chunk) => {
      leaked += chunk;
    });
    const closed = new Promise((resolve) => peer.once('close', resolve));
    peer.write(auth);
    await closed;
    expect(leaked).toBe('');
  }
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  expect((await c.call('tools/list')).result.tools).toHaveLength(1);
});

it('preserves coalesced auth and MCP bytes while consuming auth only', async () => {
  const f = fixture();
  const owner = await start(f);
  const peer = await connect(owner.endpoint, '');
  const c = client(peer);
  peer.write(owner.endpoint.token + '\n' + '{"jsonrpc":"2.0","id":44,"method":"ping"}\n');
  await new Promise((resolve) => peer.once('data', resolve));
  expect(c.received).toEqual([{ jsonrpc: '2.0', id: 44, result: {} }]);
});

it('does not remove an endpoint replaced by the operator', async () => {
  const f = fixture();
  const owner = await start(f);
  fs.writeFileSync(f.endpoint, 'replacement');
  owner.host.emit('SIGTERM');
  await owner.done;
  expect(fs.readFileSync(f.endpoint, 'utf8')).toBe('replacement');
});

it('requires a terminal and refuses an existing endpoint without overwriting it', async () => {
  const f = fixture();
  broker._setDepsForTest({ available: () => false });
  expect(
    await broker.handleActionMcpReview(['--action-mcp-review', f.policy, f.request, f.endpoint]),
  ).toBe(2);
  expect(fs.existsSync(f.endpoint)).toBe(false);
  fs.writeFileSync(f.endpoint, 'operator-file');
  broker._setDepsForTest({
    available: () => true,
    watchTerminal: () => () => {},
    monitorInput: () => () => {},
    process: new EventEmitter(),
  });
  expect(
    await broker.handleActionMcpReview(['--action-mcp-review', f.policy, f.request, f.endpoint]),
  ).toBe(2);
  expect(fs.readFileSync(f.endpoint, 'utf8')).toBe('operator-file');
});

it('handles a native Writable error after readiness callback and cleans its endpoint', async () => {
  const f = fixture();
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('PRIVATE_WRITE_ERROR'));
    },
  });
  broker._setDepsForTest({
    available: () => true,
    output,
    process: new EventEmitter(),
    watchTerminal: () => () => {},
    monitorInput: () => () => {},
  });
  expect(
    await broker.handleActionMcpReview(['--action-mcp-review', f.policy, f.request, f.endpoint]),
  ).toBe(2);
  await new Promise((resolve) => setImmediate(resolve));
  expect(fs.existsSync(f.endpoint)).toBe(false);
  expect(fs.existsSync(path.join(f.dir, 'sentinel'))).toBe(false);
});

it('stops an idle broker on SIGTERM and removes its endpoint', async () => {
  const f = fixture();
  const owner = await start(f);
  owner.host.emit('SIGTERM');
  expect(await owner.done).toBe(2);
  expect(fs.existsSync(f.endpoint)).toBe(false);
});

it('bounds an idle unauthenticated peer and the overall broker lifetime', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = fixture();
  const owner = await start(f);
  const peer = await connect(owner.endpoint, '');
  const closed = new Promise((resolve) => peer.once('close', resolve));
  await vi.advanceTimersByTimeAsync(broker.LIMITS.authMs + 1);
  await closed;
  expect(fs.existsSync(f.endpoint)).toBe(true);
  await vi.advanceTimersByTimeAsync(broker.LIMITS.lifetimeMs);
  expect(await owner.done).toBe(2);
  expect(fs.existsSync(f.endpoint)).toBe(false);
});

it('closes admission after the sole authenticated connection', async () => {
  const f = fixture();
  const owner = await start(f);
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  await expect(connect(owner.endpoint)).rejects.toBeDefined();
  expect((await c.call('tools/list')).result.tools).toHaveLength(1);
});

it('disconnect after a real confirmed child starts awaits its termination', async () => {
  const f = fixture();
  f.action.args = [
    '-e',
    "require('node:fs').writeFileSync('running',String(process.pid));setTimeout(()=>require('node:fs').writeFileSync('late','bad'),2500);setTimeout(()=>{},15000)",
  ];
  fs.writeFileSync(f.request, JSON.stringify({ schemaVersion: 1, action: f.action }));
  const owner = await start(f);
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  peer.write(
    '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"aegis_execute_selected"}}\n',
  );
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(path.join(f.dir, 'running')) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(path.join(f.dir, 'running'))).toBe(true);
  const pid = Number(fs.readFileSync(path.join(f.dir, 'running'), 'utf8'));
  peer.destroy();
  await owner.done;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(fs.existsSync(path.join(f.dir, 'late'))).toBe(false);
});
it('caps pending authenticators and shuts down after the connection budget', async () => {
  const f = fixture();
  const owner = await start(f);
  const closeAfter = async (peer, bytes) => {
    const closed = new Promise((resolve) => peer.once('close', resolve));
    if (bytes) peer.write(bytes);
    await closed;
  };
  const idle = await Promise.all(
    Array.from({ length: broker.LIMITS.pending }, () => connect(owner.endpoint, '')),
  );
  const excess = await connect(owner.endpoint, '');
  await closeAfter(excess);
  await Promise.all(idle.map((peer) => closeAfter(peer, 'wrong\n')));
  for (let count = broker.LIMITS.pending + 1; count < broker.LIMITS.connections; count++) {
    const peer = await connect(owner.endpoint, '');
    await closeAfter(peer, 'wrong\n');
  }
  const final = await connect(owner.endpoint, '');
  await closeAfter(final);
  expect(await owner.done).toBe(2);
  expect(fs.existsSync(f.endpoint)).toBe(false);
});
it('rejects pre-aborted owners before terminal, server or endpoint access', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  const available = vi.fn();
  const createServer = vi.fn();
  broker._setDepsForTest({ available, createServer });
  expect(
    await broker.handleActionMcpReview(['--action-mcp-review', f.policy, f.request, f.endpoint], {
      signal: controller.signal,
    }),
  ).toBe(2);
  expect(available).not.toHaveBeenCalled();
  expect(createServer).not.toHaveBeenCalled();
  expect(fs.existsSync(f.endpoint)).toBe(false);
});

it('snapshots owner cancellation and closes idle authentication with endpoint cleanup', async () => {
  const f = fixture();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const options = { signal: controller.signal };
  const owner = await start(f, undefined, options);
  options.signal = new AbortController().signal;
  const peer = await connect(owner.endpoint, '');
  const closed = new Promise((resolve) => peer.once('close', resolve));
  controller.abort();
  expect(await owner.done).toBe(2);
  await closed;
  expect(fs.existsSync(f.endpoint)).toBe(false);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('owner cancellation aborts pending review, waits core cleanup and suppresses late approval', async () => {
  const f = fixture();
  const controller = new AbortController();
  let entered;
  let answer;
  let reviewSignal;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const owner = await start(
    f,
    (_launch, options) => {
      reviewSignal = options.signal;
      entered();
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
    { signal: controller.signal },
  );
  const peer = await connect(owner.endpoint);
  const c = client(peer);
  await c.ready();
  peer.write(
    '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"aegis_execute_selected"}}\n',
  );
  await waiting;
  controller.abort();
  expect(await owner.done).toBe(2);
  expect(reviewSignal.aborted).toBe(true);
  expect(fs.existsSync(f.endpoint)).toBe(false);
  answer(true);
  await new Promise((resolve) => setImmediate(resolve));
  expect(fs.existsSync(path.join(f.dir, 'sentinel'))).toBe(false);
  expect(c.received.some((reply) => reply.id === 7)).toBe(false);
});
