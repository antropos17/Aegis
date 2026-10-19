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
} from '../../frontend/observatory/runtime/sensor-coverage';
import portuguese from '../../frontend/observatory/translations/pt-BR.json';

describe('closed runtime coverage projection', () => {
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
