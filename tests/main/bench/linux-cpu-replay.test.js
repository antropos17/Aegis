import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createBundle, cleanup, read, write, restamp, files } from './linux-cpu-replay-fixtures.js';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const { replayLinuxCpu } = require('../../../bench/lib/linux-cpu-replay');
afterEach(cleanup);
describe('offline Linux CPU bundle replay', () => {
  it('replays all retained arithmetic without collecting and emits deterministic safe bytes', async () => {
    const b = createBundle();
    const a = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(a.exitCode).toBe(0);
    expect(a.report.state).toBe('consistent-for-conditional-replay');
    expect(a.report.replay.state).toBe('equal');
    const second = await replayLinuxCpu({ input: b.input, out: path.join(b.base, 'second') });
    expect(second.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(b.out, 'linux-cpu-replay.json'))).toEqual(
      fs.readFileSync(path.join(b.base, 'second/linux-cpu-replay.json')),
    );
    for (const key of [
      'sourceAuthenticated',
      'measurementAccepted',
      'calibrationAccepted',
      'w8Accepted',
    ])
      expect(a.report[key]).toBe(false);
  });
  it('retains a genuine-shaped preaborted empty acquisition as nonpass', async () => {
    const b = createBundle(),
      raw = read(b, files[2]),
      w = read(b, files[3]),
      f = read(b, files[4]);
    raw.samples = [];
    raw.clock = { ...raw.clock, lastObservedUs: null, reason: 'not-observed' };
    raw.unattempted = { firstScheduledUs: 0, count: 2, reason: 'cancelled' };
    raw.stopReason = 'cancelled';
    raw.complete = false;
    w.windows = [];
    w.workload = {
      state: 'not-started',
      reason: 'baseline-unavailable',
      completedIterations: 0,
      checksum: 1,
      beforeNs: null,
      afterNs: null,
    };
    w.comparison = {
      ...w.comparison,
      state: 'incomplete',
      reason: 'missing-reference',
      endpoints: [],
      delta: null,
    };
    f.state = 'incomplete';
    f.reason = 'cancelled';
    f.workload = w.workload;
    f.comparison = w.comparison;
    f.acquisition = {
      ...f.acquisition,
      complete: false,
      observedPoints: 0,
      unattemptedPoints: 2,
      stopReason: 'cancelled',
    };
    write(b, files[2], raw);
    write(b, files[3], w);
    write(b, files[4], f);
    restamp(b);
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(r.exitCode).toBe(3);
    expect(r.report.replay.state).toBe('equal');
    expect(r.report.recorded.workState).toBe('not-started');
  });
  it('checks partial-prefix work and incomplete raw without inventing a second point', async () => {
    const b = createBundle(),
      raw = read(b, files[2]),
      w = read(b, files[3]),
      f = read(b, files[4]);
    raw.samples.length = 1;
    raw.samples[0].cpu.afterUs = 2000010;
    raw.samples[0].rss = {
      beforeUs: 2000011,
      afterUs: 2000012,
      residentBytes: null,
      reason: 'duration-limit',
    };
    raw.clock.lastObservedUs = 2000012;
    raw.unattempted = { firstScheduledUs: 1000000, count: 1, reason: 'duration-limit' };
    raw.stopReason = 'duration-limit';
    raw.complete = false;
    w.windows.length = 1;
    w.workload = {
      state: 'partial',
      reason: 'work-budget',
      completedIterations: 0,
      checksum: 1,
      beforeNs: '7',
      afterNs: '2000000007',
    };
    w.comparison = {
      ...w.comparison,
      state: 'incomplete',
      reason: 'missing-reference',
      endpoints: w.comparison.endpoints.slice(0, 1),
      delta: null,
    };
    f.state = 'incomplete';
    f.reason = 'work-budget';
    f.workload = w.workload;
    f.comparison = w.comparison;
    f.acquisition = {
      ...f.acquisition,
      complete: false,
      observedPoints: 1,
      unattemptedPoints: 1,
      stopReason: 'duration-limit',
    };
    write(b, files[2], raw);
    write(b, files[3], w);
    write(b, files[4], f);
    restamp(b);
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(r.exitCode).toBe(3);
    expect(r.report.replay.comparison.endpoints).toHaveLength(1);
    expect(r.report.replay.state).toBe('equal');
  });
  it('retains parseable close-uncertain raw presence independently of reported predecessor closure', async () => {
    const b = createBundle(),
      w = read(b, files[3]),
      f = read(b, files[4]);
    w.rawSha256 = null;
    write(b, files[3], w);
    f.rawSha256 = null;
    f.state = 'persistence-failed';
    f.reason = 'persistence-unavailable';
    f.files = f.files.filter((v) => v.file !== files[2]);
    const bytes = fs.readFileSync(path.join(b.input, files[3]));
    const crypto = require('node:crypto');
    f.windowsSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    Object.assign(
      f.files.find((v) => v.file === files[3]),
      { sha256: f.windowsSha256, byteLength: bytes.length },
    );
    write(b, files[4], f);
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(r.exitCode).toBe(3);
    expect(r.report.inputs.find((v) => v.file === files[2]).closed).toBe(true);
    expect(r.report.recorded.finalState).toBe('persistence-failed');
    expect(r.report.recorded.predecessorClosure).toBe('reported-only');
  });
});
