import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);

const mockExecFile = vi.fn();

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'child_process') return { execFile: mockExecFile };
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

describe('platform/darwin', () => {
  let darwin;

  beforeEach(() => {
    mockExecFile.mockReset();
    // Clear both darwin and posix-shared from cache
    const darwinPath = require.resolve('../../../src/main/platform/darwin.js');
    const posixPath = require.resolve('../../../src/main/platform/posix-shared.js');
    delete require.cache[darwinPath];
    delete require.cache[posixPath];
    darwin = require('../../../src/main/platform/darwin.js');
  });

  describe('IGNORE_FILE_PATTERNS', () => {
    it('ignores /System/ paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/System/Library/Fonts/a.ttf'))).toBe(true);
    });

    it('ignores /Library/Caches/ paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/Library/Caches/com.apple.foo'))).toBe(true);
    });

    it('ignores /private/var/ paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/private/var/db/something'))).toBe(true);
    });

    it('ignores .DS_Store', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/Users/foo/.DS_Store'))).toBe(true);
    });

    it('ignores /dev/ paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/dev/null'))).toBe(true);
    });

    it('ignores .dylib files', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/usr/lib/libSystem.dylib'))).toBe(true);
    });

    it('ignores /usr/share/ paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/usr/share/zoneinfo/UTC'))).toBe(true);
    });

    it('ignores /usr/lib/ paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/usr/lib/libz.1.dylib'))).toBe(true);
    });

    it('does NOT ignore normal user paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/Users/me/project/main.js'))).toBe(false);
    });

    it('does NOT ignore /tmp paths', () => {
      expect(darwin.IGNORE_FILE_PATTERNS.some(p => p.test('/tmp/build/output.js'))).toBe(false);
    });
  });

  describe('listProcesses', () => {
    it('parses ps output into name/pid pairs', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '/usr/bin/node 1234\n/Applications/Code.app/Contents/MacOS/Electron 5678\n');
      });

      const procs = await darwin.listProcesses();
      expect(procs).toEqual([
        { name: 'node', pid: 1234 },
        { name: 'Code', pid: 5678 },
      ]);
    });

    it('extracts .app bundle names from macOS paths', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '/Applications/Cursor.app/Contents/MacOS/Cursor 999\n');
      });

      const procs = await darwin.listProcesses();
      expect(procs[0].name).toBe('Cursor');
    });

    it('handles basename extraction for non-.app paths', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '/usr/local/bin/claude 100\n');
      });

      const procs = await darwin.listProcesses();
      expect(procs[0].name).toBe('claude');
      expect(procs[0].pid).toBe(100);
    });

    it('skips blank lines', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '\n  \nnode 100\n\n');
      });

      const procs = await darwin.listProcesses();
      expect(procs).toHaveLength(1);
    });

    it('skips lines without a space (no PID)', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'nodePID\nnode 100\n');
      });

      const procs = await darwin.listProcesses();
      expect(procs).toHaveLength(1);
    });

    it('skips lines where PID is NaN', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'node abc\nnode 100\n');
      });

      const procs = await darwin.listProcesses();
      expect(procs).toHaveLength(1);
      expect(procs[0].pid).toBe(100);
    });

    it('rejects on execFile error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('ps failed'));
      });

      await expect(darwin.listProcesses()).rejects.toThrow('ps failed');
    });
  });

  describe('getParentProcessMap', () => {
    it('resolves to empty Map on error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('fail'));
      });

      const map = await darwin.getParentProcessMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });
  });

  describe('getRawTcpConnections', () => {
    it('returns empty array for empty PID list', async () => {
      const result = await darwin.getRawTcpConnections([]);
      expect(result).toEqual([]);
    });

    it('returns empty array on lsof error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('lsof failed'));
      });

      const result = await darwin.getRawTcpConnections([100]);
      expect(result).toEqual([]);
    });
  });

  describe('exported functions', () => {
    it('exports all expected functions', () => {
      expect(typeof darwin.listProcesses).toBe('function');
      expect(typeof darwin.getParentProcessMap).toBe('function');
      expect(typeof darwin.getRawTcpConnections).toBe('function');
      expect(typeof darwin.getFileHandles).toBe('function');
      expect(typeof darwin.getProcessCwd).toBe('function');
      expect(typeof darwin.killProcess).toBe('function');
      expect(typeof darwin.suspendProcess).toBe('function');
      expect(typeof darwin.resumeProcess).toBe('function');
      expect(Array.isArray(darwin.IGNORE_FILE_PATTERNS)).toBe(true);
    });
  });
});
