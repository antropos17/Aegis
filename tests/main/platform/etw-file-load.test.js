import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReadPhase } from '../../../scripts/etw-file-workload.mjs';
import { runFileLoad } from '../../../scripts/etw-file-load.mjs';

const fixtures = [];
function fixture(bytes = 4096) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-load-test-'));
  fixtures.push(directory);
  const file = path.join(directory, 'private-fixture.dat');
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true });
});

describe('bounded ETW fixture workload', () => {
  it('rejects a load request without explicit live mode and rejects synthetic/live mixing', () => {
    const script = fileURLToPath(new URL('../../../scripts/verify-etw-file.mjs', import.meta.url));
    for (const [args, error] of [
      [['--load-check'], '--load-check requires --live'],
      [['--load-check', '--live', '--loss-check'], '--loss-check is synthetic'],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(error);
    }
  });

  it('paces complete reads without modifying the fixture', async () => {
    const file = fixture();
    const before = fs.readFileSync(file);
    const result = await runReadPhase(file, { operations: 6, batch: 2, rate: 100 });
    expect(result.completed).toBe(6);
    expect(result.bytesRead).toBe(24576);
    expect(result.durationMs).toBeGreaterThanOrEqual(60);
    expect(result.achievedOperationsPerSecond).toBeLessThanOrEqual(100);
    expect(result.maxBatchLatenessMs).toBeGreaterThanOrEqual(0);
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it('closes the current descriptor after a short read and rejects partial work', async () => {
    const file = fixture(4095);
    const close = vi.spyOn(fs, 'closeSync');
    await expect(runReadPhase(file, { operations: 5, batch: 2, rate: null })).rejects.toThrow(
      'workload-fixture-mismatch',
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { operations: 20001 },
    { operations: 0 },
    { operations: 1.5 },
    { batch: 0 },
    { batch: 251 },
    { rate: 0 },
    { rate: 1001 },
  ])('rejects unbounded or invalid phase parameters before opening a file %#', async (patch) => {
    await expect(
      runReadPhase('must-not-be-opened', {
        operations: 5,
        batch: 2,
        rate: null,
        ...patch,
      }),
    ).rejects.toThrow('workload-invalid-phase');
  });

  it('runs the full fixed volume in a worker while the parent keeps observing', async () => {
    const file = fixture();
    const report = {};
    let observations = 0;
    await runFileLoad(
      file,
      () => {
        observations++;
      },
      report,
    );
    expect(report.completed).toBe(true);
    expect(report.phases).toHaveLength(6);
    expect(report.phases.map((phase) => phase.completed)).toEqual([
      2000, 20000, 2000, 20000, 2000, 20000,
    ]);
    expect(report.phases.reduce((sum, phase) => sum + phase.bytesRead, 0)).toBe(270336000);
    expect(observations).toBeGreaterThan(100);
    expect(JSON.stringify(report)).not.toContain(file);
  }, 60000);

  it('terminates its worker when the sensor check fails and retains incomplete status', async () => {
    const report = {};
    await expect(
      runFileLoad(
        fixture(),
        () => {
          throw new Error('private-diagnostic');
        },
        report,
      ),
    ).rejects.toThrow('workload-sensor-failed');
    expect(report.completed).toBe(false);
  });

  it('does not copy a worker filesystem error or path into the report', async () => {
    const file = fixture();
    fs.unlinkSync(file);
    const report = {};
    await expect(runFileLoad(file, () => {}, report)).rejects.toThrow('workload-worker-failed');
    expect(report.completed).toBe(false);
    expect(JSON.stringify(report)).not.toContain(file);
  });
});
