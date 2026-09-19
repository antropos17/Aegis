import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough, Writable, Duplex } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-mcp-stdio');
const args = ['--action-mcp-stdio', 'PRIVATE_POLICY', 'PRIVATE_REQUEST'];
const streams = [];
const directories = [];
const line = (message) => JSON.stringify(message) + '\n';
const tick = () => new Promise(setImmediate);
function setup(receive = async () => null, outputOverride) {
  const input = new PassThrough();
  const output = outputOverride || new PassThrough();
  let text = '';
  if (!outputOverride)
    output.on('data', (chunk) => {
      text += chunk;
    });
  const session = { receive: vi.fn(receive), close: vi.fn() };
  const createSession = vi.fn(() => session);
  api._setDepsForTest({ input, output, createSession });
  streams.push(input, output);
  return {
    input,
    output,
    session,
    createSession,
    text: () => text,
    run: (argv = args) => api.handleActionMcpStdio(argv),
  };
}
afterEach(() => {
  api._resetForTest();
  for (const stream of streams.splice(0)) stream.destroy();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('bounded MCP stdio framing', () => {
  it('passes only the selected catalog to the session owner', async () => {
    const t = setup();
    const done = t.run(['--action-mcp-catalog-stdio', 'PRIVATE_CATALOG']);
    expect(t.createSession).toHaveBeenCalledExactlyOnceWith({ catalogPath: 'PRIVATE_CATALOG' });
    t.input.end();
    expect(await done).toBe(0);
  });

  it('rejects mixed catalog and single-action transport selection before session creation', async () => {
    const t = setup();
    expect(
      await api.serveActionMcp({
        input: t.input,
        output: t.output,
        catalogPath: 'PRIVATE_CATALOG',
        policyPath: 'PRIVATE_POLICY',
        requestPath: 'PRIVATE_REQUEST',
      }),
    ).toBe(2);
    expect(t.createSession).not.toHaveBeenCalled();
  });
  it('supports an owner-supplied executor and aborts admission while awaiting active cleanup', async () => {
    let complete;
    const t = setup(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const controller = new AbortController();
    const execute = vi.fn();
    let finished = false;
    const pending = api
      .serveActionMcp({
        input: t.input,
        output: t.output,
        policyPath: 'policy',
        requestPath: 'request',
        execute,
        signal: controller.signal,
      })
      .then((code) => {
        finished = true;
        return code;
      });
    t.input.write('{}\n');
    controller.abort();
    await tick();
    expect(t.createSession).toHaveBeenCalledExactlyOnceWith({
      policyPath: 'policy',
      requestPath: 'request',
      execute,
    });
    expect(t.session.close).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    complete({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await pending).toBe(2);
    expect(t.text()).toBe('');
  });

  it('can read and write the same duplex without reflecting responses back as input', async () => {
    let written = '';
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        written += chunk;
        callback();
      },
    });
    streams.push(socket);
    const t = setup(async () => ({ jsonrpc: '2.0', id: 1, result: {} }));
    const pending = api.serveActionMcp({
      input: socket,
      output: socket,
      policyPath: 'policy',
      requestPath: 'request',
    });
    socket.push('{}\n');
    await tick();
    socket.push(null);
    expect(await pending).toBe(0);
    expect(t.session.receive).toHaveBeenCalledOnce();
    expect(JSON.parse(written)).toMatchObject({ id: 1, result: {} });
  });

  it('rejects an already-aborted transport before creating a session', async () => {
    const t = setup();
    const pending = api.serveActionMcp({
      input: t.input,
      output: t.output,
      policyPath: 'policy',
      requestPath: 'request',
      signal: AbortSignal.abort(),
    });
    expect(await pending).toBe(2);
    expect(t.createSession).not.toHaveBeenCalled();
  });
  it('decodes split UTF-8 frames and emits only newline protocol responses', async () => {
    const t = setup(async () => ({ jsonrpc: '2.0', id: 1, result: {} }));
    const done = t.run();
    const raw = Buffer.from(line({ jsonrpc: '2.0', id: 1, method: 'PRIVATE_é' }));
    const split = raw.indexOf(Buffer.from('é')) + 1;
    t.input.write(raw.subarray(0, split));
    t.input.write(raw.subarray(split));
    await tick();
    t.input.end();
    expect(await done).toBe(0);
    expect(t.session.receive).toHaveBeenCalledExactlyOnceWith({
      jsonrpc: '2.0',
      id: 1,
      method: 'PRIVATE_é',
    });
    expect(t.text()).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    expect(t.session.close).toHaveBeenCalledOnce();
  });

  it.each([
    Buffer.from('{PRIVATE\n'),
    Buffer.from([0xff, 10]),
    Buffer.alloc(api.LIMITS.lineBytes + 1, 65),
  ])('closes on malformed or oversized frame %# without disclosing bytes', async (raw) => {
    const t = setup();
    const done = t.run();
    t.input.write(raw);
    expect(await done).toBe(2);
    expect(t.session.receive).not.toHaveBeenCalled();
    expect(t.text()).toBe('');
    expect(t.session.close).toHaveBeenCalledOnce();
  });

  it('does not execute an unterminated frame at EOF', async () => {
    const t = setup();
    const done = t.run();
    t.input.end('{"jsonrpc":"2.0","method":"PRIVATE"}');
    expect(await done).toBe(2);
    expect(t.session.receive).not.toHaveBeenCalled();
  });

  it('caps the lifetime frame count without queueing extra work', async () => {
    const t = setup();
    const done = t.run();
    for (let i = 0; i <= api.LIMITS.frames; i++) {
      t.input.write('{}\n');
      await tick();
    }
    expect(await done).toBe(2);
    expect(t.session.receive).toHaveBeenCalledTimes(api.LIMITS.frames);
  });

  it('caps cumulative bytes across individually bounded frames', async () => {
    const t = setup();
    const done = t.run();
    const raw = line({ padding: 'P'.repeat(14000) });
    const expected = Math.floor(api.LIMITS.inputBytes / Buffer.byteLength(raw));
    for (let i = 0; i <= expected; i++) {
      t.input.write(raw);
      await tick();
    }
    expect(await done).toBe(2);
    expect(t.session.receive).toHaveBeenCalledTimes(expected);
    expect(t.text()).toBe('');
  });

  it('closes on excessive concurrent requests and still waits for accepted operations', async () => {
    let complete;
    const work = new Promise((resolve) => {
      complete = resolve;
    });
    const t = setup(() => work);
    let resolved = false;
    const done = t.run().then((code) => {
      resolved = true;
      return code;
    });
    t.input.write('{}\n'.repeat(api.LIMITS.pending + 1));
    await tick();
    expect(t.session.receive).toHaveBeenCalledTimes(api.LIMITS.pending);
    expect(t.session.close).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    complete(null);
    expect(await done).toBe(2);
  });

  it('waits for an active operation to settle after EOF before returning', async () => {
    let complete;
    const t = setup(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    let resolved = false;
    const done = t.run().then((code) => {
      resolved = true;
      return code;
    });
    t.input.end('{}\n');
    await tick();
    expect(t.session.close).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    complete({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await done).toBe(0);
    expect(t.text()).toBe('');
  });

  it('redacts synchronous and asynchronous session failures', async () => {
    for (const receive of [
      () => {
        throw new Error('PRIVATE_THROW');
      },
      async () => {
        throw new Error('PRIVATE_REJECTION');
      },
    ]) {
      const t = setup(receive);
      const done = t.run();
      t.input.write('{}\n');
      expect(await done).toBe(2);
      expect(t.text()).toBe('');
    }
  });

  it('bounds session lifetime and revokes admission', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    const done = t.run();
    await vi.advanceTimersByTimeAsync(api.LIMITS.lifetimeMs);
    expect(await done).toBe(2);
    expect(t.session.close).toHaveBeenCalledOnce();
    expect(t.input.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[], ['--action-mcp-stdio'], [...args, 'PRIVATE_EXTRA']].map((argv) => [argv]))(
    'rejects invalid CLI arguments %# with no protocol or error disclosure',
    async (argv) => {
      const t = setup();
      expect(await t.run(argv)).toBe(2);
      expect(t.createSession).not.toHaveBeenCalled();
      expect(t.text()).toBe('');
    },
  );
});

describe('bounded protocol output and stream failures', () => {
  it('closes when undrained responses exceed the output budget', async () => {
    const output = new Writable({ write(_chunk, _encoding, _callback) {} });
    const t = setup(async () => ({ jsonrpc: '2.0', id: 1, result: 'R'.repeat(20000) }), output);
    const done = t.run();
    for (let i = 0; i < 4; i++) {
      t.input.write('{}\n');
      await tick();
    }
    expect(await done).toBe(2);
    expect(output.writableLength).toBeLessThanOrEqual(api.LIMITS.outputBytes);
    expect(t.session.close).toHaveBeenCalledOnce();
  });

  it('bounds final drain when the peer stops reading stdout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const output = new Writable({ write(_chunk, _encoding, _callback) {} });
    const t = setup(async () => ({ jsonrpc: '2.0', id: 1, result: {} }), output);
    const done = t.run();
    t.input.write('{}\n');
    await tick();
    t.input.end();
    await tick();
    await vi.advanceTimersByTimeAsync(api.LIMITS.drainMs);
    expect(await done).toBe(2);
    expect(output.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('absorbs queued input errors after immediate argument rejection', async () => {
    const t = setup();
    t.input.destroy(new Error('PRIVATE_INPUT_ERROR'));
    expect(await t.run([])).toBe(2);
    await tick();
    expect(t.text()).toBe('');
  });

  it('closes on stdout failure and still waits for active cleanup', async () => {
    let complete;
    const t = setup(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    let resolved = false;
    const done = t.run().then((code) => {
      resolved = true;
      return code;
    });
    t.input.write('{}\n');
    t.output.destroy(new Error('PRIVATE_OUTPUT_ERROR'));
    await tick();
    expect(t.session.close).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    complete({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await done).toBe(2);
    expect(t.text()).toBe('');
  });
});

function nativeFixture(
  code = "require('node:fs').writeFileSync('sentinel','ok');console.log('PRIVATE_OUTPUT')",
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mcp-stdio-'));
  directories.push(directory);
  const policyPath = path.join(directory, 'PRIVATE_POLICY.json');
  const requestPath = path.join(directory, 'PRIVATE_REQUEST.json');
  const action = {
    executable: process.execPath,
    cwd: directory,
    args: ['-e', code],
    env:
      process.platform === 'win32'
        ? {
            SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT,
            TEMP: directory,
            TMP: directory,
          }
        : {},
  };
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'allow' }],
    }),
  );
  return { directory, policyPath, requestPath };
}
function nativeLaunch(argv) {
  const child = spawn(process.execPath, ['src/main/main.js', ...argv], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const messages = [];
  let buffer = '';
  const waiters = new Map();
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      messages.push(message);
      waiters.get(message.id)?.(message);
      waiters.delete(message.id);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill(), 10000);
  const done = once(child, 'close').then(([code]) => {
    clearTimeout(timer);
    return { code, stdout, stderr, messages };
  });
  const request = (message) =>
    new Promise((resolve, reject) => {
      waiters.set(message.id, resolve);
      done.then(() => {
        if (waiters.has(message.id)) reject(new Error('missing-protocol-response'));
      });
      child.stdin.write(line(message));
    });
  return { child, done, request };
}
async function nativeStatus(client, id) {
  const reply = await client.request({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'aegis_route_status', arguments: {} },
  });
  expect(reply.result.isError).toBe(false);
  const status = reply.result.structuredContent;
  expect(JSON.parse(reply.result.content[0].text)).toEqual(status);
  expect(status).toMatchObject({
    schemaVersion: 1,
    mode: 'action-route-status',
    scope: 'current-mcp-connection',
    authorization: 'none',
    control: 'direct-child-only',
    outsideRouteCoverage: 'unknown',
    descendantControl: 'unsupported',
    blockingVerification: 'not-performed',
    providerIdentity: 'unverified',
    limits: { messages: 128, actionAttempts: 16 },
  });
  expect(JSON.stringify(status)).not.toMatch(/PRIVATE|policyPath|requestPath|executable|argv/);
  return status;
}

describe('actual Node MCP entry', () => {
  it('serves status while an actual child is pending and records cancellation without claiming termination', async () => {
    const f = nativeFixture(
      "require('node:fs').writeFileSync('started',String(process.pid));setTimeout(()=>{},15000)",
    );
    const client = nativeLaunch(['--action-mcp-stdio', f.policyPath, f.requestPath]);
    let called;
    try {
      await client.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      client.child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      called = client
        .request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'aegis_execute_selected', arguments: {} },
        })
        .catch(() => null);
      const started = path.join(f.directory, 'started');
      const deadline = Date.now() + 3000;
      while (!fs.existsSync(started) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect(fs.existsSync(started)).toBe(true);
      const pid = Number(fs.readFileSync(started, 'utf8'));
      const pending = await nativeStatus(client, 3);
      expect(pending).toMatchObject({
        activity: 'owner-pending',
        actionAttempts: 1,
        ownerInvocations: 1,
        ownerSettled: 0,
        cancellationRequests: 0,
      });
      const cancellation = line({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 2 },
      });
      client.child.stdin.write(cancellation + cancellation);
      let after = await nativeStatus(client, 4);
      expect(after.cancellationRequests).toBe(1);
      expect(['cancellation-requested', 'idle']).toContain(after.activity);
      expect(after).not.toHaveProperty('termination');
      const cleanupDeadline = Date.now() + 2000;
      for (let id = 10; after.ownerSettled !== 1 && Date.now() < cleanupDeadline; id++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        after = await nativeStatus(client, id);
      }
      expect(after).toMatchObject({
        activity: 'idle',
        actionAttempts: 1,
        ownerInvocations: 1,
        ownerSettled: 1,
        ownerFailures: 0,
        cancellationRequests: 1,
      });
      expect(() => process.kill(pid, 0)).toThrow();
      client.child.stdin.end();
      const result = await client.done;
      await called;
      expect(result.code).toBe(0);
      expect(result.messages.some((message) => message.id === 2)).toBe(false);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('PRIVATE');
      expect(result.stdout).not.toContain(f.directory);
    } finally {
      client.child.kill();
      await client.done;
      await called;
    }
  }, 15000);

  it('awaits direct-child termination when stdin closes during execution', async () => {
    const f = nativeFixture(
      "require('node:fs').writeFileSync('started',String(process.pid));setTimeout(()=>process.exit(0),15000)",
    );
    const client = nativeLaunch(['--action-mcp-stdio', f.policyPath, f.requestPath]);
    try {
      await client.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      client.child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      const called = client
        .request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'aegis_execute_selected', arguments: {} },
        })
        .catch(() => null);
      const started = path.join(f.directory, 'started');
      const deadline = Date.now() + 3000;
      while (!fs.existsSync(started) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect(fs.existsSync(started)).toBe(true);
      const pid = Number(fs.readFileSync(started, 'utf8'));
      client.child.stdin.end();
      const result = await client.done;
      await called;
      expect(result.code).toBe(0);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(result.messages.map((message) => message.id)).toEqual([1]);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('PRIVATE');
    } finally {
      client.child.kill();
      await client.done;
    }
  }, 15000);

  it('initializes, lists and executes only the selected action with protocol-only stdout', async () => {
    const f = nativeFixture();
    const client = nativeLaunch(['--action-mcp-stdio', f.policyPath, f.requestPath]);
    try {
      const init = await client.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      expect(init.result).toBeDefined();
      client.child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      const listed = await client.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      expect(listed.result.tools.map((tool) => tool.name)).toEqual([
        'aegis_execute_selected',
        'aegis_route_status',
      ]);
      expect(await nativeStatus(client, 10)).toMatchObject({
        selection: 'single-action',
        selectedActionCount: 1,
        activity: 'idle',
        actionAttempts: 0,
        ownerInvocations: 0,
        ownerSettled: 0,
        ownerFailures: 0,
        selectionRejected: 0,
        cancellationRequests: 0,
        messagesObserved: 4,
      });
      const called = await client.request({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'aegis_execute_selected', arguments: {} },
      });
      expect(called.result).toBeDefined();
      expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(true);
      expect(await nativeStatus(client, 11)).toMatchObject({
        activity: 'idle',
        actionAttempts: 1,
        ownerInvocations: 1,
        ownerSettled: 1,
        ownerFailures: 0,
        selectionRejected: 0,
        cancellationRequests: 0,
        messagesObserved: 6,
      });
      client.child.stdin.end();
      const result = await client.done;
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toMatch(/PRIVATE|node_modules|electron/);
    } finally {
      client.child.kill();
      await client.done;
    }
  }, 15000);

  it('routes a native catalog to two distinct actions and keeps the initialized manifest snapshot', async () => {
    const first = nativeFixture();
    const second = nativeFixture();
    const manifest = path.join(first.directory, 'PRIVATE_CATALOG.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        actions: [
          { id: 'first', policyPath: first.policyPath, requestPath: first.requestPath },
          { id: 'second', policyPath: second.policyPath, requestPath: second.requestPath },
        ],
      }),
    );
    const client = nativeLaunch(['--action-mcp-catalog-stdio', manifest]);
    try {
      const initialized = await client.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'fixture', version: '1' },
        },
      });
      expect(initialized.error).toBeUndefined();
      client.child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      fs.writeFileSync(manifest, '{"PRIVATE_REPLACEMENT":true}');
      const listed = await client.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(listed.result.tools.map((tool) => tool.name)).toEqual([
        'aegis_action_first',
        'aegis_action_second',
        'aegis_route_status',
      ]);
      expect(await nativeStatus(client, 10)).toMatchObject({
        selection: 'catalog',
        selectedActionCount: 2,
        activity: 'idle',
        actionAttempts: 0,
        ownerInvocations: 0,
        ownerSettled: 0,
      });
      const call = (id, name, args = {}) =>
        client.request({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        });
      expect((await call(3, 'aegis_action_first', { executable: 'PRIVATE' })).error.code).toBe(
        -32602,
      );
      const a = await call(4, 'aegis_action_first');
      expect(a.result.structuredContent.execution.exitCode).toBe(0);
      expect(fs.existsSync(path.join(first.directory, 'sentinel'))).toBe(true);
      expect(fs.existsSync(path.join(second.directory, 'sentinel'))).toBe(false);
      expect((await call(4, 'aegis_action_second')).error.code).toBe(-32600);
      expect(
        (await call(5, 'aegis_action_second')).result.structuredContent.execution.exitCode,
      ).toBe(0);
      expect(fs.existsSync(path.join(second.directory, 'sentinel'))).toBe(true);
      expect(await nativeStatus(client, 11)).toMatchObject({
        selection: 'catalog',
        selectedActionCount: 2,
        activity: 'idle',
        actionAttempts: 2,
        selectionRejected: 0,
        ownerInvocations: 2,
        ownerSettled: 2,
        ownerFailures: 0,
        cancellationRequests: 0,
      });
      client.child.stdin.end();
      const result = await client.done;
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      for (const secret of ['PRIVATE', first.directory, second.directory])
        expect(result.stdout).not.toContain(secret);
    } finally {
      client.child.kill();
      await client.done;
    }
  }, 15000);

  it('revokes subsequent catalog selections after one bound action observes a configuration change', async () => {
    const first = nativeFixture();
    const second = nativeFixture();
    const manifest = path.join(first.directory, 'PRIVATE_CATALOG.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        actions: [
          { id: 'first', policyPath: first.policyPath, requestPath: first.requestPath },
          { id: 'second', policyPath: second.policyPath, requestPath: second.requestPath },
        ],
      }),
    );
    const client = nativeLaunch(['--action-mcp-catalog-stdio', manifest]);
    try {
      await client.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'fixture', version: '1' },
        },
      });
      client.child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      const original = fs.readFileSync(first.policyPath);
      fs.appendFileSync(first.policyPath, ' ');
      const denied = await client.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'aegis_action_first' },
      });
      expect(denied.result.structuredContent).toMatchObject({
        decision: 'deny',
        reason: 'configuration-changed',
        execution: { state: 'not-started' },
      });
      fs.writeFileSync(first.policyPath, original);
      const next = await client.request({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'aegis_action_second' },
      });
      expect(next.error).toEqual({ code: -32000, message: 'Configuration unavailable' });
      expect(await nativeStatus(client, 10)).toMatchObject({
        selection: 'catalog',
        selectedActionCount: 2,
        activity: 'idle',
        actionAttempts: 2,
        selectionRejected: 1,
        ownerInvocations: 1,
        ownerSettled: 1,
        ownerFailures: 0,
      });
      for (const f of [first, second])
        expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(false);
      client.child.stdin.end();
      expect((await client.done).code).toBe(0);
    } finally {
      client.child.kill();
      await client.done;
    }
  }, 15000);

  it('rejects partial frames and invalid arguments without raw output', async () => {
    for (const argv of [
      args,
      ['--action-mcp-stdio'],
      ['--action-mcp-catalog-stdio'],
      ['--action-mcp-catalog-stdio', 'PRIVATE_CATALOG', 'EXTRA'],
    ]) {
      const client = nativeLaunch(argv);
      client.child.stdin.end('{"PRIVATE":"partial');
      const result = await client.done;
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    }
  });
});
