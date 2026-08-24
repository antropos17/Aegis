/**
 * @file bench/lib/metrics.js
 * @module bench/lib/metrics
 * @description Metrics over one completed run (sub-block B2.5): the catalogue
 *   confirmed against an independent oracle, and only then the sensor scored
 *   against the part of the catalogue that confirmation turned into ground truth.
 *
 *   **Nothing here reads or writes a file**, exactly as `./join` does not: the
 *   input is four arrays and the run's own recorded accounting, the output is two
 *   plain values. A unit test pins it. `bench/score.js` owns every byte that
 *   touches the disk.
 *
 *   ## The catalogue is the fixed point
 *
 *   Two arcs leave it and they never meet:
 *
 *   ```
 *                 expected.ndjson   (the catalogue — the fixed point)
 *                     /                          \
 *      confirmation  /                            \  visibility
 *      oracle-sysmon.ndjson                    observed.ndjson
 *   ```
 *
 *   There is no third arc. A metric computed by matching the oracle against the
 *   sensor would be a diff of two live streams, which is the one thing the method
 *   forbids — see {@link REJECTED} for the refinement that was rejected on exactly
 *   that ground and why it is written down rather than left unsaid.
 *
 *   ## A catalogue row is not ground truth until an oracle says so
 *
 *   A row the oracle did not confirm is excluded from every sensor denominator —
 *   recall AND precision — and is reported by count and by reason. It is never a
 *   sensor miss: the bench does not know the event happened, so the sensor cannot
 *   have failed to see it. {@link groundTruthRows} is the single place that
 *   selection is made, which is what makes it a mutable target: remove its filter
 *   and `tests/main/bench/metrics-mutation.test.js` goes red.
 *
 *   ## Nothing is scored where the oracle cannot look
 *
 *   {@link coverageFor} decides per category whether this run may be scored at
 *   all, from the configuration THE RUN ITSELF recorded (`oracle-loss.json`
 *   `config.enabledEventIds`, beside the config's sha256) rather than from the
 *   committed XML, which can be edited after a run. A category the oracle cannot
 *   observe is `unmeasurable` and carries `null`, never `0`: a zero would be a
 *   measurement, and no measurement was made.
 *
 *   ## No aggregate
 *
 *   Every figure is per category. There is no accuracy, no F1, no headline number
 *   here and there will not be one — the project publishes per-category evidence.
 *   Every number is a count of rows or a ratio of two such counts.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.14.0
 */
'use strict';

const join = require('./join');
const { neutralizePath, neutralizeRecorded } = require('./paths');

/** @type {number} Shape version of `metrics.json`. Bump when a field changes meaning. */
const METRICS_SCHEMA_VERSION = 1;

/** @type {string} The counts, inside a run directory. */
const METRICS_FILENAME = 'metrics.json';

/** @type {string} The row-by-row evidence the counts are taken over. */
const MATCHED_FILENAME = 'matched.ndjson';

/**
 * MITRE ATT&CK Evaluations detection categories, borrowed rather than invented
 * (RESEARCH-BASELINE section 10).
 *
 * Only these two are used. `General`, `Tactic` and `Technique` — the Evaluations'
 * Analytic Coverage tier — are deliberately absent: what a bench run compares is
 * the product's audit record against an expected event, which is telemetry. To
 * label it with an analytic tier would be a claim about interpretation that
 * nothing in this pipeline measures.
 * @type {Readonly<Object<string, string>>}
 */
const DETECTION = Object.freeze({
  TELEMETRY: 'Telemetry',
  NONE: 'None',
});

/**
 * Why a `None` is a `None`. One of these rides beside the category so a window
 * artefact and a blind sensor are never the same cell.
 *
 * `delayed-beyond-bound` is the Evaluations' `Delayed` modifier under this
 * bench's own bound. The other two have no Evaluations counterpart — that
 * vocabulary has no name for a stamping artefact or for a cardinality loss — so
 * they are named locally and marked as local rather than dressed in a standard
 * name they do not come from.
 * @type {Readonly<Object<string, string>>}
 */
const DETECTION_MODIFIER = Object.freeze({
  DELAYED: 'delayed-beyond-bound',
  STAMPED_BEFORE: 'stamped-before-the-expectation',
  TAKEN_BY_A_NEARER_ROW: 'observation-taken-by-a-nearer-expectation',
});

/** @type {ReadonlyArray<string>} The modifiers borrowed from the Evaluations vocabulary. */
const MODIFIERS_FROM_EVALUATIONS = Object.freeze([DETECTION_MODIFIER.DELAYED]);

/** @type {ReadonlyArray<string>} The modifiers this bench names itself, because no standard one fits. */
const MODIFIERS_BENCH_LOCAL = Object.freeze([
  DETECTION_MODIFIER.STAMPED_BEFORE,
  DETECTION_MODIFIER.TAKEN_BY_A_NEARER_ROW,
]);

/** @type {Readonly<Object<string, string>>} How a catalogue row stands to the oracle. */
const VERDICT = Object.freeze({
  CONFIRMED: 'confirmed',
  UNCONFIRMED: 'unconfirmed',
});

/**
 * The closed list of reasons a catalogue row is not ground truth. A row carries a
 * code from here and the sentence that goes with it; nothing else may appear.
 * @type {Readonly<Object<string, string>>}
 */
const UNCONFIRMED_REASON = Object.freeze({
  ORACLE_NOT_COLLECTED: 'oracle-not-collected',
  CATEGORY_UNMEASURABLE: 'category-unmeasurable',
  CATEGORY_NOT_SCORED: 'category-not-scored',
  ROW_CARRIES_NO_KEY: 'row-carries-no-oracle-key',
  NO_ORACLE_RECORD_FOR_KEY: 'no-oracle-record-for-key',
  TAKEN_BY_A_NEARER_ROW: 'oracle-record-taken-by-a-nearer-row',
});

