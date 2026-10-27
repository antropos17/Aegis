import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const broker = require('../../src/main/claude-guard-broker');
const KEY = '1234567890abcdef12345678';
const SESSION = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);
const selection = {
  token: TOKEN,
  executable: 'C:\\Programs\\Claude\\claude.exe',
  settings: 'C:\\Profile\\settings.json',
  cwd: 'C:\\Workspace',
};
let server, port, calls, output, spawned, inherited;

async function listen(handler) {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
}
function response(body, result = selection) {
  return {
    ...result,
    proof: createHmac('sha256', KEY)
      .update(
        JSON.stringify([
          SESSION,
          body.code,
          body.nonce,
          result.token,
          result.executable,
          result.settings,
          result.cwd,
        ]),
      )
      .digest('hex'),
  };
}
function makeChild(code = 0) {
  const child = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => child.emit('close', code));
  return child;
}
beforeEach(() => {
  calls = [];
  output = [];
  spawned = vi.fn((_exe, _args, options) => {
    inherited = { ...options.env };
    return makeChild();
  });
  broker._setDepsForTest({
    terminal: () => true,
    readKey: async () => KEY,
    randomInt: () => 123,
    randomBytes: () => Buffer.alloc(16, 0x12),
    spawn: spawned,
  });
});
afterEach(async () => {
  broker._resetForTest();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  server = null;
});

