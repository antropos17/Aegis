/**
 * @file bench/trace/schema.js
 * @module bench/trace/schema
 * @description The trace format itself: its version, its chain seed, the closed list
 *   of record kinds, the ECS envelope each kind carries, the environment a trace
 *   pins, and every reason a trace may be REFUSED.
 *
 *   A trace is an INPUT — a recorded stream of what the sensors observed — and it is
 *   the opposite end of the pipeline from Event Schema v1, which is what the product
 *   DECIDED. Nothing here describes a verdict.
 *
 *   THIS MODULE IMPORTS FROM `src/`, AND THAT IS DELIBERATE. The rule the rest of
 *   `bench/` keeps — "a sensor is never its own oracle; nothing under `bench/`
 *   imports from `src/`" — is about the ORACLE column, whose independence dies if it
 *   shares code with the thing it confirms. Trace replay is not an oracle: it is the
 *   system under test, re-executed. See `bench/README.md`, "Trace replay and the
 *   src/ boundary", for the name-by-name split. What THIS file loads is one module —
 *   `src/main/audit-hashchain.js`, for `canonical` and `computeHash`, so the trace
 *   chain uses one hashing algorithm rather than a third copy of it. The rest of the
 *   subtree's `src/` surface is in `./environment.js`, which is where a trace's
 *   dependence on the tree is observed and compared.
 *
 *   THE CHAIN SEED IS OUR OWN. `TRACE_GENESIS` is not the audit `GENESIS`: with a
 *   shared seed, keeping the two chains apart would rest on the top-level-`seq` gate
 *   that both of today's verifiers take before hashing
 *   (`src/main/audit-hashchain.js` `verifyChain`, `bench/lib/observed.js`
 *   `readChain`) — a gate `bench/` neither owns nor can freeze. With distinct seeds
 *   no record of one file is ever a valid record of the other, at any position and
 *   under any future verifier. A verdict file keeps the audit seed, because the
 *   product writes it.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const path = require('path');

const hashchain = require('../../src/main/audit-hashchain');

/** @type {string} Repository root — this file is `bench/trace/`, two levels down. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The trace format's version.
 *
 * A reader meeting a HIGHER version REFUSES, which is the opposite of what a reader
 * of the product's audit log must do (`src/main/audit-logger.js` — there `seq` is
 * monotonic and skipping one record breaks every hash after it, so an unknown field
 * set has to be read past). A trace is an input: a partially understood input
 * produces a verdict about some other input, and that is worse than no verdict.
 * @type {number}
 */
const TRACE_SCHEMA_VERSION = 1;

/**
 * Chain seed for `trace.ndjson`. See the file header for why it is not the audit
 * `GENESIS`.
 * @type {string}
 */
const TRACE_GENESIS = 'AEGIS-BENCH-TRACE-GENESIS-v1';

/** @type {string} ECS version the envelope speaks — the one `bench/lib/catalogue.js` uses. */
const ECS_VERSION = '8.11.0';

/** @type {string} The one file name a trace's records live in. */
const TRACE_FILENAME = 'trace.ndjson';

/** @type {string} The one file name a trace's pinned environment lives in. */
const HEADER_FILENAME = 'trace.header.json';

/**
 * Every reason this module or its readers may refuse a trace, as a closed list.
 *
 * A refusal names one of these and nothing else, so a caller can branch on the
 * reason and a test can enumerate them. Adding a refusal means adding a member
 * here first.
 * @type {Readonly<Record<string, string>>}
 */
