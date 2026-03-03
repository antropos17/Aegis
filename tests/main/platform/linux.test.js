import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import linux from '../../../src/main/platform/linux.js';

describe('linux exec-based functions', () => {
  let mockExecFile;

  beforeEach(() => {
    mockExecFile = vi.fn();
    linux._setExecFileForTest(mockExecFile);
  });

  afterEach(() => {
    linux._setExecFileForTest(null);
  });

  describe('PID validation', () => {
    const invalidPids = [0, -1, 1.5, 'abc', null, undefined];

    it('getFileHandles returns [] for invalid PIDs', async () => {
      for (const bad of invalidPids) {
        expect(await linux.getFileHandles(bad)).toEqual([]);
      }
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('getProcessCwd returns null for invalid PIDs', async () => {
      for (const bad of invalidPids) {
        expect(await linux.getProcessCwd(bad)).toBeNull();
      }
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('listProcesses()', () => {
    it('parses ps output into process objects', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'node  1234\nbash  5678\n/usr/bin/python  9999\n');
      });
      const procs = await linux.listProcesses();
      expect(procs).toHaveLength(3);
      expect(procs[0]).toEqual({ name: 'node', pid: 1234 });
      expect(procs[1]).toEqual({ name: 'bash', pid: 5678 });
      expect(procs[2]).toEqual({ name: 'python', pid: 9999 });
    });

    it('strips path prefix from process names', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '/usr/local/bin/node  100\n');
      });
      const procs = await linux.listProcesses();
      expect(procs[0].name).toBe('node');
    });

    it('skips malformed lines', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'node  100\n\nbadline\n  200\nreal  300\n');
      });
      const procs = await linux.listProcesses();
      expect(procs).toHaveLength(2);
    });

    it('rejects on exec error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('ps failed'));
      });
      await expect(linux.listProcesses()).rejects.toThrow('ps failed');
    });

    it('handles empty output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '\n');
      });
      const procs = await linux.listProcesses();
      expect(procs).toEqual([]);
    });
  });

  describe('getRawTcpConnections()', () => {
    it('returns empty array for empty PID list', async () => {
      const results = await linux.getRawTcpConnections([]);
      expect(results).toEqual([]);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('parses ss output when ss succeeds', async () => {
      const ssOutput = [
        'State      Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process',
        'ESTAB      0      0      10.0.0.1:50000     52.1.2.3:443       users:(("node",pid=100,fd=3))',
      ].join('\n');
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (cmd === 'ss') cb(null, ssOutput);
        else cb(new Error('should not be called'));
      });
      const results = await linux.getRawTcpConnections([100]);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ pid: 100, ip: '52.1.2.3', port: 443 });
    });

    it('falls back to lsof when ss fails', async () => {
      const lsofOutput = 'p100\nn10.0.0.1:50000->8.8.8.8:443\n';
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (cmd === 'ss') cb(new Error('ss not found'));
        else if (cmd === 'lsof') cb(null, lsofOutput);
      });
      const results = await linux.getRawTcpConnections([100]);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ pid: 100, ip: '8.8.8.8', port: 443 });
    });

    it('returns empty when ss succeeds but no matching PIDs', async () => {
      const ssOutput = [
        'State      Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process',
        'ESTAB      0      0      10.0.0.1:50000     52.1.2.3:443       users:(("node",pid=999,fd=3))',
      ].join('\n');
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (cmd === 'ss') cb(null, ssOutput);
        else if (cmd === 'lsof') cb(null, 'p100\nn10.0.0.1:50000->8.8.8.8:443\n');
      });
      const results = await linux.getRawTcpConnections([100]);
      // ss succeeded — should NOT fall back to lsof even with 0 matches
      expect(results).toHaveLength(0);
    });

    it('returns empty when both ss and lsof fail', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('command not found'));
      });
      const results = await linux.getRawTcpConnections([100]);
      expect(results).toEqual([]);
    });
  });
});
