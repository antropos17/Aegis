/**
 * @file bench/lib/join.js
 * @module bench/lib/join
 * @description Joins one run's expected-event catalogue to what the sensor
 *   recorded, and shapes the result into `run-report.json` — the first row of the
 *   measurement matrix.
 *
 *   **Nothing here reads or writes a file.** The input is two arrays of ECS
 *   documents plus the window parameters; the output is a plain object. A unit
 *   test pins that: a join that could reach the filesystem could also reach for a
 *   fact it was not given.
 *
 *   The join is deliberately narrow, because the audit persists less than the
 *   actor observed (B2.3):
 *
 *   - **A process expectation joins on `process.pid` alone.** pid is the only key
 *     the audit gives a process event.
 *   - **A file expectation joins on the normalised absolute path alone.** Path is
 *     the only key the audit gives a file event; the product does not persist the
 *     owner of a file event at all.
 *   - **Nothing joins on a name.** AEGIS persists the display name it resolved —
 *     `"Claude Code"` — and never the image name (`claude.exe`). The two are
 *     different strings about different things, and a join that treated one as
 *     the other would manufacture matches out of a naming coincidence.
 *
 *   The window is `[expected.@timestamp, expected.@timestamp + maxLatencyMs]`,
 *   half-open at neither end and never widened here: `maxLatencyMs` arrives as a
 *   parameter with the source that produced it, and is written into the report so
 *   every recall figure carries the bound it was measured against.
 *
 *   One observed event cancels at most one expectation, and one expectation is
 *   cancelled by at most one observed event. Where several pairings are eligible
 *   the nearest in time wins — every candidate pair is scored by its latency and
 *   assigned in ascending order, so a later expectation may take an observation an
 *   earlier one could also have used, if it is nearer to it.
 *
 *   Two refusals to dissolve a cause into a count:
 *
 *   - **A miss names its nearest candidate.** An observation stamped BEFORE its
 *     expectation, or one that arrived past the bound, is a different finding from
 *     "the sensor never saw it", and the reason says which.
 *   - **A structurally unobservable process category is labelled, not scored.**
 *     When no scan tick fell inside the scenario's process lifetime the process
 *     was never in front of the sensor, and `0/N` there is not a coverage result.
 *     The recall string says so and the numeric recall is `null` rather than 0 —
 *     the same convention `manifest.js` uses for a fact it could not read.
 *
 *   There is no confidence figure in the report and there will not be one. Every
 *   number it carries is a count of rows or a difference of two timestamps.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

/** @type {number} Report shape version. Bump when a field changes meaning. */
const SCHEMA_VERSION = 1;

/** @type {string} Name of the run report inside a run directory. */
const REPORT_FILENAME = 'run-report.json';

/**
 * The categories S1 produces, as `event.category/event.type`. A closed set: a
 * category that is not here is not scored, and a run that produced one would be
 * reporting on a shape the catalogue cannot write.
 * @type {ReadonlyArray<string>}
 */
const CATEGORIES = Object.freeze([
  'process/start',
  'process/end',
  'file/creation',
  'file/deletion',
]);

/** @type {ReadonlyArray<string>} The subset `processObservable` speaks about. */
const PROCESS_CATEGORIES = Object.freeze(['process/start', 'process/end']);

/**
 * What the join keys on, per category. Written into the report so a reader never
 * has to guess which field produced a match.
 * @type {Readonly<Object<string, string>>}
 */
const JOIN_KEYS = Object.freeze({
  'process/start': 'process.pid',
  'process/end': 'process.pid',
  'file/creation': 'file.path, case- and separator-normalised',
  'file/deletion': 'file.path, case- and separator-normalised',
});

