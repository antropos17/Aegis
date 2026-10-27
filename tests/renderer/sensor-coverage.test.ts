import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyTelemetry, record } from '../../frontend/observatory/runtime/host';
import { coverageFixture } from './coverage-fixture';
import {
  coverageCount,
  coverageLabel,
  coverageTime,
  sensorCoverage,
  coverageStates,
  coverageModes,
  coverageScopes,
  coverageSensors,
  coverageReasons,
  coveragePhases,
  coverageSurfaces,
  projectCoverageStates,
  projectCoverageDetails,
} from '../../frontend/observatory/runtime/sensor-coverage';
import portuguese from '../../frontend/observatory/translations/pt-BR.json';

describe('closed runtime coverage projection', () => {
  it('explains unavailable file observation and recovery without exposing unknown diagnostics', () => {
    const input = coverageFixture('windows');
    const sensors = record(record(input.stats.appHealth).sensors);
    sensors.byId = {
      'fs-chokidar': { state: 'FAILED', detail: 'no-live-watcher' },
      'fs-handle': { state: 'DEGRADED', detail: 'no-handle-binary-and-no-rm' },
      'fs-rm': { state: 'DEGRADED', detail: 'read-detection-unavailable' },
    };
    expect(sensorCoverage(input).sensors.map(({ state, detail }) => [state, detail])).toEqual([
      ['Failed', 'No configured file-change watcher is active.'],
      ['Degraded', 'Neither the handle scanner nor Resource Manager is available.'],
      ['Degraded', 'Open-file observation is unavailable.'],
    ]);
    sensors.byId = {
      'fs-handle': { state: 'HEALTHY', detail: null },
      'fs-rm': { state: 'UNSUPPORTED', detail: 'pool-owns-observation' },
      'fs-chokidar': { state: 'DEGRADED', detail: 'PRIVATE_ROOT_ERROR' },
    };
    const recovered = sensorCoverage(input).sensors;
    expect(recovered.map(({ state, detail }) => [state, detail])).toEqual([
      ['Healthy', 'Not reported'],
      ['Unsupported', 'The handle scanner is handling this observation.'],
      ['Degraded', 'Not reported'],
    ]);
    expect(JSON.stringify(recovered)).not.toContain('PRIVATE_ROOT_ERROR');
    expect(coverageLabel(coverageReasons, 'all-agents-failed')).toBe(
      'File handle scans failed for all selected agents.',
    );
  });
  it('shows the reported network provider failure without exposing unknown details', () => {
    const input = coverageFixture('windows');
    record(record(input.stats.appHealth).sensors).byId = {
      network: { state: 'FAILED', detail: 'provider-failure' },
    };
    expect(sensorCoverage(input).sensors[0]).toMatchObject({
      title: 'Network connections',
      state: 'Failed',
      detail: 'Provider failed',
    });
  });
  it.each(['stale', 'not-ready', 'error'])(
    'qualifies project readiness when telemetry is %s',
    (state) => {
      const input = coverageFixture();
      record(input.stats.appHealth).watchPlan = { projectState: 'observed' };
      input.stats.monitoringPaused = true;
      input.stale = state === 'stale';
      input.ready = state !== 'not-ready';
      input.error = state === 'error' ? 'PRIVATE_FAILURE' : '';
      expect(sensorCoverage(input).project).toEqual({
        state: 'Unknown',
        detail: projectCoverageDetails.unknown,
        paused: false,
      });
      expect(record(record(input.stats.appHealth).watchPlan).projectState).toBe('observed');
    },
  );
  it.each(['not-observed', 'starting', 'observed', 'unavailable', 'unknown'])(
    'keeps project %s distinct from aggregate healthy file changes',
    (projectState) => {
      const input = coverageFixture('windows');
      const health = record(input.stats.appHealth);
      health.watchPlan = { state: 'HEALTHY', projectState, path: 'PRIVATE_ROOT' };
      record(health.sensors).byId = { 'fs-chokidar': { state: 'HEALTHY' } };
      const model = sensorCoverage(input);
      expect(model.project).toEqual({
        state: projectCoverageStates[projectState],
        detail: projectCoverageDetails[projectState],
        paused: false,
      });
      expect(model.sensors[0].state).toBe('Healthy');
      expect(JSON.stringify(model)).not.toContain('PRIVATE_ROOT');
    },
  );
  it('keeps missing and hostile project states unknown and operator pause separate', () => {
    const input = coverageFixture();
    expect(sensorCoverage(input).project.state).toBe('Unknown');
    record(input.stats.appHealth).watchPlan = { projectState: '__proto__' };
    input.stats.monitoringPaused = true;
    expect(sensorCoverage(input).project).toEqual({
      state: 'Unknown',
      detail: projectCoverageDetails.unknown,
      paused: true,
    });
  });
  it('covers the checked-in factory lifecycle and fixed launcher/transport failure vocabulary', () => {
    const paths = [
      'sensor-host.js',
      'sensor-host-launch.js',
      'sensor-host-transport.js',
      'sensor-host-updates.js',
    ];
    for (const path of paths) {
      const source = readFileSync('src/main/platform/' + path, 'utf8');
      for (const [, phase] of source.matchAll(/setState\('([^']+)'/g))
        expect(coverageLabel(coveragePhases, phase), path + ': ' + phase).not.toBe('Not reported');
      const reasons = [
        ...source.matchAll(/(?:failed|fail)\('([^']+)'/g),
        ...source.matchAll(/setState\('[^']+', '([^']+)'/g),
        ...source.matchAll(/\{ error: '([^']+)' \}/g),
      ];
      for (const [, reason] of reasons)
        expect(coverageLabel(coverageReasons, reason), path + ': ' + reason).not.toBe(
          'Not reported',
        );
    }
  });
  it.each([
    ['unavailable', 'binary-missing', 'Unavailable', 'Sensor executable is missing'],
    ['unavailable', 'launch-failed', 'Unavailable', 'Sensor could not start'],
    ['waiting', 'restart-pending', 'Waiting for restart', 'Restart scheduled'],
    ['failed', 'restart-exhausted', 'Failed', 'Restart limit reached'],
    ['closing', 'stream-failed', 'Closing', 'Sensor communication failed'],
    ['closing', 'protocol-failed', 'Closing', 'Invalid sensor communication'],
    ['closing', 'stream-ended', 'Closing', 'Sensor communication ended'],
    ['closing', 'request-encoding-failed', 'Closing', 'Sensor request could not be encoded'],
    ['closing', 'write-failed', 'Closing', 'Sensor request could not be sent'],
    ['closing', 'request-timeout', 'Closing', 'Sensor request timed out'],
    ['closing', 'session-invalid', 'Closing', 'Invalid sensor session'],
    ['closing', 'snapshot-rejected', 'Closing', 'Process snapshot request rejected'],
    ['closing', 'stop-rejected', 'Closing', 'Sensor stop request rejected'],
    ['closing', 'update-rejected', 'Closing', 'Sensor scope update rejected'],
    ['closing', 'snapshot-consumer-failed', 'Closing', 'Process snapshot could not be handled'],
    ['closing', 'request-id-exhausted', 'Closing', 'Sensor request limit reached'],
  ])(
    'shows factory launch/restart/transport result %s / %s',
    (phase, reason, expectedPhase, expectedReason) => {
      const input = coverageFixture();
      const native = record(input.stats.nativeSensor);
      Object.assign(native, { phase, reason, providerState: 'FAILED' });
      const view = sensorCoverage(input);
      expect.soft(view.phase).toBe(expectedPhase);
      expect.soft(view.reason).toBe(expectedReason);
      expect(view.provider).toBe('Failed');
      expect(view.admission).toBe('Native event delivery is not qualified');
      expect(view.surfaces.every((surface) => surface.state === 'Coverage lost')).toBe(true);
    },
  );
  it('keeps healthy provider separate from unqualified native delivery and blocking', () => {
    const input = coverageFixture();
    record(record(input.stats.nativeSensor).coverage).exec = 'observed';
    const view = sensorCoverage(input);
    expect(view.provider).toBe('Healthy');
    expect(view.admission).toBe('Native event delivery is not qualified');
    expect(view.surfaces.every((surface) => surface.state === 'Coverage lost')).toBe(true);
    expect(view.accepted).toBe(0);
    expect(view.rejected).toBe(7);
    expect(view.loss).toBe(3);
    expect(view.restarts).toBe(1);
    expect(view.lastRestartAt).toBeNull();
  });
  it('shows that procfs mode cannot observe directory paths', () => {
    const input = coverageFixture();
    Object.assign(record(input.stats.nativeSensor), {
      mode: 'procfs',
      pathScope: 'paths-unsupported',
    });
    const view = sensorCoverage(input);
    expect(view.paths).toBe('Directory observation is unavailable in procfs mode');
    expect(view.surfaces.every((surface) => surface.state === 'Coverage lost')).toBe(true);
  });
  it('preserves absent versus observed zero and missing versus unsupported native status', () => {
    const missing = sensorCoverage(emptyTelemetry());
    expect(missing.unsupported).toBe(false);
    expect(missing.reported).toBe(false);
    expect(missing.loss).toBeNull();
    expect(missing.restarts).toBeNull();
    const windows = sensorCoverage(coverageFixture('windows'));
    expect(windows.unsupported).toBe(true);
    expect(windows.sensors[0].loss).toBe(0);
    expect(windows.sensors[1].state).toBe('Off');
  });
  it('does not leak hostile fixed-code diagnostics or invent rates and provenance', () => {
    const input = coverageFixture();
    const privateValue = 'C:/Users/private/.ssh/secret<script>bad</script>';
    input.stats.nativeSensor = {
      platform: privateValue,
      mode: privateValue,
      providerState: 'constructor',
      reason: privateValue,
      modeReason: privateValue,
      watchScope: privateValue,
      pathScope: privateValue,
      lossCount: '0',
      restart: { used: -1 },
      admission: { state: privateValue, accepted: Infinity },
    };
    input.stats.appHealth = {
      sensors: { byId: { [privateValue]: { state: privateValue, detail: privateValue } } },
    };
    const view = sensorCoverage(input);
    expect(JSON.stringify(view)).not.toContain(privateValue.replaceAll('\\', '\\\\'));
    expect(view.provider).toBe('Not reported');
    expect(view.loss).toBeNull();
    expect(view.accepted).toBeNull();
    expect(view.sensors[0].title).toBe('Other sensor');
    expect(view.surfaces.every((surface) => surface.state === 'Not reported')).toBe(true);
  });
  it('validates counter and timestamp bounds and does not substitute the present', () => {
    for (const input of [
      undefined,
      null,
      '0',
      -1,
      -0,
      NaN,
      Infinity,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(coverageCount(input)).toBeNull();
    expect(coverageCount(0)).toBe(0);
    for (const input of [undefined, null, 0, -1, '123', NaN, 8640000000000001])
      expect(coverageTime(input, 'en')).toBe('Not reported');
    expect(coverageTime(1792396800000, 'pt')).toContain('19/10/2026');
    expect(coverageLabel(coverageStates, '__proto__')).toBe('Not reported');
  });
  it('provides Portuguese copy for all dynamic labels and retains catalog placeholders', () => {
    for (const labels of [
      coverageStates,
      coverageModes,
      coverageScopes,
      coverageSensors,
      coverageReasons,
      coveragePhases,
      coverageSurfaces,
      projectCoverageStates,
      projectCoverageDetails,
    ]) {
      for (const label of Object.values(labels))
        expect(Object.hasOwn(portuguese, label), label).toBe(true);
    }
    const component = readFileSync('frontend/observatory/components/CoveragePanel.svelte', 'utf8');
    const metrics = component.slice(
      component.indexOf('let metrics ='),
      component.indexOf('as const'),
    );
    for (const [, label] of metrics.matchAll(/\['([^']+)',/g))
      expect(Object.hasOwn(portuguese, label), label).toBe(true);
    for (const label of ['Linux', 'macOS', 'Not reported', 'Other sensor', 'Coverage lost'])
      expect(Object.hasOwn(portuguese, label), label).toBe(true);
  });
});
