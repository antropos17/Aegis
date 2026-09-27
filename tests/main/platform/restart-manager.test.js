import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Module from 'module';

// Intercept child_process so restart-manager never spawns a real powershell.exe.
const mockExecFile = vi.fn();
const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'child_process') return { execFile: mockExecFile };
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
  vi.unstubAllEnvs();
});

describe('platform/restart-manager', () => {
  let rm;
  const TICKS = '133000000000000001';

  beforeEach(async () => {
    vi.stubEnv('AEGIS_OBSERVER_PROVIDER', 'powershell');
    mockExecFile.mockReset();
    vi.resetModules();
    const mod = await import('../../../src/main/platform/restart-manager.js');
    rm = mod.default;
  });

  describe('_parseHolders', () => {
    it('preserves exact RM process creation ticks as decimal strings', () => {
      const ticks = '133000000000000001';
      const json = JSON.stringify({
        group: '/home/u/.ssh',
        reason: 'SSH',
        holders: [{ pid: 105, createTime100ns: ticks }],
      });
      expect(rm._parseHolders(json)).toEqual([
        { pid: 105, createTime100ns: ticks, group: '/home/u/.ssh', reason: 'SSH' },
      ]);
      expect(() =>
        rm._parseHolders(
          JSON.stringify({
            group: '/home/u/.ssh',
            holders: [{ pid: 105, createTime100ns: Number(ticks) }],
          }),
        ),
      ).toThrow();
    });

    it('flattens { group, reason, holders[] } groups into per-PID holders', () => {
      const json = JSON.stringify([
        {
          group: '/home/u/.ssh',
          reason: 'SSH keys/config',
          holders: [105, 200].map((pid) => ({ pid, createTime100ns: TICKS })),
        },
        {
          group: '/home/u/.aws',
          reason: 'AWS credentials',
          holders: [{ pid: 105, createTime100ns: TICKS }],
        },
      ]);
      expect(rm._parseHolders(json)).toEqual([
        { pid: 105, createTime100ns: TICKS, group: '/home/u/.ssh', reason: 'SSH keys/config' },
        { pid: 200, createTime100ns: TICKS, group: '/home/u/.ssh', reason: 'SSH keys/config' },
        { pid: 105, createTime100ns: TICKS, group: '/home/u/.aws', reason: 'AWS credentials' },
      ]);
    });

    it('distinguishes a reported empty result from missing or corrupt output', () => {
      expect(rm._parseHolders('[]')).toEqual([]);
      expect(() => rm._parseHolders('')).toThrow();
      expect(() => rm._parseHolders('not json')).toThrow();
      expect(() => rm._parseHolders('[]', [{ group: '/home/u/.ssh' }])).toThrow();
    });

    it('wraps a single (non-array) group object', () => {
      const json = JSON.stringify({
        group: '/home/u/.ssh',
        reason: 'SSH',
        holders: { pid: 105, createTime100ns: TICKS },
      });
      expect(rm._parseHolders(json)).toEqual([
        { pid: 105, createTime100ns: TICKS, group: '/home/u/.ssh', reason: 'SSH' },
      ]);
    });

    it('rejects invalid PIDs, birth times and group-less entries instead of claiming a clean scan', () => {
      const json = JSON.stringify([
        {
          group: '/home/u/.ssh',
          reason: 'SSH',
          holders: [0, -1, 'x']
            .map((pid) => ({ pid, createTime100ns: TICKS }))
            .concat([
              { pid: 104, createTime100ns: Number(TICKS) },
              { pid: 105, createTime100ns: TICKS },
            ]),
        },
        { reason: 'no group', holders: [{ pid: 300, createTime100ns: TICKS }] },
      ]);
      expect(() => rm._parseHolders(json)).toThrow();
    });
  });

  describe('probeRestartManager', () => {
    it('marks RM available when the Add-Type probe prints OK', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'OK\n'));
      const result = await rm.probeRestartManager();
      expect(result.available).toBe(true);
      expect(rm.isRestartManagerAvailable()).toBe(true);
    });

    it('marks RM unavailable when the probe prints FAIL', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'FAIL\n'));
      const result = await rm.probeRestartManager();
      expect(result.available).toBe(false);
      expect(rm.isRestartManagerAvailable()).toBe(false);
    });

    it('marks RM unavailable on probe error (fail honest, not optimistic)', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('no powershell')));
      const result = await rm.probeRestartManager();
      expect(result.available).toBe(false);
      expect(rm.isRestartManagerAvailable()).toBe(false);
    });

    // ERROR_MORE_DATA is expected for the sizing call; other failures must not
    // become a healthy empty scan.
    it('compiles a P/Invoke that checks RM failures and never says read/accessed', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'OK'));
      await rm.probeRestartManager();
      const script = mockExecFile.mock.calls[0][1][3];
      expect(script).toMatch(/RmStartSession/);
      expect(script).toMatch(/RmGetList/);
      expect(script).toMatch(/ProcessStartTime/);
      expect(script).toMatch(/createTime100ns/);
      expect(script).toMatch(/needed > 0/);
      expect(script).toMatch(/firstResult != 0 && firstResult != 234/);
      expect(script).toMatch(/RmRegisterResources failed/);
      expect(script).not.toMatch(/accessed|read/i);
    });
  });

  describe('getSensitiveHolders', () => {
    // PR-A honesty: when RM is unavailable, return [] WITHOUT spawning powershell —
    // the same honest-zero contract getFileHandles holds when no handle binary exists.
    it('returns [] without spawning when RM is unavailable', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'FAIL'));
      await rm.probeRestartManager(); // → unavailable
      const callsAfterProbe = mockExecFile.mock.calls.length;
      const holders = await rm.getSensitiveHolders();
      expect(holders).toEqual([]);
      expect(mockExecFile.mock.calls.length).toBe(callsAfterProbe); // no extra spawn
    });
  });

  describe('buildSensitiveGroups', () => {
    it('returns an array and never throws (shallow enumeration of secret dirs)', () => {
      const groups = rm.buildSensitiveGroups();
      expect(Array.isArray(groups)).toBe(true);
      for (const g of groups) {
        expect(typeof g.group).toBe('string');
        expect(Array.isArray(g.files)).toBe(true);
      }
    });

    // Hot-scoping: when given a subset + includeEnv=false, the params must be
    // honored — no .aws/.gnupg groups, no ~/.env* single-file groups. Fails if
    // the function ignored its args and used the hardcoded full set. (On a host
    // with no ~/.ssh the list is empty and the loop is vacuously clean.)
    it('honors dirNames subset and includeEnv=false (hot scoping)', () => {
      const path = require('path');
      const groups = rm.buildSensitiveGroups(['.ssh'], false);
      expect(Array.isArray(groups)).toBe(true);
      for (const g of groups) {
        const lower = g.group.toLowerCase();
        expect(lower).not.toContain(`${path.sep}.aws`);
        expect(lower).not.toContain(`${path.sep}.gnupg`);
        expect(/^\.env(\.|$)/i.test(path.basename(g.group))).toBe(false);
      }
    });
  });

  describe('exports', () => {
    it('exports the RM contract', () => {
      expect(typeof rm.getSensitiveHolders).toBe('function');
      expect(typeof rm.getHotSensitiveHolders).toBe('function');
      expect(typeof rm.probeRestartManager).toBe('function');
      expect(typeof rm.isRestartManagerAvailable).toBe('function');
      expect(typeof rm.buildSensitiveGroups).toBe('function');
    });
  });
});
