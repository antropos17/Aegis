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
});

describe('platform/restart-manager', () => {
  let rm;

  beforeEach(async () => {
    mockExecFile.mockReset();
    vi.resetModules();
    const mod = await import('../../../src/main/platform/restart-manager.js');
    rm = mod.default;
  });

  describe('_parseHolders', () => {
    it('flattens { group, reason, pids[] } groups into per-PID holders', () => {
      const json = JSON.stringify([
        { group: '/home/u/.ssh', reason: 'SSH keys/config', pids: [105, 200] },
        { group: '/home/u/.aws', reason: 'AWS credentials', pids: [105] },
      ]);
      expect(rm._parseHolders(json)).toEqual([
        { pid: 105, group: '/home/u/.ssh', reason: 'SSH keys/config' },
        { pid: 200, group: '/home/u/.ssh', reason: 'SSH keys/config' },
        { pid: 105, group: '/home/u/.aws', reason: 'AWS credentials' },
      ]);
    });

    it('returns [] for "[]" / empty / unparseable output', () => {
      expect(rm._parseHolders('[]')).toEqual([]);
      expect(rm._parseHolders('')).toEqual([]);
      expect(rm._parseHolders('not json')).toEqual([]);
    });

    it('wraps a single (non-array) group object', () => {
      const json = JSON.stringify({ group: '/home/u/.ssh', reason: 'SSH', pids: 105 });
      expect(rm._parseHolders(json)).toEqual([{ pid: 105, group: '/home/u/.ssh', reason: 'SSH' }]);
    });

    it('drops invalid PIDs and group-less entries', () => {
      const json = JSON.stringify([
        { group: '/home/u/.ssh', reason: 'SSH', pids: [0, -1, 'x', 105] },
        { reason: 'no group', pids: [300] },
      ]);
      expect(rm._parseHolders(json)).toEqual([{ pid: 105, group: '/home/u/.ssh', reason: 'SSH' }]);
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

    // White-box honesty: the P/Invoke branches on the holder COUNT (pnProcInfoNeeded
    // > 0), NOT on a 234/ERROR_MORE_DATA return code (which does not arrive here),
    // and the RM source carries no "read"/"accessed" wording — it is a hold.
    it('compiles a P/Invoke that branches on needed>0 and never says read/accessed', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'OK'));
      await rm.probeRestartManager();
      const script = mockExecFile.mock.calls[0][1][3];
      expect(script).toMatch(/RmStartSession/);
      expect(script).toMatch(/RmGetList/);
      expect(script).toMatch(/needed > 0/);
      expect(script).not.toMatch(/234/);
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