/**
 * Which Sysmon event confirms which category, and what that event cannot settle.
 *
 * The bound is part of the entry rather than a footnote: a reader who takes a
 * confirmation count has to be able to see, in the same place, what the confirming
 * event does and does not expose.
 * @type {Readonly<Object<string, Readonly<Object>>>}
 */
const ORACLE_COVERAGE = Object.freeze({
  'process/start': Object.freeze({
    eventId: 1,
    event: 'ProcessCreate',
    key: 'process.pid AND process.executable, folded to the recording coordinate system',
    bound:
      'an EID 1 that carries no Image cannot satisfy this key and confirms nothing. pid alone is ' +
      'NOT a fallback: two generations sharing one pid are two generations, and confirming by pid ' +
      'would manufacture an identity the OS never had',
  }),
  'process/end': Object.freeze({
    eventId: 5,
    event: 'ProcessTerminate',
    key: 'process.pid alone',
    bound:
      "Microsoft's published field list for EID 5 is UtcTime, ProcessGuid and ProcessId — there is " +
      'no image to key on, and bench/oracles/sysmon-bench.xml logs terminations machine-wide, so a ' +
      'same-pid coincidence inside the window cannot be separated here. ProcessGuid is carried ' +
      'beside the confirmation as evidence and is never a key: pairing an EID 5 to its EID 1 is ' +
      "oracle-loss.json's lifecycle accounting, and it is deliberately not re-derived here",
  }),
  'file/creation': Object.freeze({
    eventId: 11,
    event: 'FileCreate',
    key: 'file.path, folded to the recording coordinate system',
    bound:
      'EID 11 carries no hash, so the sha256 and the size the catalogue observed are corroborated ' +
      'by nothing on the oracle side. It reports create and overwrite; an append to an existing ' +
      'file produces no EID 11 at all',
  }),
  'file/deletion': Object.freeze({
    eventId: 26,
    event: 'FileDeleteDetected',
    key: 'file.path, folded to the recording coordinate system',
    bound:
      'EID 23 FileDelete is never read as a deletion — bench/lib/oracles/sysmon.js refuses it at ' +
      'the source, because 23 additionally archives the deleted file and the two are not one event',
  }),
});

/**
 * Categories this oracle has no event for at all, with the reason. Separate from
 * a category the run's configuration merely left disabled: that one could be
 * enabled, and these cannot.
 *
 * They are listed even though the catalogue's ECS subset has no shape for them,
 * because the question "what would happen if it grew one" has to have an answer
 * that is not `0`.
 * @type {Readonly<Object<string, string>>}
 */
const ORACLE_BLIND = Object.freeze({
  'file/read':
    'Sysmon has no file-read event. EID 11 FileCreate reports a create or an overwrite and ' +
    'nothing else, and no other event in the RESEARCH-BASELINE section 10 oracle column observes ' +
    'a read. A file read is UNMEASURABLE under this oracle — not undetected, and never scored 0',
  'file/append':
    'Sysmon reports no append. A write into an existing file produces neither an EID 11 nor any ' +
    'other event this configuration enables, so an append is UNMEASURABLE under this oracle — not ' +
    'undetected, and never scored 0',
});

/**
 * What matching the oracle against the sensor would have bought, and why it is
 * not done. Carried in the output so the omission is a decision on the record
 * rather than a gap a later reader closes by accident.
 * @type {Readonly<Object<string, string>>}
 */
const REJECTED = Object.freeze({
  oracleVsSensorCorroboration:
    'REJECTED. An unmatched sensor observation could be split into "real machine activity the ' +
    'scenario did not cause" and "sensor noise" by asking whether the oracle also saw it, which ' +
    'would tighten the precision denominator. That question is a diff of two live streams, and ' +
    'the catalogue is the fixed point precisely so that no metric is ever computed that way. ' +
    'Precision is therefore reported as a LOWER BOUND instead, with the reason in place',
});

/**
 * A failure in this module's own inputs — never a finding about the sensor or the
 * oracle. Carries a machine-readable `stage`, the convention `./join` and
 * `./observed` both use.
 */
