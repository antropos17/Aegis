import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBundle, cleanup, writeJson, restamp } from './resource-replay-fixtures.js';
const require = createRequire(import.meta.url);
const replay = require('../../../bench/lib/resource-replay');
const current = require('../../../bench/lib/resource-replay-current');
afterEach(cleanup);
const inspect = (fixture) =>
  replay.inspectResourceReplay({ input: fixture.input, out: path.join(fixture.parent, 'report') });
describe('surviving resource declarations and binding consistency (CI only)', () => {
  it.each([
    'run',
    'options',
    'roster',
    'acceptance',
    'interval',
    'schedule',
    'sources',
    'elapsed',
    'error-cause',
  ])('refuses coherent-byte tampering of %s after adjacent hashes are restamped', async (kind) => {
    const fixture = await createBundle();
    if (kind === 'run')
      writeJson(fixture.input, 'capture/session-final.json', (v) => {
        v.runId = 'another-run';
      });
    if (kind === 'options')
      writeJson(fixture.input, 'supervision-plan.json', (v) => {
        v.child.maxAcquisitionUs = 999;
      });
    if (kind === 'roster')
      writeJson(fixture.input, 'capture/session-final.json', (v) => {
        [v.files[0], v.files[1]] = [v.files[1], v.files[0]];
      });
    if (kind === 'acceptance')
      writeJson(fixture.input, 'capture/session-pending.json', (v) => {
        v.measurementAccepted = true;
      });
    if (kind === 'interval')
      writeJson(fixture.input, 'capture/bracketed-intervals.json', (v) => {
        v.intervals[0].elapsedMaxUs++;
      });
    if (kind === 'schedule')
      writeJson(fixture.input, 'capture/bracketed-intervals.json', (v) => {
        v.schedule[0].state = 'missed';
      });
    if (kind === 'sources')
      writeJson(fixture.input, 'capture/session-final.json', (v) => {
        v.sources.state = 'changed';
      });
    if (kind === 'elapsed')
      writeJson(fixture.input, 'supervision-final.json', (v) => {
        v.supervision.elapsedMs = 10000;
      });
    if (kind === 'error-cause')
      writeJson(fixture.input, 'supervision-final.json', (v) => {
        v.supervision.errorObserved = true;
      });
    restamp(fixture.input);
    expect(inspect(fixture).exitCode).toBe(4);
  });
  it.each([
    'alone',
    'conflicting-link',
    'embedded-math',
    'embedded-cleanup',
    'missing-both-acquisition-reason',
  ])('checks present contradictions before classifying missing artifacts: %s', async (mode) => {
    const fixture = await createBundle();
    if (mode === 'conflicting-link') {
      fs.unlinkSync(path.join(fixture.input, 'capture/session-plan.json'));
      writeJson(fixture.input, 'capture/session-pending.json', (v) => {
        v.planSha256 = 'f'.repeat(64);
      });
    } else {
      fs.unlinkSync(path.join(fixture.input, 'capture/raw-samples.json'));
      if (mode === 'embedded-math')
        writeJson(fixture.input, 'capture/bracketed-intervals.json', (v) => {
          v.raw.samples[1].cpu.userUs++;
        });
      if (mode === 'embedded-cleanup')
        writeJson(fixture.input, 'capture/session-final.json', (v) => {
          v.cleanup.pendingTimer = true;
          v.state = 'incomplete';
        });
      if (mode === 'missing-both-acquisition-reason') {
        fs.unlinkSync(path.join(fixture.input, 'capture/bracketed-intervals.json'));
        writeJson(fixture.input, 'capture/session-final.json', (v) => {
          v.acquisition.reason = 'clock-regressed';
        });
      }
    }
    restamp(fixture.input);
    const result = inspect(fixture);
    expect(result.exitCode).toBe(mode === 'alone' ? 3 : 4);
    if (mode === 'alone')
      expect(result.report).toMatchObject({
        classification: 'incomplete',
        replay: { basis: 'stored-derived-embedded', entireStoredResultEqual: true },
      });
  });
  it.each(['exit-six', 'killed-late-zero'])(
    'keeps coherent parent %s evidence incomplete despite a parseable complete child final',
    async (mode) => {
      const fixture = await createBundle();
      writeJson(fixture.input, 'supervision-final.json', (v) => {
        v.state = 'failed';
        if (mode === 'exit-six') {
          v.supervision.exit.code = 6;
          v.supervision.close.code = 6;
        } else {
          v.supervision.cause = 'wall-limit';
          v.supervision.elapsedMs = 10001;
          v.supervision.kill = { attempted: true, returned: true, reason: null };
        }
      });
      restamp(fixture.input);
      const result = inspect(fixture);
      expect(result.exitCode).toBe(3);
      expect(result.report.reportedChildPublicationSupport).toBe('not-supported');
      expect(result.report.childFinalPublication).toBe('unknown');
    },
  );
  it.each(['matching-close', 'close-unconfirmed'])(
    'refuses reported child zero exit against coherently incomplete cleanup: %s',
    async (mode) => {
      const fixture = await createBundle();
      writeJson(fixture.input, 'capture/raw-samples.json', (v) => {
        v.pendingTimer = true;
      });
      writeJson(fixture.input, 'capture/bracketed-intervals.json', (v) => {
        v.raw.pendingTimer = true;
      });
      writeJson(fixture.input, 'capture/session-final.json', (v) => {
        v.cleanup.pendingTimer = true;
        v.state = 'incomplete';
      });
      if (mode === 'close-unconfirmed')
        writeJson(fixture.input, 'supervision-final.json', (v) => {
          v.state = 'failed';
          v.supervision.cause = 'wall-limit';
          v.supervision.elapsedMs = 10001;
          v.supervision.close = { observed: false, code: null, signal: null };
          v.supervision.confirmation = 'exit-observed-close-unconfirmed';
        });
      restamp(fixture.input);
      expect(inspect(fixture).exitCode).toBe(4);
    },
  );
  it.each(['absent', 'below-observed'])(
    'refuses a coherently rehashed %s raw clock claim',
    async (mode) => {
      const fixture = await createBundle();
      const update = (raw) => {
        raw.clock.lastObservedUs = mode === 'absent' ? null : 0;
        if (mode === 'absent') raw.clock.reason = 'not-observed';
      };
      writeJson(fixture.input, 'capture/raw-samples.json', update);
      writeJson(fixture.input, 'capture/bracketed-intervals.json', (v) => update(v.raw));
      restamp(fixture.input);
      expect(inspect(fixture).exitCode).toBe(4);
    },
  );
  it.each([0, null])(
    'refuses a reported wall-limit with impossible elapsed %s',
    async (elapsedMs) => {
      const fixture = await createBundle();
      writeJson(fixture.input, 'supervision-final.json', (v) => {
        v.state = 'failed';
        v.supervision.cause = 'wall-limit';
        v.supervision.elapsedMs = elapsedMs;
      });
      restamp(fixture.input);
      expect(inspect(fixture).exitCode).toBe(4);
    },
  );
  it('refuses embedded duration disagreement despite missing plans and unavailable evaluator', async () => {
    const fixture = await createBundle();
    fs.unlinkSync(path.join(fixture.input, 'supervision-plan.json'));
    fs.unlinkSync(path.join(fixture.input, 'capture/session-plan.json'));
    writeJson(fixture.input, 'capture/bracketed-intervals.json', (v) => {
      v.plan.durationUs = 1000000;
      v.plan.phases[0].endUs = 1000000;
    });
    restamp(fixture.input);
    vi.spyOn(current, 'evaluator').mockReturnValue(null);
    const result = inspect(fixture);
    expect(result.exitCode).toBe(4);
    expect(result.report.classification).toBe('refused');
  });
});
