/**
 * @file bench/replay.js
 * @description Rebuild one run's `run-report.json` from the files that run left
 *   behind — the second way a report can come into existence, and the only one
 *   that involves no sensor, no scenario and no product code at all.
 *
 *   A live arm-A run derives its report from arrays it is holding in memory at the
 *   moment the sensor is stopped (`bench/run.js`). Until now that was the only way
 *   to get one: a recorded run was an archive, not an input. Replay makes the
 *   directory the input. It reads four files out of it and hands the same two
 *   arrays and the same window parameters to the same `bench/lib/join.js`, so the
 *   report it produces is the report that run produced — byte for byte, because
 *   nothing in it records the moment it was generated.
 *
 *   **Four files, and nothing else.** No `settings.json`, no Electron profile, no
 *   `src/`, no clock, no environment. The join window is not re-derived here and
 *   is never defaulted: it is `sensor.scanInterval` exactly as `observed.meta.json`
 *   recorded it, put through the same `maxLatencyFrom` a live run uses. A run
 *   recorded before that field existed cannot be replayed, and says so, rather
 *   than being scored against a window nobody measured.
 *
 *   | file | what replay takes from it |
 *   |---|---|
 *   | `manifest.json` | `runId`, `scenario`, `arm` — the run's identity |
 *   | `expected.ndjson` | the catalogue, one ECS document per line |
 *   | `observed.ndjson` | the observation set, same subset |
 *   | `observed.meta.json` | `sensor.scanInterval`, `sensor.ticksWhileProcessAlive`, and the identity the manifest is checked against |
 *
 *   The output of a replay is a function of those files **and of the renderer
 *   rendering them** — `bench/lib/join.js` and `bench/lib/report.js` — not of the
 *   files alone. A report rendered by an older renderer can therefore differ from
 *   its own rebuild without either being wrong, which is why a directory that
 *   already holds a report is COMPARED against rather than overwritten: the
 *   recorded evidence survives its own verification, and a difference is stated
 *   instead of being applied.
 *
 *   **Two facts, never folded into one.** Whether the rebuild reproduces the
 *   recorded report's bytes is one observation, made against the recorded file
 *   itself. Which renderer originally produced those bytes is another, read out of
 *   `manifest.reportRenderer` — `renderer-match` when this replay is running the
 *   same source bytes, `renderer-skew` when it is not, `legacy-unversioned` when
 *   the run recorded no fingerprint at all. Neither is inferred from the other:
 *   identical bytes under skew are still identical bytes, a difference under a
 *   match is still a difference, and a legacy recording's report is still the
 *   evidence it always was — what is unknown there is the renderer's identity, not
 *   the bytes.
 *
 *   Exit codes: 0 the report was rebuilt, and matched if one was already there ·
 *   1 a required file is missing or malformed, the run recorded no join window, or
 *   the rebuild differs from the report already in the directory · 2 the
 *   invocation was wrong, and nothing was read.
 *
 *   Usage:
 *     node bench/replay.js bench/runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const fs = require('fs');
const path = require('path');

const join = require('./lib/join');
const {
  RENDERER_PROVENANCE,
  classifyRenderer,
  maxLatencyFrom,
  reportJoin,
  serializeReport,
} = require('./lib/report');

/**
 * The four names a run directory is replayed from.
 *
 * Re-declared rather than imported from `lib/catalogue.js` and `lib/observed.js`,
 * which own them on the writing side. Importing the writers would pull the capture
 * path — the audit chain reader, the actor's ECS shapes and their transitive
 * dependencies — into a process whose whole contract is that it reads four files
 * and starts nothing. A unit test pins these four strings against the modules that
 * write them, so the copy cannot drift.
 * @type {Readonly<Object<string, string>>}
 */
const REQUIRED_FILES = Object.freeze({
  'manifest.json':
    'the environment snapshot the run wrote before it acted, which also names the report renderer ' +
    'it was running',
  'expected.ndjson': 'the expected-event catalogue the actor wrote as it executed',
  'observed.ndjson': "the observation set read out of the product's own audit log",
  'observed.meta.json':
    'the capture record, which carries the scan interval the join window is derived from',
});

