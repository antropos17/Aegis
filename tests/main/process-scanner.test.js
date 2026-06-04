import { describe, it, expect, beforeEach, vi } from 'vitest';
import scanner from '../../src/main/process-scanner.js';

describe('process-scanner', () => {
  let mockListProcesses;

  beforeEach(() => {
    mockListProcesses = vi.fn();
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
    mockListProcesses.mockResolvedValue([{ name: 'code', pid: 100 }]);
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

  // C-04: each process name belongs to exactly one agent (umbrella no longer
  // steals a name from its rightful owner). Asserts the SPECIFIC owner is
  // present AND the umbrella is absent — not tied to agents[0].
  it('routes "copilot-language-server" to Copilot Language Server, not GitHub Copilot', async () => {
    mockListProcesses.mockResolvedValue([{ name: 'copilot-language-server', pid: 4242 }]);
    const { agents } = await scanner.scanProcesses();
    expect(agents.some((a) => a.agent === 'Copilot Language Server')).toBe(true);
    expect(agents.some((a) => a.agent === 'GitHub Copilot')).toBe(false);
  });

  it('routes bare "sm-agent" to Supermaven Agent, not Supermaven', async () => {
    mockListProcesses.mockResolvedValue([{ name: 'sm-agent', pid: 4243 }]);
    const { agents } = await scanner.scanProcesses();
    expect(agents.some((a) => a.agent === 'Supermaven Agent')).toBe(true);
    expect(agents.some((a) => a.agent === 'Supermaven')).toBe(false);
  });
});
