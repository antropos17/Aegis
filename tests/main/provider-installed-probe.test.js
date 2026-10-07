import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { inspectInstalledProvider } from '../../scripts/qualification/provider-installed-probe.mjs';
let root;
const streams = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const stream of streams) stream.destroy();
  streams.length = 0;
  if (root) {
    expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
    expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
    await fs.rm(root, { recursive: true });
    root = null;
  }
});
async function paths() {
  root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'aegis-provider-probe-'));
  const selected = {
    provider: 'codex',
    nativePath: path.join(root, 'codex.exe'),
    wrapperPath: path.join(root, 'codex.ps1'),
    launcherPath: path.join(root, 'codex.mjs'),
  };
  await fs.writeFile(selected.nativePath, Buffer.from([0x4d, 0x5a]));
  await fs.writeFile(selected.wrapperPath, 'fixed wrapper\r\n');
  await fs.writeFile(selected.launcherPath, 'fixed launcher\n');
  return selected;
}
function processDouble(output = 'codex-cli 0.157.1\n', beforeClose) {
  return vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    streams.push(child.stdout, child.stderr);
    child.kill = vi.fn(() => child.emit('close', null));
    if (output !== null)
      queueMicrotask(async () => {
        child.stdout.write(output);
        await beforeClose?.();
        child.emit('close', 0);
      });
    return child;
  });
}
it('hashes only explicit files, records raw/LF separately and invokes exactly one fixed --version operation', async () => {
  const selected = await paths(),
    spawnProcess = processDouble();
  const result = await inspectInstalledProvider(selected, { spawnProcess });
  expect(result).toMatchObject({
    result: 'version-observed',
    version: '0.157.1',
    spawnedProcesses: 1,
    hostHookBehavior: 'not-run',
    authentication: 'not-run',
    launchAllowed: false,
  });
  expect(result.wrapper.rawSha256).not.toBe(result.wrapper.lfSha256);
  expect(spawnProcess).toHaveBeenCalledOnce();
  const [file, args, options] = spawnProcess.mock.calls[0];
  expect(file).toBe(selected.nativePath);
  expect(args).toEqual(['--version']);
  expect(options.shell).toBe(false);
  expect(
    Object.keys(options.env).every((key) => ['TEMP', 'TMP', 'SystemRoot', 'WINDIR'].includes(key)),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain(root);
  expect(JSON.stringify(result)).not.toContain('fixed wrapper');
});

it('does not confuse same version with unchanged native identity', async () => {
  const selected = await paths();
  const first = await inspectInstalledProvider(selected, { spawnProcess: processDouble() });
  await fs.appendFile(selected.nativePath, Buffer.from([0x01]));
  const second = await inspectInstalledProvider(selected, { spawnProcess: processDouble() });
  expect(first.version).toBe(second.version);
  expect(first.native.rawSha256).not.toBe(second.native.rawSha256);
});

it('streams a native artifact at the measured installed Codex size without relaxing source limits', async () => {
  const selected = await paths();
  const size = 322515248;
  const before = await fs.lstat(selected.nativePath);
  const observed = Object.assign(Object.create(Object.getPrototypeOf(before)), before, { size });
  const lstat = fs.lstat.bind(fs);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'lstat').mockImplementation((file, ...args) =>
    file === selected.nativePath ? Promise.resolve(observed) : lstat(file, ...args),
  );
  // A virtual regular artifact exercises every real 64-KiB hash iteration
  // without allocating a 300-MiB disposable disk file. It is synthetic evidence.
  const reads = [];
  const close = vi.fn();
  vi.spyOn(fs, 'open').mockImplementation(async (file, ...args) => {
    if (file !== selected.nativePath) return open(file, ...args);
    return {
      read: async (buffer, offset, length, position) => {
        reads.push({ capacity: buffer.length, length });
        const bytesRead = Math.min(length, size - position);
        buffer.fill(0, offset, offset + bytesRead);
        return { bytesRead, buffer };
      },
      stat: async () => observed,
      close,
    };
  });
  const spawnProcess = processDouble();
  const result = await inspectInstalledProvider(selected, { spawnProcess });
  expect(result).toMatchObject({
    result: 'version-observed',
    native: { bytes: size },
    launchAllowed: false,
  });
  expect(result.native.rawSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(reads).toHaveLength(2 * Math.ceil(size / 65536));
  expect(reads.every(({ capacity, length }) => capacity === 65536 && length <= 65536)).toBe(true);
  expect(close).toHaveBeenCalledTimes(2);
  expect(spawnProcess).toHaveBeenCalledOnce();
});

it.each([
  ['nativePath', 402653185],
  ['wrapperPath', 1048577],
  ['launcherPath', 1048577],
])('refuses oversized %s metadata before any process can spawn', async (key, size) => {
  const selected = await paths();
  const lstat = fs.lstat.bind(fs);
  vi.spyOn(fs, 'lstat').mockImplementation(async (file, ...args) => {
    const observed = await lstat(file, ...args);
    return file === selected[key]
      ? Object.assign(Object.create(Object.getPrototypeOf(observed)), observed, { size })
      : observed;
  });
  const spawnProcess = processDouble();
  expect((await inspectInstalledProvider(selected, { spawnProcess })).result).toBe('unavailable');
  expect(spawnProcess).not.toHaveBeenCalled();
});

it.each(['growth', 'replacement'])(
  'refuses native %s during hashing before spawning',
  async (mode) => {
    const selected = await paths();
    const open = fs.open.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (file, ...args) => {
      const handle = await open(file, ...args);
      if (file === selected.nativePath) {
        const read = handle.read.bind(handle);
        vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
          const result = await read(...readArgs);
          if (!changed) {
            changed = true;
            if (mode === 'growth') await fs.appendFile(file, Buffer.from([1]));
            else {
              await fs.rename(file, path.join(root, 'retained-native'));
              await fs.writeFile(file, Buffer.from([0x4d, 0x5a]));
            }
          }
          return result;
        });
      }
      return handle;
    });
    const spawnProcess = processDouble();
    expect((await inspectInstalledProvider(selected, { spawnProcess })).result).toBe('unavailable');
    expect(changed).toBe(true);
    expect(spawnProcess).not.toHaveBeenCalled();
  },
);