/** An error in the join's own inputs — never a finding about the sensor. */
class JoinError extends Error {
  /**
   * @param {string} stage - One of `bad-window`, `bad-events`.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'JoinError';
    this.stage = stage;
  }
}

/**
 * One comparable form of a Windows path.
 *
 * Separators collapse to `\` and the whole string folds to lower case, because
 * `X:/dev\\project\\AEGIS` and `x:\dev\project\aegis` name one file on the platform the
 * bench runs on. Case folding is a Windows fact, not a general one — this module
 * is only ever handed paths the bench captured on Windows, and a POSIX bench
 * would need a different rule rather than this one relaxed.
 * @param {*} value - A path exactly as the catalogue or the audit recorded it.
 * @returns {string|null} Null when there was no path to normalise.
 */
function normalizePath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const unified = trimmed.replace(/[\\/]+/g, '\\').replace(/\\+$/, '');
  // A bare drive letter is a directory, not a name: `X:` and `X:\` are the same
  // place, and stripping the separator off the root would make them differ.
  return (/^[A-Za-z]:$/.test(unified) ? `${unified}\\` : unified).toLowerCase();
}

/**
 * The `category/type` of an ECS document, when it is one this report scores.
 * @param {Object} event
 * @returns {string|null}
 */
function categoryOf(event) {
  const block = event && event.event;
  if (!block || !Array.isArray(block.category) || !Array.isArray(block.type)) return null;
  const name = `${block.category[0]}/${block.type[0]}`;
  return CATEGORIES.includes(name) ? name : null;
}

/**
 * The one field this category joins on, rendered as a comparable string.
 *
 * A file event carries a pid in the catalogue (the actor's own) and carries none
 * in the audit, so a file NEVER keys on pid — the category decides the key, not
 * whichever fields happen to be present.
 * @param {Object} event
 * @param {string} category - From {@link categoryOf}.
 * @returns {string|null} Null when the event carries no usable key.
 */
function joinKeyOf(event, category) {
  if (PROCESS_CATEGORIES.includes(category)) {
    const pid = event && event.process ? event.process.pid : undefined;
    return Number.isSafeInteger(pid) && pid > 0 ? `pid:${pid}` : null;
  }
  const normalised = normalizePath(event && event.file ? event.file.path : undefined);
  return normalised === null ? null : `path:${normalised}`;
}

/**
 * Reduce one side of the join to rows carrying everything the matcher needs.
 * @param {Object[]} events - ECS documents.
 * @param {string} side - `expected` or `observed`, for a refusal message.
 * @returns {Object[]} One row per event, in input order.
 * @throws {JoinError} When an event carries no timestamp that is an instant.
 */
function index(events, side) {
  if (!Array.isArray(events)) {
    throw new JoinError('bad-events', `the ${side} side of the join is not an array of events`);
  }
  return events.map((event, i) => {
    const at = Date.parse(event && event['@timestamp']);
    if (!Number.isFinite(at)) {
      throw new JoinError(
        'bad-events',
        `${side} event ${i} carries @timestamp ${JSON.stringify(event && event['@timestamp'])}, ` +
          'which is not a UTC instant — a row with no instant can be neither inside a window nor ' +
          'outside one',
      );
    }
    const category = categoryOf(event);
    return {
      i,
      event,
      at,
      category,
      key: category ? joinKeyOf(event, category) : null,
      used: false,
    };
  });
}

/**
 * Assign observed events to expectations, nearest pair first.
 *
 * Every eligible pair — same category, same key, `0 ≤ observed − expected ≤
 * maxLatencyMs` — is scored by its latency and taken in ascending order, so the
 * nearest pairing always wins and neither side is ever used twice. Ties break on
 * input order, which makes the result of a run reproducible from its two files.
 * @param {Object[]} expected - From {@link index}.
 * @param {Object[]} observed - From {@link index}.
 * @param {number} maxLatencyMs
 * @returns {Array<{expected: Object, observed: Object, latencyMs: number}>}
 */
function assign(expected, observed, maxLatencyMs) {
  const candidates = [];
  for (const e of expected) {
    if (!e.category || e.key === null) continue;
    for (const o of observed) {
      if (o.category !== e.category || o.key !== e.key) continue;
      const latencyMs = o.at - e.at;
      if (latencyMs < 0 || latencyMs > maxLatencyMs) continue;
      candidates.push({ e, o, latencyMs });
    }
  }
  candidates.sort((a, b) => a.latencyMs - b.latencyMs || a.e.i - b.e.i || a.o.i - b.o.i);

  const pairs = [];
  for (const candidate of candidates) {
    if (candidate.e.used || candidate.o.used) continue;
    candidate.e.used = true;
    candidate.o.used = true;
    pairs.push({ expected: candidate.e, observed: candidate.o, latencyMs: candidate.latencyMs });
  }
  return pairs;
}