/** @type {string} Identity and environment of the run. */
const MANIFEST_FILENAME = 'manifest.json';

/** @type {string} The expected-event catalogue. */
const CATALOGUE_FILENAME = 'expected.ndjson';

/** @type {string} What the sensor recorded. */
const OBSERVED_FILENAME = 'observed.ndjson';

/** @type {string} The capture record. */
const META_FILENAME = 'observed.meta.json';

/** @type {ReadonlyArray<string>} Identity fields both files must agree on. */
const IDENTITY_FIELDS = Object.freeze(['runId', 'scenario', 'arm']);

const USAGE = `bench/replay.js — rebuild run-report.json from a recorded run directory

Usage:  node bench/replay.js <runDir> [--out <file>]

  <runDir>      A run directory written by bench/run.js, holding ${Object.keys(REQUIRED_FILES).join(
    ', ',
  )}.
  --out <file>  Write the rebuilt report there instead of into the run directory.
  --help        Show this message.

Replay starts no sensor, loads no product code and opens no settings file. The
join window is sensor.scanInterval exactly as the run recorded it — a run that
recorded none is refused rather than joined against a default.

A run directory that already holds a ${join.REPORT_FILENAME} is COMPARED against,
not overwritten: the rebuild is printed as identical or as differing, and nothing
is written.

Two verdicts are printed, and neither is read off the other: whether the rebuild
reproduced the recorded bytes, and whether the renderer that produced them is the
one running now — renderer-match, renderer-skew, or legacy-unversioned for a run
recorded before manifest.reportRenderer existed.

Exit codes: 0 rebuilt, and matched if one was already there · 1 a required file is
missing or malformed, the run recorded no join window, or the rebuild differs · 2
bad invocation, nothing was read.`;

/**
 * A refusal to rebuild a report. Carries a machine-readable `stage`, in the same
 * convention as `observed.js` and `join.js`, so a caller never parses English.
 */
