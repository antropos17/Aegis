/**
 * @file bench/trace/environment.js
 * @module bench/trace/environment
 * @description What a trace PINS about the machine and the tree it was recorded
 *   against, and the comparison that refuses a replay the recording cannot speak for.
 *
 *   Split from `./schema.js` because the two answer different questions. The schema
 *   says what a trace IS — its version, its kinds, its chain. This says what a trace
 *   silently DEPENDS ON: the platform whose path rules the attribution branches on,
 *   the time zone the audit file's own name is built from, the rules whose first match
 *   decides a reason, the closed evidence list, the settings. None of it is visible in
 *   a record, and all of it changes a verdict.
 *
 *   EVERYTHING HERE IS READ, NEVER ASSUMED. A probe that cannot establish a fact makes
 *   the call throw rather than substituting a plausible one: a header compared against
 *   a half-observed environment would agree for the wrong reason, which is worse than
 *   refusing.
 *
 *   DIGESTS, NOT VERSIONS. A version string goes stale silently — the failure
 *   ai-mistakes #24 is about — so what is pinned is content. What that content digest
 *   does and does not cover is stated at {@link foldLineEndings}, because a digest
 *   whose normalization is unwritten is a digest nobody can argue with.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const hashchain = require('../../src/main/audit-hashchain');
const attribution = require('../../src/main/attribution');
const ruleLoader = require('../../src/main/rule-loader');

const {
  REFUSAL,
  REPO_ROOT,
  TRACE_SCHEMA_VERSION,
  isNonEmptyString,
  isObject,
  refuse,
} = require('./schema');

/**
 * The questions a header's `scope` block must answer in this version.
 *
 * Each is answered in the manifest's own convention — `{value: null, unavailable}` —
 * because "this trace does not cover process ticks" and "nobody said" must not
 * collapse into the same record. A missing key is a refusal, not a default.
 * @type {ReadonlyArray<string>}
 */
const REQUIRED_SCOPE_KEYS = Object.freeze(['processTicks', 'anomalyAlerts', 'rmFullPath']);
/**
 * Fold line endings so a digest names CONTENT rather than a checkout's line-ending
 * configuration.
 *
 * `.gitattributes` puts this tree under `text=auto`, so the same commit can land on
 * disk as CRLF on one clone and LF on another. A byte digest would then refuse a
 * trace that names exactly the rules the tree holds. Nothing else is normalized —
 * not whitespace, not case, not Unicode form — so any real edit still moves the
 * digest.
 * @param {Buffer} bytes
 * @returns {string}
 */
