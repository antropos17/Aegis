import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('process-scanner', () => {
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

  it('detects known AI agents from process list', async () => {
    mockListProcesses.mockResolvedValue([
      { name: 'claude', pid: 100 },
      { name: 'node', pid: 200 },
    ]);
    const { agents } = await scanner.scanProcesses();
    expect(agents.some((a) => a.agent === 'Claude Code')).toBe(true);
  });

  it('ignores editor hosts', async () => {
    mockListProcesses.mockResolvedValue([
      { name: 'code', pid: 100 },
    ]);
    const { agents } = await scanner.scanProcesses();
    expect(agents).toHaveLength(0);
  });

  it('ignores hardware/driver processes', async () => {
    mockListProcesses.mockResolvedValue([
      { name: 'nvidia-smi', pid: 100 },
      { name: 'logioptionsplus', pid: 200 },
    ]);
    const { agents } = await scanner.scanProcesses();
    expect(agents).toHaveLength(0);
  });

  it('deduplicates by PID', async () => {
    mockListProcesses.mockResolvedValue([
      { name: 'claude', pid: 100 },
      { name: 'claude', pid: 100 },
    ]);
    const { agents } = await scanner.scanProcesses();
    expect(agents).toHaveLength(1);
  });

  it('changed: true when PID set changes, false when same', async () => {
    mockListProcesses.mockResolvedValue([{ name: 'claude', pid: 100 }]);
    const first = await scanner.scanProcesses();
    expect(first.changed).toBe(true);

    const second = await scanner.scanProcesses();
    expect(second.changed).toBe(false);

    mockListProcesses.mockResolvedValue([{ name: 'claude', pid: 200 }]);
    const third = await scanner.scanProcesses();
    expect(third.changed).toBe(true);
  });

  it('tracks peak agent count', async () => {
    mockListProcesses.mockResolvedValue([
      { name: 'claude', pid: 100 },
      { name: 'copilot', pid: 200 },
    ]);
    await scanner.scanProcesses();
    expect(scanner.peakAgents).toBe(2);

    mockListProcesses.mockResolvedValue([{ name: 'claude', pid: 100 }]);
    await scanner.scanProcesses();
    expect(scanner.peakAgents).toBe(2);
  });

  it('case-insensitive matching', async () => {
    mockListProcesses.mockResolvedValue([{ name: 'claude', pid: 101 }]);
    const result = await scanner.scanProcesses();
    expect(result.agents.some((a) => a.agent === 'Claude Code')).toBe(true);
  });
});