class ReplayError extends Error {
  /**
   * @param {string} stage - One of `run-dir`, `file-missing`, `file-unreadable`,
   *   `file-malformed`, `identity`, `meta-incomplete`, `no-observations`,
   *   `write-failed`, or `join-<stage>` when the join refused the run's own files.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'ReplayError';
    this.stage = stage;
  }
}

/**
 * Parse the invocation. An unknown flag is an error rather than a silent no-op:
 * a typo must not produce a report a reader believes was asked for.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{dir: string|null, out: string|null, help: boolean}}
 * @throws {Error} On an unknown flag, a missing value, or a second run directory.
 */
function parseArgs(argv) {
  const parsed = { dir: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--out') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--out needs a value');
      parsed.out = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown argument "${arg}"`);
    if (parsed.dir !== null) {
      throw new Error(
        `two run directories given ("${parsed.dir}" and "${arg}") — replay takes one`,
      );
    }
    parsed.dir = arg;
  }
  return parsed;
}

/**
 * Read one of the run's files, failing by name rather than by errno.
 * @param {string} dir - The run directory.
 * @param {string} name - One of {@link REQUIRED_FILES}.
 * @returns {string} File contents.
 * @throws {ReplayError} When it is absent or cannot be read.
 */
function readRunFile(dir, name) {
  const file = path.join(dir, name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ReplayError(
        'file-missing',
        `${file} is missing — it is ${REQUIRED_FILES[name]}, and a recorded run is replayed from ` +
          `all of ${Object.keys(REQUIRED_FILES).join(', ')}. Nothing was rebuilt: a report over a ` +
          'directory missing one of them would be a report about a run nobody recorded',
      );
    }
    throw new ReplayError('file-unreadable', `${file} cannot be read: ${err.message}`);
  }
}

/**
 * Read one of the run's JSON files.
 * @param {string} dir - The run directory.
 * @param {string} name - One of {@link REQUIRED_FILES}.
 * @returns {Object}
 * @throws {ReplayError} When it is absent or does not parse.
 */
function readJson(dir, name) {
  const text = readRunFile(dir, name);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ReplayError(
      'file-malformed',
      `${path.join(dir, name)} is not valid JSON (${err.message}) — it is ${REQUIRED_FILES[name]}`,
    );
  }
}

/**
 * Read one of the run's NDJSON files: one ECS document per line.
 *
 * A line that does not parse fails the replay by its number. Not "skip it and
 * carry on" — a dropped catalogue line is an expectation that silently stops
 * being expected, and a dropped observed line is a sensor credited with less than
 * it recorded.
 * @param {string} dir - The run directory.
 * @param {string} name - One of {@link REQUIRED_FILES}.
 * @returns {Object[]} In file order. Empty for an empty file.
 * @throws {ReplayError} When it is absent, or a line does not parse.
 */
function readNdjson(dir, name) {
  const file = path.join(dir, name);
  const lines = readRunFile(dir, name).split('\n');
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    try {
      events.push(JSON.parse(lines[i]));
    } catch (err) {
      throw new ReplayError(
        'file-malformed',
        `${file} line ${i + 1} does not parse (${err.message}) — this file is one ECS document ` +
          'per line, and a line nobody can read is an event this replay would otherwise drop ' +
          'without saying so',
      );
    }
  }
  return events;
}

/**
 * The run's identity, from the manifest, checked against the capture record.
 *
 * Both files carry all three, written from the same variables by the same run, so
 * a disagreement means the directory was assembled out of two runs rather than
 * recorded by one — and a report built across it would name one run and count
 * another.
 * @param {Object} manifest - Parsed `manifest.json`.
 * @param {Object} meta - Parsed `observed.meta.json`.
 * @returns {{runId: string, scenario: string, arm: string}}
 * @throws {ReplayError} When a field is missing on either side, or they disagree.
 */
function readIdentity(manifest, meta) {
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    const fromManifest = manifest[field];
    const fromMeta = meta[field];
    if (typeof fromManifest !== 'string' || fromManifest === '') {
      throw new ReplayError(
        'identity',
        `${MANIFEST_FILENAME} carries no ${field} — the report names the run it is about, and ` +
          'that name is read off the recording, never invented here',
      );
    }
    if (typeof fromMeta !== 'string' || fromMeta === '') {
      throw new ReplayError(
        'identity',
        `${META_FILENAME} carries no ${field}, so it cannot be checked against the ` +
          `${MANIFEST_FILENAME} in the same directory`,
      );
    }
    if (fromManifest !== fromMeta) {
      throw new ReplayError(
        'identity',
        `${MANIFEST_FILENAME} and ${META_FILENAME} disagree about ${field} ` +
          `("${fromManifest}" against "${fromMeta}") — these two files describe different runs, ` +
          'and a report joined across them would name one and count the other',
      );
    }
    identity[field] = fromManifest;
  }
  return /** @type {{runId: string, scenario: string, arm: string}} */ (identity);
}

/**
 * The two capture-record fields the report is built from.
 *
 * `scanInterval` is taken whole and passed to the same `maxLatencyFrom` a live run
 * uses, including when it records the interval as ABSENT — that is a measurement
 * outcome, and it produces a report whose every recall reads `unavailable`, which
 * is exactly what the live run wrote. What is refused is a capture record that
 * carries no such field at all: a run recorded before the interval was cannot have
 * its window read back, and no default stands in for it.
 * @param {Object} meta - Parsed `observed.meta.json`.
 * @returns {{scanInterval: Object, ticksWhileProcessAlive: number|null}}
 * @throws {ReplayError} When either field is absent or is not what it claims.
 */
function readWindow(meta) {
  const sensor = meta.sensor;
  if (!sensor || typeof sensor !== 'object') {
    throw new ReplayError(
      'meta-incomplete',
      `${META_FILENAME} carries no sensor block — the scan interval the join window is derived ` +
        'from and the tick accounting the process categories are read against both live there',
    );
  }

  const scanInterval = sensor.scanInterval;
  if (!scanInterval || typeof scanInterval !== 'object') {
    throw new ReplayError(
      'meta-incomplete',
      `${META_FILENAME} carries no sensor.scanInterval — this run was recorded before the ` +
        'interval it ran on was, so the window it joined on cannot be read back out of it. A ' +
        'join window is derived from the run or it is absent; it is never defaulted, because ' +
        'every recall figure in a report is a statement about that window',
    );
  }
  if (scanInterval.value !== null && !Number.isFinite(scanInterval.value)) {
    throw new ReplayError(
      'meta-incomplete',
      `${META_FILENAME} carries sensor.scanInterval.value ` +
        `${JSON.stringify(scanInterval.value)}, which is neither a number of seconds nor the ` +
        'null this harness writes for a fact it could not read',
    );
  }

  const ticks = sensor.ticksWhileProcessAlive;
  if (ticks !== null && !Number.isSafeInteger(ticks)) {
    throw new ReplayError(
      'meta-incomplete',
      `${META_FILENAME} carries sensor.ticksWhileProcessAlive ${JSON.stringify(ticks)} — the ` +
        'report reads processObservable off that count, and an absent one would quietly become ' +
        '"there was no process lifetime to speak about" instead of the count this run measured',
    );
  }

  return { scanInterval, ticksWhileProcessAlive: ticks };
}

/**
 * Load everything a report is built from, out of one recorded run directory.
 * @param {string} dir - The run directory.
 * @returns {Object} Identity, both event sets, and the window parameters.
 * @throws {ReplayError} On anything missing, malformed, or self-contradictory.
 */
function loadRun(dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (err) {
    throw new ReplayError(
      'run-dir',
      `${dir} cannot be read as a run directory (${err.message}) — replay takes the directory one ` +
        'bench run wrote, not a file and not a runs/ tree',
    );
  }
  if (!stat.isDirectory()) {
    throw new ReplayError('run-dir', `${dir} is not a directory — replay takes one recorded run`);
  }

  const manifest = readJson(dir, MANIFEST_FILENAME);
  const meta = readJson(dir, META_FILENAME);
  const identity = readIdentity(manifest, meta);
  const window = readWindow(meta);
  const expected = readNdjson(dir, CATALOGUE_FILENAME);
  const observed = readNdjson(dir, OBSERVED_FILENAME);

  if (observed.length === 0) {
    throw new ReplayError(
      'no-observations',
      `${path.join(dir, OBSERVED_FILENAME)} holds no event. A live run never writes an empty ` +
        'one — an empty observation set is indistinguishable from a sensor that ran and saw ' +
        'nothing — so there is nothing here to join the catalogue against',
    );
  }

  // Taken verbatim, and never validated into existence: a manifest written
  // before this block existed carries none, and that absence is the whole
  // content of the `legacy-unversioned` verdict.
  const reportRenderer = manifest.reportRenderer ?? null;

  return { dir, ...identity, expected, observed, ...window, reportRenderer };
}

/**
 * Join the run's two event sets, exactly as the live run joined them.
 * @param {Object} run - From {@link loadRun}.
 * @returns {Object} The report.
 * @throws {ReplayError} When the join refuses the run's own files.
 */
function rebuild(run) {
  try {
    return join.buildReport({
      runId: run.runId,
      scenario: run.scenario,
      arm: run.arm,
      expected: run.expected,
      observed: run.observed,
      maxLatency: maxLatencyFrom(run.scanInterval),
      ticksWhileProcessAlive: run.ticksWhileProcessAlive,
    });
  } catch (err) {
    if (!(err instanceof join.JoinError)) throw err;
    throw new ReplayError(
      `join-${err.stage}`,
      `the join refused this run's own files — ${err.message} (${run.dir})`,
    );
  }
}