class MetricsError extends Error {
  /**
   * @param {string} stage - One of `bad-events`, `bad-coverage`.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(stage, message) {
    super(message);
    this.name = 'MetricsError';
    this.stage = stage;
  }
}

/**
 * One comparable form of a path, for a comparison that crosses two writers.
 *
 * `bench/lib/catalogue.js` and `bench/lib/observed.js` write every path through
 * the recording rewrite in `./paths`; `bench/lib/oracles/sysmon.js` writes none.
 * So the catalogue names a run's binary under the recorded clone root and the
 * oracle names it under the real one, and a comparison that skipped the rewrite
 * would fail on EVERY path key of EVERY live run while looking like an oracle
 * that saw nothing.
 *
 * The rewrite is applied here, at comparison time, over values read from disk.
 * Neither file is modified: this module writes nothing. The residual bound is
 * that `neutralizePath` rewrites the clone root of the tree it is running in, so
 * a run scored on a different machine holds oracle paths nothing can fold — see
 * `PATH_COMPARISON`.
 * @param {*} value - A path exactly as one of the two writers recorded it.
 * @returns {string|null} Null when there was no path to fold.
 */
function foldPath(value) {
  if (typeof value !== 'string') return null;
  return join.normalizePath(neutralizePath(value));
}

/** @type {string} What {@link foldPath} does, and the bound it leaves, for the record. */
const PATH_COMPARISON =
  'both sides are folded through the recording path rewrite (bench/lib/paths.js) and then through ' +
  "the join's separator and case folding (bench/lib/join.js normalizePath). The catalogue and the " +
  'capture are written already rewritten and the oracle file is not, so a comparison without the ' +
  'first step would miss every path key of every live run. FINDING, recorded and not fixed here: ' +
  'the asymmetry belongs to the oracle writer, and closing it there changes that artefact’s ' +
  'bytes. RESIDUAL: the rewrite names the clone root of the tree doing the scoring, so a run ' +
  'scored on a different machine holds oracle paths that cannot be folded onto its catalogue';

/** @type {string} What a stamp delta between the two columns is, and what it is not. */
const STAMP_DELTA_MEANING =
  'oracle @timestamp minus catalogue @timestamp, in milliseconds. It is NOT a latency and NOT a ' +
  'measured clock offset: the two instants are written by two independent clocks (the harness ' +
  'reading its own, and Sysmon writing System/TimeCreated), and the disagreement between them is a ' +
  'quantity this repository has not measured. It is recorded beside each confirmation as an ' +
  'observation, and no bound anywhere is derived from it';

/** @type {string} Why the confirmation join declares no window at all. */
const CONFIRMATION_WINDOW =
  'none, and no epsilon. The oracle window is [the run’s startedAt, the moment collection ' +
  'began] and the catalogue is written inside it, both ends read off the harness’s own clock ' +
  '— so everything the scenario caused lies inside both columns by construction and nothing ' +
  'has to be pulled in by a tolerance. The ~2 s figure in RESEARCH-BASELINE section 10 is a ' +
  "tolerance between Sysmon's OWN two representations; guest-clock uncertainty is a different " +
  'quantity, it is unmeasured, and the two are never merged';

/** @type {string} How many rows may confirm how many rows. */
const CONFIRMATION_CARDINALITY =
  'one oracle record confirms at most one catalogue row, and one catalogue row is confirmed by at ' +
  'most one oracle record. Where several pairings are eligible the smallest absolute stamp delta ' +
  'wins; ties break on file order, so the result is reproducible from the two files it came from';

/**
 * The one field a category is confirmed on, rendered as a comparable string.
 *
 * The keys are NOT `join.JOIN_KEYS`. Those are the bounds of the audit, which
 * persists a pid for a process event and a path for a file event and nothing
 * else. The oracle is not information-starved in the same way, so `process/start`
 * takes two independent fields and a same-pid coincidence cannot confirm it.
 * @param {Object} event - An ECS document from either column.
 * @param {string} category - From `join.categoryOf`.
 * @returns {string|null} Null when the event carries no usable key.
 */
function oracleKeyOf(event, category) {
  const pid = event && event.process ? event.process.pid : undefined;
  const hasPid = Number.isSafeInteger(pid) && pid > 0;

  if (category === 'process/start') {
    const executable = foldPath(event && event.process ? event.process.executable : undefined);
    return hasPid && executable !== null ? `pid:${pid}|exe:${executable}` : null;
  }
  if (category === 'process/end') {
    return hasPid ? `pid:${pid}` : null;
  }
  const filePath = foldPath(event && event.file ? event.file.path : undefined);
  return filePath === null ? null : `path:${filePath}`;
}

/**
 * Whether this run may be scored in one category, and why.
 *
 * The authority is the configuration THE RUN RECORDED — `oracle-loss.json`'s
 * `config.enabledEventIds`, written beside the config's sha256 — and not
 * `bench/oracles/sysmon-bench.xml`, which can be edited after a run and would
 * then describe a configuration nothing was measured under.
 *
 * Order matters. The static blind set is checked first, so a category this oracle
 * has no event for reads as unobservable rather than as merely unconfigured: the
 * second could be turned on and the first could not.
 * @param {string} category - `event.category/event.type`.
 * @param {Object} opts
 * @param {boolean} opts.collected - Whether the oracle read the channel at all.
 * @param {number[]|null} opts.enabledEventIds - As the run recorded them.
 * @param {number} [opts.recordsPresent] - Oracle records of this category in the file.
 * @param {string} [opts.configSha256] - For the message, so a reader can find the config.
 * @returns {Object} The coverage block, ready to serialize.
 */
function coverageFor(category, opts) {
  const recordsPresent = opts.recordsPresent || 0;
  const entry = ORACLE_COVERAGE[category];

  /**
   * @param {Object} fields
   * @returns {Object}
   */
  const block = (fields) => {
    const out = {
      measurable: false,
      eventId: entry ? entry.eventId : null,
      event: entry ? entry.event : null,
      key: entry ? entry.key : null,
      bound: entry ? entry.bound : null,
      recordsPresent,
      ...fields,
    };
    if (out.measurable === false && recordsPresent > 0) {
      out.contradiction =
        `this category is not measurable in this run, yet ${recordsPresent} oracle record(s) of ` +
        'it are in the file. The two disagree, nothing is guessed, and no row is confirmed off a ' +
        'record the recorded configuration says could not have been emitted';
    }
    return out;
  };

  if (!entry) {
    return block({
      reasonCode: UNCONFIRMED_REASON.CATEGORY_UNMEASURABLE,
      reason:
        ORACLE_BLIND[category] ||
        `no event of the RESEARCH-BASELINE section 10 oracle column observes ${category}, so this ` +
          'oracle cannot confirm it under any configuration',
    });
  }
  if (opts.collected !== true) {
    return block({
      reasonCode: UNCONFIRMED_REASON.ORACLE_NOT_COLLECTED,
      reason:
        'the oracle did not collect this run, so nothing in this category was confirmed and ' +
        'nothing in it may be scored. Why it did not is in oracle-loss.json',
    });
  }
  if (!Array.isArray(opts.enabledEventIds)) {
    return block({
      reasonCode: UNCONFIRMED_REASON.CATEGORY_UNMEASURABLE,
      reason:
        'this run recorded no oracle configuration, so which events could have been emitted is ' +
        'unknown. An absent configuration is not an empty one, and a coverage claim is not ' +
        'derived from the committed config file: that file can have changed since the run',
    });
  }
  if (!opts.enabledEventIds.includes(entry.eventId)) {
    return block({
      reasonCode: UNCONFIRMED_REASON.CATEGORY_UNMEASURABLE,
      reason:
        `the configuration this run was measured under does not enable EID ${entry.eventId} ` +
        `${entry.event}${opts.configSha256 ? ` (config sha256 ${opts.configSha256})` : ''}, so ` +
        'the absence of a confirmation here is evidence about the configuration and not about ' +
        'the machine',
    });
  }
  return block({ measurable: true, reasonCode: null, reason: null });
}

/**
 * Reduce one column to rows carrying everything the confirmation matcher needs.
 * @param {Object[]} events - ECS documents.
 * @param {string} side - `catalogue` or `oracle`, for a refusal message.
 * @returns {Object[]} One row per event, in input order.
 * @throws {MetricsError} When an event carries no timestamp that is an instant.
 */
function indexForConfirmation(events, side) {
  if (!Array.isArray(events)) {
    throw new MetricsError('bad-events', `the ${side} column is not an array of events`);
  }
  return events.map((event, i) => {
    const at = Date.parse(event && event['@timestamp']);
    if (!Number.isFinite(at)) {
      throw new MetricsError(
        'bad-events',
        `${side} event ${i} carries @timestamp ${JSON.stringify(event && event['@timestamp'])}, ` +
          'which is not a UTC instant — a row with no instant can be neither confirmed nor ' +
          'reported as unconfirmed for a reason anyone can act on',
      );
    }
    const category = join.categoryOf(event);
    return {
      i,
      event,
      at,
      category,
      key: category ? oracleKeyOf(event, category) : null,
      used: false,
    };
  });
}

/**
 * Confirm catalogue rows against oracle records, nearest stamp first.
 *
 * Only measurable categories produce candidates: a record whose category the
 * recorded configuration says could not have been emitted confirms nothing, and
 * the disagreement is reported on the coverage block instead of being absorbed
 * into a count.
 * @param {Object[]} catalogueRows - From {@link indexForConfirmation}.
 * @param {Object[]} oracleRows - From {@link indexForConfirmation}.
 * @param {Object<string, Object>} coverage - From {@link coverageFor}, per category.
 * @returns {Array<{catalogue: Object, oracle: Object, stampDeltaMs: number}>}
 */
function assignConfirmations(catalogueRows, oracleRows, coverage) {
  const candidates = [];
  for (const row of catalogueRows) {
    if (!row.category || row.key === null) continue;
    if (!coverage[row.category] || coverage[row.category].measurable !== true) continue;
    for (const record of oracleRows) {
      if (record.category !== row.category || record.key !== row.key) continue;
      candidates.push({ row, record, stampDeltaMs: record.at - row.at });
    }
  }
  candidates.sort(
    (a, b) =>
      Math.abs(a.stampDeltaMs) - Math.abs(b.stampDeltaMs) ||
      a.row.i - b.row.i ||
      a.record.i - b.record.i,
  );

  const pairs = [];
  for (const candidate of candidates) {
    if (candidate.row.used || candidate.record.used) continue;
    candidate.row.used = true;
    candidate.record.used = true;
    pairs.push({
      catalogue: candidate.row,
      oracle: candidate.record,
      stampDeltaMs: candidate.stampDeltaMs,
    });
  }
  return pairs;
}

/**
 * Why a catalogue row is not ground truth, as a code from the closed list and the
 * sentence that goes with it.
 * @param {Object} row - The unconfirmed row, from {@link indexForConfirmation}.
 * @param {Object[]} oracleRows - From {@link indexForConfirmation}.
 * @param {Object<string, Object>} coverage - From {@link coverageFor}, per category.
 * @returns {{reasonCode: string, reason: string}}
 */
function unconfirmedReason(row, oracleRows, coverage) {
  if (!row.category) {
    return {
      reasonCode: UNCONFIRMED_REASON.CATEGORY_NOT_SCORED,
      reason:
        'the row carries no category this scoring covers. It is neither ground truth nor a ' +
        'coverage failure, and it is reported here rather than dropped',
    };
  }
  const cover = coverage[row.category];
  if (!cover || cover.measurable !== true) {
    return {
      reasonCode: cover ? cover.reasonCode : UNCONFIRMED_REASON.CATEGORY_UNMEASURABLE,
      reason: cover ? cover.reason : `${row.category} is outside this oracle's coverage`,
    };
  }
  if (row.key === null) {
    return {
      reasonCode: UNCONFIRMED_REASON.ROW_CARRIES_NO_KEY,
      reason:
        `the row carries no ${ORACLE_COVERAGE[row.category].key} to confirm on, and no narrower ` +
        'key is substituted for it',
    };
  }
  const sameKey = oracleRows.filter((r) => r.category === row.category && r.key === row.key);
  if (sameKey.length === 0) {
    return {
      reasonCode: UNCONFIRMED_REASON.NO_ORACLE_RECORD_FOR_KEY,
      reason:
        `no EID ${ORACLE_COVERAGE[row.category].eventId} record in this run's oracle column ` +
        `carries ${row.key}. The oracle looked and did not see it, so the row states an intent ` +
        'the oracle did not confirm and is not ground truth',
    };
  }
  return {
    reasonCode: UNCONFIRMED_REASON.TAKEN_BY_A_NEARER_ROW,
    reason:
      `every EID ${ORACLE_COVERAGE[row.category].eventId} record carrying ${row.key} was taken ` +
      'by a catalogue row whose stamp is nearer — one oracle record confirms at most one row',
  };
}

/**
 * The counterpart on the observed side that came closest to this expectation,
 * whether or not it was eligible. It is what separates a window artefact from a
 * sensor that saw nothing.
 *
 * A local ten-line helper rather than an import: `./join` keeps its own `nearest`
 * private, and the prose built on it there is about coverage while the prose built
 * on it here is about ground truth.
 * @param {Object} row - An expectation row from `join.index`.
 * @param {Object[]} observed - The observed side from `join.index`.
 * @returns {{row: Object, latencyMs: number}|null}
 */
function nearestObservation(row, observed) {
  let best = null;
  for (const other of observed) {
    if (other.category !== row.category || other.key !== row.key) continue;
    const latencyMs = other.at - row.at;
    if (best === null || Math.abs(latencyMs) < Math.abs(best.latencyMs)) {
      best = { row: other, latencyMs };
    }
  }
  return best;
}

/**
 * The rows a sensor may be scored against: the confirmed ones, and nothing else.
 *
 * **This is the exclusion the whole block turns on.** A catalogue row states
 * intent plus the fact of execution; only an independent oracle turns it into an
 * event that is known to have happened. Counting an unconfirmed row in a
 * denominator would charge the sensor for missing something nobody established,
 * and counting it in a numerator would credit it for the same.
 *
 * Deliberately one line, one filter, one call site per figure, so a mutant that
 * removes it is a surgical edit rather than a rewrite —
 * `tests/main/bench/metrics-mutation.test.js` makes exactly that edit and
 * requires the suite to go red.
 * @param {Object[]} rows - Scored rows, from {@link buildMetrics}.
 * @returns {Object[]} Those whose oracle verdict is `confirmed`.
 */
function groundTruthRows(rows) {
  return rows.filter((row) => row.oracle.verdict === VERDICT.CONFIRMED);
}

/**
 * A ratio as the two things a reader needs: the fraction it was taken over, and
 * the number — or the reason there is no number.
 * @param {number} numerator
 * @param {number} denominator
 * @param {string} overNothing - Why a ratio over an empty denominator is not 0.
 * @returns {{text: string, value: number|null, unavailable: string|null}}
 */
function ratio(numerator, denominator, overNothing) {
  if (denominator === 0) {
    return { text: `${numerator}/0`, value: null, unavailable: overNothing };
  }
  return { text: `${numerator}/${denominator}`, value: numerator / denominator, unavailable: null };
}

/**
 * The catalogue-side identity of a row: which step made it, which expectation it
 * claimed, and the key it was confirmed on.
 * @param {Object} row - From {@link indexForConfirmation}.
 * @returns {Object}
 */
function catalogueRef(row) {
  const bench = row.event.bench || {};
  return {
    index: row.i,
    '@timestamp': row.event['@timestamp'],
    step: bench.step ?? null,
    expect: bench.expect ?? null,
    key: row.key,
  };
}

/**
 * The oracle-side identity of a record, so any confirmation can be walked back to
 * the channel record it stands on. `processGuid` rides here as EVIDENCE and is
 * never a key — see {@link ORACLE_COVERAGE}.
 * @param {Object} row - From {@link indexForConfirmation}.
 * @returns {Object}
 */
function oracleRef(row) {
  const bench = row.event.bench || {};
  return {
    index: row.i,
    '@timestamp': row.event['@timestamp'],
    eventId: bench.eventId ?? null,
    eventRecordId: bench.eventRecordId ?? null,
    processGuid: bench.processGuid ?? null,
  };
}

/**
 * The audit-side identity of an observation, in the shape `./join` already uses
 * for one, so a metrics row and a report row name the same record the same way.
 * @param {Object} row - From `join.index`.
 * @returns {Object}
 */
function observedRef(row) {
  const bench = row.event.bench || {};
  return {
    index: row.i,
    '@timestamp': row.event['@timestamp'],
    auditFile: bench.auditFile ?? null,
    auditSeq: bench.auditSeq ?? null,
    auditType: bench.auditType ?? null,
  };
}

/**
 * The sensor half of one scored row: what the sensor did about this expectation.
 * @param {Object} opts
 * @param {Object} opts.row - The expectation, from `join.index`.
 * @param {Object|null} opts.pair - Its matched pair, or null.
 * @param {Object[]} opts.observed - The observed side, from `join.index`.
 * @param {number|null} opts.maxLatencyMs
 * @param {{scored: boolean, unavailable: string|null}} opts.state
 * @returns {Object}
 */
function sensorHalf(opts) {
  if (!opts.state.scored) {
    return {
      detectionCategory: null,
      modifier: null,
      latencyMs: null,
      record: null,
      unavailable: opts.state.unavailable,
    };
  }
  if (opts.pair) {
    return {
      detectionCategory: DETECTION.TELEMETRY,
      modifier: null,
      latencyMs: opts.pair.latencyMs,
      record: observedRef(opts.pair.observed),
      reason: 'the sensor recorded a matching event inside the join window',
    };
  }
  const near = opts.row.key === null ? null : nearestObservation(opts.row, opts.observed);
  if (!near) {
    return {
      detectionCategory: DETECTION.NONE,
      modifier: null,
      latencyMs: null,
      record: null,
      reason: `no observed ${opts.row.category} carries ${opts.row.key} at all`,
    };
  }
  if (near.latencyMs < 0) {
    return {
      detectionCategory: DETECTION.NONE,
      modifier: DETECTION_MODIFIER.STAMPED_BEFORE,
      latencyMs: near.latencyMs,
      record: observedRef(near.row),
      reason:
        `the nearest observation is stamped ${-near.latencyMs} ms BEFORE the expectation. The ` +
        'actor stamps around the step and the audit stamps inside its own log call, so this is a ' +
        'stamping artefact rather than a sensor result',
    };
  }
  if (near.latencyMs > opts.maxLatencyMs) {
    return {
      detectionCategory: DETECTION.NONE,
      modifier: DETECTION_MODIFIER.DELAYED,
      latencyMs: near.latencyMs,
      record: observedRef(near.row),
      reason:
        `the nearest observation arrived ${near.latencyMs} ms later, past the ` +
        `${opts.maxLatencyMs} ms bound this run joined on. The bound produced this None, not the ` +
        'sensor',
    };
  }
  return {
    detectionCategory: DETECTION.NONE,
    modifier: DETECTION_MODIFIER.TAKEN_BY_A_NEARER_ROW,
    latencyMs: near.latencyMs,
    record: observedRef(near.row),
    reason:
      'the only in-window observation for this key was taken by a nearer expectation — one ' +
      'observed event cancels at most one expectation',
  };
}

/**
 * One category's confirmation block: how much of the catalogue an independent
 * source stood behind, and what the oracle saw that the catalogue did not claim.
 * @param {Object} opts
 * @param {string} opts.category
 * @param {Object[]} opts.rows - This category's scored rows.
 * @param {Object} opts.coverage - This category's coverage block.
 * @param {Object[]} opts.oracleRows - All oracle rows, from {@link indexForConfirmation}.
 * @returns {Object}
 */
function confirmationBlock(opts) {
  const { rows, coverage } = opts;
  const confirmed = groundTruthRows(rows).length;
  const catalogued = rows.length;
  const unusable = opts.oracleRows.filter(
    (r) => r.category === opts.category && r.key === null && !r.used,
  );
  const outside = opts.oracleRows.filter(
    (r) => r.category === opts.category && r.key !== null && !r.used,
  );

  /** @type {Object} */
  const block = {
    catalogued,
    confirmed: coverage.measurable ? confirmed : null,
    unconfirmed: coverage.measurable ? catalogued - confirmed : null,
    confirmationRate: '',
    confirmationRateValue: null,
    unconfirmedRows: rows
      .filter((row) => row.oracle.verdict !== VERDICT.CONFIRMED)
      .map((row) => ({
        index: row.expected.index,
        step: row.expected.step,
        expect: row.expected.expect,
        key: row.expected.key,
        reasonCode: row.oracle.reasonCode,
        reason: row.oracle.reason,
      })),
    oracleRecordsUnusable: {
      count: unusable.length,
      meaning:
        `oracle records of this category carrying no ${coverage.key || 'key'}. Counted rather ` +
        'than dropped, and never confirmed off a narrower key',
      records: unusable.map(oracleRef),
    },
    oracleRecordsOutsideCatalogue: {
      count: outside.length,
      meaning:
        'oracle records of this category that confirmed no catalogue row. Real observations the ' +
        'scenario did not claim, reported and never matched against what the sensor did with them',
      records: outside.map(oracleRef),
    },
  };

  if (!coverage.measurable) {
    block.confirmationRate = `unmeasurable — ${coverage.reasonCode}`;
    block.confirmationRateUnavailable = coverage.reason;
    return block;
  }
  const rate = ratio(
    confirmed,
    catalogued,
    'the catalogue holds no row in this category, and a confirmation rate over nothing is not 0',
  );
  block.confirmationRate = rate.unavailable ? '0/0' : rate.text;
  block.confirmationRateValue = rate.value;
  if (rate.unavailable) block.confirmationRateUnavailable = rate.unavailable;
  return block;
}

/**
 * One category's sensor block: visibility over ground truth, and precision as the
 * lower bound it is.
 *
 * Every figure here is taken over {@link groundTruthRows} of the category. The
 * partition is exact by construction: every observation of the category is either
 * matched to a confirmed row (a true positive), matched to an unconfirmed row
 * (excluded from both sides), or matched to nothing (unaccounted).
 * @param {Object} opts
 * @param {string} opts.category
 * @param {Object[]} opts.rows - This category's scored rows.
 * @param {Object[]} opts.observed - The observed side, from `join.index`.
 * @param {Object} opts.coverage - This category's coverage block.
 * @param {{scored: boolean, unavailable: string|null}} opts.state
 * @param {boolean|null} opts.processObservable
 * @returns {Object}
 */
function sensorBlock(opts) {
  const { rows, coverage, state } = opts;
  const inCategory = opts.observed.filter((o) => o.category === opts.category);

  if (!state.scored || !coverage.measurable) {
    const why = !state.scored ? state.unavailable : coverage.reason;
    return {
      groundTruth: null,
      detected: null,
      notDetected: null,
      recall: `unavailable — ${!state.scored ? 'no sensor column was scored' : coverage.reasonCode}`,
      recallValue: null,
      recallUnavailable: why,
      latencyMs: join.latencyBlock([]),
      truePositives: null,
      observationsInWindow: inCategory.length,
      matchedUnconfirmed: null,
      unaccounted: null,
      precisionDenominator: null,
      precision: `unavailable — ${!state.scored ? 'no sensor column was scored' : coverage.reasonCode}`,
      precisionValue: null,
      precisionBound: 'lower',
      precisionUnavailable: why,
      unaccountedObserved: [],
    };
  }

  const truth = groundTruthRows(rows);
  const detectedRows = truth.filter((row) => row.sensor.detectionCategory === DETECTION.TELEMETRY);
  const matchedUnconfirmed = rows.filter(
    (row) =>
      row.oracle.verdict !== VERDICT.CONFIRMED &&
      row.sensor.detectionCategory === DETECTION.TELEMETRY,
  ).length;
  const unaccounted = inCategory.filter((o) => !o.used);

  // An empty ground truth has two different causes and they are not the same
  // finding: a category the catalogue never expected, and a category every row of
  // which the oracle declined to confirm. Both give `0/0` and neither gives 0.
  const recall = ratio(
    detectedRows.length,
    truth.length,
    rows.length === 0
      ? 'the catalogue holds no row in this category, so there is nothing for the sensor to have ' +
          'been visible over and a recall over nothing is not 0'
      : `all ${rows.length} catalogue row(s) of this category are unconfirmed, so this run ` +
          'established no ground truth here and a recall of 0 would be a measurement nobody ' +
          'made. Each row is listed beside its reason in the confirmation block',
  );
  const precision = ratio(
    detectedRows.length,
    detectedRows.length + unaccounted.length,
    'the sensor recorded nothing in this category that any ground-truth row or any unaccounted ' +
      'observation could be taken over, and a precision over nothing is not 0',
  );

  /** @type {Object} */
  const block = {
    groundTruth: truth.length,
    detected: detectedRows.length,
    notDetected: truth.length - detectedRows.length,
    recall: recall.unavailable ? '0/0' : recall.text,
    recallValue: recall.value,
    latencyMs: join.latencyBlock(detectedRows.map((row) => row.sensor.latencyMs)),
    truePositives: detectedRows.length,
    observationsInWindow: inCategory.length,
    matchedUnconfirmed,
    matchedUnconfirmedMeaning:
      'observations that cancelled a catalogue row the oracle did not confirm. Excluded from the ' +
      'precision denominator as well as from recall: the row is not ground truth, so the ' +
      'observation is neither a hit against it nor a false positive',
    unaccounted: unaccounted.length,
    precisionDenominator: detectedRows.length + unaccounted.length,
    precision: precision.unavailable ? '0/0' : precision.text,
    precisionValue: precision.value,
    precisionBound: 'lower',
    precisionBoundReason:
      'a LOWER bound. Every unaccounted observation is counted against precision, and some of ' +
      'them are real machine activity the scenario did not cause rather than sensor noise. ' +
      'Separating the two would mean asking whether the oracle also saw them, which is a diff of ' +
      'two live streams and is refused — see rejected.oracleVsSensorCorroboration',
    unaccountedObserved: unaccounted.map((o) => ({
      ...observedRef(o),
      key: o.key,
      reason:
        'this observation cancelled no expectation. It is either sensor noise or activity on the ' +
        'machine the scenario did not cause, and this bench does not separate the two',
    })),
  };
  if (recall.unavailable) block.recallUnavailable = recall.unavailable;
  if (precision.unavailable) block.precisionUnavailable = precision.unavailable;
  if (opts.processObservable === false && join.PROCESS_CATEGORIES.includes(opts.category)) {
    block.note =
      'no scan tick fell inside the scenario’s process lifetime, so the process was never in ' +
      'front of the sensor. Read this category as a structural gap, not as a coverage result';
  }
  return block;
}

/**
 * Score one completed run.
 *
 * @param {Object} opts
 * @param {string} opts.runId
 * @param {string} opts.scenario
 * @param {string} opts.arm
 * @param {Object[]} opts.expected - The catalogue, as ECS documents.
 * @param {Object[]} opts.oracle - The oracle column, as ECS documents. Empty when
 *   the oracle collected nothing.
 * @param {Object} opts.loss - Parsed `oracle-loss.json`, verbatim.
 * @param {Object[]|null} opts.observed - The observation set, or null in an arm
 *   that runs no sensor.
 * @param {{value: number|null, source: string, unavailable?: string}} opts.maxLatency -
 *   The join bound, in `bench/lib/report.js`'s shape.
 * @param {number|null} opts.ticksWhileProcessAlive
 * @param {Array<Object>} opts.inputs - Provenance of the files this was built
 *   from, as `bench/score.js` read them.
 * @returns {{metrics: Object, matched: Object[]}}
 * @throws {MetricsError} On a column that is not an array of instants.
 */
function buildMetrics(opts) {
  const loss = opts.loss || {};
  const config = loss.config || {};
  const collected =
    (loss.collection ? loss.collection.ran === true : false) && Array.isArray(opts.oracle);

  const catalogueRows = indexForConfirmation(opts.expected, 'catalogue');
  const oracleRows = indexForConfirmation(opts.oracle || [], 'oracle');

  /** @type {Object<string, Object>} */
  const coverage = {};
  for (const category of join.CATEGORIES) {
    coverage[category] = coverageFor(category, {
      collected,
      enabledEventIds: Array.isArray(config.enabledEventIds) ? config.enabledEventIds : null,
      recordsPresent: oracleRows.filter((r) => r.category === category).length,
      configSha256: config.sha256 || undefined,
    });
  }

  const confirmations = assignConfirmations(catalogueRows, oracleRows, coverage);
  /** @type {Map<number, Object>} */
  const confirmedByIndex = new Map(confirmations.map((c) => [c.catalogue.i, c]));

  // The sensor join is `./join`'s own, so the report and the metrics never
  // disagree about which observation cancelled which expectation.
  const bound = opts.maxLatency || {};
  const maxLatencyMs = bound.value ?? null;
  const state = {
    scored: opts.observed !== null && opts.observed !== undefined && maxLatencyMs !== null,
    unavailable: null,
  };
  if (opts.observed === null || opts.observed === undefined) {
    state.unavailable =
      `arm ${opts.arm} runs no sensor, so this run has no observation set to score. That is what ` +
      'the arm is: it establishes whether the catalogue is faithful, and arm A scores a sensor ' +
      'against the part of it that came back confirmed';
  } else if (maxLatencyMs === null) {
    state.unavailable =
      bound.unavailable ??
      'the join window could not be derived from this run, and it is never defaulted';
  }

  const sensorExpected = join.index(opts.expected, 'expected');
  const sensorObserved = join.index(opts.observed || [], 'observed');
  const sensorPairs = state.scored ? join.assign(sensorExpected, sensorObserved, maxLatencyMs) : [];
  /** @type {Map<number, Object>} */
  const detectedByIndex = new Map(sensorPairs.map((p) => [p.expected.i, p]));

  const matched = catalogueRows.map((row) => {
    const confirmation = confirmedByIndex.get(row.i) || null;
    const oracleHalf = confirmation
      ? {
          verdict: VERDICT.CONFIRMED,
          reasonCode: null,
          reason: `confirmed on ${row.key}`,
          eventId: ORACLE_COVERAGE[row.category].eventId,
          key: row.key,
          stampDeltaMs: confirmation.stampDeltaMs,
          record: oracleRef(confirmation.oracle),
        }
      : {
          verdict: VERDICT.UNCONFIRMED,
          ...unconfirmedReason(row, oracleRows, coverage),
          eventId:
            row.category && ORACLE_COVERAGE[row.category]
              ? ORACLE_COVERAGE[row.category].eventId
              : null,
          key: row.key,
          stampDeltaMs: null,
          record: null,
        };
    return {
      unit: 'expectation',
      category: row.category,
      groundTruth: oracleHalf.verdict === VERDICT.CONFIRMED,
      expected: catalogueRef(row),
      oracle: oracleHalf,
      sensor: sensorHalf({
        row: sensorExpected[row.i],
        pair: detectedByIndex.get(row.i) || null,
        observed: sensorObserved,
        maxLatencyMs,
        state,
      }),
    };
  });

  const ticks = opts.ticksWhileProcessAlive;
  const processObservable = ticks === null || ticks === undefined ? null : ticks > 0;

  /** @type {Object<string, Object>} */
  const groundTruth = {};
  /** @type {Object<string, Object>} */
  const sensor = {};
  for (const category of join.CATEGORIES) {
    const rows = matched.filter((row) => row.category === category);
    groundTruth[category] = confirmationBlock({
      category,
      rows,
      coverage: coverage[category],
      oracleRows,
    });
    sensor[category] = sensorBlock({
      category,
      rows,
      observed: sensorObserved,
      coverage: coverage[category],
      state,
      processObservable,
    });
  }

  const metrics = {
    schemaVersion: METRICS_SCHEMA_VERSION,
    runId: opts.runId,
    scenario: opts.scenario,
    arm: opts.arm,
    vocabulary: {
      source:
        'MITRE ATT&CK Evaluations, borrowed rather than invented (RESEARCH-BASELINE section 10). ' +
        'recall and precision are the standard information-retrieval names and are not renamed',
      detectionCategories: [DETECTION.TELEMETRY, DETECTION.NONE],
      detectionCategoriesNotUsed:
        'General, Tactic and Technique — the Evaluations’ Analytic Coverage tier. What this ' +
        "bench compares is the product's audit record against an expected event, which is " +
        'telemetry; labelling it with an analytic tier would claim an interpretation nothing here ' +
        'measures',
      modifiersFromEvaluations: [...MODIFIERS_FROM_EVALUATIONS],
      modifiersBenchLocal: [...MODIFIERS_BENCH_LOCAL],
      modifiersBenchLocalReason:
        'the Evaluations vocabulary has no name for a stamping artefact or for an observation lost ' +
        'to cardinality, so these two are named locally and marked as local rather than dressed in ' +
        'a standard name they do not come from',
      noAggregate:
        'there is no accuracy figure, no F1, no single headline number in this file and there will ' +
        'not be one. Every figure is per category, and every one of them is a count of rows or a ' +
        'ratio of two such counts',
    },
    inputs: opts.inputs,
    oracle: {
      id: loss.oracle ?? null,
      collected,
      records: oracleRows.length,
      window: loss.collection ? (loss.collection.window ?? null) : null,
      epsilonMs: 0,
      confirmationWindow: CONFIRMATION_WINDOW,
      cardinality: CONFIRMATION_CARDINALITY,
      pathComparison: PATH_COMPARISON,
      stampDelta: STAMP_DELTA_MEANING,
      notJoinedOnTheSensor:
        'nothing in this file is derived by matching the oracle against the sensor. The catalogue ' +
        'is the fixed point and both columns are scored against it, never against each other',
      config: {
        path: config.path ?? null,
        sha256: config.sha256 ?? null,
        enabledEventIds: Array.isArray(config.enabledEventIds) ? [...config.enabledEventIds] : null,
        authority:
          'the configuration THIS RUN recorded, not bench/oracles/sysmon-bench.xml. That file can ' +
          'have changed since the run, and a coverage claim read off it would describe a ' +
          'configuration nothing was measured under',
      },
      coverage,
    },
    groundTruth,
    sensor: {
      scored: state.scored,
      unavailable: state.unavailable,
      window: {
        maxLatencyMs,
        maxLatencySource: bound.source ?? null,
        expression: 'observed ∈ [expected.@timestamp, expected.@timestamp + maxLatencyMs]',
      },
      processObservable,
      ticksWhileProcessAlive: ticks ?? null,
      ...sensor,
    },
    scenarioSteps: {
      value: null,
      unavailable:
        'a step that failed to execute emits NO catalogue row (bench/README.md, "The catalogue"), ' +
        'so it is a state of a step and never of a row, and it cannot be counted here. ' +
        'bench/lib/actor.js returns a status per step and bench/run.js prints it without writing ' +
        'it, so no file in a run directory carries it. Absent, and named rather than inferred ' +
        'from a catalogue that is shorter than a scenario',
    },
    rejected: REJECTED,
  };

  return { metrics, matched };
}

/**
 * The bytes `metrics.json` is written as. One definition, so a run and a re-score
 * of the same run cannot differ by a newline.
 * @param {Object} metrics - From {@link buildMetrics}.
 * @returns {string}
 */
function serializeMetrics(metrics) {
  return `${JSON.stringify(neutralizeRecorded(metrics), null, 2)}\n`;
}

/**
 * The bytes `matched.ndjson` is written as: one scored row per line.
 *
 * Every catalogue row is here, including the ones nothing confirmed and nothing
 * observed. A file holding only the successes would make every count in
 * `metrics.json` underivable from the evidence beside it.
 * @param {Object[]} rows - From {@link buildMetrics}.
 * @returns {string} Empty for an empty catalogue, the convention
 *   `bench/lib/catalogue.js` already uses.
 */
function serializeMatched(rows) {
  if (rows.length === 0) return '';
  return `${rows.map((row) => JSON.stringify(neutralizeRecorded(row))).join('\n')}\n`;
}

module.exports = {
  CONFIRMATION_CARDINALITY,
  CONFIRMATION_WINDOW,
  DETECTION,
  DETECTION_MODIFIER,
  MATCHED_FILENAME,
  METRICS_FILENAME,
  METRICS_SCHEMA_VERSION,
  MODIFIERS_BENCH_LOCAL,
  MODIFIERS_FROM_EVALUATIONS,
  MetricsError,
  ORACLE_BLIND,
  ORACLE_COVERAGE,
  PATH_COMPARISON,
  REJECTED,
  STAMP_DELTA_MEANING,
  UNCONFIRMED_REASON,
  VERDICT,
  assignConfirmations,
  buildMetrics,
  confirmationBlock,
  coverageFor,
  foldPath,
  groundTruthRows,
  indexForConfirmation,
  nearestObservation,
  oracleKeyOf,
  ratio,
  sensorBlock,
  serializeMatched,
  serializeMetrics,
  unconfirmedReason,
};
