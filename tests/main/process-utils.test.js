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

    it('forceRefresh re-reads the map even for a cached pid + name', async () => {
      mockGetParentProcessMap.mockResolvedValue(
        new Map([
          [100, { name: 'claude.exe', ppid: 200, startTime: 1717000000000 }],
          [200, { name: 'code', ppid: 0 }],
        ]),
      );
      const agents = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(agents);
      await processUtils.enrichWithParentChains(agents);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1); // cached

      await processUtils.enrichWithParentChains(agents, { forceRefresh: true });
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(2);
    });

    it('a same-name reuse inside the TTL is the documented residual bound', async () => {
      // Honest test of the KNOWN BOUND in _cacheKey: pid + SAME exe name still
      // hits the cache, so the stale startTime survives until forceRefresh or TTL.
      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000000000 }]]),
      );
      const first = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(first);

      mockGetParentProcessMap.mockResolvedValueOnce(
        new Map([[100, { name: 'claude.exe', ppid: 0, startTime: 1717000500000 }]]),
      );
      const second = [{ pid: 100, agent: 'Claude Code', process: 'claude.exe' }];
      await processUtils.enrichWithParentChains(second);
      expect(mockGetParentProcessMap).toHaveBeenCalledTimes(1); // cache HIT
      expect(second[0].startTime).toBe(1717000000000); // stale, by design

      // forceRefresh — what scan-loop passes on a changed pid set — clears it.
      await processUtils.enrichWithParentChains(second, { forceRefresh: true });
      expect(second[0].startTime).toBe(1717000500000);
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
});
