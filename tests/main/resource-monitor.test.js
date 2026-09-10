import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('clamps measured CPU to 100 and preserves invalid input as unavailable', () => {
      expect(_normalizeCpu(8000, 4)).toBe(100); // 2000 → clamp 100
      expect(_normalizeCpu(-5, 4)).toBeNull();
      expect(_normalizeCpu(NaN, 4)).toBeNull();
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
        collectedAt: expect.any(Number),
        collectionStartedAt: expect.any(Number),
        collectionSequence: expect.any(Number),
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

describe('resource-monitor missing measurement regression', () => {
  it.each([null, '', ' ', false, true, 'unavailable', -1])(
    'keeps invalid Perf counters %j unavailable while retaining the PID',
    (value) => {
      const result = _parsePerfJson(
        JSON.stringify({ IDProcess: 100, PercentProcessorTime: value, WorkingSet: value }),
      );
      expect(result.get(100)).toEqual({ cpuRaw: null, memMb: null });
    },
  );
  it('preserves actual zero counters and numeric OS strings', () => {
    const zero = _parsePerfJson(
      JSON.stringify({ IDProcess: '100', PercentProcessorTime: '0', WorkingSet: '0' }),
    );
    expect(zero.get(100)).toEqual({ cpuRaw: 0, memMb: 0 });
  });
  it('never normalizes missing or invalid CPU into idle', () => {
    for (const value of [null, undefined, NaN, Infinity, -1])
      expect(_normalizeCpu(value, 4)).toBeNull();
  });
});

describe('resource-monitor nullable CPU propagation', () => {
  beforeEach(() => {
    _resetForTest();
    _setLoggerForTest({ warn: vi.fn() });
  });
  it('keeps missing CPU null through normalization/cache while preserving measured RAM', async () => {
    const exec = vi.fn(async (command) => {
      if (command === 'nvidia-smi') throw new Error('GPU unavailable');
      if (command === 'powershell.exe')
        return JSON.stringify({ IDProcess: 100, PercentProcessorTime: null, WorkingSet: 1048576 });
      return '100 .. 1024';
    });
    _setExecForTest(exec);
    const target = [{ pid: 100, instanceId: '100:missing-cpu' }];
    const first = await getResourcesForPids(target);
    const second = await getResourcesForPids(target);
    expect(first[0]).toMatchObject({ instanceId: '100:missing-cpu', cpu: null, memMb: 1 });
    expect(second).toEqual(first);
    expect(exec.mock.calls.filter(([command]) => command !== 'nvidia-smi')).toHaveLength(1);
  });
});

describe('resource-monitor collection provenance and cache ordering', () => {
  let now;
  let clock;
  let pending;

  beforeEach(async () => {
    _resetForTest();
    _setLoggerForTest({ warn: vi.fn() });
    now = 1000;
    clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    pending = [];
    _setExecForTest(
      vi.fn((command) => {
        if (command === 'nvidia-smi') return Promise.reject(new Error('GPU unavailable'));
        return new Promise((resolve) => {
          pending.push((memMb) =>
            resolve(
              command === 'powershell.exe'
                ? JSON.stringify(
                    [100, 200].map((pid) => ({
                      IDProcess: pid,
                      PercentProcessorTime: memMb,
                      WorkingSet: memMb * BYTES_PER_MB,
                    })),
                  )
                : [100, 200].map((pid) => pid + ' ' + memMb + ' ' + memMb * 1024).join('\n'),
            ),
          );
        });
      }),
    );
    await resourceMonitor.probeGpu();
  });

  afterEach(() => clock.mockRestore());

  const target = [{ pid: 100, instanceId: '100:clock' }];

  it('preserves collector completion time and sequence when delivering a cache hit', async () => {
    const initial = getResourcesForPids(target);
    await Promise.resolve();
    now = 1200;
    pending[0](1);
    const [first] = await initial;
    expect(first).toMatchObject({
      collectionStartedAt: 1000,
      collectedAt: 1200,
      collectionSequence: 1,
    });

    now = 2000;
    const [cached] = await getResourcesForPids(target);
    expect(cached).toEqual(first);
    expect(pending).toHaveLength(1);
  });

  it('starts TTL after slow collection completion rather than query request', async () => {
    const initial = getResourcesForPids(target);
    await Promise.resolve();
    now = 9000;
    pending[0](1);
    await initial;

    now = 13000;
    const replay = getResourcesForPids(target);
    await Promise.resolve();
    expect(pending).toHaveLength(1);
    expect((await replay)[0].memMb).toBe(1);

    now = 14001;
    const fresh = getResourcesForPids(target);
    await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[1](2);
    expect((await fresh)[0]).toMatchObject({
      memMb: 2,
      collectedAt: 14001,
      collectionSequence: 2,
    });
  });

  it('preserves per-record provenance in a batch containing cached and fresh instances', async () => {
    const initial = getResourcesForPids(target);
    await Promise.resolve();
    now = 1100;
    pending[0](1);
    const [first] = await initial;

    now = 1200;
    const mixed = getResourcesForPids([...target, { pid: 200, instanceId: '200:clock' }]);
    await Promise.resolve();
    now = 1300;
    pending[1](2);
    const rows = await mixed;
    expect(rows[0]).toEqual(first);
    expect(rows[0].collectedAt).toBe(1100);
    expect(rows[1]).toMatchObject({
      pid: 200,
      memMb: 2,
      collectionStartedAt: 1200,
      collectedAt: 1300,
      collectionSequence: 2,
    });
  });

  it('caches the latest completed reading while a newer query is still pending', async () => {
    const first = getResourcesForPids(target);
    await Promise.resolve();
    now = 2000;
    const second = getResourcesForPids(target);
    await Promise.resolve();

    now = 2500;
    pending[0](1);
    const [firstRow] = await first;
    for (const receipt of [3000, 3500]) {
      now = receipt;
      const cached = getResourcesForPids(target);
      await Promise.resolve();
      expect(pending).toHaveLength(2);
      expect((await cached)[0]).toEqual(firstRow);
    }

    now = 4000;
    pending[1](2);
    const [secondRow] = await second;
    now = 4500;
    expect((await getResourcesForPids(target))[0]).toEqual(secondRow);
    expect(secondRow.collectionSequence).toBeGreaterThan(firstRow.collectionSequence);
    expect(pending).toHaveLength(2);
  });

  it('does not let an older request overwrite the newer cache when it completes last', async () => {
    const older = getResourcesForPids(target);
    await Promise.resolve();
    const newer = getResourcesForPids(target);
    await Promise.resolve();
    // Both requests start and finish within the same clock millisecond.
    pending[1](2);
    const [newRow] = await newer;
    pending[0](1);
    const [oldRow] = await older;

    expect(newRow.collectionSequence).toBeGreaterThan(oldRow.collectionSequence);
    expect(newRow.collectedAt).toBe(oldRow.collectedAt);
    expect(oldRow.memMb).toBe(1);
    expect((await getResourcesForPids(target))[0]).toEqual(newRow);
  });

  it('keeps the newer-request guard after its expired cache entry has been pruned', async () => {
    const older = getResourcesForPids(target);
    await Promise.resolve();
    const newer = getResourcesForPids(target);
    await Promise.resolve();
    pending[1](2);
    await newer;

    const filler = getResourcesForPids(
      Array.from({ length: 501 }, (_, index) => ({ pid: 100, instanceId: 'fill:' + index })),
    );
    await Promise.resolve();
    pending[2](3);
    await filler;

    now = 7000;
    const prune = getResourcesForPids([{ pid: 200, instanceId: '200:prune' }]);
    await Promise.resolve();
    pending[3](4);
    await prune;

    now = 7100;
    pending[0](1);
    await older;
    const final = getResourcesForPids(target);
    await Promise.resolve();
    expect(pending).toHaveLength(5);
    pending[4](5);
    expect((await final)[0].memMb).toBe(5);
  });

  it('rejects a negative cache age after a wall-clock adjustment', async () => {
    const initial = getResourcesForPids(target);
    await Promise.resolve();
    pending[0](1);
    await initial;

    now = 900;
    const adjusted = getResourcesForPids(target);
    await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[1](2);
    expect((await adjusted)[0]).toMatchObject({
      memMb: 2,
      collectedAt: 900,
      collectionSequence: 2,
    });
  });

  it('keeps missing measurements null while timestamping the completed collection attempt', async () => {
    _setExecForTest(vi.fn(async () => ''));
    const [row] = await getResourcesForPids(target);
    expect(row).toMatchObject({
      cpu: null,
      memMb: null,
      gpu: null,
      collectionStartedAt: 1000,
      collectedAt: 1000,
      collectionSequence: 1,
    });
  });
});
