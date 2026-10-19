import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNvidiaGpu, resolveNvidiaExecutable } = require('../../src/main/platform/nvidia-gpu');

function systemFs({ redirect = false, missing = false } = {}) {
  const stat = (file) => ({
    isSymbolicLink: () => false,
    isFile: () => file.endsWith('.exe'),
    isDirectory: () => !file.endsWith('.exe'),
  });
  return {
    realpathSync: vi.fn((file) => {
      if (missing) throw new Error('missing');
      return redirect ? 'X:\\untrusted\\nvidia-smi.exe' : file;
    }),
    lstatSync: vi.fn(stat),
    statSync: vi.fn(stat),
    accessSync: vi.fn(),
  };
}

describe('NVIDIA executable admission', () => {
  it('uses a default Windows driver path and its own directory', () => {
    const fs = systemFs();
    expect(resolveNvidiaExecutable('win32', fs)).toEqual({
      file: 'C:\\Windows\\System32\\nvidia-smi.exe',
      cwd: 'C:\\Windows\\System32',
    });
    expect(fs.realpathSync).toHaveBeenCalledExactlyOnceWith(
      'C:\\Windows\\System32\\nvidia-smi.exe',
    );
  });

  it('does not fall back to PATH when system paths are missing or redirected', () => {
    for (const fs of [systemFs({ missing: true }), systemFs({ redirect: true })]) {
      expect(resolveNvidiaExecutable('win32', fs)).toBeNull();
      expect(fs.realpathSync.mock.calls.map(([file]) => file)).toEqual([
        'C:\\Windows\\System32\\nvidia-smi.exe',
        'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
      ]);
    }
    expect(resolveNvidiaExecutable('darwin', systemFs())).toBeNull();
  });
});

function fixture(available = true) {
  const executable = { file: '/system/nvidia-smi', cwd: '/system' };
  const exec = vi.fn(async (_file, args) =>
    args[0].includes('query-gpu') ? 'NVIDIA fixture\n' : '42, 32\n43, 64\n42, [N/A]\n',
  );
  const resolveExe = vi.fn(() => (available ? executable : null));
  const warn = vi.fn();
  return { exec, resolveExe, warn, gpu: createNvidiaGpu({ exec, resolveExe, warn }) };
}

it('shares one admitted probe and uses the same absolute executable for bounded samples', async () => {
  const f = fixture();
  expect(await Promise.all([f.gpu.probe(), f.gpu.probe()])).toEqual([
    { available: true },
    { available: true },
  ]);
  expect(f.resolveExe).toHaveBeenCalledOnce();
  expect(f.exec).toHaveBeenCalledOnce();
  expect([...(await f.gpu.sample())]).toEqual([[43, 64]]);
  for (const [file, _args, options] of f.exec.mock.calls) {
    expect(file).toBe('/system/nvidia-smi');
    expect(options).toMatchObject({
      cwd: '/system',
      timeout: 8000,
      maxBuffer: 262144,
      windowsHide: true,
    });
  }
  expect(f.warn).not.toHaveBeenCalled();
});

it('preserves unavailable readings and warns once without spawning an unadmitted command', async () => {
  const f = fixture(false);
  expect(await f.gpu.probe()).toEqual({ available: false });
  expect(await f.gpu.probe()).toEqual({ available: false });
  expect(f.gpu.isAvailable()).toBe(false);
  expect((await f.gpu.sample()).size).toBe(0);
  expect(f.exec).not.toHaveBeenCalled();
  expect(f.warn).toHaveBeenCalledOnce();
});

it('does not retain an earlier per-PID reading after query failure', async () => {
  const f = fixture();
  await f.gpu.probe();
  expect((await f.gpu.sample()).get(43)).toBe(64);
  f.exec.mockRejectedValueOnce(new Error('PRIVATE_DRIVER_ERROR'));
  expect((await f.gpu.sample()).size).toBe(0);
  expect(JSON.stringify(f.warn.mock.calls)).not.toContain('PRIVATE');
});
