import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const linux = require('../../../src/main/platform/linux');

describe('linux parseSsOutput()', () => {
  const header = 'State      Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process';

  it('parses state, peer, pid', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     52.1.2.3:443       users:(("node",pid=1234,fd=12))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([1234]));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      pid: 1234,
      ip: '52.1.2.3',
      port: 443,
      state: 'ESTAB',
    });
  });

  it('extracts PID from users field', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     8.8.8.8:53        users:(("chrome",pid=5678,fd=5))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([5678]));
    expect(results[0].pid).toBe(5678);
  });

  it('IPv6 bracket notation', () => {
    const stdout = [
      header,
      'ESTAB      0      0      [::1]:50000        [2607:f8b0::1]:443 users:(("node",pid=100,fd=3))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(1);
    expect(results[0].ip).toBe('2607:f8b0::1');
    expect(results[0].port).toBe(443);
  });

  it('filters by pidSet', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     8.8.8.8:443       users:(("node",pid=100,fd=3))',
      'ESTAB      0      0      10.0.0.1:50001     9.9.9.9:80        users:(("node",pid=200,fd=4))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([200]));
    expect(results).toHaveLength(1);
    expect(results[0].pid).toBe(200);
  });

  it('skips loopback', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     127.0.0.1:3000    users:(("node",pid=100,fd=3))',
      'ESTAB      0      0      10.0.0.1:50001     [::1]:3000        users:(("node",pid=100,fd=4))',
      'ESTAB      0      0      10.0.0.1:50002     8.8.8.8:443       users:(("node",pid=100,fd=5))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(1);
    expect(results[0].ip).toBe('8.8.8.8');
  });

  it('skips header', () => {
    const stdout = header + '\n';
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(0);
  });

  it('handles malformed lines', () => {
    const stdout = [
      header,
      'ESTAB      0',
      '',
      'ESTAB      0      0      10.0.0.1:50000     8.8.8.8:443       users:(("node",pid=100,fd=3))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(1);
  });

  it('skips lines without pid= in process field', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     8.8.8.8:443       users:(("node",fd=3))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(0);
  });

  it('skips 0.0.0.0 and * peers', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     0.0.0.0:443       users:(("node",pid=100,fd=3))',
      'ESTAB      0      0      10.0.0.1:50001     *:80               users:(("node",pid=100,fd=4))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(0);
  });

  it('handles multiple connections for same PID', () => {
    const stdout = [
      header,
      'ESTAB      0      0      10.0.0.1:50000     1.1.1.1:443       users:(("node",pid=100,fd=3))',
      'ESTAB      0      0      10.0.0.1:50001     2.2.2.2:80        users:(("node",pid=100,fd=4))',
      'TIME-WAIT  0      0      10.0.0.1:50002     3.3.3.3:8080      users:(("node",pid=100,fd=5))',
    ].join('\n');
    const results = linux.parseSsOutput(stdout, new Set([100]));
    expect(results).toHaveLength(3);
    expect(results[2].state).toBe('TIME-WAIT');
  });
});

describe('linux exec-based functions', () => {
  let mockExecFile;

  beforeEach(() => {
    mockExecFile = vi.fn();
    linux._setExecFileForTest(mockExecFile);
  });

  afterEach(() => {
    linux._setExecFileForTest(null);
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

    it('falls back to lsof when ss returns no matching results', async () => {
      const ssOutput = [
        'State      Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process',
        'ESTAB      0      0      10.0.0.1:50000     52.1.2.3:443       users:(("node",pid=999,fd=3))',
      ].join('\n');
      const lsofOutput = 'p100\nn10.0.0.1:50000->8.8.8.8:443\n';
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (cmd === 'ss') cb(null, ssOutput);
        else if (cmd === 'lsof') cb(null, lsofOutput);
      });
      const results = await linux.getRawTcpConnections([100]);
      expect(results).toHaveLength(1);
      expect(results[0].ip).toBe('8.8.8.8');
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