/**
 * The counterpart on the other side that came closest to this row, whether or not
 * it was eligible. This is what keeps a window artefact from reading as a miss.
 * @param {Object} row - From {@link index}.
 * @param {Object[]} others - The other side, from {@link index}.
 * @param {number} sign - `1` when `others` is the observed side, `-1` when it is
 *   the expected side, so the reported latency always reads observed − expected.
 * @returns {{row: Object, latencyMs: number}|null}
 */
function nearest(row, others, sign) {
  let best = null;
  for (const other of others) {
    if (other.category !== row.category || other.key !== row.key) continue;
    const latencyMs = sign * (other.at - row.at);
    if (best === null || Math.abs(latencyMs) < Math.abs(best.latencyMs)) {
      best = { row: other, latencyMs };
    }
  }
  return best;
}

/**
 * Why an expectation was not cancelled, naming the nearest observation there was.
 * @param {Object} row - The unmatched expectation.
 * @param {Object[]} observed - From {@link index}.
 * @param {number} maxLatencyMs
 * @returns {string}
 */
function missReason(row, observed, maxLatencyMs) {
  if (!row.category) return 'the expectation carries no category this report scores';
  if (row.key === null) {
    return `the expectation carries no ${JOIN_KEYS[row.category]} to join on`;
  }
  const near = nearest(row, observed, 1);
  if (!near) {
    return `no observed ${row.category} carries ${row.key} at all`;
  }
  if (near.latencyMs < 0) {
    return (
      `the nearest observed ${row.category} for ${row.key} is stamped ${-near.latencyMs} ms ` +
      'BEFORE the expectation, so it is outside the window. A negative latency is a stamping ' +
      'artefact — the actor stamps around the step and the audit stamps inside its own log call ' +
      '— and is not a coverage result'
    );
  }
  if (near.latencyMs > maxLatencyMs) {
    return (
      `the nearest observed ${row.category} for ${row.key} arrived ${near.latencyMs} ms later, ` +
      `past the ${maxLatencyMs} ms bound this run joined on`
    );
  }
  return (
    `the only in-window observed ${row.category} for ${row.key} (${near.latencyMs} ms) was taken ` +
    'by a nearer expectation — one observed event cancels at most one expectation'
  );
}

/**
 * Why an observation cancelled nothing. Unmatched observations are signal, not
 * debris: sensor noise, or activity on the machine the scenario did not cause.
 * @param {Object} row - The unmatched observation.
 * @param {Object[]} expected - From {@link index}.
 * @param {number} maxLatencyMs
 * @returns {string}
 */
function unmatchedReason(row, expected, maxLatencyMs) {
  if (!row.category) return 'the observation carries no category this report scores';
  if (row.key === null) return `the observation carries no ${JOIN_KEYS[row.category]} to join on`;
  const near = nearest(row, expected, -1);
  if (!near) {
    return `the catalogue expects no ${row.category} for ${row.key} — this run did not cause it`;
  }
  if (near.latencyMs < 0) {
    return (
      `it is stamped ${-near.latencyMs} ms BEFORE the nearest ${row.category} expectation for ` +
      `${row.key}, so it cannot be that expectation's observation`
    );
  }
  if (near.latencyMs > maxLatencyMs) {
    return (
      `the nearest ${row.category} expectation for ${row.key} is ${near.latencyMs} ms earlier, ` +
      `past the ${maxLatencyMs} ms bound this run joined on`
    );
  }
  return `the nearest ${row.category} expectation for ${row.key} was cancelled by another observation`;
}

/**
 * Nearest-rank percentile: the value at rank `ceil(p · n)` of the sorted sample.
 * @param {number[]} sorted - Ascending, non-empty.
 * @param {number} p - In (0, 1].
 * @returns {number}
 */
