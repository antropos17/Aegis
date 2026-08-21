#!/usr/bin/env node
/**
 * @file bench/trace/bench-replay.js
 * @module bench/trace/bench-replay
 * @description What `npm run bench:replay` executes: reads the trace's own header,
 *   supplies the environment the replay needs — `AEGIS_TRACE_CLOCK_EPOCH_MS`,
 *   `AEGIS_TRACE_TZ`, and the `--require bench/trace/preload.js` flag — and runs
 *   `replay-trace.js` in a child process.
 *
 *   ```
 *   npm run bench:replay -- <trace dir> [--out <dir>]
 *   ```
 *
 *   A WRAPPER, NOT A SECOND ENTRYPOINT. The clock has to be installed before any
 *   product module is compiled, which is strictly earlier than anything an already
 *   running process can do — so the child is spawned with the preload, and every
 *   decision about the trace (validation, refusals, the verdict) stays in
 *   `replay-trace.js`. The header is read here ONLY for the two values the
 *   environment must carry, and both are passed back verbatim: the zone because the
 *   runtime canonicalizes zone names, the epoch because `readEpochMs` accepts only a
 *   string of digits.
 *
 *   Exit codes follow `replay-trace.js`: **2** the invocation was wrong and nothing
 *   ran · **1** the header could not be read, the trace was refused, or the replay
 *   could not complete · **0** the replay completed and the verdict was written.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const clockEnv = require('./clock-env');
const schema = require('./schema');
const { parseArgs } = require('./replay-trace');

/**
 * Read the two environment values out of a trace's header.
 * @param {string} traceDir - The trace directory.
 * @returns {{epochMs: number, tz: string}|{error: string}}
 */
function readClockFromHeader(traceDir) {
  const headerPath = path.join(traceDir, schema.HEADER_FILENAME);
  let header;
  try {
    header = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  } catch (err) {
    return { error: `the trace header could not be read at ${headerPath}: ${err.message}` };
  }
  const epochMs = header && header.clock ? header.clock.epochMs : undefined;
  const tz = header && header.tz ? header.tz.name : undefined;
  if (!Number.isSafeInteger(epochMs) || typeof tz !== 'string' || tz.length === 0) {
    return {
      error:
        `${headerPath} does not carry clock.epochMs and tz.name — without them no clock can ` +
        'be installed, and the replay itself would refuse the header anyway',
    };
  }
  return { epochMs, tz };
}

/**
 * Spawn the replay under the preload, with the header's own environment.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {number} The process exit code.
 */
function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`bench:replay: ${args.error}`);
    console.error('usage: npm run bench:replay -- <trace dir> [--out <dir>]');
    return 2;
  }
  const clock = readClockFromHeader(args.traceDir);
  if (clock.error) {
    console.error(`bench:replay: ${clock.error}`);
    return 1;
  }
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      path.join(__dirname, 'preload.js'),
      path.join(__dirname, 'replay-trace.js'),
      ...argv,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        [clockEnv.EPOCH_ENV]: String(clock.epochMs),
        [clockEnv.TZ_ENV]: clock.tz,
      },
    },
  );
  // A spawn failure (no status at all) is the wrapper's own fault, not the trace's.
  return result.status === null || result.status === undefined ? 1 : result.status;
}

/* c8 ignore start — the process boundary; every decision above is reachable directly. */
if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
/* c8 ignore stop */

module.exports = { main, readClockFromHeader };
