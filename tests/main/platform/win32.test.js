import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);

const mockExecFile = vi.fn();

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'child_process') return { execFile: mockExecFile };
  return originalLoad.apply(this, arguments);
};

describe('platform/win32', () => {
  let win32;

  beforeEach(() => {
    mockExecFile.mockReset();
    const modPath = require.resolve('../../../src/main/platform/win32.js');
    delete require.cache[modPath];
    win32 = require('../../../src/main/platform/win32.js');
  });

  describe('IGNORE_FILE_PATTERNS', () => {
    it('ignores C:\\Windows paths (case-insensitive)', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\Windows\\System32\\cmd.exe'))).toBe(true);
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('c:\\windows\\explorer.exe'))).toBe(true);
    });

    it('ignores C:\\Program Files\\Windows paths', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\Program Files\\Windows Defender\\foo'))).toBe(true);
    });

    it('ignores pagefile.sys', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\pagefile.sys'))).toBe(true);
    });

    it('ignores swapfile.sys', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\swapfile.sys'))).toBe(true);
    });

    it('ignores $Extend', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\$Extend\\$UsnJrnl'))).toBe(true);
    });

    it('ignores System Volume Information', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\System Volume Information\\foo'))).toBe(true);
    });

    it('ignores \\Device\\ paths', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('\\Device\\HarddiskVolume1'))).toBe(true);
    });

    it('does NOT ignore user files', () => {
      expect(win32.IGNORE_FILE_PATTERNS.some(p => p.test('C:\\Users\\me\\project\\main.js'))).toBe(false);
    });
  });

  describe('listProcesses', () => {
    it('parses tasklist CSV output', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => {
        cb(null, '"claude.exe","1234","Console","1","50,000 K"\n"code.exe","5678","Console","1","100,000 K"\n');
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
        '100': { n: 'node.exe', p: 50 },
        '200': { n: 'claude.exe', p: 100 },
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

  describe('exports', () => {
    it('exports all expected members', () => {
      expect(typeof win32.listProcesses).toBe('function');
      expect(typeof win32.getParentProcessMap).toBe('function');
      expect(typeof win32.getRawTcpConnections).toBe('function');
      expect(typeof win32.getFileHandles).toBe('function');
      expect(typeof win32.getProcessCwd).toBe('function');
      expect(typeof win32.killProcess).toBe('function');
      expect(typeof win32.suspendProcess).toBe('function');
      expect(typeof win32.resumeProcess).toBe('function');
      expect(Array.isArray(win32.IGNORE_FILE_PATTERNS)).toBe(true);
    });
  });
});
