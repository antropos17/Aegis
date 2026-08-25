// @ts-check
'use strict';

/**
 * @file sequence-rule-loader.js
 * @module main/sequence-rule-loader
 * @description Loads the SEQUENCE ruleset — `rules/sequences/*.yaml|*.yml`, multi-document
 *   YAML holding base detection documents plus the correlation documents that order them.
 *   The accepted format is a deliberately small subset of Sigma correlations: `temporal_ordered`
 *   only, grouped by `process.entity_id` only, over the ECS view `src/shared/ecs-normalizer.js`
 *   projects (`docs/ECS-MAPPING.md` §4 is the field dictionary).
 *
 *   NOTHING CONSUMES THIS YET. The rule file exists — `rules/sequences/sequences.yaml` with
 *   SEQ001, since PR #309 — and so does the §2 state machine, but no production caller loads
 *   the one into the other: the format and its refusals were fixed first, on the ecs-normalizer
 *   precedent (PR #294), and the wiring is roadmap §7 block 3.
 *   The top-level `rules/` gates are untouched by the subdirectory: `rule-loader.js` reads one
 *   level of `rules/` filtered on `.yaml`/`.yml`, and so do the parity baseline and
 *   `scripts/counts.js` `deriveRules()` — a directory entry named `sequences` passes none of them.
 *
 *   REJECTION IS PER FILE, NEVER PER RULE. A file that trips any reason contributes zero rules:
 *   a correlation is a claim about ORDER between documents that were written together, so a
 *   partially-loaded file would silently detect something nobody wrote. Every reason emits one
 *   `logger.warn('sequence-loader', message, { rule, step, reason })` line and increments
 *   `loadErrors`; the reason CODE is the stable half and the message is the operator half.
 *
 *   A WARNING IS NOT A REJECTION. Two warnings describe rules that load and run, and say what
 *   they will and will not see — the dedup window in front of the file carrier, and the events
 *   whose `process.entity_id` is absent so the group-by can never bucket them.
 *
 *   BOUNDS, STATED RATHER THAN IMPLIED. (a) Duplicate detection is WITHIN a file — two files
 *   declaring the same `SEQ` id both load, because rejection is per file and neither file is
 *   the wrong one. (b) A selection says which events a step accepts and nothing about how many
 *   there are: a rule whose steps are satisfiable can still never fire in practice, and only the
 *   two warnings below make any statement about that. (c) `loadErrors` counts REASONS, not files.
 * @requires fs
 * @requires path
 * @requires js-yaml
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.14.0
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('./logger');

/** Logger module tag — every line this file emits carries it. @type {string} */
const LOG_MODULE = 'sequence-loader';

/** @type {string} */
const DEFAULT_SEQUENCES_DIR = path.join(__dirname, '..', '..', 'rules', 'sequences');

/** The reference key a correlation names. @type {RegExp} */
const NAME_PATTERN = /^[a-z0-9_]+$/;

/**
 * A documented departure from Sigma's UUID: the id is also the stats key and the audit
 * `action`, both of which a human reads.
 * @type {RegExp}
 */
const ID_PATTERN = /^SEQ[0-9]{3}$/;

/** @type {RegExp} */
const TIMESPAN_PATTERN = /^[0-9]+[smhd]$/;

/** @type {Readonly<Record<string, number>>} */
const TIMESPAN_UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

/** @type {number} */
const MIN_TIMESPAN_MS = 1000;

/** 24h. Above it a `<pid>:u` key (the linux/darwin steady state) stops being pid-reuse-safe. */
const MAX_TIMESPAN_MS = 24 * 3600 * 1000;

/** @type {ReadonlySet<string>} */
const LEVELS = new Set(['informational', 'low', 'medium', 'high', 'critical']);

/** @type {string} */
const DEFAULT_LEVEL = 'medium';

/** The one accepted correlation type. @type {string} */
const ACCEPTED_TYPE = 'temporal_ordered';

/** The one accepted `group-by` key — and the reason `process.entity_id` is banned in a selection. */
const GROUP_BY_FIELD = 'process.entity_id';

/** @type {ReadonlySet<string>} */
const BASE_KEYS = new Set(['title', 'name', 'id', 'logsource', 'detection']);

