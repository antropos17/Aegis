import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const posixShared = require('../../../src/main/platform/posix-shared');

describe('posix-shared parsers', () => {
  describe('parseLsofOutput()', () => {
    it('parses multi-line lsof TCP output', () => {
      const stdout = [
        'p1234',
        'n10.0.0.1:50000->52.1.2.3:443',
        'TST=ESTABLISHED',
        '',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([1234]));
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        pid: 1234,
        ip: '52.1.2.3',
        port: 443,
        state: 'ESTABLISHED',
      });
    });

    it('filters by pidSet', () => {
      const stdout = [
        'p1234',
        'n10.0.0.1:50000->52.1.2.3:443',
        'p5678',
        'n10.0.0.1:50001->99.1.2.3:80',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([5678]));
      expect(results).toHaveLength(1);
      expect(results[0].pid).toBe(5678);
    });

    it('skips loopback IPs', () => {
      const stdout = [
        'p1234',
        'n10.0.0.1:50000->127.0.0.1:3000',
        'n10.0.0.1:50001->52.1.2.3:443',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([1234]));
      expect(results).toHaveLength(1);
      expect(results[0].ip).toBe('52.1.2.3');
    });

    it('extracts state from T field', () => {
      const stdout = [
        'p100',
        'n10.0.0.1:5000->8.8.8.8:53',
        'TST=CLOSE_WAIT',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([100]));
      expect(results[0].state).toBe('CLOSE_WAIT');
    });

    it('handles malformed lines', () => {
      const stdout = [
        'p100',
        'nbadline',
        'n10.0.0.1:5000->8.8.8.8:abc',
        'n10.0.0.1:5000->8.8.8.8:443',
        '',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([100]));
      expect(results).toHaveLength(1);
      expect(results[0].port).toBe(443);
    });

    it('defaults to Established state when no T field', () => {
      const stdout = 'p100\nn10.0.0.1:5000->8.8.8.8:443\n';
      const results = posixShared.parseLsofOutput(stdout, new Set([100]));
      expect(results[0].state).toBe('Established');
    });

    it('skips lines without arrow (->)', () => {
      const stdout = 'p100\nn10.0.0.1:5000\nn10.0.0.1:5000->8.8.8.8:443\n';
      const results = posixShared.parseLsofOutput(stdout, new Set([100]));
      expect(results).toHaveLength(1);
    });

    it('skips ::1, 0.0.0.0, ::, * addresses', () => {
      const stdout = [
        'p100',
        'n10.0.0.1:5000->::1:443',
        'n10.0.0.1:5001->0.0.0.0:80',
        'n10.0.0.1:5002->:::80',
        'n10.0.0.1:5003->*:80',
        'n10.0.0.1:5004->8.8.8.8:443',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([100]));
      expect(results).toHaveLength(1);
      expect(results[0].ip).toBe('8.8.8.8');
    });

    it('handles multiple PIDs with interleaved connections', () => {
      const stdout = [
        'p100',
        'n10.0.0.1:5000->1.1.1.1:443',
        'p200',
        'n10.0.0.1:5001->2.2.2.2:80',
        'p100',
        'n10.0.0.1:5002->3.3.3.3:8080',
      ].join('\n');
      const results = posixShared.parseLsofOutput(stdout, new Set([100, 200]));
      expect(results).toHaveLength(3);
      expect(results.filter((r) => r.pid === 100)).toHaveLength(2);
      expect(results.filter((r) => r.pid === 200)).toHaveLength(1);
    });

    it('empty stdout returns empty array', () => {
      expect(posixShared.parseLsofOutput('', new Set([100]))).toEqual([]);
    });
  });

  describe('parseParentProcessMapFromPs()', () => {
    it('parses ps output into Map', () => {
      const stdout = '    1     0 init\n  100     1 bash\n  200   100 node\n';
      const map = posixShared.parseParentProcessMapFromPs(stdout);
      expect(map.size).toBe(3);
      expect(map.get(100)).toEqual({ name: 'bash', ppid: 1 });
      expect(map.get(200)).toEqual({ name: 'node', ppid: 100 });
    });

    it('strips path prefix', () => {
      const stdout = '  100     1 /usr/bin/node\n';
      const map = posixShared.parseParentProcessMapFromPs(stdout);
      expect(map.get(100).name).toBe('node');
    });

    it('handles empty/malformed input', () => {
      expect(posixShared.parseParentProcessMapFromPs('').size).toBe(0);
      expect(posixShared.parseParentProcessMapFromPs('garbage data\n').size).toBe(0);
      expect(posixShared.parseParentProcessMapFromPs('\n\n\n').size).toBe(0);
    });

    it('handles processes with spaces in name', () => {
      const stdout = '  100     1 My Process\n';
      const map = posixShared.parseParentProcessMapFromPs(stdout);
      expect(map.get(100).name).toBe('My Process');
    });

    it('handles deeply nested paths', () => {
      const stdout = '  100     1 /very/deep/nested/path/to/binary\n';
      const map = posixShared.parseParentProcessMapFromPs(stdout);
      expect(map.get(100).name).toBe('binary');
    });
  });
});

