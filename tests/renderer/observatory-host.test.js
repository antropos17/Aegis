import { describe, it, expect, vi } from 'vitest';
import { applyFormToAgent, formFromAgent } from '../../src/renderer/lib/utils/agent-crud-utils';
import {
  connectHost,
  actionTarget,
  emptyTelemetry,
  confirmed,
  measured,
  instances,
} from '../../frontend/observatory/runtime/host';
import { validateCatalog } from '../../frontend/observatory/runtime/catalog';

const healthy = {
  appHealth: { populationReliable: true, populationState: 'HEALTHY', identityDegraded: false },
  observationGap: { state: 'NONE' },
};
const agent = (id, pid = 123) => ({
  agent: 'Claude Code',
  process: 'claude.exe',
  pid,
  instanceId: id,
  instanceIdSource: 'os',
  status: 'running',
  category: 'cli-tool',
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(seed = Promise.resolve({}), ownSeed = Promise.resolve({})) {
  const listeners = {};
  const unsubs = [];
  const host = {
    getStats: () => seed,
    getResourceUsage: () => ownSeed,
    getFalsePositives: async () => [],
  };
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
  ]) {
    host[name] = (cb) => {
      listeners[name] = cb;
      const off = vi.fn();
      unsubs.push(off);
      return off;
    };
  }
  let current;
  const dispose = connectHost(host, (value) => {
    current = value;
  });
  return {
    host,
    listeners,
    unsubs,
    dispose,
    get current() {
      return current;
    },
  };
}

