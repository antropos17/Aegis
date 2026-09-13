import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../../src/main/anomaly-detector.js');
const bl = require('../../src/main/baselines.js');
let anomaly, previousModule, profiles, live;

function profile() {
  return {
    sessionCount: 6,
    sessions: Array.from({ length: 6 }, (_, i) => ({
      networkEndpoints: [i === 0 ? 'old:443' : 'known:443'],
    })),
    averages: {
      filesPerSession: 10,
      sensitivePerSession: 10,
      knownSensitiveReasons: ['credentials'],
      typicalDirectories: ['a', 'b', 'c', 'd'],
      hourHistogram: Array(24).fill(1),
    },
  };
}

function session(agentName = 'Fixture') {
  return {
    agentName,
    files: new Set(['a/file']),
    sensitiveCount: 1,
    sensitiveReasons: new Set(['credentials']),
    directories: new Set(['a', 'b', 'c', 'd']),
    endpoints: new Set(['known:443']),
    activeHours: new Set([10]),
  };
}

beforeEach(() => {
  previousModule = require.cache[modulePath];
  delete require.cache[modulePath];
  anomaly = require(modulePath);
  profiles = { Fixture: profile() };
  live = { first: session(), second: session() };
  vi.spyOn(bl, 'getBaselines').mockImplementation(() => ({ agents: profiles }));
  vi.spyOn(bl, 'getSessionData').mockImplementation(() => live);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousModule) require.cache[modulePath] = previousModule;
  else delete require.cache[modulePath];
});

describe('deviation profile lookup work', () => {
  it('reads each historical collection once for eight instances in each quiet pass', () => {
    live = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`instance-${i}`, session()]));
    const ab = profiles.Fixture;
    const arrays = [
      ab.averages.knownSensitiveReasons,
      ab.averages.typicalDirectories,
      ...ab.sessions.slice(-5).map((s) => s.networkEndpoints),
    ];
    const readers = arrays.map((values) => vi.spyOn(values, Symbol.iterator));
    expect(anomaly.checkDeviations()).toEqual([]);
    for (const reader of readers) expect(reader).toHaveBeenCalledTimes(1);
    expect(anomaly.checkDeviations()).toEqual([]);
    for (const reader of readers) expect(reader).toHaveBeenCalledTimes(2);
  });

  it('sees in-place profile changes and keeps warnings and scores per instance', () => {
    expect(anomaly.checkDeviations()).toEqual([]);
    const ab = profiles.Fixture;
    ab.averages.knownSensitiveReasons.length = 0;
    ab.averages.typicalDirectories.length = 0;
    for (const past of ab.sessions) past.networkEndpoints.length = 0;
    live.second.endpoints.add('second:443');
    const scores = Object.fromEntries(
      Object.keys(live).map((id) => [id, anomaly.calculateAnomalyScore(id).score]),
    );
    const warnings = anomaly.checkDeviations();
    expect(warnings.map((w) => [w.instanceId, w.type])).toEqual([
      ['first', 'new-sensitive'],
      ['first', 'network'],
      ['first', 'directories'],
      ['second', 'new-sensitive'],
      ['second', 'network'],
      ['second', 'network'],
      ['second', 'directories'],
    ]);
    expect(scores.second).toBeGreaterThan(scores.first);
    expect(warnings.every((w) => w.anomalyScore === scores[w.instanceId])).toBe(true);
    expect(anomaly.checkDeviations()).toEqual([]);
    anomaly.forgetInstances(['first']);
    expect(anomaly.checkDeviations().map((w) => w.instanceId)).toEqual(['first', 'first', 'first']);
  });

  it('keeps profiles separate, honors the last five sessions and reads replacements', () => {
    profiles.Other = profile();
    profiles.Other.sessions[5].networkEndpoints.push('old:443');
    live.first.endpoints.add('old:443');
    live.second = session('Other');
    live.second.endpoints.add('old:443');
    expect(anomaly.checkDeviations()).toEqual([
      expect.objectContaining({
        instanceId: 'first',
        type: 'network',
        message: expect.stringContaining('old:443'),
      }),
    ]);
    profiles.Other = profile();
    expect(anomaly.checkDeviations()).toEqual([
      expect.objectContaining({
        instanceId: 'second',
        type: 'network',
        message: expect.stringContaining('old:443'),
      }),
    ]);
  });
});
