import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { batch, bootId, context, event, fakeChild, hello, ready } from './sensor-host-fixtures.js';

const require_ = createRequire(import.meta.url);
const { createSensorRuntime, directoryPrefixes } = require_(
  '../../src/main/platform/sensor-runtime',
);
const { SENSITIVE_AGENT_DIRS, AGENT_CONFIG_PATHS } = require_('../../src/shared/constants');

function processPass(birth = '12345') {
  const startTime = 1700000000000 + Number((BigInt(birth) * 1000n) / 100n);
  const witness = `${bootId}:${birth}`;
  return {
    reliable: true,
    identityDegraded: false,
    gapStraddled: false,
    snapshotCurrent: true,
    agents: [
      {
        pid: 73,
        category: 'ai',
        startTime,
        generationWitness: witness,
        generationWitnessSource: 'linuxStartTicks',
      },
    ],
    processMap: new Map([[73, { startTime, witness, witnessSource: 'linuxStartTicks' }]]),
  };
}

function readyMac(child) {
  const announcement = hello(child.pid);
  child.send({
    ...announcement,
    platform: 'darwin',
    mode: 'libproc',
    modes: ['libproc'],
    caps: {
      ...announcement.caps,
      fileOpen: false,
      tcpConnect: false,
      identity: 'pbi-start-usec',
      witness: 'p-uniqueid',
    },
    versions: {
      sensor: 'fixture/1',
      os: 'fixture-os',
      clockAnchor: { ...announcement.versions.clockAnchor, clock: 'mach-continuous' },
    },
  });
  child.ack();
  child.ack();
  child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
}

let runtime, child;
function setup(options = {}) {
  const spawn = vi.fn(() => (child = fakeChild()));
  const adapter = { getProcessBirthContext: vi.fn(() => structuredClone(context)) };
  runtime = createSensorRuntime({
    adapter,
    _test: { platform: 'linux', host: { spawn, exists: () => true, mono: Date.now } },
    ...options,
  });
  return { spawn, adapter };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
  child = null;
});
afterEach(async () => {
  const close = runtime?.dispose();
  child?.close(0);
  await close;
  runtime = null;
  vi.useRealTimers();
});

