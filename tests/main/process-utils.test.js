import { describe, it, expect, beforeEach, vi } from 'vitest';
import processUtils from '../../src/main/process-utils.js';

describe('process-utils', () => {
  let mockGetParentProcessMap;
  let mockGetProcessCwd;
  let mockGetProcessCwds;

  beforeEach(() => {
    mockGetParentProcessMap = vi.fn();
    mockGetProcessCwd = vi.fn();
    mockGetProcessCwds = vi.fn();
    processUtils._resetForTest();
    processUtils._setPlatformForTest({
      getParentProcessMap: mockGetParentProcessMap,
      getProcessCwd: mockGetProcessCwd,
      getProcessCwds: mockGetProcessCwds,
      // Pinned, never inherited from the CI host: the generation proof only exists
      // on a platform that supplies an OS birth time. Both settings are exercised
      // deterministically — see the `providesStartTime: false` describe at the end.
      providesStartTime: true,
    });
  });

  describe('getParentChains()', () => {
    it('walks chain correctly (depth 6)', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'agent', ppid: 200 }],
          [200, { name: 'parent1', ppid: 300 }],
          [300, { name: 'parent2', ppid: 400 }],
          [400, { name: 'parent3', ppid: 500 }],
          [500, { name: 'parent4', ppid: 600 }],
          [600, { name: 'parent5', ppid: 700 }],
          [700, { name: 'parent6', ppid: 800 }],
          [800, { name: 'parent7', ppid: 0 }],
        ]),
      );

      const chains = await processUtils.getParentChains([100]);
      const chain = chains.get(100);
      expect(chain).toBeDefined();
      expect(chain.length).toBeLessThanOrEqual(6);
      expect(chain[0]).toBe('parent1');
    });

    it('cycle detection', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'a', ppid: 200 }],
          [200, { name: 'b', ppid: 100 }],
        ]),
      );

      const chains = await processUtils.getParentChains([100]);
      const chain = chains.get(100);
      expect(chain).toEqual(['b', 'a']);
    });

    it('caching within TTL', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'a', ppid: 200 }],
          [200, { name: 'b', ppid: 0 }],
        ]),
      );

      await processUtils.getParentChains([100]);
      await processUtils.getParentChains([100]);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after TTL', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'a', ppid: 200 }],
          [200, { name: 'b', ppid: 0 }],
        ]),
      );

      await processUtils.getParentChains([100]);

      vi.useFakeTimers();
      vi.advanceTimersByTime(61000);

      await processUtils.getParentChains([100]);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('empty PID list', async () => {
      const chains = await processUtils.getParentChains([]);
      expect(chains.size).toBe(0);
    });
  });

  describe('enrichWithParentChains()', () => {
    it('attaches chains to agents', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'a', ppid: 200 }],
          [200, { name: 'code', ppid: 0 }],
        ]),
      );

      const agents = [{ pid: 100, agent: 'Claude' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].parentChain).toBeDefined();
      expect(agents[0].parentChain).toContain('code');
    });
  });

  describe('enrichWithParentChains() — OS startTime', () => {
    it('surfaces OS startTime (epoch-ms) from the win32 map onto the agent', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code', ppid: 0, startTime: 1716999990000 }],
        ]),
      );

      const agents = [{ pid: 100, agent: 'Claude' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].startTime).toBe(1717000000000);
    });

    it('sets startTime null when the map entry has no startTime (darwin/linux shape)', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude', ppid: 200 }],
          [200, { name: 'bash', ppid: 0 }],
        ]),
      );

      const agents = [{ pid: 100, agent: 'Claude' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].startTime).toBeNull();
    });

    it('sets startTime null for a synthetic PID absent from the map', async () => {
      mockGetParentProcessMap.mockResolvedValue(new Map([[100, { name: 'a', ppid: 0 }]]));

      const agents = [{ pid: 0, agent: 'Ollama' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].startTime).toBeNull();
    });
  });

  describe('enrichWithParentChains() — PID-reuse cache poisoning', () => {
    it('the same PID with a DIFFERENT process name misses the cache and gets a fresh startTime', async () => {
      // The cache TTL is 60s. Keyed on pid alone, a pid recycled by another
      // executable inside that window served the DEAD process's startTime — the
      // one field instanceId is built from.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code', ppid: 0, startTime: 1716999990000 }],
        ]),
      );
      const dead = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(dead);
      expect(dead[0].startTime).toBe(1717000000000);

      // Same tick window, same pid — now held by a different executable.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([[100, { name: 'node.exe', ppid: 300, startTime: 1717000500000 }]]),
      );
      const reused = [{ pid: 100, agent: 'opencode', process: 'node.exe' }];
      await processUtils.enrichWithParentChains(reused);

      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(2); // cache MISS
      expect(reused[0].startTime).toBe(1717000500000);
      expect(reused[0].instanceId).not.toBe(dead[0].instanceId);
    });

    it('forceRefresh rebuilds the chain from the observed map even for a proven generation', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].parentChain).toEqual(['code.exe']);

      // Same birth time, so the generation is proven and the cached chain would
      // normally win. forceRefresh rebuilds it from the map this pass observed —
      // and that is still ONE call, because it is the only map fetched.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 300, startTime: 1717000000000 }],
          [300, { name: 'cursor.exe', ppid: 0 }],
        ]),
      );
      await processUtils.enrichWithParentChains(agents, { forceRefresh: true });
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(2);
      expect(agents[0].parentChain).toEqual(['cursor.exe']);
    });

    it('a same-name reuse sharing one birth-time millisecond is the residual bound', async () => {
      // What the KNOWN BOUND in _cacheKey used to be — pid + SAME exe name serving
      // the dead process's startTime until forceRefresh or TTL — is gone: the fresh
      // birth time separates those instances with forceRefresh false (see the
      // generation-proof describe above). What is left is genuine indistinguish-
      // ability: two instances sharing a pid AND the same epoch-ms birth time. That
      // is the millisecond bound documented in process-identity.js, not a cache
      // defect, and it degrades to "two instances read as one", never to a wrong
      // instance.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000000000 }]]),
      );
      const first = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(first);

      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(second);
      expect(second[0].startTime).toBe(1717000000000);
      expect(second[0].instanceId).toBe(first[0].instanceId);
    });
  });

  describe('enrichWithParentChains() — fresh OS birth time as the generation proof', () => {
    it('a same-name pid reuse with a different birth time is a NEW instance, not the dead one', async () => {
      // Reproduced on production code: two processes 10.7 s apart, same pid, same
      // executable name, forceRefresh false — both were stamped with the FIRST
      // birth time because the cached entry answered without the provider ever
      // being called.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0, startTime: 1716999990000 }],
        ]),
      );
      const first = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(first);
      expect(first[0].startTime).toBe(1717000000000);
      expect(first[0].instanceId).toBe('100:1717000000000');

      // Windows reissued pid 100 to a new claude.exe 10.7 s later — inside the 60 s TTL.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000010700 }],
          [200, { name: 'code.exe', ppid: 0, startTime: 1716999990000 }],
        ]),
      );
      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(second);

      expect(second[0].startTime).toBe(1717000010700);
      expect(second[0].instanceId).toBe('100:1717000010700');
      expect(second[0].instanceId).not.toBe(first[0].instanceId);
      expect(second[0].instanceIdSource).toBe('os');
    });

    it('a different birth time gives the new process its OWN parent chain', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      const first = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(first);
      expect(first[0].parentChain).toEqual(['code.exe']);

      // Same pid and name, new birth time, launched from a different host.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 300, startTime: 1717000010700 }],
          [300, { name: 'cursor.exe', ppid: 0 }],
        ]),
      );
      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(second);
      expect(second[0].parentChain).toEqual(['cursor.exe']);
    });

    it('a PROVEN same generation keeps the cached parent chain', async () => {
      // The opposite case, pinned hard: the freshness observation must not turn the
      // parent-chain cache into decorative code. The second fresh map deliberately
      // reports a DIFFERENT parent topology under the SAME birth time; the cached
      // chain must win, because the birth time proves it is the same process.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      const first = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(first);
      expect(first[0].parentChain).toEqual(['code.exe']);

      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 300, startTime: 1717000000000 }],
          [300, { name: 'cursor.exe', ppid: 0 }],
        ]),
      );
      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(second);

      expect(second[0].parentChain).toEqual(['code.exe']);
      expect(second[0].startTime).toBe(1717000000000);
      expect(second[0].instanceId).toBe('100:1717000000000');
    });

    it('a withheld fresh birth time never inherits the cached numeric startTime', async () => {
      // Fail honest: the fresh observation cannot produce a usable birth time for a
      // pid that previously had one. The stale number must not be served, and the
      // old generation's cache data must not be treated as proven.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const warm = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(warm);
      await processUtils.annotateWorkingDirs(warm);
      expect(warm[0].startTime).toBe(1717000000000);
      expect(warm[0].cwd).toBe('/home/user/project-a');

      // CreationDate withheld on this observation (access/rare) — the entry exists,
      // the birth time does not.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 200 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const degraded = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(degraded);

      expect(degraded[0].startTime).toBeNull();
      expect(degraded[0].instanceId).toBe('100:u');
      expect(degraded[0].instanceIdSource).toBe('unknown');

      // The generation-bound cwd of the old generation is not proven either.
      await processUtils.annotateWorkingDirs(degraded);
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2);
      expect(degraded[0].cwd).toBe('/home/user/project-b');
    });
  });

  describe('enrichWithParentChains() — process-map call cardinality', () => {
    it('performs exactly one process-map call on the first non-empty enrichment', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      await processUtils.enrichWithParentChains([
        { pid: 100, agent: 'Claude Code', process: 'claude.exe' },
      ]);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
    });

    it('performs exactly one MORE call on a fully cached same-generation pass', async () => {
      // The birth time is the generation proof, so it must be freshly observed even
      // when every other field is cached — one call, never zero, never two.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(agents);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
      await processUtils.enrichWithParentChains(agents);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(2);
      await processUtils.enrichWithParentChains(agents);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(3);
    });

    it('performs exactly one call — not two — when the generation changed', async () => {
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
        ]),
      );
      await processUtils.enrichWithParentChains([
        { pid: 100, agent: 'Claude Code', process: 'claude.exe' },
      ]);
      mockGetParentProcessMap.mockClear();

      // Generation change AND a chain rebuild in the same pass: the fresh map that
      // proved the change must also serve the rebuild.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 300, startTime: 1717000010700 }],
          [300, { name: 'cursor.exe', ppid: 0 }],
        ]),
      );
      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(second);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
      expect(second[0].parentChain).toEqual(['cursor.exe']);
    });

    it('performs exactly one call — not two — for a pid that was never cached', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code.exe', ppid: 0 }],
          [400, { name: 'cursor.exe', ppid: 200, startTime: 1717000020000 }],
        ]),
      );
      await processUtils.enrichWithParentChains([
        { pid: 100, agent: 'Claude Code', process: 'claude.exe' },
      ]);
      mockGetParentProcessMap.mockClear();

      const mixed = [
        { pid: 100, agent: 'Claude Code', process: 'claude.exe' },
        { pid: 400, agent: 'Cursor', process: 'cursor.exe' },
      ];
      await processUtils.enrichWithParentChains(mixed);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
      expect(mixed[1].parentChain).toEqual(['code.exe']);
      expect(mixed[1].instanceId).toBe('400:1717000020000');
    });
  });

  describe('enrichWithParentChains() — instanceId stamping', () => {
    it('stamps instanceId + source os when the OS birth time is readable', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000000000 }]]),
      );
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].instanceId).toBe('100:1717000000000');
      expect(agents[0].instanceIdSource).toBe('os');
    });

    it('stamps the honest unknown key when the platform withholds the birth time', async () => {
      mockGetParentProcessMap.mockResolvedValue(new Map([[100, { name: 'claude', ppid: 0 }]]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].instanceId).toBe('100:u');
      expect(agents[0].instanceIdSource).toBe('unknown');
    });

    it('stamps distinct synthetic keys for pid-0 agents', async () => {
      mockGetParentProcessMap.mockResolvedValue(new Map());
      const agents = [
        { pid: 0, agent: 'Ollama', process: 'ollama' },
        { pid: 0, agent: 'LM Studio', process: 'lm-studio' },
      ];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].instanceId).toBe('0:ollama');
      expect(agents[1].instanceId).toBe('0:lm-studio');
      expect(agents[0].instanceIdSource).toBe('synthetic');
      expect(agents[1].startTime).toBeNull();
    });
  });

  describe('annotateHostApps()', () => {
    it('sets parentEditor/displayLabel for known editors', () => {
      const agents = [{ agent: 'Claude', parentChain: ['code'] }];
      processUtils.annotateHostApps(agents);
      expect(agents[0].parentEditor).toBe('VS Code');
      expect(agents[0].displayLabel).toBe('Claude (via VS Code)');
    });

    it('case-insensitive', () => {
      const agents = [{ agent: 'Claude', parentChain: ['Code.exe'] }];
      processUtils.annotateHostApps(agents);
      expect(agents[0].parentEditor).toBe('VS Code');
    });

    it('skips agents without parentChain', () => {
      const agents = [{ agent: 'Claude' }];
      processUtils.annotateHostApps(agents);
      expect(agents[0].parentEditor).toBeUndefined();
    });
  });

  describe('annotateWorkingDirs()', () => {
    it('sets cwd and projectName via batch lookup', async () => {
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/my-project']]));
      const agents = [{ pid: 100, agent: 'Claude' }];
      await processUtils.annotateWorkingDirs(agents);
      expect(agents[0].cwd).toBe('/home/user/my-project');
      expect(agents[0].projectName).toBe('my-project');
      expect(mockGetProcessCwds).toHaveBeenCalledWith([100]);
    });

    it('caches within TTL', async () => {
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/proj']]));
      const agents = [{ pid: 100, agent: 'Claude' }];
      await processUtils.annotateWorkingDirs(agents);
      await processUtils.annotateWorkingDirs(agents);
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
    });

    it('handles null CWD from batch', async () => {
      mockGetProcessCwds.mockResolvedValue(new Map());
      const agents = [{ pid: 100, agent: 'Claude' }];
      await processUtils.annotateWorkingDirs(agents);
      expect(agents[0].cwd).toBeNull();
      expect(agents[0].projectName).toBeNull();
    });

    it('batches multiple PIDs in single call', async () => {
      mockGetProcessCwds.mockResolvedValue(
        new Map([
          [100, '/home/user/proj-a'],
          [200, '/home/user/proj-b'],
        ]),
      );
      const agents = [
        { pid: 100, agent: 'Claude' },
        { pid: 200, agent: 'Cursor' },
      ];
      await processUtils.annotateWorkingDirs(agents);
      expect(agents[0].cwd).toBe('/home/user/proj-a');
      expect(agents[1].cwd).toBe('/home/user/proj-b');
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
      expect(mockGetProcessCwds).toHaveBeenCalledWith([100, 200]);
    });
  });

  describe('annotateWorkingDirs() — PID-reuse cache poisoning', () => {
    it('the same PID with a DIFFERENT process name misses the cache and gets a fresh cwd', async () => {
      // The cache TTL is 60s. Keyed on pid alone, a pid recycled by another
      // executable inside that window served the DEAD process's cwd — the field
      // the renderer's instance key is built from and CWD_CONTAINMENT matches on.
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const dead = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.annotateWorkingDirs(dead);
      expect(dead[0].cwd).toBe('/home/user/project-a');

      // Same tick window, same pid — now held by a different executable.
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-b']]));
      const reused = [{ pid: 100, agent: 'opencode', process: 'node.exe' }];
      await processUtils.annotateWorkingDirs(reused);

      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2); // cache MISS
      expect(reused[0].cwd).toBe('/home/user/project-b');
      expect(reused[0].projectName).toBe('project-b');
    });

    it('forceRefresh re-reads the cwd even for a cached pid + name', async () => {
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.annotateWorkingDirs(agents);
      await processUtils.annotateWorkingDirs(agents);
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1); // cached

      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-b']]));
      await processUtils.annotateWorkingDirs(agents, { forceRefresh: true });
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2);
      expect(agents[0].cwd).toBe('/home/user/project-b');
      expect(agents[0].projectName).toBe('project-b');
    });

    it('serves the TTL cache when no generation was established for the key', async () => {
      // enrichWithParentChains never ran here, so there is no established
      // generation to check the entry against and the plain TTL contract applies —
      // the same contract linux and darwin keep. In the scan loop the identity
      // stamp always runs first, and the generation describe above covers that.
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const first = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.annotateWorkingDirs(first);

      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-b']]));
      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.annotateWorkingDirs(second);
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1); // cache HIT
      expect(second[0].cwd).toBe('/home/user/project-a'); // the live TTL entry

      // forceRefresh — what a changed pid set warrants — clears it.
      await processUtils.annotateWorkingDirs(second, { forceRefresh: true });
      expect(second[0].cwd).toBe('/home/user/project-b');
    });

    it('does not serve the dead generation cwd to the instance that replaced it', async () => {
      // pid 100, claude.exe, birth time A with cwd A, then birth time B with cwd B,
      // forceRefresh false throughout. Once enrichWithParentChains has established
      // B, the A-generation cwd is no longer proven.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000000000 }]]),
      );
      mockGetProcessCwds.mockResolvedValueOnce(new Map([[100, '/home/user/project-a']]));
      const genA = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(genA);
      await processUtils.annotateWorkingDirs(genA);
      expect(genA[0].cwd).toBe('/home/user/project-a');

      mockGetParentProcessMap.mockResolvedValue(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000010700 }]]),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-b']]));
      const genB = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(genB);
      await processUtils.annotateWorkingDirs(genB);

      expect(mockGetProcessCwds).toHaveBeenCalledTimes(2);
      expect(genB[0].cwd).toBe('/home/user/project-b');
      expect(genB[0].projectName).toBe('project-b');
    });

    it('keeps the cwd cached across repeated observations of the same proven generation', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000000000 }]]),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-a']]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      for (let i = 0; i < 3; i++) {
        await processUtils.enrichWithParentChains(agents);
        await processUtils.annotateWorkingDirs(agents);
      }
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
      expect(agents[0].cwd).toBe('/home/user/project-a');
    });

    it('performs no process-map lookup of its own', async () => {
      // The generation is consumed from what enrichWithParentChains established —
      // annotateWorkingDirs never observes a birth time itself.
      mockGetParentProcessMap.mockResolvedValue(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000000000 }]]),
      );
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-a']]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(agents);
      mockGetParentProcessMap.mockClear();

      await processUtils.annotateWorkingDirs(agents);
      await processUtils.annotateWorkingDirs(agents, { forceRefresh: true });
      expect(mockGetParentProcessMap).not.toHaveBeenCalled();
    });

    it('deduplicates a pid shared by several agents in the batched platform call', async () => {
      // pid-0 synthetics all share one pid but now hold distinct cache keys, so
      // the pid must be sent to the platform once, not once per agent.
      mockGetProcessCwds.mockResolvedValue(new Map());
      const agents = [
        { pid: 0, agent: 'Ollama', process: 'ollama' },
        { pid: 0, agent: 'LM Studio', process: 'lm-studio' },
      ];
      await processUtils.annotateWorkingDirs(agents);
      expect(mockGetProcessCwds).toHaveBeenCalledWith([0]);
      expect(agents[0].cwd).toBeNull();
      expect(agents[1].cwd).toBeNull();
    });
  });

  describe('a platform that supplies no OS birth time (linux / darwin shape)', () => {
    beforeEach(() => {
      // Pinned false, so this suite proves the no-startTime behaviour on ANY host.
      processUtils._setPlatformForTest({ providesStartTime: false });
    });

    it('keeps the parent-chain cache and adds no per-pass process-map fetch', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude', ppid: 200 }],
          [200, { name: 'bash', ppid: 0 }],
        ]),
      );
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude' }];
      await processUtils.enrichWithParentChains(agents);
      await processUtils.enrichWithParentChains(agents);
      await processUtils.enrichWithParentChains(agents);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1);
      expect(agents[0].parentChain).toEqual(['bash']);
    });

    it('stamps the honest unknown identity with a null startTime', async () => {
      mockGetParentProcessMap.mockResolvedValue(new Map([[100, { name: 'claude', ppid: 0 }]]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude' }];
      await processUtils.enrichWithParentChains(agents);
      expect(agents[0].startTime).toBeNull();
      expect(agents[0].instanceId).toBe('100:u');
      expect(agents[0].instanceIdSource).toBe('unknown');
    });

    it('keeps the cwd cache — there is no generation to gate it on', async () => {
      mockGetParentProcessMap.mockResolvedValue(new Map([[100, { name: 'claude', ppid: 0 }]]));
      mockGetProcessCwds.mockResolvedValue(new Map([[100, '/home/user/project-a']]));
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude' }];
      for (let i = 0; i < 3; i++) {
        await processUtils.enrichWithParentChains(agents);
        await processUtils.annotateWorkingDirs(agents);
      }
      expect(mockGetProcessCwds).toHaveBeenCalledTimes(1);
      expect(agents[0].cwd).toBe('/home/user/project-a');
    });
  });
});
