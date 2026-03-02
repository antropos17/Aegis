import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('process-scanner EPERM handling', () => {
  let scanner;
  let mockListProcesses;

  beforeEach(() => {
    mockListProcesses = vi.fn();
    scanner = require('../../src/main/process-scanner.js');
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses: mockListProcesses });
    scanner.init({ trackSeenAgent: vi.fn() });
    scanner.peakAgents = 0;
  });

  it('catches EPERM and returns empty agents', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);

    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('catches EACCES and returns empty agents', async () => {
    const err = new Error('Permission denied');
    err.code = 'EACCES';
    mockListProcesses.mockRejectedValue(err);

    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('catches "Access is denied" message without error code', async () => {
    const err = new Error('Access is denied');
    mockListProcesses.mockRejectedValue(err);

    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([]);
  });

  it('increments permissionDeniedScans on consecutive EPERM', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);

    await scanner.scanProcesses();
    expect(scanner.permissionDeniedScans).toBe(1);

    await scanner.scanProcesses();
    expect(scanner.permissionDeniedScans).toBe(2);
  });

  it('resets permissionDeniedScans on successful scan', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);

    await scanner.scanProcesses();
    await scanner.scanProcesses();
    expect(scanner.permissionDeniedScans).toBe(2);

    mockListProcesses.mockResolvedValue([{ name: 'claude', pid: 100 }]);
    await scanner.scanProcesses();
    expect(scanner.permissionDeniedScans).toBe(0);
  });

  it('re-throws non-permission errors', async () => {
    mockListProcesses.mockRejectedValue(new Error('spawn ENOENT'));

    await expect(scanner.scanProcesses()).rejects.toThrow('spawn ENOENT');
  });

  it('_resetForTest clears permissionDeniedScans', async () => {
    const err = new Error('Access is denied');
    err.code = 'EPERM';
    mockListProcesses.mockRejectedValue(err);

    await scanner.scanProcesses();
    expect(scanner.permissionDeniedScans).toBe(1);

    scanner._resetForTest();
    expect(scanner.permissionDeniedScans).toBe(0);
  });
});