/**
 * Index of the first position at which two indexable sequences differ.
 *
 * Called on Buffers, so "byte-identical" is a claim about bytes and not about
 * whatever two strings decoded to: this report carries `—`, `×` and `∈`, and a
 * character count is 13 short of the file's size.
 * @param {Buffer|string} a
 * @param {Buffer|string} b
 * @returns {number} `-1` when they are equal.
 */
function firstDifference(a, b) {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : shared;
}

/**
 * Put the rebuilt report where it belongs, or hold it up against the one already
 * there. A recorded report is never overwritten in place: it is the evidence the
 * rebuild is being checked against.
 *
 * This says whether the bytes agree and nothing more. Which renderer produced the
 * recorded ones is a separate verdict, printed next to this one by
 * {@link reportProvenance} — an explanation offered here would be one this
 * function has no evidence for.
 * @param {Object} opts
 * @param {string} opts.dir - The run directory.
 * @param {string|null} opts.out - `--out`, when it was given.
 * @param {string} opts.bytes - From `serializeReport`.
 * @returns {{mode: string, differs: boolean}} `mode` is `compared` when a
 *   recorded report was held up against the rebuild, `written` otherwise.
 * @throws {ReplayError} When the file could not be written.
 */
function emit(opts) {
  const recordedPath = path.join(opts.dir, join.REPORT_FILENAME);
  if (opts.out === null && fs.existsSync(recordedPath)) {
    const recorded = fs.readFileSync(recordedPath);
    const rebuilt = Buffer.from(opts.bytes, 'utf8');
    const at = firstDifference(recorded, rebuilt);
    if (at === -1) {
      console.log(
        `replay  identical to the ${join.REPORT_FILENAME} already in the run directory, byte ` +
          `for byte (${recorded.length} bytes) — nothing was written`,
      );
      return { mode: 'compared', differs: false };
    }
    console.error(`\nbench: the rebuilt report differs from ${recordedPath}`);
    console.error(`bench: first difference at byte ${at}`);
    const excerpt = (buffer) => JSON.stringify(buffer.subarray(at, at + 60).toString('utf8'));
    console.error(`bench:   recorded ${excerpt(recorded)}`);
    console.error(`bench:   rebuilt  ${excerpt(rebuilt)}`);
    console.error(
      'bench: nothing was written. The recorded report is the evidence, and it stands as it was ' +
        'recorded',
    );
    return { mode: 'compared', differs: true };
  }

  const target = opts.out === null ? recordedPath : opts.out;
  try {
    fs.writeFileSync(target, opts.bytes, 'utf8');
  } catch (err) {
    throw new ReplayError('write-failed', `${target} could not be written: ${err.message}`);
  }
  console.log(
    opts.out === null
      ? `written ${target}`
      : `written ${target} — rendered now, by this replay's own report renderer`,
  );
  return { mode: 'written', differs: false };
}

