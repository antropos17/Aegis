import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { referenceWindows } from './linux-own-cpu-fixtures.js';
const require = createRequire(import.meta.url);
const { evaluateCpuReference } = require('../../../bench/lib/linux-own-cpu-model');
const evaluate = (windows) => evaluateCpuReference({ clockTicksPerSecond: '100', windows });
describe('exact SELF CPU floor model (CI only)', () => {
  it('produces exact rational endpoint/delta bounds with both endpoint allowances', () => {
    const result = evaluate(referenceWindows());
    expect(result.state).toBe('consistent-under-declared-model');
    expect(result.delta).toMatchObject({
      apiDeltaUs: '100000',
      apiLowerUs: '99998',
      apiUpperExclusiveUs: '100002',
      referenceLowerUs: { numerator: '8000000', denominator: '100' },
      referenceUpperExclusiveUs: { numerator: '12000000', denominator: '100' },
      sufficientResolution: true,
      consistent: true,
    });
    expect(result.measurementAccepted).toBe(false);
    expect(result.calibrationAccepted).toBe(false);
  });
  it.each(['multiply', 'divide'])(
    'rejects a nonvacuous %s-1000 API unit error against the same proc facts',
    (mode) => {
      const windows = referenceWindows();
      for (const row of windows)
        for (const key of ['userUs', 'systemUs'])
          row.api[key] =
            mode === 'multiply' ? row.api[key] * 1000 : Math.floor(row.api[key] / 1000);
      expect(evaluate(windows)).toMatchObject({
        state: 'refused',
        reason: 'unit-or-enclosure-disagreement',
      });
    },
  );
  it('refuses equality at the strict upper reference boundary', () => {
    const windows = referenceWindows();
    windows[0].api.userUs = 1020000;
    expect(evaluate(windows).endpoints[0].consistent).toBe(false);
  });
  it('keeps exact four-microsecond reference lower progress insufficient despite positive API delta', () => {
    const windows = referenceWindows();
    for (const [i, row] of windows.entries()) {
      row.api.userUs = i ? 106 : 100;
      row.api.systemUs = 20;
      for (const v of [row.before, row.after]) {
        v.userTicks = i ? '106' : '100';
        v.systemTicks = '20';
      }
    }
    const result = evaluateCpuReference({ clockTicksPerSecond: '1000000', windows });
    expect(result.state).toBe('insufficient-resolution');
    expect(result.delta).toMatchObject({
      apiDeltaUs: '6',
      referenceLowerUs: { numerator: '4000000', denominator: '1000000' },
      consistent: true,
      sufficientResolution: false,
    });
  });
  it.each(['user-within', 'system-across'])('refuses compensated proc %s regression', (mode) => {
    const windows = referenceWindows();
    if (mode === 'user-within') {
      windows[1].after.userTicks = '109';
      windows[1].after.systemTicks = '22';
    } else {
      windows[1].before.userTicks = '112';
      windows[1].before.systemTicks = '19';
      windows[1].after.userTicks = '112';
      windows[1].api.userUs = 1120000;
    }
    expect(evaluate(windows)).toMatchObject({ state: 'refused', reason: 'counter-regressed' });
  });
  it.each([
    'identity-before',
    'identity-after',
    'user-regression',
    'system-regression',
    'clock-regression',
  ])('does not hide %s in aggregate growth', (mode) => {
    const windows = referenceWindows();
    if (mode === 'identity-before') windows[1].before.startTicks = '501';
    if (mode === 'identity-after') windows[1].after.startTicks = '501';
    if (mode === 'user-regression') {
      windows[1].api.userUs = 999999;
      windows[1].api.systemUs = 300001;
    }
    if (mode === 'system-regression') {
      windows[1].api.systemUs = 199999;
      windows[1].api.userUs = 1100001;
    }
    if (mode === 'clock-regression') windows[1].api.beforeNs = '0';
    const result = evaluate(windows);
    expect(result.state).toBe('refused');
    if (mode === 'user-regression' || mode === 'system-regression')
      expect(result.reason).toBe('counter-regressed');
  });
  it('keeps zero progress, missing second point and cancellation explicitly nonpassing', () => {
    const windows = referenceWindows();
    windows[1] = {
      ...windows[0],
      index: 1,
      before: { ...windows[0].before, beforeNs: '21', afterNs: '22' },
      api: { ...windows[0].api, beforeNs: '23', afterNs: '24' },
      after: { ...windows[0].after, beforeNs: '25', afterNs: '26' },
    };
    expect(evaluate(windows).state).toBe('insufficient-resolution');
    expect(evaluate(windows.slice(0, 1)).state).toBe('incomplete');
    windows[1].reason = 'cancelled';
    expect(evaluate(windows).state).toBe('incomplete');
  });
});