const REFUSAL = Object.freeze({
  /** `traceSchemaVersion` is absent, not a number, or not this reader's version. */
  SCHEMA_VERSION: 'schema-version',
  /** A header field is missing or has the wrong type. */
  HEADER_MALFORMED: 'header-malformed',
  /** The header names a platform this process is not running on. */
  PLATFORM_MISMATCH: 'platform-mismatch',
  /** The header names a time zone this process is not running in. */
  TZ_MISMATCH: 'tz-mismatch',
  /** A pinned digest does not match the tree this process would replay against. */
  DIGEST_MISMATCH: 'digest-mismatch',
  /** The closed list of attribution evidence codes moved since the trace was recorded. */
  EVIDENCE_CODES_MISMATCH: 'evidence-codes-mismatch',
  /** `scope` does not answer every question this version requires it to answer. */
  SCOPE_INCOMPLETE: 'scope-incomplete',
  /** A record names a `bench.kind` outside the closed list. */
  UNKNOWN_KIND: 'unknown-kind',
  /** A record is not an object, or its `bench.input` does not fit its kind. */
  RECORD_MALFORMED: 'record-malformed',
  /** A line does not parse, a seq is not its line number, or a hash does not recompute. */
  CHAIN_BROKEN: 'chain-broken',
  /** A record's ECS envelope disagrees with the kind it declares. */
  ENVELOPE_MISMATCH: 'envelope-mismatch',
  /** The trace holds no records. */
  EMPTY_TRACE: 'empty-trace',
  /** A file of the trace is missing or unreadable. */
  FILE_UNREADABLE: 'file-unreadable',
});

/** @type {ReadonlyArray<string>} Every refusal reason, for enumeration. */
const REFUSAL_REASONS = Object.freeze(Object.values(REFUSAL));

/**
 * A refusal. Carries the reason code so a caller branches on it rather than on the
 * message text. Modelled on `bench/lib/observed.js` `ObservedError`.
 */
class TraceError extends Error {
  /**
   * @param {string} reason - One of {@link REFUSAL}.
   * @param {string} message - What a reader needs in order to act.
   */
  constructor(reason, message) {
    super(message);
    this.name = 'TraceError';
    this.reason = reason;
  }
}

/**
 * Refuse, by reason.
 * @param {string} reason - One of {@link REFUSAL}.
 * @param {string} message - What a reader needs in order to act.
 * @returns {never}
 * @throws {TraceError} Always.
 */
function refuse(reason, message) {
  throw new TraceError(reason, message);
}

/** @param {*} v @returns {boolean} Whether `v` is a plain, non-null object. */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {*} v @returns {boolean} Whether `v` is a non-empty string. */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/** @param {*} v @returns {boolean} Whether `v` is a pid the OS could have handed out, or 0. */
function isPidLike(v) {
  return Number.isSafeInteger(v) && v >= 0;
}

/**
 * The ECS `event.type` and `event.action` each filesystem action maps onto.
 *
 * The three actions are exactly what `src/main/file-watcher.js` binds chokidar's
 * `add` / `change` / `unlink` to, and a trace may carry no fourth: a value the
 * watcher cannot emit is an input the product could never have been given.
 * @type {Readonly<Record<string, {type: string, action: string}>>}
 */
const FS_ACTIONS = Object.freeze({
  created: Object.freeze({ type: 'creation', action: 'file-created' }),
  modified: Object.freeze({ type: 'change', action: 'file-changed' }),
  deleted: Object.freeze({ type: 'deletion', action: 'file-deleted' }),
});

/**
 * The closed list of record kinds.
 *
 * It lives HERE, in code, and not in a JSON Schema — the same choice
 * `bench/lib/actor.js` makes for step kinds, and for the same reason: only the code
 * that can execute a kind can say which kinds exist. What each entry declares is the
 * shape of the kind's `bench.input`, so a reader can refuse a malformed one by name.
 *
 * `observation: false` marks a record that observed NOTHING — the harness's own
 * clock and the population it was handed. Those carry `event.kind: 'state'` and no
 * `event.category` / `event.type`, because ECS has no category for "the harness
 * moved its clock" and inventing one would dress a parameter up as a measurement.
 * It is the same reasoning that keeps `bench/lib/actor.js`'s `wait` step out of the
 * catalogue.
 * @type {Readonly<Record<string, Object>>}
 */
