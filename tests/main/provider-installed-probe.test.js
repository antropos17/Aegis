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
