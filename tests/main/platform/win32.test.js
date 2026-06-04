import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Module from 'module';

const mockExecFile = vi.fn();

const originalLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'child_process') return { execFile: mockExecFile };
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

describe('platform/win32', () => {
  let win32;

  beforeEach(async () => {
    mockExecFile.mockReset();
    vi.resetModules();
    const mod = await import('../../../src/main/platform/win32.js');
    win32 = mod.default;
  });

  describe('IGNORE_FILE_PATTERNS', () => {
    it('ignores C:\\Windows paths (case-insensitive)', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\Windows\\System32\\cmd.exe'))).toBe(
        true,
      );
      expect(win32.IGNORE_FILE_PATTERNS.some((p) => p.test('c:\\windows\\explorer.exe'))).toBe(
        true,
      );
    });

    it('ignores C:\\Program Files\\Windows paths', () => {
      expect(
        win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\Program Files\\Windows Defender\\foo')),
      ).toBe(true);
    });

    it('ignores pagefile.sys', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\pagefile.sys'))).toBe(true);
    });

    it('ignores swapfile.sys', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\swapfile.sys'))).toBe(true);
    });

    it('ignores $Extend', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\$Extend\\$UsnJrnl'))).toBe(true);
    });

    it('ignores System Volume Information', () => {
      expect(
        win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\System Volume Information\\foo')),
      ).toBe(true);
    });

    it('ignores \\Device\\ paths', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some((p) => p.test('\\Device\\HarddiskVolume1'))).toBe(
        true,
      );
    });

    it('does NOT ignore user files', () => {
      expect(
        win32.IGNORE_FILE_PATTERNS.some((p) => p.test('C:\\Users\\me\\project\\main.js')),
      ).toBe(false);
    });
  });

  describe('listProcesses', () => {
    it('parses tasklist CSV output', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => {
        cb(
          null,
          '"claude.exe","1234","Console","1","50,000 K"\n"code.exe","5678","Console","1","100,000 K"\n',
        );
      });

      const procs = await win32.listProcesses();
      expect(procs).toEqual([
        { name: 'claude.exe', pid: 1234 },
        { name: 'code.exe', pid: 5678 },
      ]);
    });

    it('skips malformed lines', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => {
        cb(null, 'this is not csv\n"node.exe","100","Console","1","50K"\n');
      });

      const procs = await win32.listProcesses();
      expect(procs).toHaveLength(1);
      expect(procs[0].name).toBe('node.exe');
    });

    it('rejects on error', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => {
        cb(new Error('tasklist failed'));
      });

      await expect(win32.listProcesses()).rejects.toThrow('tasklist failed');
    });
  });

  describe('getParentProcessMap', () => {
    it('parses PowerShell JSON output into Map', async () => {
      const psOutput = JSON.stringify({
        100: { n: 'node.exe', p: 50 },
        200: { n: 'claude.exe', p: 100 },
      });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, psOutput);
      });

      const map = await win32.getParentProcessMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.get(100)).toEqual({ name: 'node.exe', ppid: 50 });
      expect(map.get(200)).toEqual({ name: 'claude.exe', ppid: 100 });
    });

    it('returns empty Map on error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('fail'));
      });

      const map = await win32.getParentProcessMap();
      expect(map.size).toBe(0);
    });

    it('returns empty Map on invalid JSON', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'not json');
      });

      const map = await win32.getParentProcessMap();
      expect(map.size).toBe(0);
    });

    it('returns empty Map on empty stdout', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '');
      });

      const map = await win32.getParentProcessMap();
      expect(map.size).toBe(0);
    });
  });

  describe('getRawTcpConnections', () => {
    it('returns empty array for empty PID list', async () => {
      const result = await win32.getRawTcpConnections([]);
      expect(result).toEqual([]);
    });

    it('filters out invalid PIDs', async () => {
      const result = await win32.getRawTcpConnections([0, -1, 1.5]);
      expect(result).toEqual([]);
    });

    it('parses PowerShell connection output', async () => {
      const conns = [{ pid: 100, ip: '52.1.2.3', port: 443, state: 'Established' }];
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, JSON.stringify(conns));
      });

      const result = await win32.getRawTcpConnections([100]);
      expect(result).toEqual(conns);
    });

    it('wraps single connection object in array', async () => {
      const conn = { pid: 100, ip: '1.2.3.4', port: 80, state: 'Established' };
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, JSON.stringify(conn));
      });

      const result = await win32.getRawTcpConnections([100]);
      expect(result).toEqual([conn]);
    });

    it('returns empty on error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('PS error'));
      });

      expect(await win32.getRawTcpConnections([100])).toEqual([]);
    });

    it('returns empty for "[]" output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '[]');
      });

      expect(await win32.getRawTcpConnections([100])).toEqual([]);
    });

    it('returns empty for empty stdout', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '');
      });

      expect(await win32.getRawTcpConnections([100])).toEqual([]);
    });

    it('returns empty for unparseable output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'not json');
      });

      expect(await win32.getRawTcpConnections([100])).toEqual([]);
    });
  });

  describe('getFileHandles', () => {
    it('returns empty array for invalid PID', async () => {
      expect(await win32.getFileHandles(0)).toEqual([]);
      expect(await win32.getFileHandles(-1)).toEqual([]);
      expect(await win32.getFileHandles(1.5)).toEqual([]);
      expect(await win32.getFileHandles('abc')).toEqual([]);
    });

    it('parses file handle output', async () => {
      const files = ['C:\\Users\\me\\file.js', 'C:\\tmp\\log.txt'];
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, JSON.stringify(files));
      });

      expect(await win32.getFileHandles(100)).toEqual(files);
    });

    it('wraps single string result in array', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '"C:\\\\Users\\\\me\\\\file.js"');
      });

      const result = await win32.getFileHandles(100);
      expect(result).toEqual(['C:\\Users\\me\\file.js']);
    });

    it('returns empty on error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('failed'));
      });

      expect(await win32.getFileHandles(100)).toEqual([]);
    });

    it('returns empty for "[]" output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '[]');
      });

      expect(await win32.getFileHandles(100)).toEqual([]);
    });

    it('returns empty for non-array parsed result', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '{"not": "array"}');
      });

      expect(await win32.getFileHandles(100)).toEqual([]);
    });

    // PR-A honesty — A1: the PS script must not fall back to loaded modules.
    // White-box (the execFile mock can't simulate a real "binary absent" PS run,
    // so we assert the script itself no longer contains the .Modules branch).
    it('PS script has no .Modules / Get-Process fallback (no false-positive handles)', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, '[]'));
      await win32.getFileHandles(100);
      expect(mockExecFile).toHaveBeenCalled();
      const psScript = mockExecFile.mock.calls[0][1][3];
      expect(psScript).not.toMatch(/Modules/);
      expect(psScript).not.toMatch(/Get-Process/);
    });

    // PR-A honesty — A2: when read-detection is unavailable, getFileHandles must
    // return [] WITHOUT spawning a powershell (honest zero + perf short-circuit).
    it('returns [] without spawning when read-detection is unavailable', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, ''));
      await win32.probeReadDetection();
      expect(win32.isReadDetectionAvailable()).toBe(false);
      const callsAfterProbe = mockExecFile.mock.calls.length;
      const result = await win32.getFileHandles(100);
      expect(result).toEqual([]);
      expect(mockExecFile.mock.calls.length).toBe(callsAfterProbe);
    });
  });

  // PR-A — B: one-time startup probe drives the degraded flag honestly.
  describe('probeReadDetection', () => {
    it('sets readDetectionAvailable=true when a handle binary is found', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) =>
        cb(null, 'C:\\tools\\handle64.exe\n'),
      );
      await win32.probeReadDetection();
      expect(win32.isReadDetectionAvailable()).toBe(true);
    });

    it('sets readDetectionAvailable=false when no handle binary is found', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(null, ''));
      await win32.probeReadDetection();
      expect(win32.isReadDetectionAvailable()).toBe(false);
    });

    it('sets readDetectionAvailable=false on probe error (fail honest, not optimistic)', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('powershell missing')));
      await win32.probeReadDetection();
      expect(win32.isReadDetectionAvailable()).toBe(false);
    });

    // #2 two-flag honesty: read-detection has TWO capabilities now — the legacy
    // handle.exe binary AND the Restart Manager. When handle.exe is ABSENT but RM
    // is PRESENT, read-detection is AVAILABLE (via RM) and the degraded warning
    // must NOT fire. The warning is gated by the SAME `!available` condition as
    // this flag, so available===true proves no degraded warning was logged.
    it('reports available (no degraded warning) when handle.exe is absent but RM works', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const script = args[3]; // the -Command body
        if (/AegisRm|GetHolders/.test(script))
          cb(null, 'OK'); // RM probe succeeds
        else cb(null, ''); // handle-binary probe: not found
      });
      const result = await win32.probeReadDetection();
      expect(result.available).toBe(true);
      expect(result.rm).toBe(true);
      expect(result.handle).toBeNull();
      expect(win32.isReadDetectionAvailable()).toBe(true);
    });

    it('reports unavailable (degraded) only when BOTH handle.exe and RM are absent', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const script = args[3];
        if (/AegisRm|GetHolders/.test(script))
          cb(null, 'FAIL'); // RM probe fails
        else cb(null, ''); // handle-binary probe: not found
      });
      const result = await win32.probeReadDetection();
      expect(result.available).toBe(false);
      expect(win32.isReadDetectionAvailable()).toBe(false);
    });
  });

  describe('killProcess', () => {
    it('calls taskkill with correct PID', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => {
        expect(cmd).toBe('taskkill');
        expect(args).toContain('/PID');
        expect(args).toContain('100');
        cb(null);
      });

      const result = await win32.killProcess(100);
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => {
        cb(new Error('Access denied'));
      });

      const result = await win32.killProcess(100);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  describe('suspendProcess', () => {
    it('returns success on PowerShell success', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null);
      });

      const result = await win32.suspendProcess(100);
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('Cannot suspend'));
      });

      const result = await win32.suspendProcess(100);
      expect(result.success).toBe(false);
    });
  });

  describe('resumeProcess', () => {
    it('returns success on PowerShell success', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null);
      });

      const result = await win32.resumeProcess(100);
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('Cannot resume'));
      });

      const result = await win32.resumeProcess(100);
      expect(result.success).toBe(false);
    });
  });

  describe('getProcessCwd', () => {
    it('returns null for invalid PID', async () => {
      expect(await win32.getProcessCwd(0)).toBeNull();
      expect(await win32.getProcessCwd(-1)).toBeNull();
      expect(await win32.getProcessCwd('abc')).toBeNull();
    });

    it('returns parsed CWD from PowerShell output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'C:\\Users\\me\\project\n');
      });

      expect(await win32.getProcessCwd(100)).toBe('C:\\Users\\me\\project');
    });

    it('returns null on empty result', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '\n');
      });

      expect(await win32.getProcessCwd(100)).toBeNull();
    });

    it('returns null on error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('fail'));
      });

      expect(await win32.getProcessCwd(100)).toBeNull();
    });
  });

  describe('getProcessCwds', () => {
    it('returns empty Map for empty PID list', async () => {
      const result = await win32.getProcessCwds([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('parses batch CWD output', async () => {
      const psOutput = JSON.stringify([
        { ProcessId: 100, CommandLine: 'node --cwd "C:\\Users\\me\\proj-a" server.js' },
        { ProcessId: 200, CommandLine: 'node --project "C:\\Users\\me\\proj-b"' },
      ]);
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, psOutput);
      });

      const result = await win32.getProcessCwds([100, 200]);
      expect(result.get(100)).toBe('C:\\Users\\me\\proj-a');
      expect(result.get(200)).toBe('C:\\Users\\me\\proj-b');
    });

    it('handles single object (non-array) response', async () => {
      const psOutput = JSON.stringify({
        ProcessId: 100,
        CommandLine: 'node --cwd "/home/user/project" index.js',
      });
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, psOutput);
      });

      const result = await win32.getProcessCwds([100]);
      expect(result.get(100)).toBe('/home/user/project');
    });

    it('returns empty Map on error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('fail'));
      });

      const result = await win32.getProcessCwds([100]);
      expect(result.size).toBe(0);
    });

    it('returns null CWD for process without --cwd flag', async () => {
      const psOutput = JSON.stringify([{ ProcessId: 100, CommandLine: 'node server.js' }]);
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, psOutput);
      });

      const result = await win32.getProcessCwds([100]);
      expect(result.get(100)).toBeNull();
    });
  });

  describe('exports', () => {
    it('exports all expected members', () => {
      expect(typeof win32.listProcesses).toBe('function');
      expect(typeof win32.getParentProcessMap).toBe('function');
      expect(typeof win32.getRawTcpConnections).toBe('function');
      expect(typeof win32.getFileHandles).toBe('function');
      expect(typeof win32.getProcessCwd).toBe('function');
      expect(typeof win32.getProcessCwds).toBe('function');
      expect(typeof win32.killProcess).toBe('function');
      expect(typeof win32.suspendProcess).toBe('function');
      expect(typeof win32.resumeProcess).toBe('function');
      expect(typeof win32.probeReadDetection).toBe('function');
      expect(typeof win32.isReadDetectionAvailable).toBe('function');
      expect(typeof win32.getSensitiveHolders).toBe('function');
      expect(typeof win32.isRestartManagerAvailable).toBe('function');
      expect(Array.isArray(win32.IGNORE_FILE_PATTERNS)).toBe(true);
    });
  });
});