describe('production sensor runtime owner', () => {
  it('has no Windows owner, probe or status leaf', () => {
    const spawn = vi.fn();
    expect(setup({ _test: { platform: 'win32', host: { spawn } } }).spawn).not.toHaveBeenCalled();
    expect(runtime).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps polling fallback explicit for a missing fixed binary', () => {
    const spawn = vi.fn();
    setup({ _test: { platform: 'linux', host: { spawn, exists: () => false } } });
    expect(runtime.start()).toBe(false);
    runtime.onProcessScanCommitted(processPass());
    expect(spawn).not.toHaveBeenCalled();
    expect(runtime.getStatus()).toMatchObject({
      phase: 'unavailable',
      reason: 'binary-missing',
      polling: 'unchanged',
      qualification: 'unverified',
      admission: { state: 'unsupported-admission', accepted: 0 },
    });
    expect(runtime.getHealth().state).toBe('FAILED');
  });

  it('retries absent D1 context only after a fresh committed identity pass', () => {
    const { adapter, spawn } = setup();
    adapter.getProcessBirthContext.mockReturnValue(null);
    expect(runtime.start()).toBe(false);
    expect(runtime.getStatus().reason).toBe('identity-context-unavailable');
    runtime.onProcessScanCommitted({ ...processPass(), reliable: false });
    expect(spawn).not.toHaveBeenCalled();
    adapter.getProcessBirthContext.mockReturnValue(context);
    runtime.onProcessScanCommitted(processPass());
    expect(spawn).toHaveBeenCalledTimes(1);
    ready(child);
    expect(child.messages.find((m) => m.t === 'watch').roots[0]).toEqual({
      pid: 73,
      birth: '12345',
      witness: { kind: 'linux-start-ticks', bootId, startTicks: '12345' },
    });
  });

  it('uses existing explicit directory intentions with no glob or private status fields', () => {
    setup();
    runtime.start();
    ready(child);
    expect(child.messages.find((m) => m.t === 'paths').prefixes).toEqual(
      [...new Set([...SENSITIVE_AGENT_DIRS, ...AGENT_CONFIG_PATHS])].map((name) =>
        path.join(os.homedir(), name),
      ),
    );
    expect(directoryPrefixes('/fixture/home')).toContain(path.join('/fixture/home', '.ssh'));
    const status = JSON.stringify(runtime.getStatus());
    expect(status).not.toContain(os.homedir());
    expect(status).not.toContain('.ssh');
    expect(status).not.toContain('prefixes');
    expect(
      child.messages.find((m) => m.t === 'paths').prefixes.some((name) => name.includes('*')),
    ).toBe(false);
  });

  it('does not turn a hello or explicit provider HEALTHY into admitted native coverage', () => {
    setup();
    runtime.start();
    child.send(hello());
    expect(runtime.getHealth().state).toBe('STARTING');
    child.ack();
    child.ack();
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    expect(runtime.getStatus()).toMatchObject({
      providerState: 'HEALTHY',
      admission: { accepted: 0 },
    });
    expect(Object.values(runtime.getStatus().coverage)).toEqual(Array(5).fill('coverage-lost'));
    expect(runtime.getHealth()).toMatchObject({
      state: 'DEGRADED',
      detail: 'unsupported-admission',
    });
  });

  it('rejects native event custody and counts the entire unadmitted suffix as loss', () => {
    setup();
    runtime.start();
    ready(child);
    child.send(batch(event('1'), event('2'), event('3')));
    expect(runtime.getStatus()).toMatchObject({
      phase: 'closing',
      reason: 'sink-rejected',
      lossCount: 3,
      admission: { state: 'unsupported-admission', accepted: 0, rejected: 1 },
    });
    expect(runtime.getHealth().state).toBe('FAILED');
  });

  it('replaces PID reuse using raw ticks and suppresses duplicate desired sets', () => {
    setup();
    runtime.start();
    ready(child);
    runtime.onProcessScanCommitted(processPass('12345'));
    child.ack();
    runtime.onProcessScanCommitted(processPass('12345'));
    runtime.onProcessScanCommitted(processPass('12346'));
    expect(child.messages.filter((m) => m.t === 'watch').map((m) => m.roots[0]?.birth)).toEqual([
      undefined,
      '12345',
      '12346',
    ]);
    expect(runtime.getStatus().watchScope).toBe('current');
  });

  it.each(['reliable', 'snapshotCurrent', 'witness', 'birth', 'context', 'map'])(
    'withdraws roots rather than retaining prior authority after invalid %s',
    (failure) => {
      const { adapter } = setup();
      runtime.start();
      ready(child);
      runtime.onProcessScanCommitted(processPass());
      child.ack();
      const next = processPass();
      if (failure === 'reliable') next.reliable = false;
      if (failure === 'snapshotCurrent') next.snapshotCurrent = false;
      if (failure === 'witness') next.agents[0].generationWitness = `${bootId}:999`;
      if (failure === 'birth') next.processMap.get(73).startTime++;
      if (failure === 'context') adapter.getProcessBirthContext.mockReturnValue(null);
      if (failure === 'map') next.processMap = null;
      runtime.onProcessScanCommitted(next);
      expect(child.messages.at(-1)).toMatchObject({ t: 'watch', roots: [] });
      expect(runtime.getStatus().watchScope).toBe('process-observation-unavailable');
    },
  );

  it('waits for a new pass after pause and retains bounded custody on unresponsive shutdown', async () => {
    setup();
    runtime.start();
    ready(child);
    runtime.setPaused(true);
    runtime.onProcessScanCommitted(processPass());
    expect(runtime.getStatus().paused).toBe(true);
    const stop = runtime.dispose();
    await vi.advanceTimersByTimeAsync(2100);
    expect(await stop).toBe(false);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(runtime.getStatus().reason).toBe('custody-unconfirmed');
  });

  it('prepares explicit paths while initially paused and starts only from a new committed pass', () => {
    const { spawn } = setup();
    runtime.setPaused(true);
    expect(runtime.start()).toBe(false);
    runtime.onProcessScanCommitted(processPass('12345'));
    expect(spawn).not.toHaveBeenCalled();
    runtime.setPaused(false);
    expect(spawn).not.toHaveBeenCalled();
    runtime.onProcessScanCommitted(processPass('12346'));
    ready(child);
    expect(child.messages.find((m) => m.t === 'watch').roots[0].birth).toBe('12346');
    expect(child.messages.find((m) => m.t === 'paths').prefixes).toContain(
      path.join(os.homedir(), '.ssh'),
    );
  });

  it('never manufactures a macOS watch identity from the current polling adapter', () => {
    const spawn = vi.fn(() => (child = fakeChild()));
    setup({ _test: { platform: 'darwin', host: { spawn, exists: () => true, mono: Date.now } } });
    runtime.start();
    runtime.onProcessScanCommitted(processPass());
    expect(runtime.getStatus()).toMatchObject({
      platform: 'darwin',
      watchScope: 'identity-unavailable',
    });
    expect(runtime.getHealth().state).toBe('STARTING');
  });

  it.each(['initially-paused', 'pause-resume'])(
    'restarts the macOS provider from a fresh post-resume observation: %s',
    (scenario) => {
      const spawn = vi.fn(() => (child = fakeChild()));
      setup({ _test: { platform: 'darwin', host: { spawn, exists: () => true, mono: Date.now } } });
      if (scenario === 'pause-resume') {
        runtime.start();
        readyMac(child);
      }
      runtime.setPaused(true);
      if (scenario === 'initially-paused') expect(runtime.start()).toBe(false);
      else child.close(0);
      const starts = spawn.mock.calls.length;
      runtime.setPaused(false);
      runtime.onProcessScanCommitted({ ...processPass(), snapshotCurrent: false });
      runtime.onProcessScanCommitted({ ...processPass(), reliable: false });
      expect(spawn).toHaveBeenCalledTimes(starts);
      runtime.onProcessScanCommitted(processPass());
      expect(spawn).toHaveBeenCalledTimes(starts + 1);
      readyMac(child);
      expect(child.messages.find((message) => message.t === 'watch').roots).toEqual([]);
      expect(runtime.getStatus()).toMatchObject({
        platform: 'darwin',
        watchScope: 'identity-unavailable',
        providerState: 'HEALTHY',
        admission: { state: 'unsupported-admission', accepted: 0, rejected: 0 },
      });
      expect(runtime.getHealth()).toMatchObject({
        state: 'DEGRADED',
        detail: 'unsupported-admission',
      });
      expect(Object.values(runtime.getStatus().coverage)).toEqual(Array(5).fill('coverage-lost'));
    },
  );
});
