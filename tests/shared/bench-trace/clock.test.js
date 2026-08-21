/**
 * @file tests/shared/bench-trace/clock.test.js
 * @description The virtual clock, and — the part that actually matters — that a
 *   preload which did NOT run is detectable.
 *
 *   The last block spawns real child processes instead of importing `clock.js` here.
 *   That is the whole point: importing the module would test the clock, and the clock
 *   is the easy half. The mechanism under test is `node --require`, whose entire job
 *   is to run before any other module is compiled, and nothing that happens inside an
 *   already-started vitest worker can demonstrate that. A spawn is pure Node, so it
 *   runs wherever the suite does.
 *
 *   The failure being pinned is ai-mistakes #21's shape: a gate that only ever
 *   exercises the working path proves the command ran, not that it inspected
 *   anything. So the negative case is spawned too — same script, no `--require` — and
 *   it must come back with no marker and a live clock.
 *
 *   Every in-process case patches a FAKE global. Moving vitest's own `Date` mid-run
 *   would be a fine way to make a suite lie about itself.
 */
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

import clock from '../../../bench/trace/clock.js';
import clockEnv from '../../../bench/trace/clock-env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const PRELOAD_PATH = path.join(REPO_ROOT, 'bench', 'trace', 'preload.js');

/** @type {number} 2026-08-21T09:13:52.000Z — an instant, chosen once and never derived. */
const EPOCH_MS = 1_787_303_632_000;

/**
 * A stand-in global, so no case touches the clock this suite itself runs on.
 * @returns {Object}
 */
function fakeGlobal() {
  return { Date: globalThis.Date, performance: { now: () => 123.456 } };
}

/** The script a spawned child runs: report what it can see about its own clock. */
const PROBE = `
const out = {
  marker: globalThis.__aegisTraceClock || null,
  now: Date.now(),
  iso: new Date().toISOString(),
  hours: new Date().getHours(),
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
};
process.stdout.write(JSON.stringify(out));
`;

/**
 * Run the probe in a child process.
 * @param {Object} opts
 * @param {boolean} opts.withPreload - Whether to pass `--require`.
 * @param {Object} [opts.env] - Extra environment for the child.
 * @returns {{status: number, stdout: string, stderr: string, json: Object|null}}
 */