/**
 * Say which renderer produced the recording, and — where a comparison was made —
 * put that next to the byte verdict without letting either stand in for the
 * other.
 *
 * The four readings this keeps apart:
 *
 * - **match, bytes identical** — historical report bytes reproduced exactly, by a
 *   renderer the recording pins as the one that wrote them.
 * - **skew or legacy, bytes identical** — historical report bytes reproduced
 *   exactly all the same. The recorded report is preserved evidence and equality
 *   with it is directly observable; what is unknown on a legacy recording is the
 *   renderer's identity, not the bytes.
 * - **match, bytes differ** — renderer skew is NOT available as the explanation,
 *   and none is invented in its place.
 * - **skew or legacy, bytes differ** — the divergence and the limited attribution
 *   are stated as two separate things, because a candidate cause is not a cause.
 * @param {Object} verdict - From `classifyRenderer()`.
 * @param {{mode: string, differs: boolean}} outcome - From {@link emit}.
 * @returns {void}
 */
function reportProvenance(verdict, outcome) {
  const differs = outcome.mode === 'compared' && outcome.differs;
  const say = differs ? (m) => console.error(`bench: ${m}`) : (m) => console.log(`replay  ${m}`);
  const detail = differs
    ? (m) => console.error(`bench:   ${m}`)
    : (m) => console.log(`replay    ${m}`);

  /**
   * What the byte comparison established, appended to the identity verdict.
   * Empty when the bytes differed: the difference has already been printed in
   * full, and this line's job is then to say what may and may not be read into it.
   * @type {string}
   */
  const reproduced =
    outcome.mode === 'written'
      ? '; no recorded report was held up against this rebuild'
      : '; the historical report bytes were reproduced exactly';

  if (verdict.provenance === RENDERER_PROVENANCE.MATCH) {
    say(
      'renderer match — the recording pins the report-renderer source bytes and this replay ran ' +
        'the same ones' +
        (differs
          ? ', so renderer skew is NOT the explanation for the difference above. What failed is ' +
            'the deterministic contract between those files and this renderer, and no other ' +
            'cause is inferred here'
          : reproduced),
    );
    return;
  }

  if (verdict.provenance === RENDERER_PROVENANCE.SKEW) {
    say(
      'renderer skew — the recording pins report-renderer source bytes this replay did not run' +
        (differs
          ? '. That is a fact about the two renderers, stated next to the byte difference above ' +
            'rather than as its cause: it is a candidate explanation, and nothing here ' +
            'establishes it'
          : outcome.mode === 'written'
            ? reproduced
            : `${reproduced}, skew or no skew`),
    );
    if (verdict.reason) detail(verdict.reason);
    for (const d of verdict.differences) {
      detail(
        `${d.file.padEnd(20)} recorded ${d.recorded === null ? 'ABSENT' : d.recorded} · ` +
          `this tree ${d.current === null ? 'ABSENT' : d.current}`,
      );
    }
    return;
  }

  say(
    'legacy-unversioned — this recording carries no manifest.reportRenderer block, so which ' +
      'report-renderer source bytes originally produced its report was never recorded' +
      (differs
        ? '. The byte difference above stands on its own, and no cause is attributed to it here'
        : `${reproduced}, and those bytes are the evidence they always were — what this ` +
          'recording never captured is the identity of the renderer that wrote them, not the ' +
          'bytes themselves'),
  );
}

