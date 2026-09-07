import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import scanner from '../../src/main/process-scanner.js';
import utils from '../../src/main/process-utils.js';
import sessions from '../../src/main/session-tracker.js';

describe('shared Windows process observation', () => {
  let observe;
  let list;
  let extraObserve;
  const map = (birth, parent = 'code.exe') =>
    new Map([
      [100, { name: 'claude.exe', ppid: 200, startTime: birth }],
      [200, { name: parent, ppid: 0, startTime: 1 }],
    ]);

  beforeEach(() => {
    scanner._resetForTest();
    utils._resetForTest();
    sessions._resetForTest();
    observe = vi.fn();
    list = vi.fn().mockResolvedValue([{ pid: 100, name: 'claude.exe' }]);
    extraObserve = vi.fn(() => {
      throw new Error('unexpected second observation');
    });
    scanner._setPlatformForTest({
      providesStartTime: true,
      getParentProcessMap: observe,
      listProcesses: list,
    });
    utils._setPlatformForTest({ providesStartTime: true, getParentProcessMap: extraObserve });
  });

  afterEach(() => {
    scanner._resetForTest();
    utils._resetForTest();
    sessions._resetForTest();
  });

  async function pass() {
    const result = await scanner.scanProcesses({ sharedObservation: true });
    await utils.enrichWithParentChains(result.agents, {
      forceRefresh: result.changed,
      processMap: result.processMap,
    });
    return result;
  }

  it('observes each pass once and detects same-name PID reuse inside the cache TTL', async () => {
    observe.mockResolvedValueOnce(map(1000)).mockResolvedValueOnce(map(2000, 'fixture-editor.exe'));
    const first = await pass();
    const second = await pass();
    expect(first.agents[0]).toMatchObject({ instanceId: '100:1000', parentChain: ['code.exe'] });
    expect(second.changed).toBe(false);
    expect(second.agents[0]).toMatchObject({
      instanceId: '100:2000',
      parentChain: ['fixture-editor.exe'],
    });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(list).not.toHaveBeenCalled();
    expect(extraObserve).not.toHaveBeenCalled();
  });

  it('retains tasklist fallback and freezes identity through a failed observation', async () => {
    let health = 'HEALTHY';
    scanner._setPlatformForTest({ getSnapshotHealth: () => ({ state: health }) });
    observe
      .mockResolvedValueOnce(map(1000))
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(map(1000));
    const first = await pass();
    expect(sessions.reconcile(first.agents).entered).toHaveLength(1);
    health = 'FAILED';
    const outage = await pass();
    expect(outage.reliable).toBe(true);
    expect(outage.agents[0].startTime).toBeNull();
    expect(scanner.isIdentityDegraded()).toBe(true);
    expect(
      sessions.reconcile(outage.agents, { identityDegraded: scanner.isIdentityDegraded() }),
    ).toEqual({ entered: [], exited: [] });
    health = 'HEALTHY';
    const recovered = await pass();
    expect(sessions.reconcile(recovered.agents)).toEqual({ entered: [], exited: [] });
    expect(list).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(extraObserve).not.toHaveBeenCalled();
  });

  it('uses the ordinary list on a platform without birth-time observations', async () => {
    scanner._setPlatformForTest({ providesStartTime: false });
    const result = await scanner.scanProcesses({ sharedObservation: true });
    expect(result.agents).toHaveLength(1);
    expect(result.processMap).toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
  });

  it('does not interpret nameless snapshots as an empty agent fleet', async () => {
    observe.mockResolvedValue(new Map([[100, { name: '', startTime: 1000 }]]));
    expect((await pass()).agents).toHaveLength(1);
    expect(list).toHaveBeenCalledOnce();
  });

  it('matches the legacy path for every configured process-name signature', async () => {
    const rows = scanner.AI_AGENTS.flatMap((agent) => agent.patterns).map((name, i) => ({
      name,
      pid: i + 1,
    }));
    list.mockResolvedValue(rows);
    observe.mockResolvedValue(
      new Map(rows.map(({ pid, name }) => [pid, { name, ppid: 0, startTime: 1000 }])),
    );
    const legacy = await scanner.scanProcesses();
    const shared = await scanner.scanProcesses({ sharedObservation: true });
    expect(shared.agents).toEqual(legacy.agents);
    expect(shared.changed).toBe(false);
    expect(list).toHaveBeenCalledOnce();
  });
});
