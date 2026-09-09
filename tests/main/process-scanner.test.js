import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import scanner from '../../src/main/process-scanner.js';

describe('process-scanner', () => {
  let mockListProcesses;
  let customAgents;

  beforeEach(() => {
    mockListProcesses = vi.fn();
    customAgents = vi.fn().mockReturnValue([]);
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses: mockListProcesses });
    scanner.init({ trackSeenAgent: vi.fn(), getCustomAgents: customAgents });
    scanner.peakAgents = 0;
  });

  afterEach(() => scanner._resetForTest());

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

describe('custom process signatures', () => {
  let mockListProcesses;
  let customAgents;
  const signature = {
    id: 'local-worker',
    displayName: 'Local Worker',
    names: ['local-ai-worker.exe'],
  };

  beforeEach(() => {
    mockListProcesses = vi.fn().mockResolvedValue([
      { name: 'claude', pid: 100 },
      { name: 'LOCAL-AI-WORKER.EXE', pid: 200 },
      { name: 'second-local-worker', pid: 300 },
    ]);
    customAgents = vi.fn().mockReturnValue([]);
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses: mockListProcesses });
    scanner.init({ trackSeenAgent: vi.fn(), getCustomAgents: customAgents });
  });

  afterEach(() => scanner._resetForTest());

  it('uses catalog additions and removals on the next scan while preserving bundled signatures', async () => {
    const databaseBefore = structuredClone(scanner.agentDb);
    const bundledBefore = structuredClone(scanner.AI_AGENTS);
    expect((await scanner.scanProcesses()).agents.map((agent) => agent.agent)).toEqual([
      'Claude Code',
    ]);
    customAgents.mockReturnValue([signature]);
    const added = await scanner.scanProcesses();
    expect(added.changed).toBe(true);
    expect(added.agents).toEqual([
      expect.objectContaining({ agent: 'Claude Code', pid: 100 }),
      expect.objectContaining({ agent: 'Local Worker', pid: 200, process: 'LOCAL-AI-WORKER.EXE' }),
    ]);
    customAgents.mockReturnValue([]);
    const removed = await scanner.scanProcesses();
    expect(removed.changed).toBe(true);
    expect(removed.agents.map((agent) => agent.agent)).toEqual(['Claude Code']);
    expect(scanner.agentDb).toEqual(databaseBefore);
    expect(scanner.AI_AGENTS).toEqual(bundledBefore);
  });

  it('applies edited custom names on the next scan without reinitialization', async () => {
    customAgents.mockReturnValue([signature]);
    expect((await scanner.scanProcesses()).agents.find((agent) => agent.pid === 200)?.agent).toBe(
      'Local Worker',
    );
    customAgents.mockReturnValue([
      { ...signature, displayName: 'Renamed Worker', names: ['second-local-worker'] },
    ]);
    const updated = await scanner.scanProcesses();
    expect(updated.agents.some((agent) => agent.pid === 200)).toBe(false);
    expect(updated.agents.find((agent) => agent.pid === 300)?.agent).toBe('Renamed Worker');
  });

  it('preserves bundled ownership when a custom ID or process name collides', async () => {
    customAgents.mockReturnValue([
      { ...signature, id: 'claude-code', names: ['second-local-worker'] },
      { ...signature, names: ['claude', 'local-ai-worker.exe'] },
    ]);
    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([
      expect.objectContaining({ agent: 'Claude Code', pid: 100 }),
      expect.objectContaining({ agent: 'Local Worker', pid: 200 }),
    ]);
  });

  it('ignores invalid entries and duplicate custom IDs instead of expanding ambiguous signatures', async () => {
    customAgents.mockReturnValue([
      null,
      { ...signature, names: null },
      signature,
      { ...signature, displayName: 'Duplicate', names: ['second-local-worker'] },
    ]);
    const result = await scanner.scanProcesses();
    expect(result.agents).toEqual([
      expect.objectContaining({ agent: 'Claude Code', pid: 100 }),
      expect.objectContaining({ agent: 'Local Worker', pid: 200 }),
    ]);
  });
});
