/**
 * @file tests/main/bench/sensor.test.js
 * @description The parts of the sensor harness that decide WHEN a run may act
 *   and what it may conclude afterwards. Nothing here starts Electron: these are
 *   the pure judgements sitting on top of the child process, and they are the
 *   ones that were wrong first — a run that begins at the sensor's first
 *   completed scan acts into the startup schedule's ~37 s gap and its subject is
 *   never scanned at all.
 *
 *   The tick strings below are the instants a real arm-A run reported, offsets
 *   from the sensor's start in the comments.
 */
import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';

import sensor from '../../../bench/lib/sensor.js';

/** Ticks from a real run: +6.1 s, +43.4 s, +85.4 s, +93.6 s. @type {string[]} */
const REAL_TICKS = Object.freeze([
  '2026-08-13T17:11:09.866Z',
  '2026-08-13T17:11:47.179Z',
  '2026-08-13T17:12:29.130Z',
  '2026-08-13T17:12:37.370Z',
]);

describe("bench sensor — reading the product's own scan log", () => {
  it('recognises a completed process scan and takes its instant', () => {
    const line = '[2026-08-13T17:11:09.866Z] DEBUG [scan] process {"ms":2818,"agents":2}';
    expect(sensor.TICK_LINE.exec(line)[1]).toBe('2026-08-13T17:11:09.866Z');
  });

  it('is not fooled by the other lines the app prints', () => {
    for (const line of [
      '[2026-08-13T17:11:09.866Z] DEBUG [scan] file {"ms":12}',
      '[2026-08-13T17:11:09.866Z] DEBUG [scan] network-skip {"reason":"confirmed-zero-agents"}',
      '[2026-08-13T17:11:09.866Z] INFO  [main] App starting {"version":"0.11.0-alpha"}',
      '[2026-08-13T17:11:09.866Z] DEBUG [perf] spawn {"spawn":"tasklist","ms":885}',
    ]) {
      expect(sensor.TICK_LINE.test(line)).toBe(false);
    }
  });

  it('splits a stream into lines and keeps a partial one for the next chunk', async () => {
    const seen = [];
    const stream = new Readable({ read() {} });
    sensor.pumpLines(stream, (l) => seen.push(l));
    stream.push('one\r\ntw');
    stream.push('o\nthree');
    stream.push(null);
    await new Promise((resolve) => stream.on('end', resolve));
    expect(seen).toEqual(['one', 'two', 'three']);
  });
});

describe('bench sensor — when the run may start acting', () => {
  it('does not call one completed scan a settled cadence', () => {
    expect(sensor.settledAt([REAL_TICKS[0]], sensor.STEADY_GAP_MS)).toBeNull();
  });

  it('does not call the startup schedule settled, however many ticks it has', () => {
    // The two ticks a run used to act between: 37.3 s apart, against a subject
    // that lives 35 s. Acting here is what made the process unobservable.
    expect(sensor.settledAt(REAL_TICKS.slice(0, 2), sensor.STEADY_GAP_MS)).toBeNull();
  });

  it('settles on the first pair of ticks close enough to be the real interval', () => {
    expect(sensor.settledAt(REAL_TICKS, sensor.STEADY_GAP_MS)).toBe(REAL_TICKS[3]);
  });

  it('ignores an instant it cannot read rather than settling on it', () => {
    expect(sensor.settledAt(['not-a-time', REAL_TICKS[0]], sensor.STEADY_GAP_MS)).toBeNull();
  });
});

describe('bench sensor — what the run may conclude afterwards', () => {
  /** @param {string[]} ticks @returns {Object} */
  const handle = (ticks) => ({ ticks });

  it("counts the scans that fell inside the subject's lifetime", () => {
    expect(
      sensor.ticksWithin(
        handle(REAL_TICKS),
        '2026-08-13T17:11:40.000Z',
        '2026-08-13T17:12:30.000Z',
      ),
    ).toBe(2);
  });

  it('reports zero when the subject lived entirely between two scans', () => {
    // The real failure: alive +6.3 s → +41.3 s, scans at +6.1 s and +43.4 s.
    expect(
      sensor.ticksWithin(
        handle(REAL_TICKS),
        '2026-08-13T17:11:09.998Z',
        '2026-08-13T17:11:45.012Z',
      ),
    ).toBe(0);
  });

  it('says it does not know rather than saying zero when a bound is missing', () => {
    expect(sensor.ticksWithin(handle(REAL_TICKS), null, '2026-08-13T17:12:30.000Z')).toBeNull();
    expect(sensor.ticksWithin(handle(REAL_TICKS), 'not-a-time', 'also-not')).toBeNull();
  });
});

describe('bench sensor — the run-scoped profile', () => {
  it('puts it outside the repository, where the file watcher cannot see it', () => {
    const dir = sensor.profileDirFor('2026-08-13T17-11-03Z-S1-agent-lifecycle-A');
    expect(dir).toContain('aegis-bench-2026-08-13T17-11-03Z-S1-agent-lifecycle-A');
    // A profile under the watched project directory would feed the audit log its
    // own writes: write → file event → audit record → write.
    expect(dir.startsWith(sensor.RENDERER_ENTRY.split('dist')[0])).toBe(false);
  });
});
