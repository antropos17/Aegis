import { describe, it, expect, beforeEach, vi } from 'vitest';
import resourceMonitor from '../../src/main/resource-monitor.js';

const {
  getResourcesByPid,
  getResourcesForPids,
  isGpuAvailable,
  _setExecForTest,
  _setLoggerForTest,
  _resetForTest,
  _parsePerfJson,
  _parsePsOutput,
  _parseGpuCsv,
  _normalizeCpu,
} = resourceMonitor;

// Injected logger spy — the codebase's DI convention (see scan-loop.test.js),
// not module-mocking, which is fragile across the ESM-import/CJS-require boundary.
const logWarn = vi.fn();

/**
 * Build a vi.fn() exec that answers both the win32 (powershell.exe) and posix
 * (ps) CPU/RAM branches, plus the nvidia-smi probe + compute-apps query — so
 * the suite is green on Windows and on Linux CI alike. No real process spawns.
 * @param {{ gpu?: boolean }} [opts]
 */
function makeExec({ gpu = true } = {}) {
  return vi.fn((cmd, argv) => {
    const args = Array.isArray(argv) ? argv.join(' ') : '';
    if (cmd === 'nvidia-smi') {
      if (!gpu) return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      if (args.includes('query-gpu')) return Promise.resolve('NVIDIA GeForce RTX 4090\n');
      return Promise.resolve('100, 512\n200, 1024\n'); // compute-apps: pid, used MiB
    }
    if (cmd === 'powershell.exe') {
      return Promise.resolve(
        JSON.stringify([
          { IDProcess: 100, PercentProcessorTime: 44, WorkingSet: 75427840 }, // ~72 MB
          { IDProcess: 200, PercentProcessorTime: 0, WorkingSet: 1048576 }, // 1 MB
        ]),
      );
    }
    if (cmd === 'ps') {
      return Promise.resolve('100 44.0 73660\n200 0.0 1024\n'); // pid %cpu rss(KB)
    }
    return Promise.resolve('');
  });
}

const BYTES_PER_MB = 1048576;

/**
 * An exec whose CPU/RAM answer CHANGES on every sampling call, so a returned figure
 * proves which call produced it. Without this, a cached record and a fresh one are
 * indistinguishable and a cache-key test asserts nothing.
 *
 * Call 1 reports pid 100 at 1 MB, call 2 at 2 MB, and so on.
 * @returns {Function}
 */
function makeVaryingExec() {
  let sample = 0;
  return vi.fn((cmd) => {
    if (cmd === 'nvidia-smi') {
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    }
    if (cmd === 'powershell.exe') {
      sample++;
      return Promise.resolve(
        JSON.stringify([
          { IDProcess: 100, PercentProcessorTime: sample, WorkingSet: sample * BYTES_PER_MB },
          { IDProcess: 200, PercentProcessorTime: sample, WorkingSet: sample * BYTES_PER_MB },
        ]),
      );
    }
    if (cmd === 'ps') {
      sample++;
      return Promise.resolve(
        `100 ${sample}.0 ${sample * 1024}\n200 ${sample}.0 ${sample * 1024}\n`,
      );
    }
    return Promise.resolve('');
  });
}

/** Count of CPU/RAM sampling spawns — the thing a cache hit is supposed to avoid. */
function sampleCalls(exec) {
  return exec.mock.calls.filter(([cmd]) => cmd === 'powershell.exe' || cmd === 'ps').length;
}

