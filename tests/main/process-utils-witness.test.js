import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The module path is overridable so `scripts/verify-witness-gate.mjs` can point
 * this suite at a deliberately broken copy and prove the gate is load-bearing.
 * ai-mistakes #21: a passing command proves the command ran, not that it inspected
 * anything.
 */
const MODULE_UNDER_TEST =
  process.env.AEGIS_PU_UNDER_TEST ||
  new URL('../../src/main/process-utils.js', import.meta.url).href;
const processUtils = (await import(/* @vite-ignore */ MODULE_UNDER_TEST)).default;

/** One epoch-millisecond, shared by every generation below on purpose. */
const MS = 1717000000000;
/** The same instant in 100 ns FILETIME ticks. */
const TICKS = '133614736000000000';

describe('process-utils — generation witness', () => {
  let mockGetParentProcessMap;
  let mockGetProcessCwds;

  beforeEach(() => {
    mockGetParentProcessMap = vi.fn();
    mockGetProcessCwds = vi.fn();
    processUtils._resetForTest();
    processUtils._setPlatformForTest({
      getParentProcessMap: mockGetParentProcessMap,
      getProcessCwds: mockGetProcessCwds,
      // Pinned, never inherited from the CI host: the witness only exists on a
      // platform that observes the process table per pass.
      providesStartTime: true,
    });
  });

  /**
   * @param {Object} own - map entry for pid 100.
   * @param {Object} [parent] - map entry for the parent pid it points at.
   * @returns {Map<number, Object>}
   */
  function mapWith(own, parent) {
    const entries = [[100, own]];
    if (parent) entries.push([own.ppid, parent]);
    return new Map(entries);
  }

  /** @returns {Array<Object>} a fresh single-agent batch (never reused across passes). */
  function batch() {
    return [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
  }

  describe('what the witness buys that the birth time could not', () => {
    it('separates two instances that share a pid AND a birth millisecond', async () => {
      // RESEARCH-BASELINE §4, verbatim: "Generation witness is authoritative for
      // cache-generation validation but does not change the current `instanceId`
      // format. Therefore same-PID + same-millisecond distinct generations remain a
      // known downstream identity bound even when a stronger witness can distinguish
      // them. Generation v2 must not claim to eliminate that bound."
      //
      // So: the CACHES must separate these two, and the IDENTITY must not pretend to.
      // Do not "fix" the instanceId assertion below — it is the contract.
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 200,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'code.exe', ppid: 0 },
        ),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const genA = batch();
      await processUtils.enrichWithParentChains(genA);
      await processUtils.annotateWorkingDirs(genA);
      expect(genA[0].parentChain).toEqual(['code.exe']);
      expect(genA[0].cwd).toBe('/home/user/project-a');

      mockGetParentProcessMap.mockResolvedValue(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 300,
            startTime: MS,
            witness: '12',
            witnessSource: 'sequence',
          },
          { name: 'cursor.exe', ppid: 0 },
        ),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const genB = batch();
      await processUtils.enrichWithParentChains(genB);
      await processUtils.annotateWorkingDirs(genB);

      expect(genB[0].parentChain).toEqual(['cursor.exe']);
      expect(genB[0].cwd).toBe('/home/user/project-b');
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2);

      expect(genB[0].generationWitness).toBe('12');
      expect(genB[0].generationWitnessSource).toBe('sequence');
      // The identity is deliberately UNCHANGED across the two generations.
      expect(genB[0].instanceId).toBe(genA[0].instanceId);
      expect(genB[0].instanceId).toBe('100:1717000000000');
      expect(genB[0].instanceIdSource).toBe('os');
    });

    it('keeps the caches when the witness is unchanged — they are not decorative', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 200,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'code.exe', ppid: 0 },
        ),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-a']]));
      const first = batch();
      await processUtils.enrichWithParentChains(first);
      await processUtils.annotateWorkingDirs(first);

      // Same witness, DIFFERENT parent topology reported: the cached chain must win,
      // because the witness proves it is the same process.
      mockGetParentProcessMap.mockResolvedValue(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 300,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'cursor.exe', ppid: 0 },
        ),
      );
      const second = batch();
      await processUtils.enrichWithParentChains(second);
      await processUtils.annotateWorkingDirs(second);

      expect(second[0].parentChain).toEqual(['code.exe']);
      expect(second[0].cwd).toBe('/home/user/project-a');
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
    });

    it('never lets two witnesses of different provenance prove each other', async () => {
      // The value strings are byte-identical; only the source differs. A provider
      // change must be able to invalidate a cache entry, never to confirm one.
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith({ name: 'claude.exe', ppid: 200, startTime: MS }, { name: 'code.exe', ppid: 0 }),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const viaCim = batch();
      await processUtils.enrichWithParentChains(viaCim);
      await processUtils.annotateWorkingDirs(viaCim);
      expect(viaCim[0].generationWitnessSource).toBe('startTimeMs');
      expect(viaCim[0].generationWitness).toBe(String(MS));

      mockGetParentProcessMap.mockResolvedValue(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 300,
            startTime: MS,
            witness: String(MS),
            witnessSource: 'sequence',
          },
          { name: 'cursor.exe', ppid: 0 },
        ),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const viaSidecar = batch();
      await processUtils.enrichWithParentChains(viaSidecar);
      await processUtils.annotateWorkingDirs(viaSidecar);

      expect(viaSidecar[0].parentChain).toEqual(['cursor.exe']);
      expect(viaSidecar[0].cwd).toBe('/home/user/project-b');
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2);
    });
  });

  describe('the witness is not the identity', () => {
    it('gates the cache off a sequence number while the identity degrades honestly', async () => {
      // Creation time unreadable, SequenceNumber readable: `<pid>:u` is the honest
      // identity, and the cache gate still has a real proof to work with.
      const entry = {
        name: 'claude.exe',
        ppid: 200,
        witness: '918273',
        witnessSource: 'sequence',
      };
      mockGetParentProcessMap.mockResolvedValue(mapWith(entry, { name: 'code.exe', ppid: 0 }));
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-a']]));

      const first = batch();
      await processUtils.enrichWithParentChains(first);
      await processUtils.annotateWorkingDirs(first);
      expect(first[0].startTime).toBeNull();
      expect(first[0].instanceId).toBe('100:u');
      expect(first[0].instanceIdSource).toBe('unknown');

      const second = batch();
      await processUtils.enrichWithParentChains(second);
      await processUtils.annotateWorkingDirs(second);
      expect(second[0].parentChain).toEqual(['code.exe']);
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
    });

    it('still builds the os identity from the birth time, not from the witness', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        mapWith({
          name: 'claude.exe',
          ppid: 0,
          startTime: MS,
          witness: TICKS,
          witnessSource: 'createTime100ns',
        }),
      );
      const agents = batch();
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].instanceId).toBe('100:1717000000000');
      expect(agents[0].instanceIdSource).toBe('os');
      expect(agents[0].generationWitness).toBe(TICKS);
    });
  });

  describe('fail honest', () => {
    it('proves nothing when the observation produced no witness at all', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 200,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'code.exe', ppid: 0 },
        ),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const warm = batch();
      await processUtils.enrichWithParentChains(warm);
      await processUtils.annotateWorkingDirs(warm);

      // Neither a witness nor a birth time on this pass.
      mockGetParentProcessMap.mockResolvedValue(
        mapWith({ name: 'claude.exe', ppid: 200 }, { name: 'code.exe', ppid: 0 }),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const degraded = batch();
      await processUtils.enrichWithParentChains(degraded);
      await processUtils.annotateWorkingDirs(degraded);

      // The old witness is not inherited, and the old generation's cwd is not served.
      expect(degraded[0].generationWitness).toBeNull();
      expect(degraded[0].generationWitnessSource).toBeNull();
      expect(degraded[0].instanceId).toBe('100:u');
      expect(degraded[0].cwd).toBe('/home/user/project-b');
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2);
    });

    it('ignores a witness that arrives without a source, or with an empty value', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        mapWith({ name: 'claude.exe', ppid: 0, witness: '918273' }),
      );
      const noSource = batch();
      await processUtils.enrichWithParentChains(noSource);
      expect(noSource[0].generationWitness).toBeNull();

      mockGetParentProcessMap.mockResolvedValue(
        mapWith({ name: 'claude.exe', ppid: 0, witness: '', witnessSource: 'sequence' }),
      );
      const emptyValue = batch();
      await processUtils.enrichWithParentChains(emptyValue);
      expect(emptyValue[0].generationWitness).toBeNull();
    });

    it('refuses to derive a witness from an unusable birth time', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        mapWith({ name: 'claude.exe', ppid: 0, startTime: 0 }),
      );
      const agents = batch();
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].generationWitness).toBeNull();
      expect(agents[0].instanceId).toBe('100:u');
    });
  });

  describe('cross-record contamination', () => {
    it('never lets a record borrow a witness another record established', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith({
          name: 'claude.exe',
          ppid: 0,
          startTime: MS,
          witness: '11',
          witnessSource: 'sequence',
        }),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const enriched = batch();
      await processUtils.enrichWithParentChains(enriched);
      await processUtils.annotateWorkingDirs(enriched);

      // Another record moves the shared module cache on to witness 12.
      mockGetParentProcessMap.mockResolvedValue(
        mapWith({
          name: 'claude.exe',
          ppid: 0,
          startTime: MS,
          witness: '12',
          witnessSource: 'sequence',
        }),
      );
      const other = batch();
      await processUtils.enrichWithParentChains(other);
      expect(other[0].generationWitness).toBe('12');

      // This one never passed through enrichment: it carries no witness of its own,
      // so it gets the plain TTL contract — not somebody else's proof.
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const unenriched = batch();
      await processUtils.annotateWorkingDirs(unenriched);
      expect(unenriched[0].generationWitness).toBeUndefined();
      expect(unenriched[0].cwd).toBe('/home/user/project-a');
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
    });
  });

  describe('unchanged contracts', () => {
    it('derives a startTimeMs witness from a legacy map entry, exactly as before', async () => {
      // What the emergency CIM observation produces: a birth time and nothing else.
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith({ name: 'claude.exe', ppid: 200, startTime: MS }, { name: 'code.exe', ppid: 0 }),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const first = batch();
      await processUtils.enrichWithParentChains(first);
      await processUtils.annotateWorkingDirs(first);
      expect(first[0].generationWitness).toBe('1717000000000');
      expect(first[0].generationWitnessSource).toBe('startTimeMs');

      // A different birth millisecond is still a different generation.
      mockGetParentProcessMap.mockResolvedValue(
        mapWith(
          { name: 'claude.exe', ppid: 300, startTime: MS + 10700 },
          { name: 'cursor.exe', ppid: 0 },
        ),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const second = batch();
      await processUtils.enrichWithParentChains(second);
      await processUtils.annotateWorkingDirs(second);
      expect(second[0].parentChain).toEqual(['cursor.exe']);
      expect(second[0].cwd).toBe('/home/user/project-b');
      expect(second[0].instanceId).toBe('100:1717000010700');
    });

    it('leaves the pid-0 synthetics on the plain TTL contract', async () => {
      mockGetParentProcessMap.mockResolvedValue(new Map());
      mockGetProcessCwds.mockResolvedValue(new Map());
      const agents = [
        { pid: 0, agent: 'Ollama', process: 'ollama' },
        { pid: 0, agent: 'LM Studio', process: 'lm-studio' },
      ];
      await processUtils.enrichWithParentChains(agents);
      await processUtils.annotateWorkingDirs(agents);
      expect(agents[0].generationWitness).toBeNull();
      expect(agents[0].instanceId).toBe('0:ollama');
      expect(agents[1].instanceId).toBe('0:lm-studio');
      expect(mockGetProcessCwds).toHaveBeenCalledWith([0]);
    });

    it('still observes exactly one process map per non-empty pass', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 200,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'code.exe', ppid: 0 },
        ),
      );
      const agents = batch();
      await processUtils.enrichWithParentChains(agents);
      await processUtils.enrichWithParentChains(agents);
      await processUtils.enrichWithParentChains(agents);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(3);
    });

    it('still rebuilds the chain under forceRefresh even when the witness proves it', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 200,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'code.exe', ppid: 0 },
        ),
      );
      const agents = batch();
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].parentChain).toEqual(['code.exe']);

      mockGetParentProcessMap.mockResolvedValue(
        mapWith(
          {
            name: 'claude.exe',
            ppid: 300,
            startTime: MS,
            witness: '11',
            witnessSource: 'sequence',
          },
          { name: 'cursor.exe', ppid: 0 },
        ),
      );
      await processUtils.enrichWithParentChains(agents, { forceRefresh: true });
      expect(agents[0].parentChain).toEqual(['cursor.exe']);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(2);
    });

    it('stamps no witness at all on a platform with no per-pass observation', async () => {
      processUtils._setPlatformForTest({ providesStartTime: false });
      mockGetParentProcessMap.mockResolvedValue(
        mapWith({ name: 'claude', ppid: 200 }, { name: 'bash', ppid: 0 }),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-a']]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude' }];

      for (let i = 0; i < 3; i++) {
        await processUtils.enrichWithParentChains(agents);
        await processUtils.annotateWorkingDirs(agents);
      }
      expect(agents[0].generationWitness).toBeUndefined();
      expect(agents[0].instanceId).toBe('100:u');
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
    });
  });
});