function foldLineEndings(bytes) {
  return bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * sha256 of a file's content with line endings folded. See {@link foldLineEndings}
 * for exactly what that covers and what it does not.
 * @param {string} filePath - Absolute path.
 * @returns {string} Hex digest.
 */
function digestFile(filePath) {
  return crypto
    .createHash('sha256')
    .update(foldLineEndings(fs.readFileSync(filePath)))
    .digest('hex');
}

/**
 * The repo-relative source files a trace pins, for the platform it was recorded on.
 *
 * The platform module is chosen the way `src/main/platform/index.js` chooses it —
 * win32 and darwin by name, everything else linux — so the digest names the file
 * that would actually be loaded rather than a file that happens to exist.
 * @param {string} platform - A `process.platform` value.
 * @returns {string[]} Repo-relative paths, in a stable order.
 */
function pinnedSourceFiles(platform) {
  const platformModule =
    platform === 'win32' ? 'win32.js' : platform === 'darwin' ? 'darwin.js' : 'linux.js';
  return [
    'src/main/attribution.js',
    'src/shared/constants.js',
    `src/main/platform/${platformModule}`,
  ];
}

/**
 * Digest the detection rules as the PRODUCT COMPILES THEM, not as YAML.
 *
 * Three things are recorded, and they answer three different questions:
 *   - `loadOrder` — the file order `fs.readdirSync` handed the loader. It is not
 *     decoration: `classifySensitive` takes the FIRST matching rule, so two trees
 *     holding identical rules in a different enumeration order can disagree about
 *     one path's reason.
 *   - `files` / `schemaFile` — per-file content digests, so a mismatch can be
 *     located instead of merely reported.
 *   - `compiled` — a digest over the rule objects the loader produced, in load
 *     order: id, pattern source and flags, reason, category, risk, enabled,
 *     platform. This is the one that actually gates a verdict, and it is immune to
 *     YAML formatting.
 *
 * `_loadRules` is used rather than `getAllRules` because it is the entry point that
 * does NOT populate the module-level cache: observing an environment must not change
 * it. It is marked "exposed for testing only" in `src/main/rule-loader.js`; a harness
 * is the same kind of caller, and if that export ever goes away this fails loudly at
 * require time rather than digesting something else.
 * @param {string} rulesDir - Absolute path to the rules directory.
 * @returns {{loadOrder: string[], files: Object<string, string>, schemaFile: string|null,
 *   compiled: string}}
 */
function digestRules(rulesDir) {
  const names = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  /** @type {Object<string, string>} */
  const files = {};
  for (const name of names) files[name] = digestFile(path.join(rulesDir, name));

  const schemaPath = path.join(rulesDir, '_schema.json');
  const schemaFile = fs.existsSync(schemaPath) ? digestFile(schemaPath) : null;

  const compiledRules = [...ruleLoader._loadRules(rulesDir).values()].map((r) => ({
    id: r.id,
    pattern: r.pattern.source,
    flags: r.pattern.flags,
    reason: r.reason,
    category: r.category,
    risk: r.risk,
    enabled: r.enabled,
    platform: r.platform,
  }));
  const compiled = crypto
    .createHash('sha256')
    .update(hashchain.canonical(compiledRules))
    .digest('hex');

  return { loadOrder: names, files, schemaFile, compiled };
}

/**
 * Observe the environment a replay would run against.
 *
 * Everything here is READ, never assumed: a fact the probe cannot establish is not
 * substituted with a plausible one, it makes the call throw, because a header
 * compared against a half-observed environment would agree for the wrong reason.
 * @param {Object} [opts]
 * @param {string} [opts.repoRoot] - Tree to observe. Defaults to this checkout.
 * @param {number} [opts.clockEpochMs] - Instant the UTC offset is read at. The offset
 *   is a property of an INSTANT, not of a zone (DST), so it is meaningless without
 *   one. Defaults to the current instant.
 * @returns {Object} The observed environment, in the header's own shape.
 */
function observeEnvironment(opts = {}) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const at = opts.clockEpochMs != null ? opts.clockEpochMs : Date.now();
  const agentDbPath = path.join(repoRoot, 'src', 'shared', 'agent-database.json');
  const agentDb = JSON.parse(fs.readFileSync(agentDbPath, 'utf8'));

  /** @type {Object<string, string>} */
  const sources = {};
  for (const rel of pinnedSourceFiles(process.platform)) {
    sources[rel] = digestFile(path.join(repoRoot, rel));
  }

  return {
    platform: process.platform,
    pathSep: path.sep,
    nodeVersion: process.version,
    tz: {
      name: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offsetMinutesAt: new Date(at).getTimezoneOffset(),
      offsetReadAtEpochMs: at,
    },
    digests: {
      algorithm: 'sha256',
      normalization:
        'CRLF and lone CR are folded to LF before hashing, so a checkout with other line ' +
        'endings names the same content; nothing else is normalized',
      rules: digestRules(path.join(repoRoot, 'rules')),
      agentDatabase: {
        version: agentDb.version,
        lastUpdated: agentDb.lastUpdated,
        sha256: digestFile(agentDbPath),
      },
      sources,
      // Declaration order, compared element-for-element. A reordering changes no
      // verdict, but it IS a change to a closed list the format pins, and a format
      // that quietly tolerated one would have no way to report the change that does
      // matter — a code added or removed.
      evidenceCodes: [...attribution.EVIDENCE_CODES],
    },
  };
}

/**
 * Compare a header against an observed environment and refuse on any disagreement.
 *
 * Structure first, then environment: a malformed header is reported as malformed
 * rather than as a mismatch, because the two send a reader to different places.
 * @param {*} header - The parsed `trace.header.json`.
 * @param {Object} env - The result of {@link observeEnvironment}.
 * @returns {Object} The same header, once it has been accepted.
 * @throws {TraceError} With a reason from {@link REFUSAL}.
 */
