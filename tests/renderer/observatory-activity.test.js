import { describe, it, expect, vi } from 'vitest';
import { activityBins, activityTimeLabel } from '../../frontend/observatory/runtime/activity';
import { cpuPercent } from '../../frontend/observatory/runtime/resources';

describe('Observatory measurement contracts', () => {
  it('assigns every in-range event to exactly one half-open time bin', () => {
    const events = [-1, 0, 24, 25, 49, 50, 99, 100, NaN].map((timestamp) => ({ timestamp }));
    const bins = activityBins(events, 100, 100, 4);
    expect(bins.map((b) => b.events.map((e) => e.timestamp))).toEqual([
      [0, 24],
      [25, 49],
      [50],
      [99],
    ]);
    expect(bins[0].start).toBe(0);
    expect(bins.at(-1).end).toBe(100);
  });
  it('derives rates from cumulative samples, preserving zero, unknown and counter resets', () => {
    expect(cpuPercent({ cpuUser: 0, cpuSystem: 0 }, { cpuUser: 0, cpuSystem: 0 }, 1000)).toBe(0);
    expect(cpuPercent({ cpuUser: 10, cpuSystem: 0 }, { cpuUser: 500010, cpuSystem: 0 }, 1000)).toBe(
      50,
    );
    expect(cpuPercent({}, {}, 1000)).toBeNull();
    expect(
      cpuPercent({ cpuUser: 10, cpuSystem: 0 }, { cpuUser: 0, cpuSystem: 0 }, 1000),
    ).toBeNull();
    expect(cpuPercent({ cpuUser: 0, cpuSystem: 0 }, { cpuUser: 0, cpuSystem: 0 }, 0)).toBeNull();
  });
});

it('assigns fractional epoch boundaries to the following bucket without floating-point drift', () => {
  const end = 1788961234567.25;
  const bounds = activityBins([], end, 12345.67, 24);
  const events = bounds.map((bin) => ({ timestamp: bin.start }));
  const bins = activityBins([...events, { timestamp: end }], end, 12345.67, 24);
  expect(bins.map((bin) => bin.events)).toEqual(events.map((event) => [event]));
  expect(bins.at(-1).end).toBe(end);
});

it('rejects invalid histogram ranges and counts without throwing or allocating unbounded arrays', () => {
  for (const [end, period, count] of [
    [NaN, 100, 4],
    [100, 0, 4],
    [100, -100, 4],
    [100, Infinity, 4],
    [100, 100, 0],
    [100, 100, -1],
    [100, 100, 2.5],
    [100, 100, Infinity],
    [100, 100, 1001],
  ]) {
    expect(activityBins([{ timestamp: 50 }], end, period, count)).toEqual([]);
  }
});

it('formats a complete local axis clock and leaves malformed dates unavailable', () => {
  const at = Date.UTC(2026, 8, 10, 13, 5, 30);
  expect(activityTimeLabel(at)).toBe(
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(at),
  );
  expect(activityTimeLabel(at, true)).toBe(
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(at),
  );
  expect(activityTimeLabel(NaN)).toBe('—');
  expect(activityTimeLabel(1e30)).toBe('—');
});

it('bounds formatter allocation across ticks and refreshes the default zone after time changes', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const Original = Intl.DateTimeFormat;
  let timeZone = 'UTC';
  const constructor = vi
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(function (locale, options) {
      return new Original(locale, { ...options, timeZone });
    });
  try {
    const at = Date.UTC(2026, 8, 10, 12, 0);
    for (let i = 0; i < 100; i++) {
      activityTimeLabel(at + i * 1000);
      activityTimeLabel(at + i * 1000, true);
    }
    expect(constructor).toHaveBeenCalledTimes(2);
    timeZone = 'Asia/Tokyo';
    vi.setSystemTime(70000);
    expect(activityTimeLabel(at)).toBe(
      new Original(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }).format(at),
    );
    expect(constructor).toHaveBeenCalledTimes(3);
    timeZone = 'UTC';
    vi.setSystemTime(5000);
    expect(activityTimeLabel(at)).toBe(
      new Original(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }).format(at),
    );
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