const RECORD_KINDS = Object.freeze({
  'fs.event': Object.freeze({
    observation: true,
    summary: 'one chokidar filesystem event, as the watcher delivered it',
    inputFields: Object.freeze(['action', 'path']),
    validateInput(input, fail) {
      if (!Object.prototype.hasOwnProperty.call(FS_ACTIONS, input.action)) {
        fail(
          `action ${JSON.stringify(input.action)} is not one of ` +
            `${Object.keys(FS_ACTIONS).join(', ')} — the watcher emits no fourth action`,
        );
      }
      if (!isNonEmptyString(input.path)) fail('path must be a non-empty string');
    },
  }),
  'handles.tick': Object.freeze({
    observation: true,
    summary: 'one per-pid handle scan, as the platform provider answered it',
    inputFields: Object.freeze(['byPid']),
    validateInput(input, fail) {
      if (!isObject(input.byPid)) fail('byPid must be an object keyed by pid');
      for (const [pid, files] of Object.entries(input.byPid)) {
        if (!/^\d+$/.test(pid)) fail(`byPid key ${JSON.stringify(pid)} is not a pid`);
        if (!Array.isArray(files) || !files.every(isNonEmptyString)) {
          fail(`byPid[${pid}] must be an array of non-empty path strings`);
        }
      }
    },
  }),
  'rm.hot.tick': Object.freeze({
    observation: true,
    summary: 'one Restart Manager hot-cycle answer, as the provider returned it',
    inputFields: Object.freeze(['holders']),
    validateInput(input, fail) {
      if (!Array.isArray(input.holders)) fail('holders must be an array');
      for (const [i, h] of input.holders.entries()) {
        if (!isObject(h)) fail(`holders[${i}] must be an object`);
        if (!isPidLike(h.pid)) fail(`holders[${i}].pid must be a non-negative integer`);
        // `group`, not `path`, and the name is the product's: `_scanRmHolders` reads
        // `h.group` and writes it into the event's `file`. A holder group is a bare
        // DIRECTORY with no trailing separator (or a single file), which is why the
        // product matches it twice — once with a separator appended, once as-is.
        // Calling the field `path` here would have recorded a shape no provider
        // returns, and the harness would then have replayed an empty tick forever.
        if (!isNonEmptyString(h.group)) fail(`holders[${i}].group must be a non-empty string`);
        // Optional, and carried verbatim when present: the provider may already know
        // why a group is sensitive, and `_scanRmHolders` prefers `h.reason` over
        // re-classifying. Absent is not empty — an absent reason means the provider
        // said nothing, and the product then classifies the group itself.
        if (h.reason !== undefined && !isNonEmptyString(h.reason)) {
          fail(`holders[${i}].reason must be a non-empty string when present`);
        }
      }
    },
  }),
  'net.tick': Object.freeze({
    observation: true,
    summary: 'one TCP table read plus the DNS answers that resolved its addresses',
    inputFields: Object.freeze(['tcp', 'dns']),
    validateInput(input, fail) {
      if (!Array.isArray(input.tcp)) fail('tcp must be an array');
      for (const [i, c] of input.tcp.entries()) {
        if (!isObject(c)) fail(`tcp[${i}] must be an object`);
        if (!isPidLike(c.pid)) fail(`tcp[${i}].pid must be a non-negative integer`);
        if (!isNonEmptyString(c.ip)) fail(`tcp[${i}].ip must be a non-empty string`);
        if (!Number.isSafeInteger(c.port)) fail(`tcp[${i}].port must be an integer`);
        if (!isNonEmptyString(c.state)) fail(`tcp[${i}].state must be a non-empty string`);
      }
      if (!isObject(input.dns)) fail('dns must be an object keyed by address');
      for (const [ip, answer] of Object.entries(input.dns)) {
        if (!isObject(answer)) fail(`dns[${ip}] must be an object`);
        // `reverse` and `forward` are RECORDED ANSWERS, and an answer may legitimately
        // be "the lookup threw". `null` says that; `[]` says the resolver replied with
        // nothing. The two are different observations and neither stands in for the other.
        for (const side of ['reverse', 'forward']) {
          const v = answer[side];
          if (v !== null && !(Array.isArray(v) && v.every(isNonEmptyString))) {
            fail(`dns[${ip}].${side} must be null or an array of non-empty strings`);
          }
        }
      }
    },
  }),
  'clock.advance': Object.freeze({
    observation: false,
    summary: 'the virtual clock is moved forward — a replay parameter, not an observation',
    inputFields: Object.freeze(['toEpochMs']),
    validateInput(input, fail) {
      if (!Number.isSafeInteger(input.toEpochMs) || input.toEpochMs < 0) {
        fail('toEpochMs must be a non-negative safe integer');
      }
    },
  }),
  'population.set': Object.freeze({
    observation: false,
    summary: 'the agent population the sensors are handed from this record onward',
    inputFields: Object.freeze(['agents']),
    validateInput(input, fail) {
      if (!Array.isArray(input.agents)) fail('agents must be an array');
      for (const [i, a] of input.agents.entries()) {
        if (!isObject(a)) fail(`agents[${i}] must be an object`);
        if (!isNonEmptyString(a.agent)) fail(`agents[${i}].agent must be a non-empty string`);
        if (!isPidLike(a.pid)) fail(`agents[${i}].pid must be a non-negative integer`);
        // `instanceId` is carried VERBATIM and never parsed — reconstructing an instant
        // out of an identity string would be a derivation dressed as an observation
        // (`src/main/process-identity.js` `readInstanceId`). `null` is a real value: an
        // agent the scan never stamped has no key, and inventing one is worse than none.
        if (a.instanceId !== null && !isNonEmptyString(a.instanceId)) {
          fail(`agents[${i}].instanceId must be a non-empty string or null`);
        }
      }
    },
  }),
});