function validateHeader(header, env) {
  if (!isObject(header)) {
    refuse(REFUSAL.HEADER_MALFORMED, 'the trace header is not a JSON object');
  }
  if (header.traceSchemaVersion !== TRACE_SCHEMA_VERSION) {
    refuse(
      REFUSAL.SCHEMA_VERSION,
      `the trace declares traceSchemaVersion ${JSON.stringify(header.traceSchemaVersion)} and ` +
        `this reader speaks version ${TRACE_SCHEMA_VERSION} — a trace is an INPUT, and a ` +
        'partially understood input produces a verdict about some other input',
    );
  }
  if (!isNonEmptyString(header.id)) {
    refuse(REFUSAL.HEADER_MALFORMED, 'header.id must be a non-empty string');
  }
  if (!isObject(header.clock) || !Number.isSafeInteger(header.clock.epochMs)) {
    refuse(REFUSAL.HEADER_MALFORMED, 'header.clock.epochMs must be a safe integer');
  }
  if (!isObject(header.neutralization)) {
    refuse(REFUSAL.HEADER_MALFORMED, 'header.neutralization must be an object');
  }
  if (!isObject(header.tz) || !isNonEmptyString(header.tz.name)) {
    refuse(REFUSAL.HEADER_MALFORMED, 'header.tz.name must be a non-empty string');
  }
  if (!isObject(header.digests)) {
    refuse(REFUSAL.HEADER_MALFORMED, 'header.digests must be an object');
  }

  if (!isObject(header.scope)) {
    refuse(REFUSAL.SCOPE_INCOMPLETE, 'header.scope must be an object');
  }
  for (const key of REQUIRED_SCOPE_KEYS) {
    const entry = header.scope[key];
    if (!isObject(entry) || !('value' in entry)) {
      refuse(
        REFUSAL.SCOPE_INCOMPLETE,
        `header.scope.${key} is absent — a question this version requires an answer to must be ` +
          'answered as {value, unavailable}, and a missing key is not a default',
      );
    }
    if (entry.value === null && !isNonEmptyString(entry.unavailable)) {
      refuse(
        REFUSAL.SCOPE_INCOMPLETE,
        `header.scope.${key} is null without a reason — an absent fact is recorded WITH why`,
      );
    }
  }

  if (header.platform !== env.platform) {
    refuse(
      REFUSAL.PLATFORM_MISMATCH,
      `the trace was recorded on ${header.platform} and this process runs on ${env.platform} — ` +
        'path resolution, the separator and the win32 branch of findOwningAgent all differ, so ' +
        'the replay would only look faithful',
    );
  }
  if (header.tz.name !== env.tz.name) {
    refuse(
      REFUSAL.TZ_MISMATCH,
      `the trace was recorded in ${header.tz.name} and this process runs in ${env.tz.name} — ` +
        "the audit file's name and the baseline hour bucket are both read off local time",
    );
  }

  const expected = env.digests;
  const got = header.digests;
  if (
    !Array.isArray(got.evidenceCodes) ||
    !arraysEqual(got.evidenceCodes, expected.evidenceCodes)
  ) {
    refuse(
      REFUSAL.EVIDENCE_CODES_MISMATCH,
      `the trace pins the evidence codes [${asList(got.evidenceCodes)}] and this tree declares ` +
        `[${asList(expected.evidenceCodes)}]`,
    );
  }
  for (const [label, a, b] of digestPairs(got, expected)) {
    if (a !== b) {
      refuse(
        REFUSAL.DIGEST_MISMATCH,
        `${label}: the trace pins ${JSON.stringify(a)} and this tree holds ${JSON.stringify(b)}`,
      );
    }
  }
  return header;
}

/** @param {*} v @returns {string} A readable rendering of a list that may not be one. */
function asList(v) {
  return Array.isArray(v) ? v.join(', ') : JSON.stringify(v);
}

/** @param {*} a @param {*} b @returns {boolean} Element-for-element equality. */
function arraysEqual(a, b) {
  return (
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
  );
}

/**
 * Every comparable digest pair, flattened to `[label, recorded, observed]`.
 *
 * The rules load ORDER is compared as a joined string rather than ignored: it
 * decides which of two matching rules answers first, so a tree that holds the same
 * files in a different enumeration order is a different tree for this purpose.
 * @param {Object} recorded - `header.digests`.
 * @param {Object} observed - `env.digests`.
 * @returns {Array<[string, *, *]>}
 */
function digestPairs(recorded, observed) {
  /** @type {Array<[string, *, *]>} */
  const pairs = [];
  const rr = isObject(recorded.rules) ? recorded.rules : {};
  const or = observed.rules;
  pairs.push(['rules.loadOrder', asList(rr.loadOrder), asList(or.loadOrder)]);
  pairs.push(['rules.compiled', rr.compiled, or.compiled]);
  pairs.push(['rules.schemaFile', rr.schemaFile, or.schemaFile]);
  for (const name of or.loadOrder) {
    pairs.push([
      `rules.files[${name}]`,
      isObject(rr.files) ? rr.files[name] : undefined,
      or.files[name],
    ]);
  }
  const ra = isObject(recorded.agentDatabase) ? recorded.agentDatabase : {};
  pairs.push(['agentDatabase.sha256', ra.sha256, observed.agentDatabase.sha256]);
  pairs.push(['agentDatabase.version', ra.version, observed.agentDatabase.version]);
  for (const [rel, digest] of Object.entries(observed.sources)) {
    pairs.push([
      `sources[${rel}]`,
      isObject(recorded.sources) ? recorded.sources[rel] : undefined,
      digest,
    ]);
  }
  return pairs;
}

module.exports = {
  REQUIRED_SCOPE_KEYS,
  digestFile,
  digestPairs,
  digestRules,
  foldLineEndings,
  observeEnvironment,
  pinnedSourceFiles,
  validateHeader,
};
