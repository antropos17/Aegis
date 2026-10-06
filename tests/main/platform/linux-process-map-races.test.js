/**
 * @file linux-process-map-races.test.js
 * @description Tests for boot-ID and CLK_TCK race conditions in the Linux process-map reader.
 *
 * Exercises the createProcessMapReader({ fs, execFile }) seam directly.
 * Uses controlled promises and callbacks; no sleeps.
 *
 * Targeted run:
 *   npx vitest run tests/main/platform/linux-process-map-races.test.js \
 *     tests/main/platform/linux-process-map.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import readerModule from '../../../src/main/platform/linux-process-map.js';
import scanner from '../../../src/main/process-scanner.js';
import utils from '../../../src/main/process-utils.js';
import sessions from '../../../src/main/session-tracker.js';

const BOOT_ID_A = '11111111-1111-4111-8111-111111111111';
const BOOT_ID_B = '22222222-2222-4222-8222-222222222222';
const BOOT_PATH = '/proc/sys/kernel/random/boot_id';
const BOOT_SECONDS_A = 1700000000;
const BOOT_SECONDS_B = 1700010000;

function stat(pid, name, ppid, ticks) {
  const fields = Array(20).fill('0');
  fields[0] = 'S';
  fields[1] = String(ppid);
  fields[19] = String(ticks);
  return `${pid} (${name}) ${fields.join(' ')}\n`;
}

describe('linux-process-map boot-ID races', () => {
  let files;
  let fs;
  let exec;
  let reader;

  beforeEach(() => {
    files = new Map([
      [BOOT_PATH, BOOT_ID_A],
      ['/proc/stat', `cpu 0\nbtime ${BOOT_SECONDS_A}\n`],
      ['/proc/100/stat', stat(100, 'node', 1, 10000)],
      ['/proc/200/stat', stat(200, 'claude', 100, 20000)],
    ]);
    fs = {
      readdirSync: vi.fn(() => ['100', '200']),
      readFileSync: vi.fn((file) => {
        if (!files.has(file)) throw Object.assign(Error('gone'), { code: 'ENOENT' });
        const v = files.get(file);
        if (v instanceof Error) throw v;
        return v;
      }),
    };
    exec = vi.fn((cmd, _args, _opts, cb) => {
      if (cmd === 'getconf') cb(null, '100\n');
      else cb(null, '100 1 node\n200 100 claude\n');
    });
    reader = readerModule.createProcessMapReader({ fs, execFile: exec });
  });

  afterEach(() => {
    scanner._resetForTest();
    utils._resetForTest();
    sessions._resetForTest();
  });

  // ─── Test 1: boot ID changes between initial and final read ─────────────────

  it('boot ID changes between initial and final read: population-only fallback, null startTime, FAILED health, recovery uses new reference', async () => {
    // Prime the clock so it does not interfere with the race scenario.
    await reader.getParentProcessMap();
    expect(reader.getSnapshotHealth().state).toBe('HEALTHY');

    // Set up the boot-ID change: initial read returns A, final read returns B.
    let bootReadCount = 0;
    fs.readFileSync.mockImplementation((file) => {
      if (file === BOOT_PATH) {
        bootReadCount++;
        // First read (initial in getParentProcessMap) returns A;
        // second read (final integrity check at end of pass) returns B.
        return bootReadCount % 2 === 1 ? BOOT_ID_A : BOOT_ID_B;
      }
      if (!files.has(file)) throw Object.assign(Error('gone'), { code: 'ENOENT' });
      const v = files.get(file);
      if (v instanceof Error) throw v;
      return v;
    });

    const result = await reader.getParentProcessMap();

    // All entries have null startTime (population-only) and no witness.
    for (const entry of result.values()) {
      expect(entry.startTime).toBeNull();
      expect(entry.witness).toBeUndefined();
      expect(entry.witnessSource).toBeUndefined();
    }
    // Health must be FAILED.
    expect(reader.getSnapshotHealth().state).toBe('FAILED');
    expect(reader.getSnapshotHealth().lastError).toBe('linux-proc-identity-unavailable');

    // Recovery: stable boot ID B, btime B. Recovery uses the new boot reference.
    bootReadCount = 0;
    fs.readFileSync.mockImplementation((file) => {
      if (file === BOOT_PATH) return BOOT_ID_B;
      if (file === '/proc/stat') return `btime ${BOOT_SECONDS_B}\n`;
      if (!files.has(file)) throw Object.assign(Error('gone'), { code: 'ENOENT' });
      const v = files.get(file);
      if (v instanceof Error) throw v;
      return v;
    });

    const recovered = await reader.getParentProcessMap();
    expect(reader.getSnapshotHealth().state).toBe('HEALTHY');
    // Witness must reference the new boot ID.
    for (const entry of recovered.values()) {
      expect(entry.witness).toMatch(new RegExp(`^${BOOT_ID_B}:`));
    }
  });

  // ─── Test 2: final boot-ID read throws after stat records were read ─────────

  it('final boot-ID read throws after stat records: no birth values leak, FAILED health', async () => {
    // Prime the clock.
    await reader.getParentProcessMap();

    // The second read of BOOT_PATH (the final integrity check) will throw.
    let bootReadCount = 0;
    fs.readFileSync.mockImplementation((file) => {
      if (file === BOOT_PATH) {
        bootReadCount++;
        if (bootReadCount % 2 === 0) {
          throw Object.assign(Error('proc-unreadable'), { code: 'EIO' });
        }
        return BOOT_ID_A;
      }
      if (!files.has(file)) throw Object.assign(Error('gone'), { code: 'ENOENT' });
      const v = files.get(file);
      if (v instanceof Error) throw v;
      return v;
    });

    const result = await reader.getParentProcessMap();

    // Population-only: no birth values.
    for (const entry of result.values()) {
      expect(entry.startTime).toBeNull();
      expect(entry.witness).toBeUndefined();
      expect(entry.witnessSource).toBeUndefined();
    }
    expect(reader.getSnapshotHealth().state).toBe('FAILED');

    // Neither new nor previous boot reference ticks leak into the fallback.
    const json = JSON.stringify(result);
    expect(json).not.toContain('"witness"');
    expect(json).not.toContain('"startTime":' + (BOOT_SECONDS_A * 1000));
    expect(json).not.toContain('"startTime":' + (BOOT_SECONDS_B * 1000));
  });

  // ─── Test 3: two concurrent calls share a single CLK_TCK probe ─────────────

  it('two concurrent calls await a single CLK_TCK probe; after failure, the next call retries and recovers', async () => {
    let clockResolve;
    // The first execFile call for getconf captures the callback so we control when it resolves.
    let clockCallCount = 0;
    exec.mockImplementation((cmd, _args, _opts, cb) => {
      if (cmd === 'getconf') {
        clockCallCount++;
        clockResolve = cb;
        // Do not call cb here: we control it.
      } else {
        cb(null, '100 1 node\n200 100 claude\n');
      }
    });

    // Start two concurrent getParentProcessMap() calls.
    const p1 = reader.getParentProcessMap();
    const p2 = reader.getParentProcessMap();

    // Allow the microtask queue to flush so both calls reach getClockTicks().
    await Promise.resolve();
    await Promise.resolve();

    // Only one execFile call for getconf CLK_TCK should have been made.
    expect(clockCallCount).toBe(1);

    // Fail the probe; both calls should receive the population-only fallback.
    clockResolve(Error('getconf-unavailable'));
    const [r1, r2] = await Promise.all([p1, p2]);

    for (const entry of r1.values()) expect(entry.startTime).toBeNull();
    for (const entry of r2.values()) expect(entry.startTime).toBeNull();
    expect(reader.getSnapshotHealth().state).toBe('FAILED');

    // After failure, clockProbe is null and clockTicks is null, so the next call retries.
    exec.mockImplementation((cmd, _args, _opts, cb) => {
      if (cmd === 'getconf') cb(null, '100\n');
      else cb(null, '100 1 node\n200 100 claude\n');
    });
    const recovered = await reader.getParentProcessMap();
    expect(reader.getSnapshotHealth().state).toBe('HEALTHY');
    for (const entry of recovered.values()) {
      expect(typeof entry.startTime).toBe('number');
      expect(entry.startTime).toBeGreaterThan(0);
    }
    // exec must have been called a second time for getconf (the retry).
    const getconfCalls = exec.mock.calls.filter(([cmd]) => cmd === 'getconf');
    expect(getconfCalls.length).toBe(2);
  });

  // ─── Test 4: ESRCH on one PID preserves valid peer observations ─────────────

  it('ESRCH on one PID during enumeration preserves birth observations for valid peers', async () => {
    // PID 100 disappears with ESRCH (process exited between readdirSync and stat read).
    files.set('/proc/100/stat', Object.assign(Error('no such process'), { code: 'ESRCH' }));

    const map = await reader.getParentProcessMap();

    // PID 100 is absent from the map (vanished cleanly).
    expect(map.has(100)).toBe(false);
    // PID 200 is still present with full birth observation.
    expect(map.has(200)).toBe(true);
    expect(map.get(200).startTime).not.toBeNull();
    expect(typeof map.get(200).startTime).toBe('number');
    expect(map.get(200).witness).toBeDefined();
    expect(map.get(200).witnessSource).toBe('linuxStartTicks');
    // Health remains HEALTHY: ESRCH is an expected transient condition.
    expect(reader.getSnapshotHealth().state).toBe('HEALTHY');
  });
});
