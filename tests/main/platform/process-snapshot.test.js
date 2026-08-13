import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';

/** Operational-log lines the module under test emitted, newest last. */
let logLines = [];
const fakeLogger = {
  debug: (mod, message, meta) => logLines.push({ level: 'debug', mod, message, meta }),
  info: (mod, message, meta) => logLines.push({ level: 'info', mod, message, meta }),
  warn: (mod, message, meta) => logLines.push({ level: 'warn', mod, message, meta }),
  error: (mod, message, meta) => logLines.push({ level: 'error', mod, message, meta }),
};

// The module under test is CommonJS and holds its logger by reference, so the
// substitution has to happen at require time — spying on an ESM default import
// patches a different object and records nothing.
const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === '../logger') return fakeLogger;
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

/** 1717000000000 epoch-ms expressed in 100 ns FILETIME ticks. */
const TICKS = '133614736000000000';

/**
 * @param {Array<Object>} procs
 * @param {string} [source]
 * @returns {{requestSnapshot: Function}}
 */
function clientReturning(procs, source = 'basic') {
  return { requestSnapshot: vi.fn().mockResolvedValue({ source, procs }) };
}

/**
 * @param {string} message
 * @returns {{requestSnapshot: Function}}
 */
function clientFailing(message) {
  return { requestSnapshot: vi.fn().mockRejectedValue(new Error(message)) };
}

