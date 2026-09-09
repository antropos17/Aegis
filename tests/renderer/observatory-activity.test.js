import { describe, it, expect } from 'vitest';
import { activityBins } from '../../frontend/observatory/runtime/activity';
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
