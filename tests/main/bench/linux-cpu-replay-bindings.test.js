import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createBundle, cleanup, read, write, restamp, files } from './linux-cpu-replay-fixtures.js';
const require = createRequire(import.meta.url);
const { replayLinuxCpu } = require('../../../bench/lib/linux-cpu-replay');
const edit = (b, n, fn) => {
  const v = read(b, n);
  fn(v);
  write(b, n, v);
};
afterEach(cleanup);
describe('surviving Linux CPU bundle bindings', () => {
  it.each([
    [
      'run identity',
      files[1],
      (v) => {
        v.runId = 'different';
      },
    ],
    [
      'HZ',
      files[3],
      (v) => {
        v.clockTicksPerSecond = '200';
      },
    ],
    [
      'mode',
      files[1],
      (v) => {
        v.collectionMode = 'linux-own-defaults';
      },
    ],
    [
      'platform',
      files[4],
      (v) => {
        v.platform.arch = 'arm64';
      },
    ],
    [
      'plan sampler',
      files[0],
      (v) => {
        v.sampler.durationMs = 1000;
      },
    ],
    [
      'fixed source roster',
      files[0],
      (v) => {
        v.sources.files.reverse();
      },
    ],
    [
      'closed model',
      files[0],
      (v) => {
        v.model.tickEndpointAllowance = 1;
      },
    ],
    [
      'work checksum',
      files[3],
      (v) => {
        v.workload.checksum ^= 1;
      },
    ],
    [
      'complete short work',
      files[3],
      (v) => {
        v.workload.completedIterations = 0;
        v.workload.checksum = 1;
      },
    ],
    [
      'false acceptance',
      files[3],
      (v) => {
        v.measurementAccepted = true;
      },
    ],
    [
      'ordinal CPU',
      files[2],
      (v) => {
        v.samples[0].cpu.userUs++;
      },
    ],
    [
      'entire comparison',
      files[3],
      (v) => {
        v.comparison.endpoints[0].apiLowerUs = '1200001';
      },
    ],
    [
      'extra comparison',
      files[3],
      (v) => {
        v.comparison.extra = 'private';
      },
    ],
    [
      'source unchanged contradiction',
      files[4],
      (v) => {
        v.sources.after.files[0].sha256 = '2'.repeat(64);
      },
    ],
    [
      'unavailable source contradiction',
      files[4],
      (v) => {
        v.sources.state = 'unavailable';
      },
    ],
    [
      'predecessor reorder',
      files[4],
      (v) => {
        v.files.reverse();
      },
    ],
    [
      'predecessor hash',
      files[4],
      (v) => {
        v.files[1].sha256 = 'f'.repeat(64);
      },
    ],
    [
      'complete omitted predecessor',
      files[4],
      (v) => {
        v.files.pop();
      },
    ],
    [
      'complete cleanup',
      files[4],
      (v) => {
        v.acquisition.pendingTimer = true;
      },
    ],
    [
      'raw clock absent',
      files[2],
      (v) => {
        v.clock.reason = 'not-observed';
        v.clock.lastObservedUs = null;
      },
    ],
    [
      'raw cap contract',
      files[2],
      (v) => {
        v.limits.maxOutputBytes = 131072;
      },
    ],
  ])('refuses coherent %s contradiction', async (_label, n, fn) => {
    const b = createBundle();
    edit(b, n, fn);
    if (n !== files[4]) restamp(b);
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it.each(files)('retains missing %s as incomplete', async (n) => {
    const b = createBundle();
    fs.unlinkSync(path.join(b.input, n));
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(3);
    expect(result.report.missing).toContain(n);
  });
  it.each([files[0], files[1], files[2]])(
    'missing %s cannot mask retained disagreement',
    async (n) => {
      const b = createBundle();
      edit(b, files[3], (v) => {
        v.windows[0].api.userUs = 9000000;
      });
      edit(b, files[4], (v) => {
        v.workload.checksum = 0;
      });
      restamp(b);
      fs.unlinkSync(path.join(b.input, n));
      expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
    },
  );
  it('surviving plan and windows HZ disagree even without raw/final', async () => {
    const b = createBundle();
    edit(b, files[3], (v) => {
      v.clockTicksPerSecond = '200';
    });
    fs.unlinkSync(path.join(b.input, files[2]));
    fs.unlinkSync(path.join(b.input, files[4]));
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it('replays windows arithmetic when plan/raw are missing', async () => {
    const b = createBundle();
    edit(b, files[3], (v) => {
      v.comparison.endpoints[0].apiLowerUs = '1200001';
    });
    edit(b, files[4], (v) => {
      v.comparison.endpoints[0].apiLowerUs = '1200001';
    });
    restamp(b);
    for (const n of [files[0], files[2]]) fs.unlinkSync(path.join(b.input, n));
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(4);
    expect(result.report.replay.state).toBe('different');
  });
  it('keeps historical model identity drift orthogonal to current replay', async () => {
    const b = createBundle();
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(0);
    expect(result.report.current.historicalModelComparison).toBe('different');
    expect(result.report.current.historicalModel.sha256).toBe('1'.repeat(64));
  });
  it('retains coherent changed source as recorded nonpass', async () => {
    const b = createBundle();
    edit(b, files[4], (v) => {
      v.sources.state = 'changed';
      v.sources.after.files[0].sha256 = 'f'.repeat(64);
      v.state = 'unavailable';
      v.reason = 'source-unavailable-or-changed';
    });
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(3);
    expect(result.report.replay.state).toBe('equal');
  });
  it('accepts nonaligning clock origins and falling raw RSS without offset inference', async () => {
    const b = createBundle();
    edit(b, files[2], (v) => {
      for (const s of v.samples) {
        s.cpu.beforeUs += 10;
        s.cpu.afterUs += 10;
        s.rss.beforeUs += 20;
        s.rss.afterUs += 20;
        s.rss.residentBytes = s.scheduledUs ? 1 : 999999;
      }
    });
    restamp(b);
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(0);
    expect(Object.keys(result.report).sort()).toEqual(
      [
        'version',
        'scope',
        'state',
        'reason',
        'runId',
        'inputs',
        'missing',
        'recorded',
        'replay',
        'current',
        'originalFinalPublication',
        'finalPublication',
        'sourceAuthenticated',
        'measurementAccepted',
        'calibrationAccepted',
        'w8Accepted',
      ].sort(),
    );
    expect(Object.keys(result.report.recorded).sort()).toEqual(
      [
        'runId',
        'collectionMode',
        'comparisonState',
        'workState',
        'sourceState',
        'finalState',
        'finalPublication',
        'predecessorClosure',
        'rssAssessment',
      ].sort(),
    );
    expect(result.report.recorded.rssAssessment).toBe('not-qualified');
    const rssKeys = [];
    const visit = (v, prefix = '') => {
      if (v && typeof v === 'object')
        for (const [key, value] of Object.entries(v)) {
          const location = prefix ? prefix + '.' + key : key;
          if (/rss|residentBytes/i.test(key)) rssKeys.push(location);
          visit(value, location);
        }
    };
    visit(result.report);
    expect(rssKeys).toEqual(['recorded.rssAssessment']);
  });
  it.each([
    [
      'CPU bracket',
      (r) => {
        r.samples[0].cpu.beforeUs = 53;
      },
    ],
    [
      'CPU to RSS',
      (r) => {
        r.samples[0].cpu.afterUs = 60;
      },
    ],
    [
      'across samples',
      (r) => {
        r.samples[0].rss.beforeUs = 1000004;
        r.samples[0].rss.afterUs = 1000005;
      },
    ],
  ])('refuses coherently rehashed raw %s clock regression', async (_label, change) => {
    const b = createBundle();
    edit(b, files[2], change);
    restamp(b);
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it.each(['baseline-unavailable', 'work-budget', 'cancelled'])(
    'refuses unreachable partial full-count work reason %s',
    async (reason) => {
      const b = createBundle();
      for (const name of [files[3], files[4]])
        edit(b, name, (v) => {
          v.workload.state = 'partial';
          v.workload.reason = reason;
          if (name === files[4]) {
            v.state = 'incomplete';
            v.reason = reason;
          }
        });
      restamp(b);
      expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
    },
  );
  it('refuses partial baseline-unavailable even with zero count and a valid prefix checksum', () => {
    const { work } = require('../../../bench/lib/linux-cpu-replay-observations');
    expect(() =>
      work({
        state: 'partial',
        reason: 'baseline-unavailable',
        completedIterations: 0,
        checksum: 1,
        beforeNs: '7',
        afterNs: '20',
      }),
    ).toThrow();
  });
  it.each([
    ['clock-unavailable', '7', '20'],
    ['clock-unavailable', null, null],
    ['work-budget', null, '20'],
    ['work-budget', '7', null],
    ['cancelled', null, '20'],
    ['cancelled', '7', null],
  ])('refuses short partial %s with before=%s after=%s', async (reason, beforeNs, afterNs) => {
    const b = createBundle();
    const { checksum } = require('../../../bench/lib/linux-cpu-replay-observations');
    for (const name of [files[3], files[4]])
      edit(b, name, (v) => {
        v.workload = {
          state: 'partial',
          reason,
          completedIterations: 65536,
          checksum: checksum(65536),
          beforeNs,
          afterNs,
        };
        if (name === files[4]) {
          v.state = 'incomplete';
          v.reason = reason;
        }
      });
    restamp(b);
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it('preserves full-count partial when the final clock read throws', async () => {
    const b = createBundle(),
      raw = read(b, files[2]),
      w = read(b, files[3]),
      f = read(b, files[4]);
    raw.samples.length = 1;
    raw.samples[0].cpu.afterUs = null;
    raw.samples[0].cpu.reason = 'clock-unavailable';
    raw.samples[0].rss = {
      beforeUs: null,
      afterUs: null,
      residentBytes: null,
      reason: 'clock-unavailable',
    };
    raw.clock = { ...raw.clock, lastObservedUs: 2, reason: 'clock-unavailable' };
    raw.stopReason = 'clock-unavailable';
    raw.complete = false;
    raw.unattempted = { firstScheduledUs: 1000000, count: 1, reason: 'clock-unavailable' };
    w.windows.length = 1;
    w.workload.state = 'partial';
    w.workload.reason = 'clock-unavailable';
    w.workload.afterNs = null;
    w.comparison = {
      ...w.comparison,
      state: 'incomplete',
      reason: 'missing-reference',
      endpoints: w.comparison.endpoints.slice(0, 1),
      delta: null,
    };
    f.state = 'incomplete';
    f.reason = 'clock-unavailable';
    f.workload = w.workload;
    f.comparison = w.comparison;
    f.acquisition = {
      ...f.acquisition,
      complete: false,
      observedPoints: 1,
      unattemptedPoints: 1,
      stopReason: 'clock-unavailable',
    };
    write(b, files[2], raw);
    write(b, files[3], w);
    write(b, files[4], f);
    restamp(b);
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(3);
    expect(result.report.recorded.workState).toBe('partial');
    expect(result.report.replay.state).toBe('equal');
  });
  it('retains pure arithmetic separately from a supported late producer clock refusal', async () => {
    const b = createBundle(),
      raw = read(b, files[2]),
      w = read(b, files[3]),
      f = read(b, files[4]);
    raw.samples[1].cpu.afterUs = null;
    raw.samples[1].cpu.reason = 'clock-unavailable';
    raw.samples[1].rss = {
      beforeUs: null,
      afterUs: null,
      residentBytes: null,
      reason: 'clock-unavailable',
    };
    raw.clock = { ...raw.clock, lastObservedUs: 1000002, reason: 'clock-unavailable' };
    raw.stopReason = 'clock-unavailable';
    raw.complete = false;
    w.comparison = { ...w.comparison, state: 'refused', reason: 'clock-regressed' };
    f.comparison = w.comparison;
    f.state = 'refused';
    f.reason = 'clock-regressed';
    f.acquisition = { ...f.acquisition, complete: false, stopReason: 'clock-unavailable' };
    write(b, files[2], raw);
    write(b, files[3], w);
    write(b, files[4], f);
    restamp(b);
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(3);
    expect(result.report.replay.state).toBe('equal');
    expect(result.report.replay.comparison.state).toBe('consistent-under-declared-model');
    expect(result.report.replay.comparison.reason).toBeNull();
    expect(result.report.replay.producerComparison).toEqual(w.comparison);
    expect(result.report.replay.producerClockOverride).toBe('compatible-recorded-clock-regression');
  });
  it('refuses an unbacked producer clock override rather than inventing clock evidence', async () => {
    const b = createBundle();
    for (const name of [files[3], files[4]])
      edit(b, name, (v) => {
        v.comparison = { ...v.comparison, state: 'refused', reason: 'clock-regressed' };
        if (name === files[4]) {
          v.state = 'refused';
          v.reason = 'clock-regressed';
        }
      });
    restamp(b);
    const result = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(result.exitCode).toBe(4);
    expect(result.report.replay.comparison.state).toBe('consistent-under-declared-model');
    expect(result.report.replay.producerClockOverride).toBe('none');
  });
  it('requires default proc closure from surviving windows mode when plan/final are missing', async () => {
    const b = createBundle();
    edit(b, files[3], (v) => {
      v.collectionMode = 'linux-own-defaults';
    });
    for (const name of [files[0], files[1], files[2], files[4]])
      fs.unlinkSync(path.join(b.input, name));
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it('refuses a surviving contradictory complete final even without raw/windows', async () => {
    const b = createBundle();
    edit(b, files[4], (v) => {
      v.acquisition.stopReason = 'cancelled';
    });
    for (const n of [files[2], files[3]]) fs.unlinkSync(path.join(b.input, n));
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
});
