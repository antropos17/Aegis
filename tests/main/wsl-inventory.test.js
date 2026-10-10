import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createWslInventory,
  parseWslOutput,
  resolveWslExecutable,
} = require('../../src/main/wsl-inventory');
const executable = 'C:\\Windows\\System32\\wsl.exe';
const utf8 = (value) => Buffer.from(value, 'utf8');
const utf16 = (value) => Buffer.from(value, 'utf16le');

function harness(replies = [], options = {}) {
  let time = 1000;
  const children = [];
  const callbacks = [];
  const onUpdate = vi.fn();
  const execFile = vi.fn((file, args, settings, callback) => {
    const child = { kill: vi.fn(), stdin: { end: vi.fn() } };
    children.push(child);
    callbacks.push(callback);
    const reply = replies.shift();
    if (reply !== undefined)
      queueMicrotask(() =>
        callback(reply instanceof Error ? reply : null, reply, utf8('private stderr')),
      );
    return child;
  });
  const inventory = createWslInventory({
    execFile,
    now: () => time,
    platform: 'win32',
    resolveExecutable: () => executable,
    onUpdate,
    ...options,
  });
  return {
    inventory,
    execFile,
    children,
    callbacks,
    onUpdate,
    advance: (value) => {
      time = value;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('WSL host inventory', () => {
  it('reads pending cached snapshots without launching anything, then copies names only', async () => {
    const { inventory, execFile, onUpdate } = harness([utf8('Ubuntu\r\ndocker-desktop\r\n')]);
    expect(inventory.snapshot()).toEqual({
      status: 'pending',
      reason: null,
      observedAt: null,
      attemptedAt: null,
      stale: true,
      distributions: [],
    });
    expect(execFile).not.toHaveBeenCalled();
    await inventory.refresh();
    expect(inventory.snapshot()).toEqual({
      status: 'ready',
      reason: null,
      observedAt: 1000,
      attemptedAt: 1000,
      stale: false,
      distributions: ['Ubuntu', 'docker-desktop'],
    });
    inventory.snapshot().distributions.push('mutated');
    onUpdate.mock.calls[0][0].distributions[0] = 'changed';
    expect(inventory.snapshot().distributions).toEqual(['Ubuntu', 'docker-desktop']);
    expect(JSON.stringify(inventory.snapshot())).not.toMatch(/agent|pid|risk|action|private/i);
  });

  it('uses the fixed host argv, raw buffers, closed stdin and child-only UTF8 override', async () => {
    vi.stubEnv('WSL_UTF8', 'inherited');
    const { inventory, execFile, children } = harness([Buffer.alloc(0)]);
    await inventory.refresh();
    const [file, args, settings] = execFile.mock.calls[0];
    expect(file).toBe(executable);
    expect(args).toEqual(['--list', '--running', '--quiet']);
    expect(settings).toMatchObject({
      timeout: 3000,
      killSignal: 'SIGKILL',
      maxBuffer: 65536,
      encoding: 'buffer',
      windowsHide: true,
      shell: false,
      env: { WSL_UTF8: '1' },
    });
    expect(children[0].stdin.end).toHaveBeenCalledOnce();
    expect(process.env.WSL_UTF8).toBe('inherited');
    expect(children[0].kill).not.toHaveBeenCalled();
  });

  it.each(['linux', 'darwin'])('does not invoke a CLI on %s', async (platform) => {
    const resolveExecutable = vi.fn();
    const { inventory, execFile } = harness([], { platform, resolveExecutable });
    expect(await inventory.refresh()).toMatchObject({
      status: 'unavailable',
      reason: 'unsupported-platform',
      stale: true,
    });
    expect(execFile).not.toHaveBeenCalled();
    expect(resolveExecutable).not.toHaveBeenCalled();
  });

  it('fails closed when no verified system binary is available', async () => {
    const { inventory, execFile } = harness([], { resolveExecutable: () => null });
    expect(await inventory.refresh()).toMatchObject({
      status: 'unavailable',
      reason: 'cli-missing',
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('coalesces parallel calls and throttles from the attempt, even on failure', async () => {
    const h = harness();
    const first = h.inventory.refresh();
    expect(h.inventory.refresh()).toBe(first);
    await Promise.resolve();
    expect(h.execFile).toHaveBeenCalledOnce();
    h.callbacks[0](new Error('private failure'), utf8('Ubuntu'));
    expect(await first).toMatchObject({ status: 'unavailable', reason: 'runtime-unavailable' });
    h.advance(30999);
    await h.inventory.refresh();
    expect(h.execFile).toHaveBeenCalledOnce();
    h.advance(31000);
    const next = h.inventory.refresh();
    await Promise.resolve();
    expect(h.execFile).toHaveBeenCalledTimes(2);
    h.callbacks[1](null, utf8('Ubuntu'));
    await next;
  });

  it('retains dated stale names on failure and retires them on successful empty stdout', async () => {
    const h = harness([utf8('Ubuntu'), new Error('private'), Buffer.alloc(0)]);
    await h.inventory.refresh();
    h.advance(31000);
    expect(await h.inventory.refresh()).toMatchObject({
      status: 'unavailable',
      observedAt: 1000,
      distributions: ['Ubuntu'],
      stale: true,
    });
    h.advance(61000);
    expect(await h.inventory.refresh()).toMatchObject({
      status: 'ready',
      observedAt: 61000,
      distributions: [],
      stale: false,
    });
  });

  it('expires observations at 90s and treats backwards time as stale', async () => {
    const h = harness([utf8('Ubuntu')]);
    await h.inventory.refresh();
    h.advance(90999);
    expect(h.inventory.snapshot().stale).toBe(false);
    h.advance(91000);
    expect(h.inventory.snapshot().stale).toBe(true);
    h.advance(999);
    expect(h.inventory.snapshot().stale).toBe(true);
  });

  it('settles the independent deadline, kills only its child and ignores late success', async () => {
    vi.useFakeTimers();
    const h = harness();
    const result = h.inventory.refresh();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(h.children[0].kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    h.callbacks[0](null, utf8('Ubuntu'));
    expect(h.inventory.snapshot().distributions).toEqual([]);
    expect(h.onUpdate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop cancels active work, keeps old names stale and suppresses late callbacks', async () => {
    const h = harness([utf8('Ubuntu')]);
    await h.inventory.refresh();
    h.advance(31000);
    const pending = h.inventory.refresh();
    await Promise.resolve();
    h.inventory.stop();
    expect(await pending).toMatchObject({ distributions: ['Ubuntu'], stale: true });
    h.callbacks[1](null, utf8('Debian'));
    expect(h.inventory.snapshot().distributions).toEqual(['Ubuntu']);
    expect(h.children[1].kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    await h.inventory.refresh();
    h.inventory.stop();
    expect(h.execFile).toHaveBeenCalledTimes(2);
    expect(h.onUpdate).toHaveBeenCalledOnce();
  });

  it('cancels before deferred launch and allows a new query without old-owner interference', async () => {
    const h = harness();
    const cancelled = h.inventory.refresh();
    h.inventory.cancelRefresh();
    await cancelled;
    expect(h.execFile).not.toHaveBeenCalled();
    const old = h.inventory.refresh();
    await Promise.resolve();
    h.inventory.cancelRefresh();
    const fresh = h.inventory.refresh();
    await old;
    await Promise.resolve();
    expect(h.inventory.refresh()).toBe(fresh);
    h.callbacks[0](null, utf8('late'));
    h.callbacks[1](null, utf8('Debian'));
    expect(await fresh).toMatchObject({ distributions: ['Debian'], status: 'ready' });
    expect(h.onUpdate).toHaveBeenCalledOnce();
  });

  it('handles synchronous callback and thrown exec without leaking private errors', async () => {
    const sync = harness([], {
      execFile: (file, args, settings, cb) => {
        cb(null, utf8('Ubuntu'));
        return {};
      },
    });
    expect(await sync.inventory.refresh()).toMatchObject({
      status: 'ready',
      distributions: ['Ubuntu'],
    });
    const thrown = harness([], {
      execFile: () => {
        throw Object.assign(new Error('private'), { code: 'ENOENT' });
      },
    });
    expect(await thrown.inventory.refresh()).toMatchObject({ reason: 'cli-missing' });
  });

  it('settles and terminates its owned child if closing stdin fails', async () => {
    const child = {
      kill: vi.fn(),
      stdin: {
        end: () => {
          throw new Error('private');
        },
      },
    };
    const h = harness([], { execFile: () => child });
    expect(await h.inventory.refresh()).toMatchObject({ reason: 'runtime-unavailable' });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  });

  it.each([
    ['ENOENT', 'cli-missing'],
    ['ETIMEDOUT', 'timeout'],
    ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'invalid-output'],
    ['EACCES', 'runtime-unavailable'],
  ])('maps %s to a fixed public reason', async (code, reason) => {
    const h = harness([Object.assign(new Error('private Ubuntu secret'), { code })]);
    expect(await h.inventory.refresh()).toMatchObject({
      status: 'unavailable',
      reason,
      distributions: [],
    });
    expect(JSON.stringify(h.inventory.snapshot())).not.toMatch(/private|secret/);
  });
});

describe('WSL output decoding and validation', () => {
  it.each([
    utf8('Ubuntu\nDebian\n'),
    utf8('\ufeffUbuntu\r\nDebian\r\n'),
    utf16('Ubuntu\r\nDebian\r\n'),
    utf16('\ufeffUbuntu\nDebian\n'),
  ])('accepts UTF8 and legacy UTF16LE %j', (bytes) => {
    expect(parseWslOutput(bytes)).toEqual(['Ubuntu', 'Debian']);
  });
  it('accepts names with Unicode and internal spaces without converting them', () => {
    expect(parseWslOutput(utf8('Ubuntu Dev\n测试\nDistro-24.04'))).toEqual([
      'Ubuntu Dev',
      '测试',
      'Distro-24.04',
    ]);
    expect(parseWslOutput(utf16('\ufeff测试'))).toEqual(['测试']);
    expect(parseWslOutput(utf16('测试\r\n'))).toEqual(['测试']);
  });
  it('accepts only exact successful empty output and the maximum row count', () => {
    expect(parseWslOutput(Buffer.alloc(0))).toEqual([]);
    expect(parseWslOutput(utf8('\ufeff'))).toEqual([]);
    expect(
      parseWslOutput(utf8(Array.from({ length: 128 }, (_, i) => `Distro-${i}`).join('\n'))),
    ).toHaveLength(128);
  });
  it.each([
    'Ubuntu\nubuntu',
    'é\ne\u0301',
    '* Ubuntu',
    'Ubuntu (Default)',
    ' NAME STATE VERSION',
    'Ubuntu\tRunning\t2',
    'Ubuntu\n\nDebian',
    '\n',
    'Ubuntu\n\n',
    ' Ubuntu',
    'Ubuntu ',
    'Ubuntu\rDebian',
    'Ubuntu\x1b[31m',
    'Ubuntu\u202e',
    'Ubuntu\u2028Debian',
    '/Ubuntu',
    'Ubuntu: running',
    'Distro  Dev',
    'x'.repeat(257),
    Array.from({ length: 129 }, (_, i) => `Distro-${i}`).join('\n'),
  ])('rejects malformed/decorated/duplicate names %j', (text) => {
    expect(parseWslOutput(utf8(text))).toBeNull();
  });
  it.each([
    Buffer.from([0xc3, 0x28]),
    Buffer.from([0xff, 0xfe, 0x41]),
    Buffer.from([0xfe, 0xff, 0, 65]),
    utf8('AB\0D'),
    utf8('abcdefg\0'),
    utf16('\ufeff\ud800'),
    Buffer.alloc(65537),
    'Ubuntu',
  ])('rejects invalid/bounded raw bytes %j', (bytes) => {
    expect(parseWslOutput(bytes)).toBeNull();
  });
  it('publishes invalid-output without partial accepted names', async () => {
    const h = harness([utf8('Ubuntu\n* Debian')]);
    expect(await h.inventory.refresh()).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-output',
      distributions: [],
    });
  });
});

describe('fixed system executable admission', () => {
  function filesFixture() {
    const files = {
      lstatSync: vi.fn((location) => ({
        isDirectory: () => !location.endsWith('.exe'),
        isFile: () => location.endsWith('.exe'),
        isSymbolicLink: () => false,
        size: 256,
      })),
      openSync: vi.fn(() => 3),
      closeSync: vi.fn(),
      readSync: vi.fn((fd, buffer, offset, count, position) => {
        if (position === 0) {
          buffer.writeUInt16LE(0x5a4d, 0);
          buffer.writeUInt32LE(128, 60);
        } else buffer.writeUInt32LE(0x00004550, 0);
        return count;
      }),
    };
    return files;
  }
  const runtime = { platform: 'win32', arch: 'x64', env: { SystemRoot: 'C:\\Windows' } };
  it('admits only the fixed PE system file and closes the bounded header descriptor', () => {
    const files = filesFixture();
    expect(resolveWslExecutable(runtime, files)).toBe(executable);
    expect(files.openSync).toHaveBeenCalledExactlyOnceWith(executable, 'r');
    expect(files.readSync.mock.calls.map((call) => call[3])).toEqual([64, 4]);
    expect(files.closeSync).toHaveBeenCalledExactlyOnceWith(3);
    expect(resolveWslExecutable({ ...runtime, arch: 'ia32' }, filesFixture())).toBe(
      'C:\\Windows\\Sysnative\\wsl.exe',
    );
  });
  it.each(['C:\\evil', 'X:\\Windows', 'C:\\Windows\\..\\evil', undefined])(
    'rejects alternate root %j without filesystem lookup',
    (SystemRoot) => {
      const files = filesFixture();
      expect(resolveWslExecutable({ ...runtime, env: { SystemRoot } }, files)).toBeNull();
      expect(files.lstatSync).not.toHaveBeenCalled();
    },
  );
  it('rejects reparse files, invalid PE and inaccessible files without PATH fallback', () => {
    const linked = filesFixture();
    linked.lstatSync.mockReturnValue({
      isDirectory: () => true,
      isFile: () => true,
      isSymbolicLink: () => true,
    });
    expect(resolveWslExecutable(runtime, linked)).toBeNull();
    const invalid = filesFixture();
    invalid.readSync.mockImplementation((fd, buf, offset, count) => count);
    expect(resolveWslExecutable(runtime, invalid)).toBeNull();
    expect(invalid.closeSync).toHaveBeenCalledOnce();
    const missing = filesFixture();
    missing.lstatSync.mockImplementation(() => {
      throw new Error('private');
    });
    expect(resolveWslExecutable(runtime, missing)).toBeNull();
  });
});