function nearestRank(sorted, p) {
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1];
}

/**
 * The latency block of one category.
 *
 * A sample of one or two is reported as the points it is. Calling two numbers a
 * p50 and a max invites the reader to treat them as a distribution, and this
 * bench produces exactly one pair per category per S1 run.
 * @param {number[]} points - Latencies of that category's matched pairs.
 * @returns {{points: number[], p50: number|null, max: number|null, basis: string}}
 */
function latencyBlock(points) {
  const sorted = [...points].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { points: [], p50: null, max: null, basis: 'no matched pair — no latency was measured' };
  }
  return {
    points: sorted,
    p50: nearestRank(sorted, 0.5),
    max: sorted[sorted.length - 1],
    basis:
      sorted.length <= 2
        ? `${sorted.length} matched ${sorted.length === 1 ? 'pair' : 'pairs'} — p50 and max ARE ` +
          'those points, not statistics over a sample'
        : `${sorted.length} matched pairs, nearest-rank percentile (rank ceil(p·n))`,
  };
}

/**
 * One category's counts, recall and latency.
 * @param {Object} opts
 * @param {string} opts.category
 * @param {number} opts.expected
 * @param {number} opts.matched
 * @param {number[]} opts.latencies
 * @param {boolean|null} opts.processObservable
 * @param {string|null} opts.unavailable - Set when no join happened at all.
 * @returns {Object}
 */
function categoryBlock(opts) {
  const { category, expected, matched } = opts;
  const block = {
    expected,
    matched: opts.unavailable ? null : matched,
    missed: opts.unavailable ? null : expected - matched,
    recall: '',
    recallValue: null,
    latencyMs: latencyBlock(opts.latencies),
  };

  if (opts.unavailable) {
    block.recall = `unavailable — ${opts.unavailable}`;
    block.recallUnavailable = opts.unavailable;
    return block;
  }
  if (expected === 0) {
    block.recall = '0/0';
    block.recallUnavailable =
      'the catalogue holds no expectation in this category, and a recall over nothing is not 0';
    return block;
  }

  const unobservable =
    opts.processObservable === false && PROCESS_CATEGORIES.includes(category) && matched === 0;
  if (unobservable) {
    block.recall = `0/${expected} (structurally unobservable)`;
    block.recallUnavailable =
      'no scan tick fell inside the process lifetime — the process was never in front of the ' +
      'sensor, so this is not a coverage result and no number is derived from it';
    return block;
  }

  block.recall = `${matched}/${expected}`;
  block.recallValue = matched / expected;
  if (opts.processObservable === false && PROCESS_CATEGORIES.includes(category)) {
    block.note =
      'the tick accounting says no scan fell inside the process lifetime, yet an observation ' +
      'matched — the two disagree, and this recall should not be read until they are reconciled';
  }
  return block;
}

/**
 * The catalogue-side identity of a row: which step made it, which expectation it
 * claimed.
 * @param {Object} row - From {@link index}.
 * @returns {Object}
 */
function expectedRef(row) {
  const bench = row.event.bench || {};
  return {
    index: row.i,
    '@timestamp': row.event['@timestamp'],
    step: bench.step ?? null,
    expect: bench.expect ?? null,
  };
}

/**
 * The audit-side identity of a row: which record of which chained file it came
 * out of, so any line of the report can be walked back to its evidence.
 * @param {Object} row - From {@link index}.
 * @returns {Object}
 */
function observedRef(row) {
  const bench = row.event.bench || {};
  const ref = {
    index: row.i,
    '@timestamp': row.event['@timestamp'],
    auditFile: bench.auditFile ?? null,
    auditSeq: bench.auditSeq ?? null,
    auditType: bench.auditType ?? null,
  };
  if (bench.agent !== undefined) ref.agent = bench.agent;
  if (bench.instanceId !== undefined) ref.instanceId = bench.instanceId;
  if (bench.attribution !== undefined) ref.attribution = bench.attribution;
  return ref;
}

