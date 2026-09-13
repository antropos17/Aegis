import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import scanner from '../../src/main/process-scanner.js';

describe('process-name matching work and freshness', () => {
  let listProcesses;
  let custom;

  beforeEach(() => {
    listProcesses = vi.fn();
    custom = [];
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses, providesStartTime: false });
    scanner.init({ trackSeenAgent: vi.fn(), getCustomAgents: () => custom });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    scanner._resetForTest();
  });

  it('keeps catalog normalization work independent of the number of unrelated processes', async () => {
    const pattern = 'custom-index-probe.exe';
    custom = [{ id: 'index-probe', displayName: 'Index Probe', names: [pattern] }];
    const lower = String.prototype.toLowerCase;
    let normalizations = 0;
    vi.spyOn(String.prototype, 'toLowerCase').mockImplementation(function () {
      if (String(this) === pattern) normalizations++;
      return lower.call(this);
    });
    const run = async (count) => {
      listProcesses.mockResolvedValue(
        Array.from({ length: count }, (_, index) => ({
          pid: index + 1,
          name: `ordinary-worker-${index}`,
        })),
      );
      normalizations = 0;
      const result = await scanner.scanProcesses();
      expect(result.agents).toEqual([]);
      expect(result.reliable).toBe(true);
      return normalizations;
    };
    const small = await run(10);
    const large = await run(1000);
    expect(listProcesses).toHaveBeenCalledTimes(2);
    expect(large).toBeLessThanOrEqual(small + 2);
  });

  it('preserves first ownership, exact matching, exclusions and first detected PID order', async () => {
    custom = [
      {
        id: 'first-worker',
        displayName: 'First Worker',
        names: ['shared-worker.exe', 'codex.exe', 'code.exe', 'nvidia-worker.exe', '__proto__'],
      },
      { id: 'second-worker', displayName: 'Second Worker', names: ['SHARED-WORKER.EXE'] },
    ];
    const codex = scanner.AI_AGENTS.find((agent) =>
      agent.patterns.some((name) => name.toLowerCase() === 'codex.exe'),
    ).name;
    listProcesses.mockResolvedValue([
      { pid: 7, name: 'SHARED-WORKER.EXE' },
      { pid: 8, name: 'CODEX.EXE' },
      { pid: 9, name: 'prefix-shared-worker.exe' },
      { pid: 10, name: 'code.exe' },
      { pid: 11, name: 'nvidia-worker.exe' },
      { pid: 12, name: '__proto__' },
      { pid: 7, name: 'codex.exe' },
    ]);
    expect((await scanner.scanProcesses()).agents).toEqual([
      {
        pid: 7,
        process: 'SHARED-WORKER.EXE',
        agent: 'First Worker',
        status: 'running',
        category: 'ai',
      },
      { pid: 8, process: 'CODEX.EXE', agent: codex, status: 'running', category: 'ai' },
      { pid: 12, process: '__proto__', agent: 'First Worker', status: 'running', category: 'ai' },
    ]);
  });

  it('applies in-place catalog edits and newly observed/exited processes on the next scan', async () => {
    const signature = { id: 'live-worker', displayName: 'Before', names: ['before-worker'] };
    custom = [signature];
    listProcesses.mockResolvedValue([{ pid: 20, name: 'before-worker' }]);
    expect((await scanner.scanProcesses()).agents[0].agent).toBe('Before');
    signature.displayName = 'After';
    signature.names[0] = 'after-worker';
    listProcesses.mockResolvedValue([
      { pid: 21, name: 'after-worker' },
      { pid: 20, name: 'before-worker' },
    ]);
    expect(await scanner.scanProcesses()).toMatchObject({
      changed: true,
      reliable: true,
      agents: [{ pid: 21, agent: 'After' }],
    });
    listProcesses.mockResolvedValue([{ pid: 100, name: 'ordinary-worker' }]);
    expect(await scanner.scanProcesses()).toMatchObject({
      changed: true,
      reliable: true,
      agents: [],
    });
    expect(listProcesses).toHaveBeenCalledTimes(3);
  });

  it('reads the current catalog after the fresh process observation resolves', async () => {
    let complete;
    listProcesses.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const pending = scanner.scanProcesses();
    custom = [{ id: 'late-worker', displayName: 'Late Worker', names: ['late-worker'] }];
    complete([{ pid: 1, name: 'late-worker' }]);
    expect((await pending).agents).toEqual([
      expect.objectContaining({ pid: 1, agent: 'Late Worker' }),
    ]);
  });

  it('carries each fresh shared map and distinguishes an outage from a confirmed empty agent fleet', async () => {
    const first = new Map([[31, { name: 'codex.exe', startTime: 1 }]]);
    const reused = new Map([[31, { name: 'CODEX.EXE', startTime: 2 }]]);
    const ordinary = new Map([[32, { name: 'ordinary-worker', startTime: 3 }]]);
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(reused)
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(ordinary);
    listProcesses.mockResolvedValue([]);
    scanner._setPlatformForTest({ providesStartTime: true, getParentProcessMap: snapshot });
    const a = await scanner.scanProcesses({ sharedObservation: true });
    const b = await scanner.scanProcesses({ sharedObservation: true });
    expect(a.processMap).toBe(first);
    expect(b.processMap).toBe(reused);
    expect(b.agents[0]).toMatchObject({ pid: 31, process: 'CODEX.EXE' });
    const unavailable = await scanner.scanProcesses({ sharedObservation: true });
    expect(unavailable).toMatchObject({ agents: [], reliable: false });
    expect(scanner.getProcessSensorHealth().state).toBe('DEGRADED');
    const empty = await scanner.scanProcesses({ sharedObservation: true });
    expect(empty).toMatchObject({ agents: [], reliable: true });
    expect(empty.processMap).toBe(ordinary);
    expect(scanner.getProcessSensorHealth().state).toBe('HEALTHY');
    expect(snapshot).toHaveBeenCalledTimes(4);
    expect(listProcesses).toHaveBeenCalledTimes(1);
  });
});
