import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHarness } from '../../fixtures/etw-supervisor-harness.js';
import runtime from '../../../src/main/platform/etw-file-runtime.js';
import { message, observation, rawFrame, telemetry } from './etw-file-fixtures.js';

const sensors = [];
afterEach(() => {
  for (const sensor of sensors.splice(0)) sensor.dispose();
  vi.useRealTimers();
});
const harness = (options = {}) => createHarness(options, (sensor) => sensors.push(sensor));

describe('ETW diagnostic supervisor', () => {
  it('accepts verified reservation cleanup before ready without inventing a capture', () => {
    const h = harness();
    h.sensor.start();
    const child = h.children[0];
    child.message('hello', 1);
    child.flush();
    child.message('recovered', 2);
    child.emit('close', 4);
    const d = h.sensor.getDiagnostics();
    expect(d.restartBlocked).toBe(false);
    expect(d.summaries[0]).toMatchObject({
      capture: null,
      recoveryVerified: true,
      observationGap: true,
      finalTotals: null,
    });
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it.each([2, 72])(
    'keeps guard/broker failure blocked and never calls sampled totals final (exit %s)',
    (code) => {
      const h = harness();
      const child = h.running();
      child.message('heartbeat', 3, telemetry());
      child.emit('close', code);
      const d = h.sensor.getDiagnostics();
      expect(d.restartBlocked).toBe(true);
      expect(d.summaries[0]).toMatchObject({
        finalCounters: null,
        finalTotals: null,
        observationGap: true,
        recoveryVerified: false,
      });
      expect(h.sensor.restart()).toBe(false);
      expect(h.spawnBroker).toHaveBeenCalledOnce();
    },
  );
  it('publishes health transitions promptly without a per-observation stats storm', () => {
    const onHealthChange = vi.fn();
    const h = harness({ onHealthChange });
    const child = h.running();
    expect(onHealthChange).toHaveBeenCalledTimes(2);
    child.message('observations', 3);
    child.message('observations', 4, { records: [observation({ eventSeq: '2' })] });
    expect(onHealthChange).toHaveBeenCalledTimes(2);
    child.message('recovered', 5);
    expect(onHealthChange).toHaveBeenCalledTimes(3);
  });
  it('permits explicit retry only after an authenticated recovery terminal AND broker exit 4', () => {
    const h = harness();
    const child = h.running();
    child.message('recovered', 3);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(h.sensor.start()).toBe(false);
    child.stdout.emit('end');
    child.emit('close', 4);
    const summary = h.sensor.getDiagnostics().summaries[0];
    expect(summary.recoveryVerified).toBe(true);
    expect(summary.stopVerified).toBe(false);
    expect(summary.finalTotals).toBeNull();
    expect(summary.observationGap).toBe(true);
    expect(h.spawnBroker).toHaveBeenCalledOnce();
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(false);
    expect(h.sensor.restart()).toBe(true);
  });
  it.each(['collector-exited', 'collector-and-guard-exited', 'all-three-helpers-exited'])(
    'keeps %s FAILED and unknown stage loss until the verified broker exit',
    (cause) => {
      const h = harness();
      const child = h.running();
      child.message('recovered', 3, { ...message('recovered').data, cause });
      expect(h.sensor.getHealth().state).toBe('FAILED');
      expect(h.sensor.start()).toBe(false);
      child.emit('close', 4);
      const d = h.sensor.getDiagnostics();
      expect(d.restartBlocked).toBe(false);
      expect(d.records).toEqual([]);
      expect(d.summaries[0]).toMatchObject({
        recoveryCause: cause,
        recoveryVerified: true,
        stopVerified: false,
        finalTotals: null,
        observationGap: true,
        collectorExit: 70,
        recoveryPeers: { guardExit: 0, fallbackExit: 0, brokerElevated: false },
        exitCode: 4,
      });
      expect(d.summaries[0].reasons).toContain(cause);
    },
  );
  it('cannot infer cleanup from exit code 4 alone or a failed broker after a recovery frame', () => {
    for (const terminal of [false, true]) {
      const h = harness();
      const child = h.running();
      if (terminal) child.message('recovered', 3);
      child.stdout.emit('end');
      child.emit('close', terminal ? 2 : 4);
      expect(h.sensor.getDiagnostics().summaries[0].recoveryVerified).toBe(false);
      expect(h.sensor.start()).toBe(false);
    }
  });
  it('retains FAILED and blocks retry while one bounded cleanup consent is pending', () => {
    const h = harness();
    const child = h.running();
    child.message('recovering', 3);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(h.sensor.getHealth().detail).toContain('recovery-consent-pending');
    expect(h.sensor.getDiagnostics().recoveryPending).toBe(true);
    expect(h.sensor.start()).toBe(false);
    h.advance(120000);
    expect(child.kill).not.toHaveBeenCalled();
    child.message('recovered', 4);
    child.emit('close', 4);
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(false);
    expect(h.sensor.getHealth().detail).not.toContain('recovery-consent-pending');
    expect(h.sensor.getDiagnostics().recoveryPending).toBe(false);
  });
  it('never extends the consent deadline from duplicate pending frames', () => {
    const h = harness();
    const child = h.running();
    child.message('recovering', 3);
    h.advance(120000);
    child.message('recovering', 4);
    h.advance(25001);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(h.sensor.start()).toBe(false);
  });
  it('keeps canceled cleanup unverified and restores the short exit budget after a receipt', () => {
    for (const receipt of [false, true]) {
      const h = harness();
      const child = h.running();
      child.message('recovering', 3);
      if (receipt) {
        child.message('recovered', 4);
        h.advance(15001);
        expect(child.kill).toHaveBeenCalledOnce();
      }
      child.emit('close', 2);
      const summary = h.sensor.getDiagnostics().summaries[0];
      expect(summary.recoveryVerified).toBe(false);
      expect(summary.finalCounters).toBeNull();
      expect(h.sensor.start()).toBe(false);
    }
  });
  it('reports failed cleanup when the broker exits nonzero after a stopped acknowledgement', async () => {
    const h = harness();
    const child = h.running();
    const completion = h.sensor.dispose();
    child.flush();
    const data = message('stopped').data;
    data.requestId = child.writes.at(-1).data.requestId;
    child.message('stopped', 3, data);
    child.emit('close', 2);
    expect(await completion).toBe(false);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(h.sensor.getDiagnostics().summaries[0].stopVerified).toBe(false);
  });
  it('waits for acknowledged stop AND broker closure during application shutdown', async () => {
    const h = harness();
    const child = h.running();
    let settled = false;
    const completion = h.sensor.dispose().then((verified) => {
      settled = verified;
    });
    child.flush();
    const data = message('stopped').data;
    data.requestId = child.writes.at(-1).data.requestId;
    child.message('stopped', 3, data);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(h.sensor.isActive()).toBe(true);
    child.emit('close', 0);
    await completion;
    expect(settled).toBe(true);
    expect(h.sensor.isActive()).toBe(false);
  });
  it('does not report a successful shutdown from EOF without a stopped acknowledgement', async () => {
    const h = harness();
    const child = h.running();
    const completion = h.sensor.dispose();
    child.stdout.emit('end');
    child.emit('close', 0);
    expect(await completion).toBe(false);
  });
  it('bounds capture from ready rather than from the time spent waiting for UAC', () => {
    const h = harness({ maxCaptureMs: 60000 });
    h.sensor.start();
    h.advance(100000);
    const child = h.children[0];
    child.message('hello', 1);
    child.flush();
    const ready = message('ready').data;
    ready.requestId = child.writes[0].data.requestId;
    child.message('ready', 2, ready);
    for (let seq = 3; seq <= 32; seq++) {
      child.message('heartbeat', seq, telemetry());
      h.advance(2000);
      child.flush();
    }
    expect(child.writes.filter((row) => row.t === 'stop')).toHaveLength(1);
    const stopped = message('stopped').data;
    stopped.requestId = child.writes.at(-1).data.requestId;
    child.message('stopped', 33, stopped);
    child.emit('close', 0);
    expect(h.sensor.getDiagnostics().summaries[0].stopReason).toBe('duration-limit');
    expect(h.spawnBroker).toHaveBeenCalledOnce();
  });
  it('does not start implicitly and publishes diagnostic degradation after ready', () => {
    const h = harness();
    expect(h.spawnBroker).not.toHaveBeenCalled();
    expect(h.sensor.getHealth().state).toBe('DISABLED');
    h.running();
    expect(h.sensor.getHealth().state).toBe('DEGRADED');
    expect(h.sensor.start()).toBe(false);
  });
  it('requires ready to acknowledge this start request', () => {
    const h = harness();
    h.sensor.start();
    const child = h.children[0];
    child.message('hello', 1);
    child.flush();
    child.message('ready', 2);
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it('requires stopped to acknowledge this stop request', () => {
    const h = harness();
    const child = h.running();
    child.message('stopped', 3);
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it('retains only 256 records and accounts local ring eviction', () => {
    const h = harness();
    const child = h.running();
    for (let i = 0; i < 400; i++)
      child.message('observations', i + 3, { records: [observation({ eventSeq: String(i + 1) })] });
    const data = h.sensor.getDiagnostics();
    expect(data.records).toHaveLength(256);
    expect(data.ringDropped).toBe(144);
    data.records[0].path = 'mutation';
    expect(h.sensor.getDiagnostics().records[0].path).toBeNull();
  });
  it('also bounds long retained UTF-16 paths by bytes', () => {
    const h = harness();
    const child = h.running();
    for (let i = 0; i < 50; i++)
      child.message('observations', i + 3, {
        records: [
          observation({
            eventSeq: String(i + 1),
            path: `C:\\fixture\\${'a'.repeat(32000)}`,
            pathEvidence: 'candidate-object',
          }),
        ],
      });
    const result = h.sensor.getDiagnostics();
    expect(result.ringBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(result.records.length).toBeLessThan(20);
    expect(result.ringDropped).toBeGreaterThan(0);
  });
  it('EOF cannot stand in for stop and erases candidate evidence', () => {
    const h = harness();
    const child = h.running();
    child.message('observations', 3);
    child.stdout.emit('end');
    child.emit('close', 0);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(h.sensor.getDiagnostics().records).toEqual([]);
    expect(h.sensor.start()).toBe(false);
    expect(h.sensor.getDiagnostics().summaries[0].stopVerified).toBe(false);
  });
  it('retains losses in ended summary across a fresh session', () => {
    const h = harness();
    const child = h.running();
    const sample = telemetry();
    sample.counters.eventsLost = '7';
    child.message('health', 3, sample);
    h.stop(child, 4);
    expect(h.sensor.getDiagnostics().summaries[0].maxima.eventsLost).toBe('7');
    h.running();
    expect(h.sensor.getHealth().lossCount).toBe(0);
    expect(h.sensor.getDiagnostics().summaries[0].maxima.eventsLost).toBe('7');
  });
  it('ignores callbacks belonging to a previous broker', () => {
    const h = harness();
    const old = h.running();
    h.stop(old);
    const fresh = h.running();
    old.message('error', 5);
    old.emit('close', 2);
    expect(h.sensor.getHealth().state).toBe('DEGRADED');
    fresh.message('observations', 3);
    expect(h.sensor.getDiagnostics().records).toHaveLength(1);
  });
  it('rejects frames claiming a foreign session even on the current stream', () => {
    const h = harness();
    const child = h.running();
    child.stdout.emit('data', rawFrame(message('observations', '3')));
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it('queues one stop behind a blocked control write without growing promises', () => {
    const h = harness();
    const child = h.running();
    h.advance(2000);
    h.sensor.stop();
    h.sensor.stop();
    expect(child.writes.filter((v) => v.t === 'stop')).toHaveLength(0);
    child.flush();
    expect(child.writes.filter((v) => v.t === 'stop')).toHaveLength(1);
  });
  it('fails a blocked write and only terminates its normal broker after cleanup grace', () => {
    const h = harness();
    const child = h.running();
    h.advance(2000);
    h.advance(5001);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(child.kill).not.toHaveBeenCalled();
    h.advance(15001);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
  });
  it('heartbeat expiry is independent of successful outbound pings', () => {
    const h = harness();
    const child = h.running();
    h.advance(2000);
    child.flush();
    h.advance(8001);
    expect(h.sensor.getHealth().lastError).toBe('lease-expired');
  });
  it('launch deadline does not repeat UAC', () => {
    const h = harness();
    h.sensor.start();
    h.advance(130001);
    expect(h.sensor.getHealth().lastError).toBe('launch-failed');
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
  });
  it('stop timeout blocks restart and clears diagnostic data', () => {
    const h = harness();
    const child = h.running();
    h.sensor.restart();
    child.flush();
    h.advance(10001);
    child.emit('close', 2);
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(true);
  });
  it('explicit restart waits for terminal and successful broker exit', () => {
    const h = harness();
    const child = h.running();
    h.sensor.restart();
    child.flush();
    const data = message('stopped').data;
    data.requestId = child.writes.at(-1).data.requestId;
    child.message('stopped', 3, data);
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
    child.emit('close', 0);
    expect(h.spawnBroker).toHaveBeenCalledTimes(2);
    expect(h.spawnBroker.mock.calls[0]).not.toEqual(h.spawnBroker.mock.calls[1]);
  });
  it('bounds ended summaries and makes truncation explicit', () => {
    const h = harness();
    for (let i = 0; i < 40; i++) h.stop(h.running());
    expect(h.sensor.getDiagnostics().summaries).toHaveLength(32);
    expect(h.sensor.getDiagnostics().omittedSummaries).toBe(8);
  });
  it('rejects confirmed fields at the only diagnostic ingress', () => {
    const h = harness();
    const child = h.running();
    child.message('observations', 3, {
      records: [observation({ agent: 'invented-agent', instanceId: '71:1000' })],
    });
    expect(h.sensor.getDiagnostics().records).toEqual([]);
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
});

describe('ETW backend runtime gate', () => {
  function make(options = {}) {
    const powerMonitor = new EventEmitter(),
      spawnProcess = vi.fn();
    const sensor = runtime.createRuntime({
      app: { isPackaged: false },
      powerMonitor,
      platform: 'win32',
      argv: [],
      exists: () => true,
      spawnProcess,
      ...options,
    });
    sensors.push(sensor);
    return { sensor, powerMonitor, spawnProcess };
  }
  it.each([
    [{}, 'DISABLED'],
    [{ platform: 'linux' }, 'UNSUPPORTED'],
    [{ app: { isPackaged: true }, argv: ['--etw-file-diagnostic-root=C:\\fixture'] }, 'DISABLED'],
    [
      {
        app: { isPackaged: true },
        packageMetadata: { aegisEtwDiagnostic: 'true' },
        argv: ['--etw-file-diagnostic-root=C:\\fixture'],
      },
      'DISABLED',
    ],
    [{ argv: ['--etw-file-diagnostic-root=C:\\'] }, 'FAILED'],
    [{ argv: ['--etw-file-diagnostic-root=C:\\fixture'], exists: () => false }, 'FAILED'],
  ])('does not elevate when gates fail (%j)', (options, state) => {
    const { sensor, spawnProcess } = make(options);
    expect(sensor.start()).toBe(false);
    expect(sensor.getHealth().state).toBe(state);
    expect(spawnProcess).not.toHaveBeenCalled();
  });
  it('uses only the bundled broker in an explicit diagnostic package', () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('test launch failure');
    });
    const { sensor } = make({
      app: { isPackaged: true },
      packageMetadata: { aegisEtwDiagnostic: true },
      resourcesPath: 'C:\\candidate\\resources',
      argv: ['--etw-file-diagnostic-root=C:\\fixture'],
      spawnProcess,
    });
    sensor.start();
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(spawnProcess.mock.calls[0][0].replaceAll('\\', '/')).toMatch(
      /candidate\/resources\/etw-file\/EtwFile.exe$/,
    );
    expect(spawnProcess.mock.calls[0][1]).toEqual([
      'broker',
      expect.any(String),
      expect.any(String),
      'C:\\fixture',
      'main-escrow',
    ]);
    expect(sensor.getHealth().lastError).toBe('launch-failed');
  });
  it('routes the main-loss fault and a read-only observer only in a marked package', () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('test launch failure');
    });
    const endpoint = '12345678123456781234567812345678:71:1000';
    const { sensor } = make({
      app: { isPackaged: true },
      packageMetadata: { aegisEtwDiagnostic: true },
      resourcesPath: 'C:\\candidate\\resources',
      spawnProcess,
      argv: [
        '--etw-file-diagnostic-root=C:\\fixture',
        '--etw-file-diagnostic-fault=orphan-main-first',
        '--etw-file-diagnostic-observer=' + endpoint,
      ],
    });
    sensor.start();
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(spawnProcess.mock.calls[0][1]).toEqual([
      'broker-orphan-main-check',
      expect.any(String),
      expect.any(String),
      'C:\\fixture',
      'main-escrow',
      endpoint,
    ]);
  });
  it.each([
    '',
    'foreign',
    '0'.repeat(32) + ':71:1000',
    '12345678123456781234567812345678:0:1000',
    '12345678123456781234567812345678:71:01000',
    '12345678123456781234567812345678:71:9223372036854775808',
  ])('refuses malformed observer addresses before any process launch (%s)', (endpoint) => {
    const { sensor, spawnProcess } = make({
      app: { isPackaged: true },
      packageMetadata: { aegisEtwDiagnostic: true },
      resourcesPath: 'C:\\candidate\\resources',
      argv: [
        '--etw-file-diagnostic-root=C:\\fixture',
        '--etw-file-diagnostic-fault=orphan-main-first',
        '--etw-file-diagnostic-observer=' + endpoint,
      ],
    });
    expect(sensor.start()).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(sensor.getHealth().state).toBe('FAILED');
    expect(sensor.getHealth().detail).toBe('invalid-diagnostic-observer');
  });
  it.each([
    { app: { isPackaged: false } },
    { argv: ['--etw-file-diagnostic-root=C:\\fixture', '--etw-file-diagnostic-fault=unknown'] },
    {
      argv: [
        '--etw-file-diagnostic-root=C:\\fixture',
        '--etw-file-diagnostic-fault=collector-exit',
        '--etw-file-diagnostic-fault=collector-exit',
      ],
    },
  ])('rejects an unauthorized diagnostic crash mode (%j)', (options) => {
    const { sensor, spawnProcess } = make({
      app: { isPackaged: true },
      packageMetadata: { aegisEtwDiagnostic: true },
      resourcesPath: 'C:\\candidate\\resources',
      argv: [
        '--etw-file-diagnostic-root=C:\\fixture',
        '--etw-file-diagnostic-fault=collector-exit',
      ],
      ...options,
    });
    expect(sensor.start()).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(sensor.getHealth().state).toBe('FAILED');
  });
  it.each([
    ['collector-exit', 'broker-crash-check'],
    ['collector-before-start', 'broker-prestart-check'],
    ['collector-before-arm', 'broker-prearm-check'],
    ['guard-exit', 'broker-guard-check'],
    ['broker-exit', 'broker-exit-check'],
    ['dual-guard-first', 'broker-dual-guard-check'],
    ['dual-collector-first', 'broker-dual-collector-check'],
    ['dual-before-arm', 'broker-dual-prearm-check'],
    ['dual-before-start', 'broker-dual-prestart-check'],
    ['triple-collector-first', 'broker-triple-collector-check'],
    ['triple-guard-first', 'broker-triple-guard-check'],
    ['triple-fallback-first', 'broker-triple-fallback-check'],
    ['triple-before-arm', 'broker-triple-prearm-check'],
    ['triple-before-start', 'broker-triple-prestart-check'],
    ['triple-access-denied', 'broker-triple-denial-check'],
    ['orphan-total-before-start', 'broker-orphan-total-prestart-check'],
    ['orphan-total-before-arm', 'broker-orphan-total-prearm-check'],
    ['orphan-total-running', 'broker-orphan-total-running-check'],
    ['orphan-total-denial', 'broker-orphan-total-running-check'],
    ['orphan-recovery-denial', 'broker-orphan-recovery-denial-check'],
  ])(
    'selects only fixed crash mode %s in a marked explicit diagnostic package',
    (fault, command) => {
      const spawnProcess = vi.fn(() => {
        throw new Error('test launch failure');
      });
      const { sensor } = make({
        app: { isPackaged: true },
        packageMetadata: { aegisEtwDiagnostic: true },
        resourcesPath: 'C:\\candidate\\resources',
        argv: ['--etw-file-diagnostic-root=C:\\fixture', '--etw-file-diagnostic-fault=' + fault],
        spawnProcess,
      });
      sensor.start();
      expect(spawnProcess.mock.calls[0][1][0]).toBe(command);
    },
  );
  it('does not auto-launch on resume or unpause; removes power listeners', () => {
    const { sensor, powerMonitor, spawnProcess } = make({
      argv: ['--etw-file-diagnostic-root=C:\\fixture'],
    });
    powerMonitor.emit('suspend');
    expect(sensor.start()).toBe(false);
    powerMonitor.emit('resume');
    sensor.setPaused(true);
    sensor.setPaused(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    sensor.dispose();
    expect(powerMonitor.listenerCount('suspend')).toBe(0);
    expect(powerMonitor.listenerCount('resume')).toBe(0);
  });
});