/** @type {ReadonlyArray<string>} Every legal `bench.kind`, in declaration order. */
const KIND_NAMES = Object.freeze(Object.keys(RECORD_KINDS));

/**
 * A coupling a trace author has to know about, and it is NOT an ordering rule.
 *
 * `scanHotFileHolders` and `scanAllFileHandles` share `_state.knownHandles`, so a
 * hold one of them already reported will not re-fire from the other — the product
 * says so itself (`src/main/file-watcher.js`, `scanHotFileHolders`: "Shares
 * _state.knownHandles with the full scan → cross-cycle dedup"). A tick that carries a
 * path an earlier tick already carried therefore produces NOTHING, and that silence
 * is the product working, not the trace failing.
 *
 * Recorded as a note rather than enforced, because there is nothing here to refuse:
 * the two kinds are independent. `scanAllFileHandles` diverts to the Restart Manager
 * only when `_getSensitiveHolders` is set (`rmEnabled`), phase 1 never injects it —
 * see a header's `scope.rmFullPath` — and `isHotReadScanActive` reads only
 * `_getHotSensitiveHolders`. So the two may appear in either order, and a rule saying
 * otherwise would be guarding a constraint this path does not have.
 * @type {string}
 */
const SHARED_HANDLE_STATE_NOTE =
  'handles.tick and rm.hot.tick share _state.knownHandles, so a path one tick already ' +
  'reported produces no event from the other';

/**
 * The ECS envelope a record of this kind must carry.
 *
 * ONE definition, used by the writer to build a record and by the reader to check
 * that a record's envelope still agrees with the kind it declares. A record whose
 * envelope disagrees is malformed, not merely odd: a consumer that reads ECS fields
 * would then be told a different thing from what `bench.kind` dispatches on.
 * @param {string} kind - One of {@link KIND_NAMES}.
 * @param {Object} input - The record's `bench.input`.
 * @returns {{kind: string, category?: string[], type?: string[], action: string}}
 */
function ecsEnvelopeFor(kind, input) {
  switch (kind) {
    case 'fs.event': {
      const mapped = FS_ACTIONS[input.action];
      // Total by construction: a caller that skipped {@link validateInput} must get the
      // refusal this format declares, never a TypeError from an undefined lookup.
      if (!mapped) {
        return refuse(
          REFUSAL.RECORD_MALFORMED,
          `fs.event: action ${JSON.stringify(input.action)} is not one of ` +
            `${Object.keys(FS_ACTIONS).join(', ')} — the watcher emits no fourth action`,
        );
      }
      return { kind: 'event', category: ['file'], type: [mapped.type], action: mapped.action };
    }
    case 'handles.tick':
      return { kind: 'event', category: ['file'], type: ['access'], action: 'handle-scan-tick' };
    case 'rm.hot.tick':
      return { kind: 'event', category: ['file'], type: ['access'], action: 'rm-hot-tick' };
    case 'net.tick':
      return {
        kind: 'event',
        category: ['network'],
        type: ['connection'],
        action: 'tcp-scan-tick',
      };
    case 'clock.advance':
      return { kind: 'state', action: 'clock-advanced' };
    case 'population.set':
      return { kind: 'state', action: 'population-set' };
    default:
      return refuse(REFUSAL.UNKNOWN_KIND, `no ECS envelope is defined for kind ${kind}`);
  }
}