/** @type {ReadonlySet<string>} */
const CORRELATION_KEYS = new Set(['title', 'id', 'level', 'status', 'description', 'correlation']);

/** `aliases`, `condition` and `generate` are refused BY NAME below, so they are not listed here. */
const CORRELATION_BODY_KEYS = new Set(['type', 'rules', 'group-by', 'timespan']);

/**
 * The closed field dictionary, per `logsource.category`. Taken from `docs/ECS-MAPPING.md` §4:
 * a field absent from the row a category emits can never be satisfied by an event of that
 * category, so a selection naming one is refused rather than silently never matching.
 * Internal fields the normalizer does not map (`sensitive`, `verdict`, `severity` — §6) are
 * absent on purpose: "a sensitive file" is written as a regex over `file.path`.
 * @type {Readonly<Record<string, ReadonlySet<string>>>}
 */
const CATEGORY_FIELDS = {
  file: new Set([
    'event.action',
    'event.type',
    'file.path',
    'process.working_directory',
    'process.pid',
    'aegis.agent.name',
    'aegis.attribution.status',
  ]),
  network: new Set([
    'destination.ip',
    'destination.port',
    'destination.domain',
    'process.working_directory',
    'aegis.agent.name',
  ]),
  process: new Set(['event.action', 'process.name', 'process.pid', 'aegis.agent.name']),
};

/**
 * `event.action` is a closed union per category (ECS-MAPPING §3), so a value outside it is
 * as unsatisfiable as a field outside the dictionary — and the message names the VALUE, which
 * is what tells the two sub-cases apart in the log.
 * @type {Readonly<Record<string, ReadonlySet<string>>>}
 */
const CATEGORY_ACTIONS = {
  file: new Set([
    'file-created',
    'file-modified',
    'file-deleted',
    'file-accessed',
    'file-handle-held',
  ]),
  process: new Set(['agent-enter', 'agent-exit']),
};

/** Every field any category emits — membership here separates "unknown" from "wrong category". */
const KNOWN_FIELDS = new Set(Object.values(CATEGORY_FIELDS).flatMap((set) => [...set]));

/**
 * Accepted modifier chains, joined by `|`. `re|i` is the only two-token chain: the `i` flag is
 * pinned onto the RegExp at compile time, so a matcher never carries a mutable flag.
 * @type {ReadonlySet<string>}
 */
const MODIFIERS = new Set(['contains', 'startswith', 'endswith', 're', 're|i']);

/** The attribution status whose events carry no `instanceId` at all (C-01, file-watcher.js). */
const UNATTRIBUTED = 'unattributed';

/** Categories whose carrier may hold a null `instanceId` under Event Schema v1. */
const NULLABLE_KEY_CATEGORIES = new Set(['file', 'network']);

/**
 * @typedef {(doc: Record<string, unknown>) => boolean} StepMatcher
 *   A compiled predicate over ONE ECS document, as `normalizeToEcs` emits it. Absent fields are
 *   absent (never `null`), so a step that names a field the document lacks answers `false`.
 */

/**
 * @typedef {object} SequenceStep
 * @property {string} name - the base document's `name`, the reference key a correlation uses.
 * @property {string} category - `file` | `network` | `process`, from its `logsource`.
 * @property {StepMatcher} matcher - the compiled selection.
 */

/**
 * @typedef {object} SequenceRule
 * @property {string} id - `^SEQ[0-9]{3}$`.
 * @property {string} title
 * @property {string} level - `informational` … `critical`; `medium` when the document omits it.
 * @property {number} timespanMs - the window, already in milliseconds.
 * @property {SequenceStep[]} steps - 2 to 5, in the order the correlation lists them.
 */

/**
 * @typedef {object} SequenceNotice
 * @property {string|null} rule - the correlation id, or null when the defect is not inside one.
 * @property {string|null} step - the base document name, or null when it is not about one step.
 * @property {string} reason - the stable code.
 * @property {string} message - the operator-facing line, prefixed with the file name.
 */

/**
 * @typedef {object} SequenceLoadResult
 * @property {SequenceRule[]} rules - every rule from every accepted file.
 * @property {SequenceNotice[]} warnings - rules that LOADED, with what they will not see.
 * @property {number} loadErrors - one per rejection REASON, not per rejected file.
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function _isMap(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function _isText(v) {
  return typeof v === 'string' && v !== '';
}

/**
 * A YAML scalar a selection may compare against. An object or a null is neither a value nor a
 * list of them, and is refused as a shape defect rather than coerced.
 * @param {unknown} v
 * @returns {v is string|number|boolean}
 */