describe('resource-monitor', () => {
  beforeEach(() => {
    _resetForTest();
    logWarn.mockClear();
    _setLoggerForTest({ warn: logWarn });
  });

  describe('_normalizeCpu()', () => {
    it('divides sum-across-cores percent by core count → 0–100', () => {
      expect(_normalizeCpu(88, 22)).toBe(4); // 88/22
      expect(_normalizeCpu(100, 4)).toBe(25);
    });

    it('clamps to 100 and floors negatives/NaN to 0', () => {
      expect(_normalizeCpu(8000, 4)).toBe(100); // 2000 → clamp 100
      expect(_normalizeCpu(-5, 4)).toBe(0);
      expect(_normalizeCpu(NaN, 4)).toBe(0);
    });
  });

  describe('_parsePerfJson() — Windows CPU/RAM', () => {
    it('parses array form to cpuRaw + memMb (bytes → MB)', () => {
      const map = _parsePerfJson(
        JSON.stringify([
          { IDProcess: 100, PercentProcessorTime: 97, WorkingSet: 75427840 },
          { IDProcess: 200, PercentProcessorTime: 0, WorkingSet: 1048576 },
        ]),
      );
      expect(map.get(100)).toEqual({ cpuRaw: 97, memMb: 72 });
      expect(map.get(200)).toEqual({ cpuRaw: 0, memMb: 1 });
    });

    it('parses single-object form (one matching PID)', () => {
      const map = _parsePerfJson(
        JSON.stringify({ IDProcess: 100, PercentProcessorTime: 12, WorkingSet: 2097152 }),
      );
      expect(map.get(100)).toEqual({ cpuRaw: 12, memMb: 2 });
    });

    it('returns empty map for blank or malformed JSON', () => {
      expect(_parsePerfJson('').size).toBe(0);
      expect(_parsePerfJson('not json').size).toBe(0);
    });
  });

  describe('_parsePsOutput() — posix CPU/RAM', () => {
    it('parses pid/%cpu/rss lines (rss KB → MB)', () => {
      const map = _parsePsOutput('100 44.0 73660\n200 0.0 1024\n');
      expect(map.get(100)).toEqual({ cpuRaw: 44, memMb: 72 });
      expect(map.get(200)).toEqual({ cpuRaw: 0, memMb: 1 });
    });
  });

  describe('_parseGpuCsv()', () => {
    it('parses nvidia-smi compute-apps rows to pid → MiB', () => {
      const map = _parseGpuCsv('100, 512\n200, 1024\n');
      expect(map.get(100)).toBe(512);
      expect(map.get(200)).toBe(1024);
    });
  });

  describe('getResourcesByPid() — happy path', () => {
    it('returns normalized cpu, memMb, and per-PID gpu memory', async () => {
      _setExecForTest(makeExec({ gpu: true }));
      const r = await getResourcesByPid(100);
      expect(r.pid).toBe(100);
      expect(typeof r.cpu).toBe('number');
      expect(r.cpu).toBeGreaterThanOrEqual(0);
      expect(r.cpu).toBeLessThanOrEqual(100);
      expect(r.memMb).toBe(72); // 75427840 B or 73660 KB → 72 MB on either branch
      expect(r.gpu).toEqual({ memMb: 512 });
      expect(isGpuAvailable()).toBe(true);
    });
  });

  describe('degraded path — no nvidia-smi', () => {
    it('returns gpu:null, isGpuAvailable()=false, warns exactly once', async () => {
      _setExecForTest(makeExec({ gpu: false }));

      const r1 = await getResourcesByPid(100);
      expect(r1.gpu).toBeNull();
      expect(r1.memMb).toBe(72); // CPU/RAM still sampled — only GPU degraded
      expect(isGpuAvailable()).toBe(false);

      const r2 = await getResourcesByPid(200);
      expect(r2.gpu).toBeNull();

      expect(logWarn).toHaveBeenCalledTimes(1); // warn-once across both calls
    });
  });

  describe('TTL cache — keyed by instanceId, never by pid', () => {
    it('serves a second call for the SAME instance within TTL without re-spawning', async () => {
      const exec = makeExec({ gpu: true });
      _setExecForTest(exec);

      await getResourcesForPids([{ pid: 100, instanceId: '100:aaa' }]);
      await getResourcesForPids([{ pid: 100, instanceId: '100:aaa' }]);

      expect(sampleCalls(exec)).toBe(1);
    });

    it('a recycled pid under a NEW instanceId gets a fresh sample, not the dead one’s', async () => {
      // The whole point of the key migration (ai-mistakes #19). Same pid, two lives:
      // the second must not be served the first's cached numbers. The varying exec makes
      // the two answers distinguishable — 1 MB on the first sample, 2 MB on the second.
      const exec = makeVaryingExec();
      _setExecForTest(exec);

      const [first] = await getResourcesForPids([{ pid: 100, instanceId: '100:lifeA' }]);
      const [second] = await getResourcesForPids([{ pid: 100, instanceId: '100:lifeB' }]);

      expect(first.memMb).toBe(1);
      expect(second.memMb).toBe(2); // a pid-keyed cache would have replayed 1 here
      expect(second.instanceId).toBe('100:lifeB');
      expect(sampleCalls(exec)).toBe(2);
    });

    it('an unkeyed target is never cached — every call resamples', async () => {
      // With instanceId null there is no proof the pid still names the same process,
      // so a cache hit would be a guess. It resamples instead.
      const exec = makeVaryingExec();
      _setExecForTest(exec);

      const [first] = await getResourcesForPids([{ pid: 100, instanceId: null }]);
      const [second] = await getResourcesForPids([{ pid: 100, instanceId: null }]);

      expect(first.memMb).toBe(1);
      expect(second.memMb).toBe(2);
      expect(sampleCalls(exec)).toBe(2);
    });

    it('an unkeyed target does not poison the cache for a keyed one on the same pid', async () => {
      const exec = makeVaryingExec();
      _setExecForTest(exec);

      await getResourcesForPids([{ pid: 100, instanceId: null }]);
      const [keyed] = await getResourcesForPids([{ pid: 100, instanceId: '100:aaa' }]);

      expect(keyed.memMb).toBe(2); // its own sample, not the unkeyed call's
      expect(keyed.instanceId).toBe('100:aaa');
    });
  });

  describe('record shape and identity', () => {
    it('returns one record per requested target, in request order, each with its key', async () => {
      _setExecForTest(makeExec({ gpu: true }));

      const records = await getResourcesForPids([
        { pid: 200, instanceId: '200:bbb' },
        { pid: 100, instanceId: '100:aaa' },
      ]);

      expect(records).toHaveLength(2);
      expect(records.map((r) => r.instanceId)).toEqual(['200:bbb', '100:aaa']);
      expect(records.map((r) => r.pid)).toEqual([200, 100]);
      expect(records[1]).toEqual({
        instanceId: '100:aaa',
        pid: 100,
        cpu: expect.any(Number),
        memMb: 72,
        gpu: { memMb: 512 },
      });
    });

    it('two unattributed targets stay distinct instead of collapsing into one bucket', async () => {
      _setExecForTest(makeExec({ gpu: true }));

      const records = await getResourcesForPids([
        { pid: 100, instanceId: null },
        { pid: 200, instanceId: null },
      ]);

      expect(records).toHaveLength(2);
      expect(records.map((r) => r.pid)).toEqual([100, 200]);
      expect(records.every((r) => r.instanceId === null)).toBe(true);
      // Distinct measurements, not one shared row: pid 200 is the 1 MB process.
      expect(records[0].memMb).toBe(72);
      expect(records[1].memMb).toBe(1);
    });

    it('two agents sharing a pid under different keys both get a record', async () => {
      _setExecForTest(makeExec({ gpu: true }));

      const records = await getResourcesForPids([
        { pid: 100, instanceId: '100:aaa' },
        { pid: 100, instanceId: '100:bbb' },
      ]);

      expect(records.map((r) => r.instanceId)).toEqual(['100:aaa', '100:bbb']);
    });

    it('collapses an exact repeat of the same (pid, instanceId) pair', async () => {
      _setExecForTest(makeExec({ gpu: true }));

      const records = await getResourcesForPids([
        { pid: 100, instanceId: '100:aaa' },
        { pid: 100, instanceId: '100:aaa' },
      ]);

      expect(records).toHaveLength(1);
    });
  });

  describe('invalid input', () => {
    it('returns an all-null resource for a non-positive PID', async () => {
      _setExecForTest(makeExec({ gpu: true }));
      const r = await getResourcesByPid(-1);
      expect(r).toEqual({ pid: -1, cpu: null, memMb: null, gpu: null });
    });

    it('drops unsampleable targets and keeps the rest', async () => {
      _setExecForTest(makeExec({ gpu: true }));

      const records = await getResourcesForPids([
        null,
        { pid: 0, instanceId: '0:Kilo Code' }, // synthetic: no OS process to sample
        { pid: -1, instanceId: 'x' },
        { pid: 'nope', instanceId: 'y' },
        { pid: 100, instanceId: '100:aaa' },
      ]);

      expect(records).toHaveLength(1);
      expect(records[0].instanceId).toBe('100:aaa');
    });

    it('returns an empty array for a non-array or empty input', async () => {
      _setExecForTest(makeExec({ gpu: true }));
      expect(await getResourcesForPids([])).toEqual([]);
      expect(await getResourcesForPids(undefined)).toEqual([]);
    });

    it('treats an empty-string instanceId as unattributed, not as a key', async () => {
      const exec = makeVaryingExec();
      _setExecForTest(exec);

      const [first] = await getResourcesForPids([{ pid: 100, instanceId: '' }]);
      const [second] = await getResourcesForPids([{ pid: 100, instanceId: '' }]);

      expect(first.instanceId).toBeNull();
      expect(second.memMb).toBe(2); // resampled — an empty string never became a cache key
    });
  });
});