describe('platform/process-snapshot', () => {
  const originalMode = process.env.AEGIS_PROC_SNAPSHOT;
  /** @type {any} */
  let snapshot;

  /**
   * Reload the module so the rollout flag is read afresh.
   * @returns {Promise<void>}
   */
  async function loadModule() {
    vi.resetModules();
    const mod = await import('../../../src/main/platform/process-snapshot.js');
    snapshot = mod.default;
  }

  beforeEach(async () => {
    logLines = [];
    delete process.env.AEGIS_PROC_SNAPSHOT;
    await loadModule();
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.AEGIS_PROC_SNAPSHOT;
    else process.env.AEGIS_PROC_SNAPSHOT = originalMode;
  });

  describe('ticksToEpochMs', () => {
    it('converts FILETIME ticks to the frozen epoch-millisecond contract', () => {
      expect(snapshot.ticksToEpochMs(TICKS)).toBe(1717000000000);
    });

    it('keeps every low digit — the naive Number path is off by a millisecond here', () => {
      // 2^53 is 9.0e15; ticks run at 1.3e17, so Number() rounds to the nearest
      // multiple of 16 BEFORE any division, and on this value that rounding crosses
      // a millisecond boundary. A witness that lost its low digits would compare
      // EQUAL across two generations — the exact failure this guards against.
      const ticks = '133614736000009999';
      expect(snapshot.ticksToEpochMs(ticks)).toBe(1717000000000);
      expect(Math.floor(Number(ticks) / 10000) - 11644473600000).toBe(1717000000001);
    });

    it('is honest about a value it cannot use', () => {
      expect(snapshot.ticksToEpochMs('')).toBeNull();
      expect(snapshot.ticksToEpochMs('12abc')).toBeNull();
      expect(snapshot.ticksToEpochMs('1')).toBeNull();
      expect(snapshot.ticksToEpochMs(undefined)).toBeNull();
      expect(snapshot.ticksToEpochMs(Number(TICKS))).toBeNull();
    });
  });

  describe('sidecar path', () => {
    it('prefers the kernel SequenceNumber as the witness', async () => {
      snapshot._setClientForTest(
        clientReturning([{ pid: 100, ppid: 4, name: 'claude.exe', ct: TICKS, seq: '918273' }]),
      );
      const map = await snapshot.getParentProcessMap();
      expect(map.get(100)).toEqual({
        name: 'claude.exe',
        ppid: 4,
        startTime: 1717000000000,
        witness: '918273',
        witnessSource: 'sequence',
      });
      expect(snapshot.getSnapshotHealth().state).toBe('HEALTHY');
    });

    it('falls back to creation-time ticks when the OS supplies no sequence number', async () => {
      snapshot._setClientForTest(
        clientReturning([{ pid: 100, ppid: 4, name: 'claude.exe', ct: TICKS }], 'class5'),
      );
      const map = await snapshot.getParentProcessMap();
      expect(map.get(100).witness).toBe(TICKS);
      expect(map.get(100).witnessSource).toBe('createTime100ns');
    });

    it('keeps a readable witness even when the birth time is unusable', async () => {
      snapshot._setClientForTest(
        clientReturning([{ pid: 100, ppid: 4, name: 'claude.exe', ct: 'nope', seq: '7' }]),
      );
      const map = await snapshot.getParentProcessMap();
      expect(map.get(100).startTime).toBeNull();
      expect(map.get(100).witness).toBe('7');
    });

    it('drops records that carry no usable pid', async () => {
      snapshot._setClientForTest(
        clientReturning([
          { pid: 0, name: 'idle', ct: TICKS },
          { pid: -1, name: 'bogus', ct: TICKS },
          { pid: 1.5, name: 'bogus', ct: TICKS },
          { pid: 100, ppid: 4, name: 'claude.exe', ct: TICKS },
        ]),
      );
      const map = await snapshot.getParentProcessMap();
      expect([...map.keys()]).toEqual([100]);
    });
  });

  describe('fallback chain', () => {
    it('serves the CIM observation when the sidecar cannot, and marks itself DEGRADED', async () => {
      snapshot._setClientForTest(clientFailing('binary not found'));
      const cimMap = new Map([[100, { name: 'claude.exe', ppid: 4, startTime: 1717000000000 }]]);
      const cimFallback = vi.fn().mockResolvedValue(cimMap);

      const map = await snapshot.getParentProcessMap({ cimFallback });
      expect(cimFallback).toHaveBeenCalledTimes(1);
      // Passed through untouched: the CIM entry carries no witness, and
      // process-utils derives a `startTimeMs` one from the birth time instead.
      expect(map.get(100)).toEqual({ name: 'claude.exe', ppid: 4, startTime: 1717000000000 });
      const health = snapshot.getSnapshotHealth();
      expect(health.state).toBe('DEGRADED');
      expect(health.lastError).toMatch(/binary not found/);
    });

    it('never spawns the sidecar under the cim kill switch', async () => {
      process.env.AEGIS_PROC_SNAPSHOT = 'cim';
      await loadModule();
      const client = clientReturning([{ pid: 100, ppid: 4, name: 'claude.exe', ct: TICKS }]);
      snapshot._setClientForTest(client);
      const cimFallback = vi
        .fn()
        .mockResolvedValue(new Map([[100, { name: 'claude.exe', ppid: 4, startTime: 1 }]]));

      const map = await snapshot.getParentProcessMap({ cimFallback });
      expect(snapshot.getMode()).toBe('cim');
      expect(client.requestSnapshot).not.toHaveBeenCalled();
      expect(cimFallback).toHaveBeenCalledTimes(1);
      expect(map.get(100).witness).toBeUndefined();
    });

    it('refuses the CIM fallback under strict — so a measurement cannot be mistaken', async () => {
      process.env.AEGIS_PROC_SNAPSHOT = 'strict';
      await loadModule();
      snapshot._setClientForTest(clientFailing('timed out'));
      const cimFallback = vi.fn();

      const map = await snapshot.getParentProcessMap({ cimFallback });
      expect(cimFallback).not.toHaveBeenCalled();
      expect(map.size).toBe(0);
      expect(snapshot.getSnapshotHealth().state).toBe('FAILED');
    });

    it('returns an empty map — never a remembered one — when nothing can observe', async () => {
      snapshot._setClientForTest(clientFailing('dead'));
      const map = await snapshot.getParentProcessMap({ cimFallback: async () => new Map() });
      expect(map.size).toBe(0);
      expect(snapshot.getSnapshotHealth().state).toBe('FAILED');
    });

    it('does not obey an unknown rollout value', async () => {
      process.env.AEGIS_PROC_SNAPSHOT = 'turbo';
      await loadModule();
      expect(snapshot.getMode()).toBe('auto');
      expect(
        logLines.some((l) => l.level === 'warn' && /Unknown AEGIS_PROC_SNAPSHOT/.test(l.message)),
      ).toBe(true);
    });
  });

  describe('source visibility', () => {
    it('names the serving source on EVERY pass, not only when it changes', async () => {
      snapshot._setClientForTest(
        clientReturning([{ pid: 100, ppid: 4, name: 'claude.exe', ct: TICKS }], 'class5'),
      );

      await snapshot.getParentProcessMap();
      await snapshot.getParentProcessMap();

      const perfLines = logLines.filter((l) => l.mod === 'perf' && l.message === 'snapshot');
      expect(perfLines).toHaveLength(2);
      for (const line of perfLines) {
        expect(line.meta.source).toBe('class5');
        expect(line.meta.procs).toBe(1);
        expect(line.meta.mode).toBe('auto');
        expect(typeof line.meta.ms).toBe('number');
      }
    });

    it('counts a provider change, because each one invalidates every cached witness', async () => {
      snapshot._setClientForTest(
        clientReturning([{ pid: 100, ppid: 4, name: 'claude.exe', ct: TICKS }], 'class5'),
      );
      await snapshot.getParentProcessMap();
      expect(snapshot.getSourceStats()).toEqual({ lastSource: 'class5', transitions: 0 });

      snapshot._setClientForTest(clientFailing('died'));
      await snapshot.getParentProcessMap({
        cimFallback: async () => new Map([[100, { name: 'claude.exe', ppid: 4, startTime: 1 }]]),
      });
      expect(snapshot.getSourceStats()).toEqual({ lastSource: 'cim', transitions: 1 });
    });
  });
});
