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

  describe('TTL cache', () => {
    it('serves a second call within TTL without re-spawning the CPU/RAM query', async () => {
      const exec = makeExec({ gpu: true });
      _setExecForTest(exec);

      await getResourcesForPids([100]);
      await getResourcesForPids([100]);

      const cpuMemCalls = exec.mock.calls.filter(
        ([cmd]) => cmd === 'powershell.exe' || cmd === 'ps',
      ).length;
      expect(cpuMemCalls).toBe(1);
    });
  });

  describe('invalid input', () => {
    it('returns an all-null resource for a non-positive PID', async () => {
      _setExecForTest(makeExec({ gpu: true }));
      const r = await getResourcesByPid(-1);
      expect(r).toEqual({ pid: -1, cpu: null, memMb: null, gpu: null });
    });
  });
});
