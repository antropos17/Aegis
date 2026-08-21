#!/usr/bin/env node
/**
 * @file bench/trace/replay-trace.js
 * @module bench/trace/replay-trace
 * @description Replays one recorded trace through the product's own detection and
 *   attribution code, and leaves the records the product wrote.
 *
 *   ```
 *   node bench/trace/replay-trace.js <trace dir> [--out <dir>]
 *   ```
 *
 *   THE `--require` IS NOT OPTIONAL, and this file does not add it for you. The clock
 *   has to be installed before any module is compiled, which is strictly earlier than
 *   anything this file could do — so it verifies instead: `wiring.setUp` refuses when
 *   no clock is installed, when the installed clock was seeded for a different trace,
 *   and when something has already moved it. Run it as `npm run bench:replay`, which
 *   supplies the flag and the environment from the trace's own header.
 *
 *   NOT THE SAME THING AS `bench/replay.js`. That rebuilds one recorded RUN's
 *   `run-report.json` out of the four files that run left behind, and touches nothing
 *   from `src/`. This one replays a recorded stream of OBSERVATIONS through the
 *   product itself. See `bench/README.md`, "Trace replay — the format".
 *
 *   Exit codes follow `bench/run.js`: **2** the invocation was wrong and nothing ran ·
 *   **1** the trace was refused, or the replay could not complete · **0** the replay
 *   completed and the verdict was written.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const clockEnv = require('./clock-env');
const harness = require('./harness');
const reader = require('./reader');
const schema = require('./schema');

/** @type {string} Where a replay writes when `--out` is not given. Gitignored. */
const RUNS_DIRNAME = 'traces-runs';

/** @type {string} The product's own records, copied out of the run profile verbatim. */
const VERDICT_FILENAME = 'verdict.ndjson';

/**
 * Parse argv, or explain what was wrong with it.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {{traceDir: string, outDir: string|null}|{error: string}}
 */
function parseArgs(argv) {
  /** @type {string|null} */
  let traceDir = null;
  /** @type {string|null} */
  let outDir = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      outDir = argv[++i] || null;
      if (!outDir) return { error: '--out needs a directory' };
      continue;
    }
    if (arg.startsWith('--')) return { error: `unknown flag ${arg}` };
    if (traceDir) return { error: `only one trace directory is replayed at a time (got ${arg})` };
    traceDir = arg;
  }
  if (!traceDir) return { error: 'no trace directory given' };
  return { traceDir, outDir };
}

/**
 * Where this replay writes.
 *
 * A REPLAY IS NOT A RECORDING, and the difference decides this. `bench/run.js` refuses
 * to write a run directory twice, because a run observed a machine at an instant that
 * will never come back. A replay is a pure function of the trace and the tree, so an
 * older output is not evidence — it is a stale copy of something reproducible, and it
 * is replaced. `--out` puts the result somewhere else, which is what a comparison
 * against a committed golden will use.
 * @param {string} traceId - The trace's id.
 * @param {string|null} outDir - `--out`, when given.
 * @returns {string} An empty directory to write into.
 */
function prepareOutDir(traceId, outDir) {
  const dir = outDir || path.join(schema.REPO_ROOT, 'bench', RUNS_DIRNAME, traceId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Copy the product's records out of the run profile, byte for byte.
 *
 * COPIED, NEVER RE-SERIALIZED. These are the bytes `src/main/audit-logger.js` wrote —
 * Event Schema v1, hash-chained, seq and all — and re-emitting them from parsed
 * objects would make the verdict a rendering of the product's output rather than the
 * output. The whole claim a trace replay makes is about those bytes.
 * @param {{auditDir: string, auditFiles: string[]}} audit - What `tearDown` found.
 * @param {string} outDir - Where the verdict goes.
 * @returns {{path: string, source: string, bytes: number}}
 * @throws {import('./schema').TraceError} When the product wrote nothing, or wrote
 *   more than one day's file.
 */
function writeVerdict(audit, outDir) {
  if (audit.auditFiles.length === 0) {
    schema.refuse(
      schema.REFUSAL.EMPTY_TRACE,
      'the replay produced no audit records at all. An empty verdict is indistinguishable from ' +
        'a sensor that ran and decided nothing, so none is written',
    );
  }
  if (audit.auditFiles.length > 1) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `the replay wrote ${audit.auditFiles.length} daily files (${audit.auditFiles.join(', ')}). ` +
        'An audit chain restarts each day, so a trace that crosses local midnight produces two ' +
        'independent chains and one verdict file cannot hold both',
    );
  }
  const source = path.join(audit.auditDir, audit.auditFiles[0]);
  const target = path.join(outDir, VERDICT_FILENAME);
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(target, bytes);
  return { path: target, source, bytes: bytes.length };
}

/**
 * Read a trace, replay it, write the verdict.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {Promise<number>} The process exit code.
 */
async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`replay-trace: ${args.error}`);
    console.error('usage: node bench/trace/replay-trace.js <trace dir> [--out <dir>]');
    console.error(
      `  the clock is supplied by the environment: ${clockEnv.EPOCH_ENV}, ` +
        `${clockEnv.TZ_ENV}, with --require bench/trace/preload.js`,
    );
    return 2;
  }

  let trace;
  try {
    trace = reader.readTrace(args.traceDir);
  } catch (err) {
    console.error(`replay-trace: refused (${err.reason || 'error'})`);
    console.error(`  ${err.message}`);
    return 1;
  }

  const outDir = prepareOutDir(trace.header.id, args.outDir);
  try {
    const result = await harness.replay({
      header: trace.header,
      records: trace.records,
      runDir: outDir,
    });
    const verdict = writeVerdict(result, outDir);
    console.log(`trace      ${trace.header.id} (${result.records} records)`);
    for (const kind of Object.keys(result.byKind).sort()) {
      console.log(`  ${kind.padEnd(16)} ${result.byKind[kind]}`);
    }
    console.log(`audit      ${verdict.bytes} bytes from ${path.basename(verdict.source)}`);
    console.log(`verdict    ${verdict.path}`);
    console.log(`profile    ${result.profileDir}`);
    return 0;
  } catch (err) {
    console.error(`replay-trace: replay failed (${err.reason || 'error'})`);
    console.error(`  ${err.message}`);
    return 1;
  }
}

/* c8 ignore start — the process boundary; every decision above is reachable directly. */
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`replay-trace: ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    },
  );
}
/* c8 ignore stop */

module.exports = { RUNS_DIRNAME, VERDICT_FILENAME, main, parseArgs, prepareOutDir, writeVerdict };
