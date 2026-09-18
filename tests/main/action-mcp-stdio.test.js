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

describe('actual Node MCP entry', () => {
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
      expect(listed.result.tools.map((tool) => tool.name)).toEqual(['aegis_execute_selected']);
      const called = await client.request({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'aegis_execute_selected', arguments: {} },
      });
      expect(called.result).toBeDefined();
      expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(true);
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

  it('rejects partial frames and invalid arguments without raw output', async () => {
    for (const argv of [args, ['--action-mcp-stdio']]) {
      const client = nativeLaunch(argv);
      client.child.stdin.end('{"PRIVATE":"partial');
      const result = await client.done;
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    }
  });
});