it.each(['nativePath', 'wrapperPath', 'launcherPath'])(
  'rejects %s changing during the bounded version operation',
  async (key) => {
    const selected = await paths();
    const result = await inspectInstalledProvider(selected, {
      spawnProcess: processDouble(undefined, () => fs.appendFile(selected[key], 'changed')),
    });
    expect(result).toEqual({
      schemaVersion: 1,
      result: 'unavailable',
      hostHookBehavior: 'not-run',
      authentication: 'not-run',
      launchAllowed: false,
    });
  },
);

it('refuses missing files and arbitrary executable selectors before spawning', async () => {
  const selected = await paths(),
    spawnProcess = processDouble();
  await fs.unlink(selected.wrapperPath);
  expect((await inspectInstalledProvider(selected, { spawnProcess })).result).toBe('unavailable');
  expect(
    (
      await inspectInstalledProvider(
        { ...selected, nativePath: path.join(root, 'arbitrary.exe') },
        { spawnProcess },
      )
    ).result,
  ).toBe('unavailable');
  expect(spawnProcess).not.toHaveBeenCalled();
});

it('bounds overflow and withholds private output instead of converting it to provider evidence', async () => {
  const selected = await paths();
  const result = await inspectInstalledProvider(selected, {
    spawnProcess: processDouble('PRIVATE_OUTPUT'.repeat(400)),
  });
  expect(result.result).toBe('unavailable');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_OUTPUT');
});

it('kills a version process missing its bounded response without waiting indefinitely', async () => {
  const selected = await paths();
  vi.useFakeTimers();
  const spawned = new Promise((resolve) => {
    const base = processDouble(null);
    const spawnProcess = (...args) => {
      const child = base(...args);
      resolve(child);
      return child;
    };
    selected.pending = inspectInstalledProvider(selected, { spawnProcess });
  });
  const child = await spawned;
  await vi.advanceTimersByTimeAsync(2001);
  expect((await selected.pending).result).toBe('unavailable');
  expect(child.kill).toHaveBeenCalledOnce();
});