/**
 * Join one run's two event sets and shape the whole report.
 * @param {Object} opts
 * @param {string} opts.runId
 * @param {string} opts.scenario
 * @param {string} opts.arm
 * @param {Object[]} opts.expected - The catalogue, as ECS documents.
 * @param {Object[]} opts.observed - The observation set, as ECS documents.
 * @param {{value: number|null, source: string, unavailable?: string}} opts.maxLatency -
 *   The join bound and where it came from, in `manifest.js`'s convention: a null
 *   value carries the reason it is null and no join is performed.
 * @param {number|null} opts.ticksWhileProcessAlive - Completed scan ticks inside
 *   the scenario's own process lifetime, or null when there was no lifetime.
 * @returns {Object} The report, ready to serialize.
 * @throws {JoinError} On a malformed bound or an event with no instant.
 */
function buildReport(opts) {
  const bound = opts.maxLatency || {};
  if (bound.value !== null && bound.value !== undefined) {
    if (!Number.isFinite(bound.value) || bound.value <= 0) {
      throw new JoinError(
        'bad-window',
        `maxLatency ${JSON.stringify(bound.value)} is not a positive number of milliseconds — a ` +
          'join window is derived from the run or it is absent, never defaulted',
      );
    }
  }
  const maxLatencyMs = bound.value ?? null;
  const unavailable =
    maxLatencyMs === null ? (bound.unavailable ?? 'no reason was recorded') : null;

  const expected = index(opts.expected, 'expected');
  const observed = index(opts.observed, 'observed');
  const pairs = unavailable ? [] : assign(expected, observed, maxLatencyMs);

  const ticks = opts.ticksWhileProcessAlive;
  const processObservable = ticks === null || ticks === undefined ? null : ticks > 0;

  const categories = {};
  for (const category of CATEGORIES) {
    const inCategory = pairs.filter((p) => p.expected.category === category);
    categories[category] = categoryBlock({
      category,
      expected: expected.filter((e) => e.category === category).length,
      matched: inCategory.length,
      latencies: inCategory.map((p) => p.latencyMs),
      processObservable,
      unavailable,
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    join: {
      maxLatencyMs,
      maxLatencySource: bound.source ?? null,
      unavailable,
      window: 'observed ∈ [expected.@timestamp, expected.@timestamp + maxLatencyMs]',
      keys: JOIN_KEYS,
      notJoinedOn:
        'a name. AEGIS persists the display name it resolved ("Claude Code"), never the image ' +
        'name ("claude.exe"), so the two sides hold different strings about different things and ' +
        'a name join would manufacture matches (B2.3)',
      cardinality:
        'one observed event cancels at most one expectation; where several pairings are eligible ' +
        'the nearest in time wins',
      noConfidenceFigure:
        'every number here is a count of rows or a difference of two timestamps. This report ' +
        'carries no confidence score and none is derived from it',
    },
    processObservable,
    ticksWhileProcessAlive: ticks ?? null,
    categories,
    matched: pairs.map((p) => ({
      category: p.expected.category,
      key: p.expected.key,
      latencyMs: p.latencyMs,
      expected: expectedRef(p.expected),
      observed: observedRef(p.observed),
    })),
    missed: expected
      .filter((e) => !e.used)
      .map((e) => ({
        category: e.category,
        key: e.key,
        expected: expectedRef(e),
        reason: unavailable
          ? `no join was performed — ${unavailable}`
          : missReason(e, observed, maxLatencyMs),
      })),
    unmatchedObserved: observed
      .filter((o) => !o.used)
      .map((o) => ({
        category: o.category,
        key: o.key,
        observed: observedRef(o),
        reason: unavailable
          ? `no join was performed — ${unavailable}`
          : unmatchedReason(o, expected, maxLatencyMs),
      })),
  };
}

module.exports = {
  CATEGORIES,
  JOIN_KEYS,
  JoinError,
  PROCESS_CATEGORIES,
  REPORT_FILENAME,
  SCHEMA_VERSION,
  assign,
  buildReport,
  categoryOf,
  index,
  joinKeyOf,
  latencyBlock,
  nearestRank,
  normalizePath,
};
