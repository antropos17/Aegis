/**
 * The stats-update call sites defer their payload (scan-loop.js).
 *
 * `stats-update` is a `mode: 'latest'` batcher on a 1000 ms window, so every payload
 * but the last is discarded. Building one eagerly per file event pays for N snapshots
 * to throw N-1 away — and each snapshot now carries the app-health composition and a
 * watch-plan derivation. These assert the PRODUCER is handed over, not the payload.
 *
 * The saving itself is measured in ipc-batcher.test.js ("N pushes inside one window
 * build exactly ONE payload"); what is pinned here is that the call sites use that path.
 *
 * `doFileScan` and `doHotReadScan` are not exported, so both are reached through their
 * real schedulers: `staggeredStartup` fires the file scan once at 8 s (paused, so no
 * warmup follows), and the hot-read poll runs on its own 10 s interval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as scanLoop from '../../src/main/scan-loop.js';

/** @param {object} [overrides] */
function makeDeps(overrides = {}) {
  return {
    scanner: {
      scanProcesses: vi.fn().mockResolvedValue({ agents: [], changed: false, reliable: true }),
      getProcessCapabilities: vi.fn().mockReturnValue({
        populationState: 'HEALTHY',
        populationReliable: true,
        populationAsOf: 1,
        identityQuality: 'witnessed',
      }),
      isIdentityDegraded: vi.fn().mockReturnValue(false),
    },
    procUtil: { enrichWithParentChains: vi.fn().mockResolvedValue() },
    watcher: {
      scanAllFileHandles: vi.fn().mockResolvedValue([]),
      scanHotFileHolders: vi.fn().mockResolvedValue([]),
      noteFileScanSkip: vi.fn(),
    },
    network: {
      isNetworkScanRunning: vi.fn().mockReturnValue(false),
      setNetworkScanRunning: vi.fn(),
      scanNetworkConnections: vi.fn().mockResolvedValue([]),
      noteNetworkSkip: vi.fn(),
    },
    anomaly: { calculateAnomalyScore: vi.fn().mockReturnValue({ score: 0 }) },
    baselines: { recordNetworkEndpoint: vi.fn() },
    tray: { updateTrayIcon: vi.fn(), notifySensitive: vi.fn() },
    logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    audit: { log: vi.fn() },
    sendToRenderer: vi.fn(),
    fileAccessBatcher: { push: vi.fn() },
    statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
    getStats: vi.fn().mockReturnValue({ marker: 'built' }),
    getResourceUsage: vi.fn().mockReturnValue({}),
    getLatestAgents: vi
      .fn()
      .mockReturnValue([{ pid: 100, agent: 'Claude Code', instanceId: '100:1' }]),
    setAgents: vi.fn(),
    setLatestNetConnections: vi.fn(),
    ...overrides,
  };
}

describe('scan-loop stats-update is deferred', () => {
  let deps;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    scanLoop.stopScanIntervals();
    vi.useRealTimers();
  });

  it('doFileScan hands over the producer and never the payload', async () => {
    deps = makeDeps();
    scanLoop.init(deps);
    scanLoop.staggeredStartup(10_000, true);
    await vi.advanceTimersByTimeAsync(8_100);

    expect(deps.statsUpdateBatcher.pushLazy).toHaveBeenCalled();
    expect(deps.statsUpdateBatcher.push).not.toHaveBeenCalled();
    // The exact function, not a wrapper: a closure would be a second call site to keep
    // in step with getStats, and there is no reason for one.
    expect(deps.statsUpdateBatcher.pushLazy).toHaveBeenCalledWith(deps.getStats);
  });

  it('the call site does not resolve the producer itself', async () => {
    deps = makeDeps();
    scanLoop.init(deps);
    scanLoop.staggeredStartup(10_000, true);
    await vi.advanceTimersByTimeAsync(8_100);

    const [producer] = deps.statsUpdateBatcher.pushLazy.mock.calls[0];
    expect(typeof producer).toBe('function');
    // Resolving it here proves it builds the payload — and that nobody had to build it
    // to hand it over. The batcher does that once, at flush.
    expect(producer()).toEqual({ marker: 'built' });
  });

  it('doHotReadScan defers the same way when it emits', async () => {
    deps = makeDeps({
      watcher: {
        scanAllFileHandles: vi.fn().mockResolvedValue([]),
        scanHotFileHolders: vi
          .fn()
          .mockResolvedValue([
            { agent: 'Claude Code', file: '/home/u/.ssh/id_rsa', instanceId: '100:1' },
          ]),
        noteFileScanSkip: vi.fn(),
        isHotReadScanActive: vi.fn().mockReturnValue(true),
      },
    });
    scanLoop.init(deps);
    scanLoop.startScanIntervals(30_000);
    await vi.advanceTimersByTimeAsync(10_100);

    expect(deps.statsUpdateBatcher.pushLazy).toHaveBeenCalled();
    expect(deps.statsUpdateBatcher.push).not.toHaveBeenCalled();
    expect(deps.statsUpdateBatcher.pushLazy).toHaveBeenCalledWith(deps.getStats);
  });
});