describe('Observatory host boundary', () => {
  it('does not let a delayed seed overwrite a newer batch', async () => {
    const seed = deferred();
    const run = setup(seed.promise);
    run.listeners.onScanBatch({ stats: { ...healthy, totalFiles: 9 }, agents: [agent('123:1')] });
    seed.resolve({ totalFiles: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(run.current.stats.totalFiles).toBe(9);
    expect(run.current.stale).toBe(false);
    run.dispose();
  });
  it('retains the population through outage, sleep and recovery, then rejects reused PID targets', () => {
    const run = setup();
    run.listeners.onScanBatch({ stats: healthy, agents: [agent('123:1'), agent('124:1', 124)] });
    for (const stats of [
      { appHealth: { populationReliable: false } },
      { ...healthy, observationGap: { state: 'RESUMED' } },
      { ...healthy, appHealth: { ...healthy.appHealth, identityDegraded: true } },
    ]) {
      run.listeners.onScanBatch({ stats, agents: [] });
      expect(run.current.agents).toHaveLength(2);
      expect(() => actionTarget(run.current, '123:1')).toThrow('reliably observed');
    }
    run.listeners.onScanBatch({ stats: healthy, agents: [agent('123:2')] });
    expect(run.current.agents).toHaveLength(1);
    expect(() => actionTarget(run.current, '123:1')).toThrow();
    expect(actionTarget(run.current, '123:2').pid).toBe(123);
    run.dispose();
  });
  it('distinguishes a reliable empty scan from an unavailable bridge', () => {
    const run = setup();
    run.listeners.onScanBatch({ stats: healthy, agents: [] });
    expect(run.current.ready).toBe(true);
    expect(run.current.stale).toBe(false);
    let unavailable;
    connectHost(null, (value) => {
      unavailable = value;
    })();
    expect(unavailable.ready).toBe(false);
    expect(unavailable.error).toContain('unavailable');
    run.dispose();
  });
  it('disposes all listeners and ignores pending promises and queued callbacks', async () => {
    const seed = deferred();
    const run = setup(seed.promise);
    run.dispose();
    const before = run.current;
    seed.resolve(healthy);
    run.listeners.onScanBatch({ stats: healthy, agents: [agent('new')] });
    await Promise.resolve();
    await Promise.resolve();
    expect(run.current).toBe(before);
    expect(run.unsubs).toHaveLength(7);
    for (const unsubscribe of run.unsubs) expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('joins same-name instances by stamp and keeps unknown measurements distinct from zero', () => {
    const telemetry = {
      ...emptyTelemetry(),
      agents: [agent('a'), agent('b', 124)],
      anomalies: { a: 75 },
      events: [
        {
          instanceId: 'a',
          agent: 'Claude Code',
          file: '/home/a/.ssh/id_rsa',
          timestamp: Date.now(),
          sensitive: true,
          reason: 'SSH',
          attribution: { status: 'confirmed' },
        },
      ],
    };
    const rows = instances(telemetry);
    expect(rows[0].riskScore).toBeGreaterThan(0);
    expect(rows[1].riskScore).toBe(0);
    expect(rows[0].anomalyScore).toBe(75);
    expect(rows[1].anomalyScore).toBe(0);
    expect(measured(null)).toBeNull();
    expect(measured(undefined)).toBeNull();
    expect(measured(0)).toBe(0);
  });
  it('never reports a failed save or cancelled export as confirmed', () => {
    expect(() => confirmed({ success: false, error: 'Disk full' })).toThrow('Disk full');
    expect(() => confirmed({ success: false })).toThrow('cancelled');
    expect(() => confirmed(undefined)).toThrow();
    expect(confirmed({ success: true }).success).toBe(true);
  });
  it('freezes observations after silent delivery loss and recovers only with a new scan', async () => {
    vi.useFakeTimers();
    const run = setup();
    try {
      run.listeners.onScanBatch({ stats: healthy, agents: [agent('123:1')] });
      await vi.advanceTimersByTimeAsync(32000);
      expect(run.current.stale).toBe(true);
      expect(run.current.agents).toHaveLength(1);
      run.listeners.onStatsUpdate(healthy);
      expect(run.current.stale).toBe(true);
      run.listeners.onScanBatch({ stats: healthy, agents: [agent('123:1')] });
      expect(run.current.stale).toBe(false);
    } finally {
      run.dispose();
      vi.useRealTimers();
    }
  });
  it('refreshes false positives without letting older overlapping reads win', async () => {
    const run = setup();
    const older = deferred();
    const newer = deferred();
    run.host.getFalsePositives = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const one = run.dispose.refreshFalsePositives();
    const two = run.dispose.refreshFalsePositives();
    newer.resolve([{ agentName: 'new', pattern: 'x' }]);
    await two;
    older.resolve([{ agentName: 'old', pattern: 'y' }]);
    await one;
    expect(run.current.falsePositives[0].agentName).toBe('new');
    run.dispose();
  });
  it('preserves additional imported process signatures when editing an agent', () => {
    const original = {
      displayName: 'Custom',
      names: ['old.exe', 'worker.exe'],
      knownDomains: ['example.test'],
    };
    const form = { ...formFromAgent(original), processName: 'new.exe' };
    expect(applyFormToAgent(original, form)).toMatchObject({
      names: ['new.exe', 'worker.exe'],
      knownDomains: ['example.test'],
    });
  });
  it('validates imported custom identities before persistence', () => {
    const signature = { id: 'custom-agent', displayName: 'Agent', names: ['agent.exe'] };
    expect(validateCatalog([signature])).toEqual([signature]);
    expect(() => validateCatalog([signature, signature])).toThrow('unique');
    expect(() => validateCatalog([{ ...signature, names: [] }])).toThrow('process');
    expect(() => validateCatalog([{ ...signature, website: 'javascript:alert(1)' }])).toThrow(
      'HTTP',
    );
  });
});

it('keeps source receipt clocks independent through async scan, token, resource and network ordering', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const run = setup();
  try {
    await Promise.resolve();
    await Promise.resolve();
    run.listeners.onScanBatch({
      stats: healthy,
      agents: [agent('123:1')],
      resourceUsage: { cpuUser: 100, cpuSystem: 0 },
    });
    expect(run.current.lastScan).toBe(1000);
    expect(run.current.ownAt).toBe(1000);
    now = 1020;
    run.listeners.onTokenCosts([{ instanceId: '123:1', totalTokens: 20 }]);
    expect(run.current.tokensAt).toBe(1020);
    expect(run.current.lastScan).toBe(1000);
    expect(run.current.resourcesAt).toBeNull();
    now = 1800;
    run.listeners.onAgentResourceUsage([{ instanceId: '123:1', cpu: 3 }]);
    expect(run.current.resourcesAt).toBe(1800);
    expect(run.current.tokensAt).toBe(1020);
    expect(run.current.ownAt).toBe(1000);
    now = 2000;
    run.listeners.onNetworkUpdate([]);
    expect(run.current.networkAt).toBe(2000);
    expect(run.current.statsAt).toBe(1000);
  } finally {
    run.dispose();
    clock.mockRestore();
  }
});
it('a delayed own-resource seed cannot replace a newer scan value or timestamp', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const own = deferred();
  const run = setup(Promise.resolve(healthy), own.promise);
  try {
    await Promise.resolve();
    await Promise.resolve();
    now = 2000;
    run.listeners.onScanBatch({
      stats: healthy,
      agents: [agent('123:1')],
      resourceUsage: { memMB: 20 },
    });
    now = 5000;
    own.resolve({ memMB: 10 });
    await Promise.resolve();
    await Promise.resolve();
    expect(run.current.own.memMB).toBe(20);
    expect(run.current.ownAt).toBe(2000);
  } finally {
    run.dispose();
    clock.mockRestore();
  }
});

it('captures delivery totals at scan receipt rather than borrowing later file pushes', async () => {
  const run = setup();
  try {
    await Promise.resolve();
    await Promise.resolve();
    run.listeners.onFileAccess([{ sensitive: true }]);
    run.listeners.onScanBatch({ stats: healthy, agents: [agent('123:1')] });
    expect(run.current.scanCounters).toEqual({ files: 1, sensitive: 1, evicted: 0 });
    run.listeners.onFileAccess([{ sensitive: true }, { sensitive: false }]);
    expect(run.current.events).toHaveLength(3);
    expect(run.current.scanCounters).toEqual({ files: 1, sensitive: 1, evicted: 0 });
  } finally {
    run.dispose();
  }
});
