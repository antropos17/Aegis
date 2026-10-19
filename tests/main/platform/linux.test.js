import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import linux from '../../../src/main/platform/linux.js';
import fs from 'node:fs';
import identity from '../../../src/main/platform/sensor-identity.js';

describe('linux exec-based functions', () => {
  let mockExecFile;

  beforeEach(() => {
    mockExecFile = vi.fn();
    linux._setExecFileForTest(mockExecFile);
  });

  afterEach(() => {
    linux._setExecFileForTest(null);
    vi.restoreAllMocks();
  });

  it('shares its actual reader pinned context with sensor conversion and withdraws it on failure', async () => {
    const bootId = '11111111-1111-4111-8111-111111111111';
    let seconds = '1700000000';
    let broken = false;
    const read = fs.readFileSync.bind(fs);
    const readdir = fs.readdirSync.bind(fs);
    const fields = Array(20).fill('0');
    fields[0] = 'S';
    fields[1] = '1';
    fields[19] = '12345';
    const record = `100 (node) ${fields.join(' ')}`;
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (file === '/proc/sys/kernel/random/boot_id') return bootId;
      if (file === '/proc/stat') return `btime ${seconds}\n`;
      if (file === '/proc/100/stat') return broken ? 'invalid' : record;
      return read(file, ...args);
    });
    vi.spyOn(fs, 'readdirSync').mockImplementation((dir, ...args) =>
      dir === '/proc' ? ['100'] : readdir(dir, ...args),
    );
    mockExecFile.mockImplementation((cmd, _args, _opts, cb) =>
      cb(null, cmd === 'getconf' ? '100' : '100 1 node\n'),
    );
    expect(linux.getProcessBirthContext()).toBeNull();
    const first = await linux.getParentProcessMap();
    const context = linux.getProcessBirthContext();
    expect(context).toEqual({ bootId, bootTimeSeconds: '1700000000', clockTicks: '100' });
    expect(Object.isFrozen(context)).toBe(true);
    const reads = readSpy.mock.calls.length;
    expect(linux.getProcessBirthContext()).not.toBe(context);
    expect(readSpy).toHaveBeenCalledTimes(reads);
    seconds = '1700003600';
    const second = await linux.getParentProcessMap();
    const converted = identity.convertSensorIdentity(
      {
        birth: '12345',
        identityError: null,
        witness: { kind: 'linux-start-ticks', bootId, startTicks: '12345' },
      },
      { platform: 'linux', linuxContext: linux.getProcessBirthContext() },
    );
    expect(second.get(100)).toEqual(first.get(100));
    expect(converted.startTime).toBe(1700000123450);
    expect(converted.witness).toBe(second.get(100).witness);
    broken = true;
    expect((await linux.getParentProcessMap()).get(100).startTime).toBeNull();
    expect(linux.getProcessBirthContext()).toBeNull();
    broken = false;
    await linux.getParentProcessMap();
    expect(linux.getProcessBirthContext()).toEqual(context);
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
    it('bounds ps and rejects when the command times out', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        expect(cmd).toBe('ps');
        expect(opts).toEqual({ timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
        cb(new Error('ps timed out'));
      });

      await expect(linux.listProcesses()).rejects.toThrow('ps timed out');
    });

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

    it('retains distinct local sockets in IPv4 and IPv6 ss output', async () => {
      const stdout = [
        'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
        'ESTAB 0 0 10.0.0.1:52001 52.1.2.3:443 users:(("node",pid=100,fd=3))',
        'ESTAB 0 0 10.0.0.1:52002 52.1.2.3:443 users:(("node",pid=100,fd=4))',
        'CLOSE-WAIT 0 0 [2001:db8::1]:52003 [2001:db8::2]:443 users:(("node",pid=100,fd=5))',
      ].join('\n');
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, stdout));
      const rows = await linux.getRawTcpConnections([100]);
      expect(rows.map(({ localIp, localPort }) => ({ localIp, localPort }))).toEqual([
        { localIp: '10.0.0.1', localPort: 52001 },
        { localIp: '10.0.0.1', localPort: 52002 },
        { localIp: '2001:db8::1', localPort: 52003 },
      ]);
      expect(rows[2]).toMatchObject({ ip: '2001:db8::2', port: 443, state: 'CLOSE-WAIT' });
    });

    it('finds a monitored owner after an unmonitored socket owner', async () => {
      const stdout = [
        'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
        'ESTAB 0 0 10.0.0.1:52001 52.1.2.3:443 users:(("helper",pid=999,fd=3),("node",pid=100,fd=4))',
      ].join('\n');
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, stdout));
      expect(await linux.getRawTcpConnections([100])).toEqual([
        {
          pid: 100,
          ip: '52.1.2.3',
          port: 443,
          state: 'ESTAB',
          localIp: '10.0.0.1',
          localPort: 52001,
        },
      ]);
    });

    it('reports each monitored PID once per socket while preserving IPv6 endpoints and state', async () => {
      const stdout = [
        'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
        'CLOSE-WAIT 0 0 [2001:db8::1]:52003 [2001:db8::2]:443 users:(("node",pid=100,fd=3),("worker",pid=200,fd=4),("node",pid=100,fd=5))',
        'ESTAB 0 0 10.0.0.1:52004 52.1.2.3:443 users:(("node",pid=100,fd=6))',
      ].join('\n');
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, stdout));
      expect(await linux.getRawTcpConnections([100, 200])).toEqual([
        {
          pid: 100,
          ip: '2001:db8::2',
          port: 443,
          state: 'CLOSE-WAIT',
          localIp: '2001:db8::1',
          localPort: 52003,
        },
        {
          pid: 200,
          ip: '2001:db8::2',
          port: 443,
          state: 'CLOSE-WAIT',
          localIp: '2001:db8::1',
          localPort: 52003,
        },
        {
          pid: 100,
          ip: '52.1.2.3',
          port: 443,
          state: 'ESTAB',
          localIp: '10.0.0.1',
          localPort: 52004,
        },
      ]);
    });

    it.each([
      'users:(("pid=100",pid=999,fd=3))',
      'users:(("fake,(node,pid=100,fd=3)",pid=999,fd=4))',
      'users:(("node",pid=100junk,fd=3))',
      'users:(("node",pid=100,fd=3),)',
      'users:(("node",pid=100,fd=3),("bad",pid=200))',
      'pid=100',
    ])('rejects malformed or lookalike owner text: %s', async (process) => {
      const stdout = `State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nESTAB 0 0 10.0.0.1:52001 52.1.2.3:443 ${process}`;
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, stdout));
      expect(await linux.getRawTcpConnections([100, 200])).toEqual([]);
    });

    it('uses actual owners when quoted process names contain PID lookalikes', async () => {
      const stdout = [
        'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
        'ESTAB 0 0 10.0.0.1:52001 52.1.2.3:443 users:(("pid=200",pid=100,fd=3),("worker",pid=200,fd=4))',
      ].join('\n');
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, stdout));
      expect((await linux.getRawTcpConnections([100, 200])).map(({ pid }) => pid)).toEqual([
        100, 200,
      ]);
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

    it('accepts a clean lsof no-match result when ss is unavailable', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (cmd === 'ss') return cb(new Error('ss not found'));
        // lsof normally exits 1 for no matches; -Q changes only search failures.
        cb(args.includes('-Q') ? null : Object.assign(new Error('no matches'), { code: 1 }), '');
      });
      await expect(linux.getRawTcpConnections([100])).resolves.toEqual([]);
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it.each([
      Object.assign(new Error('lsof permission denied'), { code: 1 }),
      Object.assign(new Error('lsof timed out'), { killed: true, signal: 'SIGTERM' }),
      Object.assign(new Error('lsof: illegal option -- Q'), { code: 1 }),
    ])('rejects genuine lsof failure after ss fails: %s', async (failure) => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (cmd === 'ss') return cb(new Error('ss not found'));
        expect(opts).toEqual({ timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
        // Partial stdout must not disguise provider failure as a valid snapshot.
        cb(failure, 'p100\nn10.0.0.1:50000->8.8.8.8:443\n');
      });
      await expect(linux.getRawTcpConnections([100])).rejects.toBe(failure);
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

    it('rejects when both ss and lsof fail (B-S05 — not silent empty)', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('command not found'));
      });
      await expect(linux.getRawTcpConnections([100])).rejects.toThrow('command not found');
    });
  });
});
