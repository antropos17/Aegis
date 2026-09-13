import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const anomalyPath = require.resolve('../../src/main/anomaly-detector.js');
const bl = require('../../src/main/baselines.js');
const scoring = require('../../src/main/scoring-utils.js');

describe('warning score work and freshness', () => {
  let anomaly;
  let previousModule;
  let spies;
  let sd;

  beforeEach(() => {
    previousModule = require.cache[anomalyPath];
    delete require.cache[anomalyPath];
    spies = Object.keys(scoring).map((name) => vi.spyOn(scoring, name));
    anomaly = require(anomalyPath);
    sd = {
      agentName: 'Fixture',
      files: new Set(['a']),
      sensitiveCount: 0,
      sensitiveReasons: new Set(),
      endpoints: new Set(),
      directories: new Set(),
      activeHours: new Set([10]),
    };
    vi.spyOn(bl, 'getSessionData').mockReturnValue({ first: sd });
    vi.spyOn(bl, 'getBaselines').mockReturnValue({
      agents: {
        Fixture: {
          sessionCount: 5,
          sessions: [{ networkEndpoints: [] }],
          averages: {
            filesPerSession: 2,
            sensitivePerSession: 1,
            knownSensitiveReasons: [],
            typicalDirectories: [],
            hourHistogram: Array(24).fill(1),
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousModule) require.cache[anomalyPath] = previousModule;
    else delete require.cache[anomalyPath];
  });

  function expectScoringCalls(count) {
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(count);
  }

  it('does not build score dimensions for a check with no new warnings', () => {
    expect(anomaly.checkDeviations()).toEqual([]);
    expectScoringCalls(0);
    sd.files = new Set(Array.from({ length: 10 }, (_, i) => `file-${i}`));
    expect(anomaly.checkDeviations()).toHaveLength(1);
    expectScoringCalls(1);
    expect(anomaly.checkDeviations()).toEqual([]);
    expectScoringCalls(1);
  });

  it('scores multiple warnings once and reads new activity on each check', () => {
    sd.files = new Set(Array.from({ length: 10 }, (_, i) => `file-${i}`));
    sd.sensitiveCount = 4;
    sd.endpoints.add('fixture.invalid:443');
    let expected = anomaly.calculateAnomalyScore('first').score;
    spies.forEach((spy) => spy.mockClear());
    const warnings = anomaly.checkDeviations();
    expect(warnings.map((w) => w.type)).toEqual(['files', 'sensitive', 'network']);
    expect(warnings.every((w) => w.anomalyScore === expected && w.instanceId === 'first')).toBe(
      true,
    );
    expectScoringCalls(1);
    sd.sensitiveReasons.add('new category');
    expected = anomaly.calculateAnomalyScore('first').score;
    spies.forEach((spy) => spy.mockClear());
    expect(anomaly.checkDeviations()).toEqual([
      expect.objectContaining({
        type: 'new-sensitive',
        anomalyScore: expected,
        instanceId: 'first',
      }),
    ]);
    expect(expected).toBeGreaterThan(warnings[0].anomalyScore);
    expectScoringCalls(1);
  });

  it('keeps scores and warning suppression separate for same-named instances', () => {
    sd.endpoints.add('first.invalid:443');
    const second = { ...sd, endpoints: new Set(['second.invalid:443', 'third.invalid:443']) };
    bl.getSessionData.mockReturnValue({ first: sd, second });
    const expected = ['first', 'second'].map((id) => anomaly.calculateAnomalyScore(id).score);
    spies.forEach((spy) => spy.mockClear());
    const warnings = anomaly.checkDeviations();
    expect(warnings.map((w) => [w.instanceId, w.anomalyScore])).toEqual([
      ['first', expected[0]],
      ['second', expected[1]],
      ['second', expected[1]],
    ]);
    expectScoringCalls(2);
    expect(anomaly.checkDeviations()).toEqual([]);
    expectScoringCalls(2);
    anomaly.forgetInstances(['first']);
    expect(anomaly.checkDeviations()).toEqual([expect.objectContaining({ instanceId: 'first' })]);
    expectScoringCalls(3);
  });
});
