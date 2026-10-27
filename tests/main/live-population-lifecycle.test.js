import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installShims, createHarness, CLAUDE } from './helpers/health-umbrella-harness.js';

const shims = installShims();
let h, hooks, detachPower;

beforeEach(() => {
  h = createHarness(shims);
  h.main._setMonitoringPausedForTest(false);
  hooks = h.main._livePopulationHooksForTest;
  // The real observation-gap and main's production listeners share this emitter.
  detachPower = hooks.attachPower(h.powerMonitor);
  h.scanLoop.init({
    ...h.deps,
    beginLivePopulationScan: hooks.begin,
    onLivePopulationIntervalsStopped: hooks.lifecycleChange,
    onProcessScanCommitted: hooks.committed,
    onProcessObservationUnavailable: hooks.unavailable,
  });
});

afterEach(async () => {
  detachPower();
  h.main._setMonitoringPausedForTest(false);
  await h.tearDown();
});

afterAll(() => shims.restore());

describe('live population custody through real process scans', () => {
  it('admits only a newly completed reliable population after pause, resume and timer stop', async () => {
    expect(hooks.witness()).toBeNull();
    await h.tickProcess();
    const first = hooks.witness();
    expect(first).toBeTypeOf('string');
    expect(h.scanner.getProcessCapabilities().populationReliable).toBe(true);
    expect(h.sessionTracker.activeCount()).toBe(1);

    h.main._setMonitoringPausedForTest(true);
    expect(hooks.witness()).toBeNull();
    h.main._setMonitoringPausedForTest(false);
    expect(hooks.witness()).toBeNull();
    expect(h.sessionTracker.activeCount()).toBe(1);
    expect(h.auditTypes()).not.toContain('agent-exit');

    await h.tickProcess();
    const resumed = hooks.witness();
    expect(resumed).toBeTypeOf('string');
    expect(resumed).not.toBe(first);
    h.scanLoop.stopScanIntervals();
    expect(hooks.witness()).toBeNull();
    await h.tickProcess();
    expect(hooks.witness()).toBeTypeOf('string');
    expect(hooks.witness()).not.toBe(resumed);
  });

  it('stays unavailable throughout suspend and resume until a healthy reconciliation', async () => {
    await h.tickProcess();
    const first = hooks.witness();
    expect(first).toBeTypeOf('string');
    h.powerMonitor.emit('suspend');
    expect(h.gap.snapshot().state).toBe('SUSPENDED');
    expect(hooks.witness()).toBeNull();
    h.powerMonitor.emit('resume');
    expect(h.gap.snapshot().state).toBe('RESUMED');
    expect(hooks.witness()).toBeNull();
    expect(h.sessionTracker.activeCount()).toBe(1);
    expect(h.auditTypes()).not.toContain('agent-exit');
    await h.tickProcess();
    expect(h.gap.snapshot().state).toBe('NONE');
    expect(hooks.witness()).toBeTypeOf('string');
    expect(hooks.witness()).not.toBe(first);
  });

  it('keeps a healthy enumeration unavailable until working-directory enrichment commits', async () => {
    let finish;
    h.deps.procUtil.annotateWorkingDirs.mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    h.startup();
    await h.advance(3000);
    expect(finish).toBeTypeOf('function');
    expect(h.scanner.getProcessCapabilities().populationReliable).toBe(true);
    expect(hooks.witness()).toBeNull();
    finish();
    await h.flush();
    expect(hooks.witness()).toBeTypeOf('string');
  });

  it('rejects a scan spanning pause and resume even when the same process returns', async () => {
    await h.tickProcess();
    const previous = hooks.witness();
    let finish;
    h.listProcesses.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    h.startup();
    await h.advance(3000);
    expect(finish).toBeTypeOf('function');
    h.main._setMonitoringPausedForTest(true);
    h.main._setMonitoringPausedForTest(false);
    finish([CLAUDE]);
    await h.flush();
    expect(hooks.witness()).toBeNull();
    expect(h.sessionTracker.activeCount()).toBe(1);
    expect(h.auditTypes()).not.toContain('agent-exit');
    await h.tickProcess();
    expect(hooks.witness()).toBeTypeOf('string');
    expect(hooks.witness()).not.toBe(previous);
  });

  it.each(['suspend-resume', 'orphan-resume'])(
    'does not admit a population when %s straddles the provider await',
    async (transition) => {
      await h.tickProcess();
      let finish;
      h.listProcesses.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      h.startup();
      await h.advance(3000);
      expect(finish).toBeTypeOf('function');
      expect(hooks.witness()).toBeNull();
      if (transition === 'suspend-resume') h.powerMonitor.emit('suspend');
      h.powerMonitor.emit('resume');
      finish([CLAUDE]);
      await h.flush();
      expect(hooks.witness()).toBeNull();
      expect(h.sessionTracker.activeCount()).toBe(1);
      expect(h.auditTypes()).not.toContain('agent-exit');
      await h.tickProcess();
      expect(hooks.witness()).toBeTypeOf('string');
    },
  );

  it('does not admit a degraded identity or an unwitnessed PID; a complete scan restores it', async () => {
    const setSnapshot = h.installSnapshotLeaf('HEALTHY', 'sidecar');
    await h.tickProcess();
    expect(hooks.witness()).toBeTypeOf('string');
    setSnapshot('FAILED');
    await h.tickProcess();
    expect(hooks.witness()).toBeNull();
    setSnapshot('HEALTHY', 'sidecar', [CLAUDE.pid]);
    await h.tickProcess();
    expect(hooks.witness()).toBeNull();
    setSnapshot('HEALTHY', 'sidecar');
    await h.tickProcess();
    expect(hooks.witness()).toBeTypeOf('string');
    expect(h.auditTypes()).not.toContain('agent-exit');
  });
});