describe('posix-shared exec-based functions', () => {
  let mockExecFile;

  beforeEach(() => {
    mockExecFile = vi.fn();
    posixShared._setExecFileForTest(mockExecFile);
  });

  afterEach(() => {
    posixShared._setExecFileForTest(null);
  });

  describe('parseLsofFileHandles()', () => {
    it('parses lsof output into file paths', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'p100\nn/home/user/file.js\nn/home/user/.env\nnsocket\nfraw\n');
      });
      const files = await posixShared.parseLsofFileHandles(100);
      expect(files).toEqual(['/home/user/file.js', '/home/user/.env']);
    });

    it('returns empty array on exec error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('lsof not found'));
      });
      const files = await posixShared.parseLsofFileHandles(100);
      expect(files).toEqual([]);
    });

    it('returns empty array when no file paths in output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'p100\nfsomething\n');
      });
      const files = await posixShared.parseLsofFileHandles(100);
      expect(files).toEqual([]);
    });

    it('passes correct args to lsof', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '');
      });
      await posixShared.parseLsofFileHandles(42);
      expect(mockExecFile).toHaveBeenCalledWith(
        'lsof',
        ['-p', '42', '-F', 'n'],
        expect.objectContaining({ timeout: 15000 }),
        expect.any(Function),
      );
    });
  });

  describe('parseLsofCwd()', () => {
    it('extracts working directory from lsof output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'p100\nfcwd\nn/home/user/project\n');
      });
      const cwd = await posixShared.parseLsofCwd(100);
      expect(cwd).toBe('/home/user/project');
    });

    it('returns null on exec error', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('permission denied'));
      });
      const cwd = await posixShared.parseLsofCwd(100);
      expect(cwd).toBeNull();
    });

    it('returns null when no cwd line in output', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, 'p100\nfsomething\n');
      });
      const cwd = await posixShared.parseLsofCwd(100);
      expect(cwd).toBeNull();
    });

    it('passes correct args to lsof', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(null, '');
      });
      await posixShared.parseLsofCwd(99);
      expect(mockExecFile).toHaveBeenCalledWith(
        'lsof',
        ['-d', 'cwd', '-a', '-p', '99', '-F', 'n'],
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function),
      );
    });
  });

  describe('killProcess()', () => {
    it('returns success on kill', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => cb(null));
      const result = await posixShared.killProcess(123);
      expect(result).toEqual({ success: true });
      expect(mockExecFile).toHaveBeenCalledWith('kill', ['-9', '123'], expect.any(Function));
    });

    it('returns failure with error message', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => cb(new Error('No such process')));
      const result = await posixShared.killProcess(999);
      expect(result).toEqual({ success: false, error: 'No such process' });
    });
  });

  describe('suspendProcess()', () => {
    it('sends STOP signal', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => cb(null));
      const result = await posixShared.suspendProcess(123);
      expect(result).toEqual({ success: true });
      expect(mockExecFile).toHaveBeenCalledWith('kill', ['-STOP', '123'], expect.any(Function));
    });

    it('returns failure on error', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => cb(new Error('fail')));
      const result = await posixShared.suspendProcess(123);
      expect(result.success).toBe(false);
    });
  });

  describe('resumeProcess()', () => {
    it('sends CONT signal', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => cb(null));
      const result = await posixShared.resumeProcess(123);
      expect(result).toEqual({ success: true });
      expect(mockExecFile).toHaveBeenCalledWith('kill', ['-CONT', '123'], expect.any(Function));
    });

    it('returns failure on error', async () => {
      mockExecFile.mockImplementation((cmd, args, cb) => cb(new Error('fail')));
      const result = await posixShared.resumeProcess(123);
      expect(result.success).toBe(false);
    });
  });
});
