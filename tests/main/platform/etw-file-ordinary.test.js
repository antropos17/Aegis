import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import runtime from '../../../src/main/platform/etw-file-runtime.js';
import { createHarness } from '../../fixtures/etw-supervisor-harness.js';
import { message, telemetry } from './etw-file-fixtures.js';

const owners = [];
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.useRealTimers();
});
function make(options = {}) {
  const transport = createHarness({}, (sensor) => owners.push(sensor));
  vi.setSystemTime(0);
  const powerMonitor = new EventEmitter();
  const checkRoot = vi.fn(() => true);
  const spawnProcess = vi.fn((_executable, args) => transport.spawnBroker(args[1], args[2]));
  const sensor = runtime.createRuntime({
    app: { isPackaged: true },
    packageMetadata: {},
    resourcesPath: 'C:\\package\\resources',
    platform: 'win32',
    argv: [],
    exists: () => true,
    checkRoot,
    powerMonitor,
    spawnProcess,
    now: () => Date.now(),
    mono: () => Date.now(),
    ...options,
  });
  owners.push(sensor);
  function running(action = 'start', objectBridge) {
    expect(sensor.control({ action, root: 'C:\\fixture' })).toEqual({ success: true });
    const child = transport.children.at(-1);
    child.message('hello', 1);
    child.flush();
    child.message('ready', 2, {
      ...message('ready').data,
      requestId: child.writes[0].data.requestId,
      ...(objectBridge === undefined ? {} : { objectBridge }),
    });
    child.flush();
    return child;
  }
  return { sensor, transport, powerMonitor, spawnProcess, checkRoot, running };
}
describe('ordinary packaged ETW file reads', () => {
  it('enables object policy only after the separate explicit start action', () => {
    const normal = make();
    const first = normal.running();
    expect(first.writes[0].data).not.toHaveProperty('objectPolicy');
    const explicit = make();
    const second = explicit.running('start-object', 'win11-x64-26300.9457-experimental');
    expect(second.writes[0].data.objectPolicy).toBe(true);
    expect(explicit.sensor.getReadView()).toMatchObject({
      captureMode: 'object-bound',
      admission: { qualified: true },
    });
    explicit.sensor.setPaused(true);
    expect(explicit.sensor.getReadView().admission.qualified).toBe(false);
  });
  it('offers controls without automatically prompting or requiring diagnostic metadata', () => {
    const { sensor, spawnProcess } = make();
    expect(sensor.start()).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(sensor.getReadView()).toMatchObject({
      phase: 'disabled',
      mode: 'ordinary',
      controls: { canStart: true, canStop: false },
      reads: [],
    });
  });
  it('uses the bundled broker, selected folder and main custody only after explicit start', () => {
    const h = make();
    h.running();
    expect(h.spawnProcess).toHaveBeenCalledOnce();
    expect(h.spawnProcess.mock.calls[0][0].replaceAll('\\', '/')).toBe(
      'C:/package/resources/etw-file/EtwFile.exe',
    );
    expect(h.spawnProcess.mock.calls[0][1]).toEqual([
      'broker',
      expect.any(String),
      expect.any(String),
      'C:\\fixture',
      'main-escrow',
    ]);
    expect(h.sensor.getReadView()).toMatchObject({ root: 'C:\\fixture', phase: 'running' });
    expect(h.sensor.control({ action: 'start', root: 'C:\\other' }).success).toBe(false);
    expect(h.spawnProcess).toHaveBeenCalledOnce();
  });
  it('continues past the diagnostic minute limit while the authenticated peer remains live', () => {
    const h = make(),
      child = h.running();
    for (let seq = 3; seq < 40; seq++) {
      child.message('heartbeat', seq, telemetry());
      vi.advanceTimersByTime(2000);
      child.flush();
    }
    expect(h.sensor.getDiagnostics().phase).toBe('running');
    expect(child.writes.some((row) => row.t === 'stop')).toBe(false);
  });
  it('keeps native, collector and mapping loss counters separate and reports unknown before telemetry', () => {
    const h = make();
    expect(Object.values(h.sensor.getReadView().losses).every((value) => value === null)).toBe(
      true,
    );
    const child = h.running();
    const sample = telemetry();
    Object.assign(sample.totals, {
      dropped: '7',
      ingressDropped: '7',
      mapResets: '2',
      mapEpoch: '2',
    });
    child.message('heartbeat', 3, sample);
    child.flush();
    expect(h.sensor.getReadView()).toMatchObject({
      lossCount: 0,
      losses: {
        kernelEvents: '0',
        realtimeBuffers: '0',
        logBuffers: '0',
        collectorDropped: '7',
        mappingResets: '2',
      },
    });
  });
  it.each([
    null,
    {},
    { action: 'start' },
    { action: 'start', root: 'C:\\' },
    { action: 'start', root: 'relative' },
    { action: 'start', root: 'C:\\a\\..\\b' },
    { action: 'start', root: 'C:\\fixture', executable: 'foreign.exe' },
    { action: 'stop', root: 'C:\\fixture' },
    { action: 'restart' },
  ])('refuses malformed controls before filesystem checks or process creation (%j)', (request) => {
    const h = make();
    expect(h.sensor.control(request).success).toBe(false);
    expect(h.checkRoot).not.toHaveBeenCalled();
    expect(h.spawnProcess).not.toHaveBeenCalled();
  });
  it('refuses missing/reparse folders and unavailable helpers without starting a child', () => {
    for (const options of [{ checkRoot: () => false }, { exists: () => false }]) {
      const h = make(options);
      expect(h.sensor.control({ action: 'start', root: 'C:\\fixture' }).success).toBe(false);
      expect(h.spawnProcess).not.toHaveBeenCalled();
    }
  });
  it('stops on pause or suspend and requires another explicit user start', () => {
    for (const reason of ['pause', 'suspend']) {
      const h = make(),
        child = h.running();
      if (reason === 'pause') h.sensor.setPaused(true);
      else h.powerMonitor.emit('suspend');
      child.flush();
      expect(child.writes.at(-1).t).toBe('stop');
      expect(h.sensor.control({ action: 'start', root: 'C:\\fixture' }).success).toBe(false);
      if (reason === 'pause') h.sensor.setPaused(false);
      else h.powerMonitor.emit('resume');
      expect(h.spawnProcess).toHaveBeenCalledOnce();
    }
  });
});
