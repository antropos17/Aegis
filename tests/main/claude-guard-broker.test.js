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
    expect(calls).toHaveLength(3);
    expect(calls[0].path).toBe('/claim/' + SESSION);
    expect(JSON.parse(calls[0].text)).toEqual({ code: '000123', nonce: '12'.repeat(16) });
    expect(calls[0].authorization).toBeUndefined();
    expect(calls[0].text).not.toContain(KEY);
    expect(calls[1]).toEqual({
      path: '/start/' + SESSION,
      authorization: 'Bearer ' + TOKEN,
      text: '{}',
    });
    expect(calls[2]).toEqual({
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

  it('does not launch when the confirmed profile fails revalidation immediately before start', async () => {
    await listen((request, reply) => {
      let text = '';
      request.on('data', (chunk) => (text += chunk));
      request.on('end', () => {
        calls.push({ path: request.url, authorization: request.headers.authorization });
        if (request.url.startsWith('/claim/'))
          reply.end(JSON.stringify(response(JSON.parse(text))));
        else {
          reply.statusCode = request.url.startsWith('/start/') ? 403 : 204;
          reply.end();
        }
      });
    });
    expect(
      await broker.handleClaudeGuardSession(
        ['--claude-guard-session', String(port), SESSION],
        (line) => output.push(line),
      ),
    ).toBe(2);
    expect(spawned).not.toHaveBeenCalled();
    expect(calls.map((call) => call.path)).toEqual([
      '/claim/' + SESSION,
      '/start/' + SESSION,
      '/finish/' + SESSION,
    ]);
    expect(output.join(' ')).toContain('the session did not start');
    expect(output.join(' ')).not.toContain(TOKEN);
  });

  it.each(['rejected', 'timed-out'])(
    'reports uncertain reporting closure after a successful child and %s finish acknowledgment',
    async (kind) => {
      await listen((request, reply) => {
        let text = '';
        request.on('data', (chunk) => {
          text += chunk;
        });
        request.on('end', () => {
          calls.push(request.url);
          if (request.url.startsWith('/claim/'))
            reply.end(JSON.stringify(response(JSON.parse(text))));
          else if (request.url.startsWith('/start/')) {
            reply.statusCode = 204;
            reply.end();
          } else if (kind === 'rejected') {
            reply.statusCode = 503;
            reply.end();
          }
          // An unanswered finish exercises the real bounded control-report deadline.
        });
      });
      expect(
        await broker.handleClaudeGuardSession(
          ['--claude-guard-session', String(port), SESSION],
          (line) => output.push(line),
        ),
      ).toBe(2);
      expect(spawned).toHaveBeenCalledOnce();
      expect(calls).toEqual(['/claim/' + SESSION, '/start/' + SESSION, '/finish/' + SESSION]);
      expect(output).toContain(
        'Claude Guard reporting closure is unconfirmed; action effects remain unknown. Do not repeat the attempt without a fresh review.',
      );
      expect(output.join(' ')).not.toContain('the session did not start');
      expect(output.join(' ')).not.toContain(TOKEN);
      expect(output.join(' ')).not.toContain(KEY);
    },
  );

  it.each(['false', 'missing', 'exception'])(
    'never retries a completed child after a %s finish result',
    async (kind) => {
      const finish = vi.fn(async () => {
        if (kind === 'exception') throw Error('PRIVATE_FINISH_ERROR');
        return kind === 'false' ? false : undefined;
      });
      broker._setDepsForTest({
        terminal: () => true,
        readKey: async () => KEY,
        randomInt: () => 123,
        randomBytes: () => Buffer.alloc(16, 0x12),
        claim: async (_port, _session, code, nonce) => response({ code, nonce }),
        startReport: async () => true,
        finishReport: finish,
        spawn: spawned,
      });
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (line) =>
          output.push(line),
        ),
      ).toBe(2);
      expect(spawned).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledOnce();
      expect(output).toContain(
        'Claude Guard reporting closure is unconfirmed; action effects remain unknown. Do not repeat the attempt without a fresh review.',
      );
      expect(output.join(' ')).not.toContain('PRIVATE_FINISH_ERROR');
      expect(output.join(' ')).not.toContain('session was not confirmed');
    },
  );

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
        this.isRaw = value;
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
      startReport: async () => true,
      finishReport: async () => true,
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
    const finishReport = vi.fn(async () => true);
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
      startReport: async () => true,
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

  it.each([
    ['synchronous', false],
    ['asynchronous', false],
    ['asynchronous', true],
  ])('retains cleanup uncertainty after a %s kill error (close=%s)', async (timing, closes) => {
    const signals = new EventEmitter();
    const child = new EventEmitter();
    child.kill = vi.fn(() => {
      const emitError = () => {
        child.emit('error', Error('PRIVATE_KILL_ERROR'));
        if (closes) setImmediate(() => child.emit('close', 0));
      };
      if (timing === 'synchronous') emitError();
      else setImmediate(emitError);
      return false;
    });
    const finishReport = vi.fn(async () => true);
    const spawn = vi.fn(() => {
      setImmediate(() => signals.emit('SIGTERM'));
      return child;
    });
    broker._setDepsForTest({
      terminal: () => true,
      readKey: async () => KEY,
      randomInt: () => 123,
      randomBytes: () => Buffer.alloc(16, 0x12),
      claim: async (_port, _session, code, nonce) => response({ code, nonce }),
      startReport: async () => true,
      finishReport,
      cleanupMs: 50,
      signals,
      spawn,
    });
    expect(
      await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (line) =>
        output.push(line),
      ),
    ).toBe(2);
    expect(spawn).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(finishReport).toHaveBeenCalledOnce();
    const warning = 'Claude child cleanup is unconfirmed; descendant cleanup is not verified.';
    if (closes) expect(output).not.toContain(warning);
    else expect(output).toContain(warning);
    expect(output.join(' ')).not.toContain('PRIVATE_KILL_ERROR');
    expect(output.join(' ')).not.toContain(TOKEN);
    expect(signals.listenerCount('SIGINT')).toBe(0);
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

  describe('Windows Electron console handles', () => {
    let modes, closedReads, files, signals, terminal, options;

    beforeEach(() => {
      modes = [];
      closedReads = [];
      signals = new EventEmitter();
      files = {
        openSync: vi.fn().mockReturnValueOnce(91).mockReturnValueOnce(92),
        closeSync: vi.fn(),
      };
      class FakeReadStream extends EventEmitter {
        constructor(fd) {
          super();
          this.fd = fd;
          this.isRaw = false;
        }
        setRawMode(value) {
          this.isRaw = value;
          modes.push(value);
        }
        pause() {}
        unref() {}
        resume() {
          setImmediate(() => this.emit('data', Buffer.from('1234-5678-90ab-cdef-1234-5678\r')));
        }
        destroy() {
          closedReads.push(this.fd);
          setImmediate(() => this.emit('close'));
        }
      }
      terminal = {
        isatty: vi.fn((fd) => fd === 1 || fd === 91 || fd === 92),
        ReadStream: FakeReadStream,
      };
      options = {
        runtime: { platform: 'win32', versions: { electron: '45.0.0' } },
        tty: terminal,
        fs: files,
        signals,
        randomInt: () => 123,
        randomBytes: () => Buffer.alloc(16, 0x12),
        claim: async (_port, _session, code, nonce) => response({ code, nonce }),
        startReport: async () => true,
        finishReport: vi.fn(async () => true),
        spawn: spawned,
      };
    });

    it('restores and closes key input, then passes a fresh console descriptor to the child', async () => {
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(0);
      expect(files.openSync.mock.calls).toEqual([
        ['\\\\.\\CONIN$', 'r+'],
        ['\\\\.\\CONIN$', 'r+'],
      ]);
      expect(modes).toEqual([true, false]);
      expect(closedReads).toEqual([91]);
      expect(spawned.mock.calls[0][2].stdio).toEqual([92, 'inherit', 'inherit']);
      expect(files.closeSync.mock.calls).toEqual([[92]]);
      expect(output.join(' ')).not.toContain(KEY);
    });

    it.each([
      'non-windows',
      'redirected-output',
      'tty-query-fails',
      'open-fails',
      'not-a-console',
      'stream-fails',
      'raw-fails',
      'resume-fails',
      'restore-fails',
    ])('refuses %s before contacting or starting Claude', async (kind) => {
      if (kind === 'non-windows')
        options.runtime = { platform: 'linux', versions: { electron: '45.0.0' } };
      if (kind === 'redirected-output') terminal.isatty.mockImplementation(() => false);
      if (kind === 'tty-query-fails')
        terminal.isatty.mockImplementation(() => {
          throw Error('tty');
        });
      if (kind === 'open-fails')
        files.openSync.mockReset().mockImplementation(() => {
          throw Error('open');
        });
      if (kind === 'not-a-console') terminal.isatty.mockImplementation((fd) => fd === 1);
      if (kind === 'stream-fails')
        terminal.ReadStream = class {
          constructor() {
            throw Error('stream');
          }
        };
      if (kind === 'raw-fails')
        terminal.ReadStream = class extends EventEmitter {
          pause() {}
          destroy() {
            closedReads.push(91);
            setImmediate(() => this.emit('close'));
          }
          setRawMode() {
            throw Error('raw');
          }
        };
      if (kind === 'resume-fails')
        terminal.ReadStream = class extends terminal.ReadStream {
          resume() {
            throw Error('resume');
          }
        };
      if (kind === 'restore-fails')
        terminal.ReadStream = class extends terminal.ReadStream {
          setRawMode(value) {
            if (!value) throw Error('restore');
            super.setRawMode(value);
          }
        };
      options.claim = vi.fn();
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(options.claim).not.toHaveBeenCalled();
      expect(spawned).not.toHaveBeenCalled();
      if (kind === 'not-a-console' || kind === 'stream-fails')
        expect(files.closeSync).toHaveBeenCalledWith(91);
      if (kind === 'raw-fails') expect(closedReads).toEqual([91]);
      if (kind === 'resume-fails' || kind === 'restore-fails') expect(closedReads).toEqual([91]);
    });

    it('restores and closes the owned input when terminal confirmation is interrupted', async () => {
      terminal.ReadStream = class extends terminal.ReadStream {
        resume() {
          setImmediate(() => signals.emit('SIGINT'));
        }
      };
      options.claim = vi.fn();
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(modes).toEqual([true, false]);
      expect(closedReads).toEqual([91]);
      expect(options.claim).not.toHaveBeenCalled();
      expect(spawned).not.toHaveBeenCalled();
    });

    it.each([
      ['owned', 'throw'],
      ['inherited', 'throw'],
      ['owned', 'mismatch'],
      ['inherited', 'mismatch'],
    ])('attempts to restore %s console mode after a raw setup %s', async (kind, failure) => {
      let unreferenced = false;
      terminal.ReadStream = class extends terminal.ReadStream {
        setRawMode(value) {
          modes.push(value);
          if (value && failure === 'mismatch') return;
          this.isRaw = value;
          if (value) throw Error('raw-after-change');
        }
        unref() {
          unreferenced = true;
        }
      };
      if (kind === 'inherited') {
        options.runtime = { platform: 'win32', versions: {} };
        terminal.isatty.mockImplementation((fd) => fd === 0 || fd === 1);
      }
      options.claim = vi.fn();
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(modes).toEqual([true, false]);
      expect(unreferenced).toBe(true);
      expect(closedReads).toEqual(kind === 'owned' ? [91] : []);
      expect(options.claim).not.toHaveBeenCalled();
      expect(spawned).not.toHaveBeenCalled();
    });

    it('closes key input and refuses a launch when a fresh child console cannot open', async () => {
      files.openSync
        .mockReset()
        .mockReturnValueOnce(91)
        .mockImplementationOnce(() => {
          throw Error('open');
        });
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(closedReads).toEqual([91]);
      expect(spawned).not.toHaveBeenCalled();
      expect(options.finishReport).toHaveBeenCalledOnce();
    });

    it('closes key input on a bad proof and revokes the unused capability', async () => {
      options.claim = async (_port, _session, code, nonce) => ({
        ...response({ code, nonce }),
        proof: '0'.repeat(64),
      });
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(closedReads).toEqual([91]);
      expect(files.openSync).toHaveBeenCalledOnce();
      expect(spawned).not.toHaveBeenCalled();
      expect(options.finishReport).toHaveBeenCalledOnce();
    });

    it('closes the child descriptor if spawn fails', async () => {
      options.spawn = vi.fn(() => {
        throw Error('launch');
      });
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(closedReads).toEqual([91]);
      expect(files.closeSync).toHaveBeenCalledWith(92);
      expect(options.finishReport).toHaveBeenCalledOnce();
    });

    it('stops only the owned child and reports an unconfirmed parent descriptor close', async () => {
      const child = new EventEmitter();
      child.kill = vi.fn(() => {
        setImmediate(() => child.emit('close', null));
      });
      options.spawn = vi.fn(() => child);
      files.closeSync.mockImplementation(() => {
        throw Error('close');
      });
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(child.kill).toHaveBeenCalledOnce();
      expect(output).toContain('Console input handle closure is unconfirmed.');
      expect(options.finishReport).toHaveBeenCalledOnce();
    });

    it('reports unconfirmed descriptor close even when process creation fails', async () => {
      options.spawn = vi.fn(() => {
        throw Error('launch');
      });
      files.closeSync.mockImplementation(() => {
        throw Error('close');
      });
      broker._setDepsForTest(options);
      expect(
        await broker.handleClaudeGuardSession(['--claude-guard-session', '321', SESSION], (x) =>
          output.push(x),
        ),
      ).toBe(2);
      expect(output).toContain('Console input handle closure is unconfirmed.');
      expect(options.finishReport).toHaveBeenCalledOnce();
    });
  });
});