function _isScalar(v) {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * Collects the reasons one file produced. The whole file is skipped when it is non-empty.
 * @typedef {object} Sink
 * @property {SequenceNotice[]} errors
 * @property {SequenceNotice[]} warnings
 * @property {string} file
 */

/**
 * @param {Sink} sink
 * @param {string} reason
 * @param {string} detail - the sentence after the file name.
 * @param {{rule?: string|null, step?: string|null}} [where]
 * @returns {void}
 */
function _reject(sink, reason, detail, where) {
  sink.errors.push({
    rule: (where && where.rule) || null,
    step: (where && where.step) || null,
    reason,
    message: `${sink.file}: ${detail}`,
  });
}

/**
 * `where` is REQUIRED here and optional on {@link _reject}, and the difference is real rather
 * than an oversight: a warning is only ever raised about a rule that loaded, so its id always
 * exists, while a rejection can happen before any document has been read (a YAML parse failure
 * names no rule at all).
 * @param {Sink} sink
 * @param {string} reason
 * @param {string} detail
 * @param {{rule: string, step?: string|null}} where
 * @returns {void}
 */
function _warn(sink, reason, detail, where) {
  sink.warnings.push({
    rule: where.rule,
    step: where.step || null,
    reason,
    message: `${sink.file}: ${detail}`,
  });
}

/**
 * Walks a dotted ECS path. Returns `undefined` for every absence — a missing branch, a
 * non-object in the middle, or a missing leaf — because the ECS view omits what it did not
 * observe and never writes `null` in its place.
 * @param {Record<string, unknown>} doc
 * @param {string} field
 * @returns {unknown}
 */
function _lookup(doc, field) {
  /** @type {unknown} */
  let cursor = doc;
  for (const part of field.split('.')) {
    if (!_isMap(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Case-folded text for a scalar comparison. Sigma compares string representations, so `443`
 * and `'443'` are the same value; anything that is not a scalar has no representation to
 * compare and is refused by the caller instead.
 * @param {string|number|boolean} v
 * @returns {string}
 */
function _fold(v) {
  return String(v).toLowerCase();
}

/**
 * One value's predicate. The RegExp is built ONCE here and its flags are pinned: no `g`, so no
 * `lastIndex` survives between events, and `i` only when the author wrote `re|i`.
 * @param {string} modifier - `''` for an unmodified value.
 * @param {string|number|boolean} value
 * @returns {(actual: unknown) => boolean}
 */
function _predicate(modifier, value) {
  if (modifier === 're' || modifier === 're|i') {
    const re = new RegExp(String(value), modifier === 're|i' ? 'i' : '');
    return (actual) => _isScalar(actual) && re.test(String(actual));
  }
  const wanted = _fold(value);
  if (modifier === 'contains') return (a) => _isScalar(a) && _fold(a).includes(wanted);
  if (modifier === 'startswith') return (a) => _isScalar(a) && _fold(a).startsWith(wanted);
  if (modifier === 'endswith') return (a) => _isScalar(a) && _fold(a).endsWith(wanted);
  return (a) => _isScalar(a) && _fold(a) === wanted;
}

/**
 * Splits `file.path|re|i` into its field and its modifier chain.
 * @param {string} key
 * @returns {{field: string, modifier: string}}
 */
function _splitKey(key) {
  const cut = key.indexOf('|');
  if (cut === -1) return { field: key, modifier: '' };
  return { field: key.slice(0, cut), modifier: key.slice(cut + 1) };
}

/**
 * Compiles one `field: value` pair into a test over an ECS document. A list is OR; an array in
 * the DOCUMENT (`event.type` is `['creation']`) is containment, so either side being plural
 * means "any of".
 *
 * ABSENCE IS DECIDED IN ONE PLACE — the `_isScalar` guard inside every predicate. An absent
 * field arrives here as `undefined` and becomes the single candidate `[undefined]`, which no
 * predicate accepts; a second early return for it would read as the mechanism while changing
 * nothing, and a reader would then maintain the wrong one (ai-mistakes #27).
 * @param {string} field
 * @param {string} modifier
 * @param {Array<string|number|boolean>} values
 * @returns {StepMatcher}
 */
function _compilePair(field, modifier, values) {
  const preds = values.map((v) => _predicate(modifier, v));
  return (doc) => {
    const actual = _lookup(doc, field);
    const candidates = Array.isArray(actual) ? actual : [actual];
    return preds.some((p) => candidates.some((c) => p(c)));
  };
}

/**
 * The selection as one predicate: every pair must hold (AND).
 * @param {Record<string, unknown>} selection
 * @returns {StepMatcher}
 */
function _compileSelection(selection) {
  /** @type {StepMatcher[]} */
  const tests = [];
  for (const [key, raw] of Object.entries(selection)) {
    const { field, modifier } = _splitKey(key);
    const values = (Array.isArray(raw) ? raw : [raw]).filter(_isScalar);
    tests.push(_compilePair(field, modifier, values));
  }
  return (doc) => tests.every((t) => t(doc));
}

/**
 * Every value a pair accepts, or `null` when the pair is not a scalar/list of scalars.
 * @param {unknown} raw
 * @returns {Array<string|number|boolean>|null}
 */
function _valuesOf(raw) {
  if (_isScalar(raw)) return [raw];
  if (Array.isArray(raw) && raw.length > 0 && raw.every(_isScalar)) {
    return /** @type {Array<string|number|boolean>} */ (raw);
  }
  return null;
}

/**
 * Validates one selection against the dictionary for its category. Every defect is reported —
 * a selection with two unknown fields yields two lines, because fixing one of them is not
 * fixing the rule.
 * @param {Sink} sink
 * @param {Record<string, unknown>} selection
 * @param {string} category
 * @param {string} name - the base document's name, for the `step` meta.
 * @returns {void}
 */
function _checkSelection(sink, selection, category, name) {
  const dictionary = CATEGORY_FIELDS[category];
  const where = { step: name };
  for (const [key, raw] of Object.entries(selection)) {
    const { field, modifier } = _splitKey(key);

    if (modifier !== '' && !MODIFIERS.has(modifier)) {
      _reject(
        sink,
        'unsupported-modifier',
        `modifier "|${modifier}" on "${field}" is not supported — accepted: contains, ` +
          `startswith, endswith, re, re|i`,
        where,
      );
      continue;
    }

    if (field === GROUP_BY_FIELD) {
      _reject(
        sink,
        'entity-id-in-selection',
        `field "${GROUP_BY_FIELD}" is forbidden in a selection — it is reserved for group-by`,
        where,
      );
      continue;
    }
    if (!KNOWN_FIELDS.has(field)) {
      _reject(
        sink,
        'unknown-field',
        `field "${field}" is not an ECS field AEGIS produces — see docs/ECS-MAPPING.md`,
        where,
      );
      continue;
    }
    if (!dictionary.has(field)) {
      _reject(
        sink,
        'unsatisfiable-selection',
        `field "${field}" is never produced by logsource category "${category}"`,
        where,
      );
      continue;
    }

    const values = _valuesOf(raw);
    if (values === null) {
      _reject(
        sink,
        'invalid-document',
        `field "${key}" must hold a scalar or a non-empty list of scalars`,
        where,
      );
      continue;
    }

    const actions = CATEGORY_ACTIONS[category];
    if (field === 'event.action' && modifier === '' && actions) {
      for (const v of values) {
        if (!actions.has(String(v))) {
          _reject(
            sink,
            'unsatisfiable-selection',
            `event.action value "${v}" is never produced by logsource category "${category}"`,
            where,
          );
        }
      }
    }

    if (modifier === '') {
      for (const v of values) {
        if (typeof v === 'string' && /[*?]/.test(v)) {
          _reject(
            sink,
            'unmodified-wildcard',
            `field "${field}" holds a wildcard in an unmodified value ("${v}") — ` +
              `use |contains or |re`,
            where,
          );
        }
      }
    }

    if (modifier === 're' || modifier === 're|i') {
      for (const v of values) {
        try {
          new RegExp(String(v), modifier === 're|i' ? 'i' : '');
        } catch (/** @type {*} */ err) {
          _reject(
            sink,
            'invalid-regex',
            `field "${key}" holds an invalid regular expression ("${v}") — ` +
              `${/** @type {Error} */ (err).message}`,
            where,
          );
        }
      }
    }

    // C-01: an unattributed event keeps NO agent and no key at all
    // (`readInstanceId(null)` → null), so a step that accepts nothing else can never be
    // bucketed by the group-by and the rule can never fire. A list holding `unattributed`
    // BESIDE another status still matches attributed events and is left alone.
    if (field === 'aegis.attribution.status' && modifier === '') {
      if (values.every((v) => String(v) === UNATTRIBUTED)) {
        _reject(
          sink,
          'step-without-entity-id',
          `step can only match events without ${GROUP_BY_FIELD}; a ${ACCEPTED_TYPE} rule ` +
            `grouped by ${GROUP_BY_FIELD} can never fire`,
          where,
        );
      }
    }
  }
}

/**
 * Per-document shape validation for a base detection document.
 * @param {Sink} sink
 * @param {Record<string, unknown>} doc
 * @param {number} index - 1-based document position, used when there is no name to point at.
 * @returns {{name: string, category: string, selection: Record<string, unknown>}|null}
 */
function _checkBase(sink, doc, index) {
  const label = _isText(doc.name) ? `"${doc.name}"` : `#${index}`;
  const where = { step: _isText(doc.name) ? doc.name : null };

  for (const key of Object.keys(doc)) {
    if (!BASE_KEYS.has(key)) {
      _reject(sink, 'invalid-document', `base document ${label} holds unknown key "${key}"`, where);
    }
  }
  if (doc.title !== undefined && !_isText(doc.title)) {
    _reject(sink, 'invalid-document', `base document ${label} has a non-string title`, where);
  }
  if (doc.id !== undefined && !_isText(doc.id)) {
    _reject(sink, 'invalid-document', `base document ${label} has a non-string id`, where);
  }
  if (!_isText(doc.name) || !NAME_PATTERN.test(doc.name)) {
    _reject(
      sink,
      'invalid-document',
      `base document ${label} needs a name matching ${NAME_PATTERN.source}`,
      where,
    );
    return null;
  }
  const name = doc.name;

  const logsource = doc.logsource;
  if (
    !_isMap(logsource) ||
    logsource.product !== 'aegis' ||
    !_isText(logsource.category) ||
    !CATEGORY_FIELDS[logsource.category] ||
    Object.keys(logsource).length !== 2
  ) {
    _reject(
      sink,
      'invalid-document',
      `base document "${name}" needs logsource product: aegis plus category: file|network|process`,
      where,
    );
    return null;
  }
  const category = logsource.category;

  const detection = doc.detection;
  if (!_isMap(detection)) {
    _reject(sink, 'invalid-document', `base document "${name}" has no detection`, where);
    return null;
  }
  const selectionNames = Object.keys(detection).filter((k) => k !== 'condition');
  if (selectionNames.length !== 1 || detection.condition !== selectionNames[0]) {
    _reject(
      sink,
      'invalid-document',
      `base document "${name}" needs exactly one named selection and a condition equal to ` +
        `that name`,
      where,
    );
    return null;
  }
  const selection = detection[selectionNames[0]];
  if (!_isMap(selection) || Object.keys(selection).length === 0) {
    _reject(
      sink,
      'invalid-document',
      `base document "${name}" has a selection that is not a non-empty map of fields`,
      where,
    );
    return null;
  }

  _checkSelection(sink, selection, category, name);
  return { name, category, selection };
}

/**
 * `^[0-9]+[smhd]$`, then the 1s–24h bounds. Both halves are separate messages: "5x" is a typo
 * and "48h" is a decision the author has to revisit.
 * @param {Sink} sink
 * @param {unknown} raw
 * @param {{rule: string|null}} where
 * @returns {number|null}
 */
function _checkTimespan(sink, raw, where) {
  if (!_isText(raw) || !TIMESPAN_PATTERN.test(raw)) {
    _reject(
      sink,
      'invalid-timespan',
      `timespan ${JSON.stringify(raw)} does not match ${TIMESPAN_PATTERN.source}`,
      where,
    );
    return null;
  }
  const ms = Number(raw.slice(0, -1)) * TIMESPAN_UNIT_MS[raw.slice(-1)];
  if (ms < MIN_TIMESPAN_MS || ms > MAX_TIMESPAN_MS) {
    _reject(sink, 'invalid-timespan', `timespan "${raw}" is outside the bounds 1s to 24h`, where);
    return null;
  }
  return ms;
}

/**
 * Per-document shape validation for a correlation document. The three refusals Sigma allows and
 * this subset does not — `aliases`, an inner `condition`, `generate` — are named one by one,
 * BEFORE the unknown-key sweep, so the author is told which feature is missing rather than that
 * a key was not recognised.
 * @param {Sink} sink
 * @param {Record<string, unknown>} doc
 * @param {number} index
 * @returns {{id: string, title: string, level: string, timespanMs: number, names: string[]}|null}
 */
function _checkCorrelation(sink, doc, index) {
  const id = _isText(doc.id) ? doc.id : null;
  const label = id !== null ? `"${id}"` : `#${index}`;
  const where = { rule: id };

  for (const key of Object.keys(doc)) {
    if (!CORRELATION_KEYS.has(key)) {
      _reject(sink, 'invalid-document', `correlation ${label} holds unknown key "${key}"`, where);
    }
  }
  if (id === null || !ID_PATTERN.test(id)) {
    _reject(
      sink,
      'invalid-document',
      `correlation ${label} needs an id matching ${ID_PATTERN.source}`,
      where,
    );
    return null;
  }
  if (!_isText(doc.title)) {
    _reject(sink, 'invalid-document', `correlation "${id}" needs a title`, where);
  }
  for (const key of ['status', 'description']) {
    if (doc[key] !== undefined && !_isText(doc[key])) {
      _reject(sink, 'invalid-document', `correlation "${id}" has a non-string ${key}`, where);
    }
  }
  const level = doc.level === undefined ? DEFAULT_LEVEL : doc.level;
  if (!_isText(level) || !LEVELS.has(level)) {
    _reject(
      sink,
      'invalid-document',
      `correlation "${id}" has level ${JSON.stringify(doc.level)} outside ` +
        `informational|low|medium|high|critical`,
      where,
    );
  }

  const body = doc.correlation;
  if (!_isMap(body)) {
    _reject(sink, 'invalid-document', `correlation "${id}" has no correlation body`, where);
    return null;
  }
  if (body.aliases !== undefined) {
    _reject(
      sink,
      'aliases-not-supported',
      `correlation "${id}" uses aliases, not supported`,
      where,
    );
  }
  if (body.condition !== undefined) {
    _reject(
      sink,
      'condition-in-correlation',
      `correlation "${id}" holds a condition, not supported inside a correlation`,
      where,
    );
  }
  if (body.generate !== undefined) {
    _reject(
      sink,
      'generate-not-supported',
      `correlation "${id}" uses generate, not supported`,
      where,
    );
  }
  for (const key of Object.keys(body)) {
    if (!CORRELATION_BODY_KEYS.has(key) && !['aliases', 'condition', 'generate'].includes(key)) {
      _reject(
        sink,
        'invalid-document',
        `correlation "${id}" holds unknown correlation key "${key}"`,
        where,
      );
    }
  }

  if (body.type !== ACCEPTED_TYPE) {
    _reject(
      sink,
      'unsupported-correlation-type',
      `correlation type ${JSON.stringify(body.type)} is not supported — ${ACCEPTED_TYPE} is the ` +
        `only accepted type`,
      where,
    );
  }

  const groupBy = body['group-by'];
  if (!Array.isArray(groupBy) || groupBy.length !== 1 || groupBy[0] !== GROUP_BY_FIELD) {
    _reject(
      sink,
      'unsupported-group-by',
      `correlation "${id}" must group by exactly [${GROUP_BY_FIELD}]`,
      where,
    );
  }

  const timespanMs = _checkTimespan(sink, body.timespan, where);

  const rules = body.rules;
  if (!Array.isArray(rules) || !rules.every(_isText)) {
    _reject(sink, 'invalid-document', `correlation "${id}" needs a rules list of names`, where);
    return null;
  }
  if (rules.length < 2 || rules.length > 5) {
    _reject(
      sink,
      'rule-count-out-of-range',
      `correlation "${id}" lists ${rules.length} step(s) — a ${ACCEPTED_TYPE} rule needs 2 to 5`,
      where,
    );
    return null;
  }
  if (timespanMs === null || !_isText(doc.title) || !_isText(level) || !LEVELS.has(level)) {
    return null;
  }
  return { id, title: doc.title, level, timespanMs, names: /** @type {string[]} */ (rules) };
}

/**
 * The two warnings, emitted only for a rule that LOADED.
 * @param {Sink} sink
 * @param {SequenceRule} rule
 * @returns {void}
 */
function _checkWarnings(sink, rule) {
  for (let i = 0; i + 1 < rule.steps.length; i++) {
    const a = rule.steps[i];
    if (a.category === 'file' && a.name === rule.steps[i + 1].name) {
      _warn(
        sink,
        'adjacent-duplicate-step',
        `steps ${i + 1} and ${i + 2} are both "${a.name}"; dedupFileEvent suppresses a repeat ` +
          `of instanceId|file for 30s, so this rule fires only on two different paths`,
        { rule: rule.id, step: a.name },
      );
    }
  }
  const nullable = rule.steps.filter((s) => NULLABLE_KEY_CATEGORIES.has(s.category));
  if (nullable.length > 0) {
    _warn(
      sink,
      'nullable-entity-id-steps',
      `steps ${nullable.map((s) => `"${s.name}"`).join(', ')} are over file or network, where ` +
        `${GROUP_BY_FIELD} is nullable — unattributed events on those steps are skipped and counted`,
      { rule: rule.id },
    );
  }
}

/**
 * Loads one multi-document file. PURE with respect to the filesystem — the text is the input —
 * so a test needs no fixture on disk, while `loadDir` supplies the one that does.
 *
 * Validation is STAGED, and the stages do not run past a failure: a base document whose `name`
 * is malformed has no reference key, so running the cross-document stage anyway would report an
 * `unresolved-rule-reference` that describes the loader's own recovery rather than the file.
 *
 * @param {string} text - the file's YAML.
 * @param {string} fileName - the name the messages are prefixed with.
 * @returns {SequenceLoadResult}
 * @since v0.14.0
 */
function loadFromString(text, fileName) {
  /** @type {Sink} */
  const sink = { errors: [], warnings: [], file: fileName };
  /** @type {SequenceRule[]} */
  const rules = [];

  /** @type {unknown[]} */
  let documents;
  try {
    documents = /** @type {unknown[]} */ (yaml.loadAll(text));
  } catch (/** @type {*} */ err) {
    _reject(sink, 'yaml-parse', `YAML parse failed — ${/** @type {Error} */ (err).message}`);
    return _emit(sink, rules);
  }

  // ── Stage A: one document at a time ────────────────────────────────────────
  /** @type {Map<string, {category: string, selection: Record<string, unknown>}>} */
  const bases = new Map();
  /** @type {Array<{id: string, title: string, level: string, timespanMs: number, names: string[]}>} */
  const correlations = [];
  /** @type {Set<string>} */
  const seenIds = new Set();

  let index = 0;
  for (const raw of documents) {
    index++;
    if (raw === null || raw === undefined) continue;
    if (!_isMap(raw)) {
      _reject(sink, 'invalid-document', `document #${index} is not a mapping`);
      continue;
    }
    if (_isText(raw.id) && seenIds.has(raw.id)) {
      _reject(sink, 'duplicate-identifier', `duplicate id "${raw.id}"`, { rule: raw.id });
    } else if (_isText(raw.id)) {
      seenIds.add(raw.id);
    }

    if (raw.correlation !== undefined) {
      const parsed = _checkCorrelation(sink, raw, index);
      if (parsed !== null) correlations.push(parsed);
      continue;
    }
    const parsed = _checkBase(sink, raw, index);
    if (parsed === null) continue;
    if (bases.has(parsed.name)) {
      _reject(sink, 'duplicate-identifier', `duplicate name "${parsed.name}"`, {
        step: parsed.name,
      });
      continue;
    }
    bases.set(parsed.name, { category: parsed.category, selection: parsed.selection });
  }
  if (sink.errors.length > 0) return _emit(sink, rules);

  // ── Stage B: the documents against each other ──────────────────────────────
  const correlationIds = new Set(correlations.map((c) => c.id));
  /** @type {Set<string>} */
  const referenced = new Set();
  for (const correlation of correlations) {
    for (const name of correlation.names) {
      if (correlationIds.has(name)) {
        _reject(
          sink,
          'correlation-chain',
          `correlation "${correlation.id}" references correlation "${name}" — a correlation of ` +
            `correlations is not supported`,
          { rule: correlation.id, step: name },
        );
        continue;
      }
      if (!bases.has(name)) {
        _reject(
          sink,
          'unresolved-rule-reference',
          `correlation "${correlation.id}" references "${name}", which resolves to no base ` +
            `document in this file`,
          { rule: correlation.id, step: name },
        );
        continue;
      }
      referenced.add(name);
    }
  }
  for (const name of bases.keys()) {
    if (!referenced.has(name)) {
      _reject(
        sink,
        'unreferenced-base-document',
        `base document "${name}" is referenced by no correlation in this file`,
        { step: name },
      );
    }
  }
  if (sink.errors.length > 0) return _emit(sink, rules);

  // ── Stage C: compile ───────────────────────────────────────────────────────
  for (const correlation of correlations) {
    /** @type {SequenceStep[]} */
    const steps = correlation.names.map((name) => {
      const base = /** @type {{category: string, selection: Record<string, unknown>}} */ (
        bases.get(name)
      );
      return { name, category: base.category, matcher: _compileSelection(base.selection) };
    });
    const rule = {
      id: correlation.id,
      title: correlation.title,
      level: correlation.level,
      timespanMs: correlation.timespanMs,
      steps,
    };
    _checkWarnings(sink, rule);
    rules.push(rule);
  }
  return _emit(sink, rules);
}

/**
 * Writes every collected line to the operational log and answers the result.
 *
 * A rejected file contributes NO rules and NO warnings, and THE STAGING IS WHAT MAKES THAT TRUE:
 * both stage guards return through here before stage C runs, so `rules` and `sink.warnings` are
 * already empty on every path that carries an error. Re-emptying them here would read as the
 * mechanism, survive any mutation of the real one, and leave the next reader maintaining the
 * decoration instead of the guard (ai-mistakes #27).
 * @param {Sink} sink
 * @param {SequenceRule[]} rules
 * @returns {SequenceLoadResult}
 */
function _emit(sink, rules) {
  for (const line of sink.errors) {
    logger.warn(LOG_MODULE, line.message, {
      rule: line.rule,
      step: line.step,
      reason: line.reason,
    });
  }
  for (const line of sink.warnings) {
    logger.warn(LOG_MODULE, line.message, {
      rule: line.rule,
      step: line.step,
      reason: line.reason,
    });
  }
  return { rules, warnings: sink.warnings, loadErrors: sink.errors.length };
}

/**
 * Loads every `*.yaml` / `*.yml` file in a directory, in name order. A missing directory is not
 * an error: `rules/sequences/` is optional, and an absent one means "no sequence rules", which
 * is a different statement from "the directory could not be read".
 * @param {string} [dir] - defaults to `rules/sequences` beside the project's `rules/`.
 * @returns {SequenceLoadResult}
 * @since v0.14.0
 */
function loadDir(dir = DEFAULT_SEQUENCES_DIR) {
  /** @type {SequenceLoadResult} */
  const total = { rules: [], warnings: [], loadErrors: 0 };
  if (!fs.existsSync(dir)) return total;

  /** @type {string[]} */
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
  } catch (/** @type {*} */ err) {
    logger.warn(
      LOG_MODULE,
      `${dir}: directory unreadable — ${/** @type {Error} */ (err).message}`,
      {
        rule: null,
        step: null,
        reason: 'file-read',
      },
    );
    return { rules: [], warnings: [], loadErrors: 1 };
  }

  for (const file of files) {
    /** @type {string} */
    let text;
    try {
      text = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (/** @type {*} */ err) {
      logger.warn(LOG_MODULE, `${file}: unreadable — ${/** @type {Error} */ (err).message}`, {
        rule: null,
        step: null,
        reason: 'file-read',
      });
      total.loadErrors++;
      continue;
    }
    const one = loadFromString(text, file);
    total.rules.push(...one.rules);
    total.warnings.push(...one.warnings);
    total.loadErrors += one.loadErrors;
  }
  return total;
}

module.exports = {
  loadDir,
  loadFromString,
  DEFAULT_SEQUENCES_DIR,
};