function runProbe(opts) {
  const args = [];
  if (opts.withPreload) args.push('--require', PRELOAD_PATH);
  args.push('-e', PROBE);
  // Built by hand rather than spread over `process.env`: a key set to `undefined` is
  // not the same as a key that is absent, and the "no clock named" case has to be the
  // second one.
  const env = { ...process.env, ...(opts.env || {}) };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: REPO_ROOT, env });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch (_) {
    // A child that refused to start prints nothing on stdout, and that is one of the
    // cases under test — so an unparseable stdout is a result, not an error.
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

describe('virtual clock — the value', () => {
  it('starts where it was seeded and does not drift', () => {
    const c = clock.createClock(EPOCH_MS);
    expect(c.now()).toBe(EPOCH_MS);
    expect(c.epoch()).toBe(EPOCH_MS);
    expect(c.now()).toBe(EPOCH_MS);
  });

  it('moves only when it is told to, and only forward', () => {
    const c = clock.createClock(EPOCH_MS);
    expect(c.advanceTo(EPOCH_MS + 31_000)).toBe(EPOCH_MS + 31_000);
    expect(c.now()).toBe(EPOCH_MS + 31_000);
    expect(c.epoch()).toBe(EPOCH_MS);

    let err = null;
    try {
      c.advanceTo(EPOCH_MS);
    } catch (e) {
      err = e;
    }
    expect(err.name).toBe('ClockError');
    expect(err.reason).toBe('clock-reversed');
    expect(c.now(), 'a refused advance leaves the clock where it was').toBe(EPOCH_MS + 31_000);
  });

  it('allows two observations to share a millisecond', () => {
    // Refusing this would make the format unable to record what the machine did.
    const c = clock.createClock(EPOCH_MS);
    expect(c.advanceTo(EPOCH_MS)).toBe(EPOCH_MS);
  });

  it('refuses a seed or a target that is not an instant', () => {
    for (const bad of [-1, 1.5, NaN, '0', null, undefined]) {
      let err = null;
      try {
        clock.createClock(bad);
      } catch (e) {
        err = e;
      }
      expect(err && err.reason, JSON.stringify(bad)).toBe('clock-invalid');
    }
    const c = clock.createClock(EPOCH_MS);
    for (const bad of [1.5, NaN, '1', null]) {
      let err = null;
      try {
        c.advanceTo(bad);
      } catch (e) {
        err = e;
      }
      expect(err && err.reason, JSON.stringify(bad)).toBe('clock-invalid');
    }
  });
});

describe('virtual clock — what install replaces', () => {
  it('answers Date.now() and a zero-argument Date from the clock', () => {
    const target = fakeGlobal();
    const c = clock.createClock(EPOCH_MS);
    const uninstall = clock.install(c, target);
    try {
      expect(target.Date.now()).toBe(EPOCH_MS);
      expect(new target.Date().getTime()).toBe(EPOCH_MS);
      c.advanceTo(EPOCH_MS + 5000);
      expect(target.Date.now()).toBe(EPOCH_MS + 5000);
      expect(new target.Date().toISOString()).toBe(new Date(EPOCH_MS + 5000).toISOString());
    } finally {
      uninstall();
    }
  });

  it('leaves a Date built from an argument alone', () => {
    const target = fakeGlobal();
    const uninstall = clock.install(clock.createClock(EPOCH_MS), target);
    try {
      expect(new target.Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
      expect(new target.Date(2026, 0, 1).getFullYear()).toBe(2026);
    } finally {
      uninstall();
    }
  });

  it('keeps the static methods, the prototype and instanceof intact', () => {
    // A subclass would quietly change identity for code that never asked for a virtual
    // clock. A proxy over the real constructor does not.
    const target = fakeGlobal();
    const uninstall = clock.install(clock.createClock(EPOCH_MS), target);
    try {
      expect(target.Date.parse('2026-08-21T00:00:00Z')).toBe(Date.parse('2026-08-21T00:00:00Z'));
      expect(target.Date.UTC(2026, 7, 21)).toBe(Date.UTC(2026, 7, 21));
      expect(target.Date.prototype).toBe(Date.prototype);
      expect(new target.Date() instanceof Date).toBe(true);
      expect(typeof target.Date()).toBe('string');
    } finally {
      uninstall();
    }
  });

  it('reports performance.now as milliseconds since its own epoch', () => {
    const target = fakeGlobal();
    const c = clock.createClock(EPOCH_MS);
    const uninstall = clock.install(c, target);
    try {
      expect(target.performance.now()).toBe(0);
      c.advanceTo(EPOCH_MS + 250);
      expect(target.performance.now()).toBe(250);
    } finally {
      uninstall();
    }
  });

  it('undoes exactly what it did, and is safe to undo twice', () => {
    const target = fakeGlobal();
    const realDate = target.Date;
    const realPerf = target.performance.now;
    const uninstall = clock.install(clock.createClock(EPOCH_MS), target);
    expect(target.Date).not.toBe(realDate);
    uninstall();
    uninstall();
    expect(target.Date).toBe(realDate);
    expect(target.performance.now).toBe(realPerf);
    expect(target[clock.MARKER]).toBeUndefined();
  });
});

describe('virtual clock — a clock that is not installed says so', () => {
  it('isInstalled is false, and installedEpochMs refuses by name', () => {
    const target = fakeGlobal();
    expect(clock.isInstalled(target)).toBe(false);
    let err = null;
    try {
      clock.installedEpochMs(target);
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe('clock-not-installed');
    expect(err.message).toContain('--require');
  });

  it('refuses a marker whose version this build does not speak', () => {
    const target = fakeGlobal();
    target[clock.MARKER] = { version: clock.MARKER_VERSION + 1, epochMs: EPOCH_MS };
    expect(clock.isInstalled(target)).toBe(false);
  });

  it('reports the seeded epoch once a clock is in place', () => {
    const target = fakeGlobal();
    const uninstall = clock.install(clock.createClock(EPOCH_MS), target);
    try {
      expect(clock.isInstalled(target)).toBe(true);
      expect(clock.installedEpochMs(target)).toBe(EPOCH_MS);
      expect(clock.currentClock().now()).toBe(EPOCH_MS);
    } finally {
      uninstall();
    }
  });
});

describe('preload — reading its environment', () => {
  it('names the variable it needs, rather than defaulting to an instant', () => {
    // `Number('')` is 0 and `Number(' 12 ')` is 12, so a lax parse would turn an unset
    // variable into the Unix epoch and a typo into a plausible instant. Both would run.
    for (const raw of [undefined, '', ' ', 'abc', '12.5', ' 1755766432000 ', '-1']) {
      let err = null;
      try {
        clockEnv.readEpochMs({ [clockEnv.EPOCH_ENV]: raw });
      } catch (e) {
        err = e;
      }
      expect(err && err.reason, JSON.stringify(raw)).toBe('clock-invalid');
      expect(err.message).toContain(clockEnv.EPOCH_ENV);
    }
    expect(clockEnv.readEpochMs({ [clockEnv.EPOCH_ENV]: String(EPOCH_MS) })).toBe(EPOCH_MS);
  });

  it('applies a named time zone and leaves an unnamed one alone', () => {
    const env = {};
    expect(clockEnv.applyTimeZone(env)).toBeNull();
    expect(env.TZ).toBeUndefined();
    expect(clockEnv.applyTimeZone({ ...env, [clockEnv.TZ_ENV]: 'Etc/UTC' })).toBe('Etc/UTC');
  });

  it('bootstraps a clock onto the target it was given', () => {
    const target = fakeGlobal();
    const env = { [clockEnv.EPOCH_ENV]: String(EPOCH_MS), [clockEnv.TZ_ENV]: 'Etc/UTC' };
    const { epochMs, tz, uninstall } = clockEnv.bootstrap({ env, target });
    try {
      expect(epochMs).toBe(EPOCH_MS);
      expect(tz).toBe('Etc/UTC');
      expect(env.TZ).toBe('Etc/UTC');
      expect(target.Date.now()).toBe(EPOCH_MS);
    } finally {
      uninstall();
    }
  });
});

describe('preload — the mechanism, in a real child process', () => {
  it('installs the clock and the zone before anything else runs', () => {
    const probe = runProbe({
      withPreload: true,
      env: {
        [clockEnv.EPOCH_ENV]: String(EPOCH_MS),
        [clockEnv.TZ_ENV]: 'Asia/Tokyo',
      },
    });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.json.marker).toEqual({
      version: clock.MARKER_VERSION,
      epochMs: EPOCH_MS,
      installedAt: 'preload',
    });
    expect(probe.json.now).toBe(EPOCH_MS);
    expect(probe.json.iso).toBe(new Date(EPOCH_MS).toISOString());
    expect(probe.json.tz).toBe('Asia/Tokyo');
    // The zone is not decoration: `audit-logger.js` builds a daily file's NAME out of
    // local-time getters, so a replay in the wrong zone writes a differently-named file.
    expect(probe.json.hours).toBe(18);
  });

  it('WITHOUT the preload the same script has no marker and a live clock', () => {
    // The case that makes the one above mean something. A gate that only ever runs the
    // working path proves the command ran, not that it inspected anything.
    const before = Date.now();
    const probe = runProbe({
      withPreload: false,
      env: { [clockEnv.EPOCH_ENV]: String(EPOCH_MS), [clockEnv.TZ_ENV]: 'Asia/Tokyo' },
    });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.json.marker).toBeNull();
    expect(probe.json.now).not.toBe(EPOCH_MS);
    expect(probe.json.now).toBeGreaterThanOrEqual(before);
  });

  it('exits non-zero when the environment names no clock', () => {
    const probe = runProbe({ withPreload: true, env: { [clockEnv.EPOCH_ENV]: undefined } });
    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toContain(clockEnv.EPOCH_ENV);
    expect(probe.stderr).toContain('wall clock');
  });

  it('exits non-zero on an epoch that is not a string of digits', () => {
    const probe = runProbe({ withPreload: true, env: { [clockEnv.EPOCH_ENV]: '17e11' } });
    expect(probe.status).not.toBe(0);
    expect(probe.stderr).toContain('ClockError');
  });
});
