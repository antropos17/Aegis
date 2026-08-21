/**
 * @file bench/trace/clock-env.js
 * @module bench/trace/clock-env
 * @description How a preload learns which clock to install: the environment variables
 *   it reads, and the bootstrap that applies them.
 *
 *   Split from `preload.js` because that file has to ACT ON LOAD — being required for
 *   its side effect is its entire job — and a module that installs a clock the moment
 *   anything imports it cannot be tested by importing it. The split is the same one
 *   `bench/run.js` and `bench/lib/*` already draw: an entrypoint that does something,
 *   and a library that can be asked about it.
 *
 *   CONFIGURED BY ENVIRONMENT, BECAUSE `--require` TAKES NO ARGUMENTS. That makes a
 *   missing variable the most likely failure, so it is also the loudest one:
 *   {@link readEpochMs} throws rather than defaulting, and `preload.js` lets the throw
 *   escape so Node exits non-zero before the entrypoint runs. A preload that quietly
 *   declined to install would leave a replay running on the wall clock and looking
 *   exactly like one that was not.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const clockModule = require('./clock');

/** @type {string} Environment variable naming the instant the virtual clock starts at. */
const EPOCH_ENV = 'AEGIS_TRACE_CLOCK_EPOCH_MS';

/** @type {string} Environment variable naming the IANA time zone the trace was recorded in. */
const TZ_ENV = 'AEGIS_TRACE_TZ';

/**
 * Read the seed instant out of the environment, or refuse.
 *
 * Deliberately strict: only a string of digits is accepted. `Number('')` is `0` and
 * `Number(' 12 ')` is `12`, so a lax parse would turn an unset variable into the Unix
 * epoch and a typo into a plausible instant — and either one produces a replay that
 * RUNS, and whose verdict names an instant nobody recorded.
 * @param {Object} env - Usually `process.env`.
 * @returns {number} The seed instant.
 * @throws {import('./clock').ClockError} `clock-invalid` when the variable is absent
 *   or unusable.
 */
function readEpochMs(env) {
  const raw = env[EPOCH_ENV];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new clockModule.ClockError(
      'clock-invalid',
      `${EPOCH_ENV} must be a string of digits — milliseconds since the epoch, taken from the ` +
        `trace header's clock.epochMs. It was ${JSON.stringify(raw)}. Without it this preload ` +
        'would install nothing and the replay would run on the wall clock',
    );
  }
  const epochMs = Number(raw);
  if (!Number.isSafeInteger(epochMs)) {
    throw new clockModule.ClockError(
      'clock-invalid',
      `${EPOCH_ENV}=${raw} is not a safe integer of milliseconds`,
    );
  }
  return epochMs;
}

/**
 * Apply the recorded time zone, when one was named.
 *
 * The zone is not decoration: `src/main/audit-logger.js` builds a daily file's NAME
 * out of local-time getters, and `src/main/baselines.js` buckets activity by local
 * hour. A replay in the wrong zone writes a differently-named file.
 *
 * It is optional HERE so the preload can be exercised on its own without pretending to
 * a zone nobody recorded: an unset variable leaves the process in whatever zone it was
 * already in, and the trace reader then either accepts or refuses that by name. In a
 * real replay the header always carries one.
 * @param {Object} env - Usually `process.env`.
 * @returns {string|null} The zone that was applied, or `null` when none was named.
 */
function applyTimeZone(env) {
  const tz = env[TZ_ENV];
  if (typeof tz !== 'string' || tz.length === 0) return null;
  env.TZ = tz;
  return tz;
}

/**
 * Install the time zone and then the clock.
 *
 * ORDER IS LOAD-BEARING. `process.env.TZ` decides what the local-time getters answer,
 * so it is applied before anything in this process reads one.
 * @param {Object} [opts]
 * @param {Object} [opts.env] - Environment to read. Defaults to `process.env`.
 * @param {Object} [opts.target] - Global to patch. Defaults to `globalThis`.
 * @returns {{epochMs: number, tz: string|null, uninstall: () => void}}
 * @throws {import('./clock').ClockError} When the environment does not name a clock.
 */
function bootstrap(opts = {}) {
  const env = opts.env || process.env;
  const tz = applyTimeZone(env);
  const epochMs = readEpochMs(env);
  const clock = clockModule.createClock(epochMs);
  const uninstall = clockModule.install(clock, opts.target || globalThis);
  return { epochMs, tz, uninstall };
}

module.exports = { EPOCH_ENV, TZ_ENV, applyTimeZone, bootstrap, readEpochMs };
