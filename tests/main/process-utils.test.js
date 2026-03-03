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
