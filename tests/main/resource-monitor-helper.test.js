import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(import.meta.url);
const monitor = require('../../src/main/resource-monitor');
const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  monitor._resetForTest();
  monitor._setLoggerForTest({ warn: vi.fn() });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', descriptor);
  monitor._resetForTest();
});

it('keeps identity, cache, normalization and per-record provenance on the helper path', async () => {
  let samples = 0;
  const exec = vi.fn(async (command) => {
    if (command === 'nvidia-smi') throw new Error('absent');
    if (command !== '/helper') throw new Error('unexpected fallback');
    return JSON.stringify({
      version: 1,
      rows: [
        {
          IDProcess: 42,
          PercentProcessorTime: 50,
          WorkingSet: ++samples * 1048576,
        },
      ],
    });
  });
  monitor._setExecForTest(exec, { resolveExe: () => '/helper', mode: 'auto' });
  const [first] = await monitor.getResourcesForPids([{ pid: 42, instanceId: '42:first' }]);
  const [cached] = await monitor.getResourcesForPids([{ pid: 42, instanceId: '42:first' }]);
  const [recycled] = await monitor.getResourcesForPids([{ pid: 42, instanceId: '42:second' }]);
  expect(first).toMatchObject({
    pid: 42,
    instanceId: '42:first',
    memMb: 1,
    gpu: null,
    cpu: monitor._normalizeCpu(50, os.cpus().length),
  });
  expect(cached).toEqual(first);
  expect(recycled).toMatchObject({ instanceId: '42:second', memMb: 2 });
  expect(recycled.collectionSequence).toBeGreaterThan(first.collectionSequence);
  expect(first.collectedAt).toBeGreaterThanOrEqual(first.collectionStartedAt);
  expect(samples).toBe(2);
  expect(exec.mock.calls.some(([cmd]) => cmd === 'powershell.exe')).toBe(false);
});

it('returns null measurements after both providers fail', async () => {
  const exec = vi.fn().mockRejectedValue(new Error('unavailable'));
  monitor._setExecForTest(exec, { resolveExe: () => '/helper', mode: 'auto' });
  const [record] = await monitor.getResourcesForPids([{ pid: 42, instanceId: null }]);
  expect(record).toMatchObject({ pid: 42, instanceId: null, cpu: null, memMb: null, gpu: null });
  expect(exec.mock.calls.map(([cmd]) => cmd)).toEqual(['nvidia-smi', '/helper', 'powershell.exe']);
});
