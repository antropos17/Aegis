import { beforeEach, describe, expect, it } from 'vitest';
import tracker from '../../src/main/token-tracker.js';

const model = 'claude-haiku-4-5-20251001';
const event = { model, inputTokens: 10, outputTokens: 2 };
const proc = (birth) => ({ pid: 42, instanceId: `42:${birth}` });
const total = (field) => tracker.getAllCosts().reduce((sum, row) => sum + row[field], 0);

describe('token history retention', () => {
  beforeEach(() => tracker._resetForTest());

  it('bounds exited history and IPC across 10,000 recycled identities without losing totals', () => {
    for (let birth = 1; birth <= 10_000; birth++) {
      tracker.trackTokens(proc(birth), event);
      tracker.compactCosts((id) => id === proc(birth).instanceId, true);
      expect(tracker.getAllCosts().length).toBeLessThanOrEqual(258);
    }
    const rows = tracker.getAllCosts();
    const archive = rows.find((row) => row.archived === true);
    expect(archive).toMatchObject({ instanceId: null, pid: null, archivedRecords: 9743 });
    expect(total('inputTokens')).toBe(100_000);
    expect(total('outputTokens')).toBe(20_000);
    expect(total('totalTokens')).toBe(120_000);
    expect(total('costUsd')).toBeCloseTo(10_000 * tracker.computeCost(model, 10, 2).costUsd, 10);
    expect(tracker.getCost(proc(10_000)).totalTokens).toBe(12);
    expect(JSON.stringify(rows).length).toBeLessThan(80_000);
  });

  it('keeps all active counters even when the live population exceeds the history cap', () => {
    const live = new Set();
    for (let birth = 1; birth <= 600; birth++) {
      const source = proc(birth);
      live.add(source.instanceId);
      tracker.trackTokens(source, event);
    }
    for (let birth = 601; birth <= 1600; birth++) tracker.trackTokens(proc(birth), event);
    tracker.compactCosts((id) => live.has(id), true);
    expect(tracker.getAllCosts()).toHaveLength(857);
    for (const id of live)
      expect(tracker.getCost({ pid: 42, instanceId: id }).totalTokens).toBe(12);
    expect(total('totalTokens')).toBe(19_200);
  });

  it('freezes retention without a confirmed observation, including an empty outage population', () => {
    for (let birth = 1; birth <= 1000; birth++) tracker.trackTokens(proc(birth), event);
    tracker.compactCosts(() => false, false);
    tracker.compactCosts(() => false);
    expect(tracker.getAllCosts()).toHaveLength(1000);
    tracker.compactCosts(() => false, true);
    expect(tracker.getAllCosts()).toHaveLength(257);
    expect(total('totalTokens')).toBe(12_000);
  });

  it('never transfers an archived PID generation or its estimated flags to its successor', () => {
    tracker.trackTokens(proc(1), { ...event, estimated: true });
    for (let birth = 2; birth <= 300; birth++) tracker.trackTokens(proc(birth), event);
    tracker.compactCosts(() => false, true);
    expect(tracker.getAllCosts().find((row) => row.archived)).toMatchObject({ estimated: true });
    const successor = tracker.trackTokens(proc(301), { ...event, inputTokens: 3, outputTokens: 1 });
    expect(successor).toMatchObject({ instanceId: '42:301', totalTokens: 4, estimated: false });
    expect(total('totalTokens')).toBe(3604);
  });

  it('bounds model labels while preserving counts, prices, and cache-pricing uncertainty', () => {
    for (let i = 0; i < 1000; i++) tracker.trackTokens(proc(1), { ...event, model: `model-${i}` });
    tracker.trackTokens(proc(1), { ...event, model: 'x'.repeat(100_000) });
    const record = tracker.getCost(proc(1));
    expect(record.models).toHaveLength(32);
    expect(record.modelsTruncated).toBe(true);
    expect(record.totalTokens).toBe(12_012);
    expect(record.estimated).toBe(true);
    tracker.trackTokens(proc(2), {
      ...event,
      inputBreakdown: { uncached: 0, read: 0, write5m: 0, write1h: 0, writeUnknown: 10 },
    });
    for (let birth = 3; birth <= 300; birth++) tracker.trackTokens(proc(birth), event);
    tracker.compactCosts(() => false, true);
    expect(tracker.getAllCosts().find((row) => row.archived)).toMatchObject({
      estimated: true,
      pricingEstimated: true,
      modelsTruncated: true,
    });
    tracker._resetForTest();
    expect(tracker.getAllCosts()).toEqual([]);
  });
});