/**
 * Validate one record's `bench.input` against the shape its kind declares.
 *
 * Split out of {@link validateRecord} because the WRITER has to run it before it
 * builds anything: an ECS envelope is derived FROM the input, so building first and
 * validating after would let a malformed input crash the derivation instead of being
 * refused by name.
 * @param {string} kind - One of {@link KIND_NAMES}.
 * @param {*} input - The candidate `bench.input`.
 * @param {string} label - Prefix for the message, e.g. a line number.
 * @returns {void}
 * @throws {TraceError} `unknown-kind` or `record-malformed`.
 */
function validateInput(kind, input, label) {
  if (!Object.prototype.hasOwnProperty.call(RECORD_KINDS, kind)) {
    refuse(
      REFUSAL.UNKNOWN_KIND,
      `${label}bench.kind ${JSON.stringify(kind)} is outside the closed list ` +
        `[${KIND_NAMES.join(', ')}]`,
    );
  }
  if (!isObject(input)) {
    refuse(REFUSAL.RECORD_MALFORMED, `${label}bench.input must be an object`);
  }
  const spec = RECORD_KINDS[kind];
  /** @param {string} why @returns {never} */
  const fail = (why) => refuse(REFUSAL.RECORD_MALFORMED, `${label}${kind}: ${why}`);
  for (const field of spec.inputFields) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) fail(`input.${field} is absent`);
  }
  spec.validateInput(input, fail);
}

/**
 * Validate one record's `bench` block and ECS envelope.
 * @param {*} record - A parsed trace line.
 * @param {number} line - 0-based line number, for the message.
 * @returns {Object} The same record, once accepted.
 * @throws {TraceError} With a reason from {@link REFUSAL}.
 */
function validateRecord(record, line) {
  if (!isObject(record) || !isObject(record.bench)) {
    refuse(REFUSAL.RECORD_MALFORMED, `line ${line}: a trace record must carry a bench block`);
  }
  const { kind, input } = record.bench;
  validateInput(kind, input, `line ${line}: `);
  if (!isNonEmptyString(record['@timestamp'])) {
    refuse(REFUSAL.RECORD_MALFORMED, `line ${line}: @timestamp must be a non-empty string`);
  }

  const envelope = ecsEnvelopeFor(kind, input);
  const actual = record.event;
  if (!isObject(actual) || hashchain.canonical(actual) !== hashchain.canonical(envelope)) {
    refuse(
      REFUSAL.ENVELOPE_MISMATCH,
      `line ${line}: the ECS envelope does not match kind ${kind} — recorded ` +
        `${hashchain.canonical(actual)}, expected ${hashchain.canonical(envelope)}`,
    );
  }
  return record;
}

/**
 * A trace record's chain hash.
 *
 * The preimage is the record WITHOUT its `hash` — and, unlike the audit chain, WITH
 * its sequence number, which lives at `bench.seq` and is therefore bound into the
 * hash. That is the second of the two things that keep a trace chain and an audit
 * chain apart; the first is the seed. See the file header.
 * @param {string} prevHash - The previous record's hash, or {@link TRACE_GENESIS}.
 * @param {Object} record - A record, with or without `hash`.
 * @returns {string} Hex-encoded SHA-256.
 */
function recordHash(prevHash, record) {
  const preimage = { ...record };
  delete preimage.hash;
  return hashchain.computeHash(prevHash, preimage);
}

module.exports = {
  ECS_VERSION,
  FS_ACTIONS,
  HEADER_FILENAME,
  KIND_NAMES,
  RECORD_KINDS,
  REFUSAL,
  REFUSAL_REASONS,
  REPO_ROOT,
  SHARED_HANDLE_STATE_NOTE,
  TRACE_FILENAME,
  TRACE_GENESIS,
  TRACE_SCHEMA_VERSION,
  TraceError,
  ecsEnvelopeFor,
  // Shared with ./environment.js, which compares a header against a tree and needs
  // the same notion of "refuse" and the same primitive checks. Exported rather than
  // duplicated: two definitions of what an object is would drift.
  isNonEmptyString,
  isObject,
  recordHash,
  refuse,
  validateInput,
  validateRecord,
};