describe('Claude Guard terminal broker', () => {
  it('routes the real source entrypoint and refuses a noninteractive input', () => {
    const child = spawnSync(
      process.execPath,
      [path.resolve('src/main/main.js'), '--claude-guard-session', '1234', SESSION],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    expect(child.status).toBe(2);
    expect(child.stdout).toContain('Claude Guard requires an interactive terminal.');
    expect(child.stderr).not.toContain(KEY);
  });
  it('claims once, verifies the selected launch and sends finish without exposing credentials', async () => {
    await listen((request, reply) => {
      let text = '';
      request.on('data', (chunk) => {
        text += chunk;
      });
      request.on('end', () => {
        calls.push({ path: request.url, authorization: request.headers.authorization, text });
        if (request.url.startsWith('/claim/'))
          reply.end(JSON.stringify(response(JSON.parse(text))));
        else {
          reply.statusCode = 204;
          reply.end();
        }
      });
    });
    const status = await broker.handleClaudeGuardSession(
      ['--claude-guard-session', String(port), SESSION],
      (line) => output.push(line),
    );
    expect(status).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe('/claim/' + SESSION);
    expect(JSON.parse(calls[0].text)).toEqual({ code: '000123', nonce: '12'.repeat(16) });
    expect(calls[0].authorization).toBeUndefined();
    expect(calls[0].text).not.toContain(KEY);
    expect(calls[1]).toEqual({
      path: '/finish/' + SESSION,
      authorization: 'Bearer ' + TOKEN,
      text: '{}',
    });
    expect(spawned).toHaveBeenCalledOnce();
    const [exe, args, options] = spawned.mock.calls[0];
    expect(exe).toBe(selection.executable);
    expect(args).toEqual(['--settings', selection.settings]);
    expect(options.cwd).toBe(selection.cwd);
    expect(options.shell).toBe(false);
    expect(options.stdio).toBe('inherit');
    expect(inherited.AEGIS_CLAUDE_GUARD_PORT).toBe(String(port));
    expect(inherited.AEGIS_CLAUDE_GUARD_SESSION).toBe(SESSION);
    expect(inherited.AEGIS_CLAUDE_GUARD_CAPABILITY).toBe(TOKEN);
    expect(options.env.AEGIS_CLAUDE_GUARD_CAPABILITY).toBeUndefined();
    expect(output.join(' ')).not.toContain(KEY);
    expect(output.join(' ')).not.toContain(TOKEN);
    expect(output.join(' ')).not.toContain(selection.executable);
  });

  it.each(['wrong-proof', 'changed-path', 'extra-field', 'wrong-executable', 'invalid-token'])(
    'refuses untrusted endpoint response %s without starting a child',
    async (kind) => {
      await listen((request, reply) => {
        let text = '';
        request.on('data', (chunk) => {
          text += chunk;
        });
        request.on('end', () => {
          calls.push({ path: request.url, authorization: request.headers.authorization });
          if (request.url === '/finish/' + SESSION) {
            reply.statusCode = 204;
            reply.end();
            return;
          }
          const item = response(JSON.parse(text));
          if (kind === 'wrong-proof') item.proof = '0'.repeat(64);
          if (kind === 'changed-path') item.cwd = 'C:\\Other';
          if (kind === 'extra-field') item.surprise = true;
          if (kind === 'wrong-executable')
            Object.assign(
              item,
              response(JSON.parse(text), { ...selection, executable: 'C:\\bad.exe' }),
            );
          if (kind === 'invalid-token') item.token = 'no';
          reply.end(JSON.stringify(item));
        });
      });
      expect(
        await broker.handleClaudeGuardSession(
          ['--claude-guard-session', String(port), SESSION],
          (line) => output.push(line),
        ),
      ).toBe(2);
      expect(calls).toEqual([
        { path: '/claim/' + SESSION, authorization: undefined },
        ...(kind === 'invalid-token'
          ? []
          : [{ path: '/finish/' + SESSION, authorization: 'Bearer ' + TOKEN }]),
      ]);
      expect(spawned).not.toHaveBeenCalled();
      expect(output.join(' ')).not.toContain(KEY);
      expect(output.join(' ')).not.toContain(TOKEN);
    },
  );

  it('does not contact or launch when the terminal or key is unavailable', async () => {
    const claim = vi.fn();
    broker._setDepsForTest({
      terminal: () => false,
      readKey: async () => KEY,
      claim,
      spawn: spawned,
    });
    expect(
      await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
        output.push(x),
      ),
    ).toBe(2);
    broker._setDepsForTest({
      terminal: () => true,
      readKey: async () => null,
      claim,
      spawn: spawned,
    });
    expect(
      await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
        output.push(x),
      ),
    ).toBe(2);
    expect(claim).not.toHaveBeenCalled();
    expect(spawned).not.toHaveBeenCalled();
  });

  it('accepts a grouped key privately and restores terminal mode before spawning', async () => {
    const modes = [];
    class FakeTerminal extends EventEmitter {
      setRawMode(value) {
        modes.push(value);
      }
      pause() {}
      resume() {
        setImmediate(() => this.emit('data', Buffer.from('1234-5678-90AB-CDEF-1234-5678\r')));
      }
    }
    const terminal = { isatty: () => true, ReadStream: FakeTerminal };
    const claim = async (_port, _session, code, nonce) => response({ code, nonce });
    broker._setDepsForTest({
      terminal: () => true,
      tty: terminal,
      randomInt: () => 123,
      randomBytes: () => Buffer.alloc(16, 0x12),
      claim,
      finishReport: async () => {},
      spawn: spawned,
    });
    expect(
      await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (line) =>
        output.push(line),
      ),
    ).toBe(0);
    expect(modes).toEqual([true, false]);
    expect(output.join(' ')).not.toContain(KEY);
    expect(output.join(' ')).not.toContain('1234-5678');
    expect(spawned).toHaveBeenCalledOnce();
  });

  it('does not start the process after an incomplete response times out', async () => {
    await listen((request, reply) => {
      request.resume();
      request.on('end', () => {
        calls.push(request.url);
        reply.write('{"token":');
      });
    });
    broker._setDepsForTest({
      terminal: () => true,
      readKey: async () => KEY,
      randomInt: () => 123,
      randomBytes: () => Buffer.alloc(16, 0x12),
      claimMs: 30,
      spawn: spawned,
    });
    expect(
      await broker.handleClaudeGuardSession(
        ['--claude-guard-session', String(port), SESSION],
        (line) => output.push(line),
      ),
    ).toBe(2);
    expect(calls).toHaveLength(1);
    expect(spawned).not.toHaveBeenCalled();
  });

  it('bounds cancellation and reports unconfirmed child cleanup without claiming descendants stopped', async () => {
    const signals = new EventEmitter();
    const child = new EventEmitter();
    child.kill = vi.fn();
    const finishReport = vi.fn(async () => {});
    const claim = async (_port, _session, code, nonce) => response({ code, nonce });
    spawned = vi.fn(() => {
      setImmediate(() => signals.emit('SIGTERM'));
      return child;
    });
    broker._setDepsForTest({
      terminal: () => true,
      readKey: async () => KEY,
      randomInt: () => 123,
      randomBytes: () => Buffer.alloc(16, 0x12),
      claim,
      signals,
      cleanupMs: 20,
      finishReport,
      spawn: spawned,
    });
    expect(
      await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (line) =>
        output.push(line),
      ),
    ).toBe(2);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(output).toContain(
      'Claude child cleanup is unconfirmed; descendant cleanup is not verified.',
    );
    expect(finishReport).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it.each(['0', '65536', '01', '123abc'])(
    'refuses invalid port %s before contact',
    async (value) => {
      const claim = vi.fn();
      broker._setDepsForTest({
        terminal: () => true,
        readKey: async () => KEY,
        claim,
        spawn: spawned,
      });
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', value, SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(claim).not.toHaveBeenCalled();
    },
  );
});