/**
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {number} Process exit code.
 */
function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`bench: ${err.message}\n`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.dir === null) {
    console.error('bench: no run directory given\n');
    console.error(USAGE);
    return 2;
  }

  const dir = path.resolve(args.dir);
  let run;
  let report;
  let outcome;
  try {
    run = loadRun(dir);
    report = rebuild(run);
    console.log(`replay  ${run.runId}`);
    console.log(`dir     ${dir}`);
    console.log(
      `sources ${CATALOGUE_FILENAME} (${run.expected.length} expected), ` +
        `${OBSERVED_FILENAME} (${run.observed.length} observed), ` +
        `${META_FILENAME}, ${MANIFEST_FILENAME} — no sensor, no product code, no settings file`,
    );
    outcome = emit({ dir, out: args.out, bytes: serializeReport(report) });
    reportProvenance(classifyRenderer(run.reportRenderer), outcome);
  } catch (err) {
    if (!(err instanceof ReplayError)) throw err;
    console.error(`bench: ${err.message}`);
    return 1;
  }

  reportJoin(report);

  const unscored = report.missed.filter((m) => m.category === null).length;
  if (unscored > 0) {
    console.log(
      `report  ${unscored} expected row(s) carry a category this report does not score — they ` +
        'are listed as missed with that reason, never counted as a coverage failure',
    );
  }

  if (outcome.differs) return 1;
  return report.join.unavailable ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`bench: the replay failed unexpectedly — ${(err && err.stack) || err}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CATALOGUE_FILENAME,
  IDENTITY_FIELDS,
  MANIFEST_FILENAME,
  META_FILENAME,
  OBSERVED_FILENAME,
  REQUIRED_FILES,
  ReplayError,
  emit,
  firstDifference,
  loadRun,
  main,
  parseArgs,
  readIdentity,
  readNdjson,
  readWindow,
  rebuild,
  reportProvenance,
};
