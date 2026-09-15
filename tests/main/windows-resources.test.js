import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWindowsResources } = require('../../src/main/platform/windows-resources');

const reading = { IDProcess: 42, PercentProcessorTime: 125, WorkingSet: 1048576 };
const response = (rows) => JSON.stringify({ version: 1, rows });

describe('Windows formatted-counter transport', () => {
  it.each([
    { development: false, exists: true },
    { development: false, exists: false },
    { development: true, exists: true },
  ])('resolves the authoritative executable location (%j)', async ({ development, exists }) => {
    const fs = require('node:fs'),
      path = require('node:path');
    const savedResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    const savedDefault = Object.getOwnPropertyDescriptor(process, 'defaultApp');
    const check = vi.spyOn(fs, 'existsSync').mockReturnValue(exists);
    const exec = vi.fn().mockResolvedValue(response([]));
    try {
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: '/installed/resources',
      });
      Object.defineProperty(process, 'defaultApp', { configurable: true, value: development });
      const expected = development
        ? path.join(
            path.dirname(require.resolve('../../src/main/platform/windows-resources')),
            '../../..',
            'build/sidecar/aegis-resources.exe',
          )
        : path.join('/installed/resources', 'sidecar/aegis-resources.exe');
      await createWindowsResources({ exec, mode: 'auto' }).fetch([42]);
      expect(check.mock.calls).toEqual([[expected]]);
      expect(exec.mock.calls[0][0]).toBe(exists ? expected : 'powershell.exe');
    } finally {
      check.mockRestore();
      if (savedResources) Object.defineProperty(process, 'resourcesPath', savedResources);
      else delete process.resourcesPath;
      if (savedDefault) Object.defineProperty(process, 'defaultApp', savedDefault);
      else delete process.defaultApp;
    }
  });

  it('uses one bounded helper call and preserves counters, nulls and exited-process absence', async () => {
    const rows = [reading, { IDProcess: 43, PercentProcessorTime: null, WorkingSet: 0 }];
    const exec = vi.fn().mockResolvedValue(response(rows));
    const client = createWindowsResources({ exec, resolveExe: () => '/fixed/helper.exe' });
    expect(JSON.parse(await client.fetch([42, 43, 44]))).toEqual(rows);
    expect(exec.mock.calls).toEqual([
      ['/fixed/helper.exe', ['42,43,44'], { timeout: 5000, maxBuffer: 1048576 }],
    ]);
  });

  it('does not turn an empty successful observation into a retry or stale reading', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(response([reading]))
      .mockResolvedValue(response([]));
    const client = createWindowsResources({ exec, resolveExe: () => '/helper' });
    await client.fetch([42]);
    expect(JSON.parse(await client.fetch([42]))).toEqual([]);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it.each([
    'broken',
    '{}',
    response([{ ...reading, PercentProcessorTime: -1 }]),
    response([{ ...reading, WorkingSet: false }]),
    response([{ IDProcess: 42 }]),
    response([{ ...reading, IDProcess: 99 }]),
    response([reading, reading]),
  ])('falls back on invalid helper output (%s)', async (bad) => {
    const exec = vi.fn().mockResolvedValueOnce(bad).mockResolvedValue('fallback');
    const client = createWindowsResources({ exec, resolveExe: () => '/helper' });
    expect(await client.fetch([42])).toBe('fallback');
    expect(exec.mock.calls[1][0]).toBe('powershell.exe');
    expect(exec.mock.calls[1][1].at(-1)).toContain("-Filter 'IDProcess=42'");
  });

  it('cools down failures while collecting fresh fallback data, then retries', async () => {
    let time = 0;
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
      .mockResolvedValue(response([reading]));
    const client = createWindowsResources({ exec, resolveExe: () => '/helper', now: () => time });
    expect(await client.fetch([42])).toBe('first');
    time = 59999;
    expect(await client.fetch([42])).toBe('second');
    time = 60000;
    expect(JSON.parse(await client.fetch([42]))).toEqual([reading]);
    expect(exec.mock.calls.map(([cmd]) => cmd)).toEqual([
      '/helper',
      'powershell.exe',
      'powershell.exe',
      '/helper',
    ]);
  });

  it.each([null, '/helper'])('honors rollback and missing-helper fallback (%s)', async (file) => {
    const exec = vi.fn().mockResolvedValue('fallback');
    const client = createWindowsResources({
      exec,
      resolveExe: () => file,
      mode: file ? 'powershell' : 'auto',
    });
    expect(await client.fetch([42])).toBe('fallback');
    expect(exec.mock.calls.map(([cmd]) => cmd)).toEqual(['powershell.exe']);
  });

  it('rejects untrusted PID expressions without spawning and leaves total failure visible', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('unavailable'));
    const client = createWindowsResources({ exec, resolveExe: () => null });
    await expect(client.fetch(['42 OR 1=1'])).rejects.toThrow('Invalid resource target');
    expect(exec).not.toHaveBeenCalled();
    await expect(client.fetch([42])).rejects.toThrow('unavailable');
  });
});
