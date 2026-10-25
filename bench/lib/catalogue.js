/**
 * @file bench/lib/catalogue.js
 * @module bench/lib/catalogue
 * @description The expected-event catalogue for one bench run.
 *
 *   The catalogue is the fixed point of the whole method: the oracle and the
 *   sensor are each scored against it, never against each other. That only
 *   works if every row of it is a record of something that actually happened,
 *   so this module is built around one refusal — **it will not write a line
 *   whose identity fields were not observed.** A missing pid, a timestamp that
 *   is not a real UTC instant, an executable path nobody resolved: each throws
 *   here rather than becoming a plausible-looking row that a later metric would
 *   count. A hand-written catalogue is a guess; a guess that reaches
 *   `expected.ndjson` is indistinguishable from truth by the time anyone reads
 *   the numbers.
 *
 *   Field names are the minimal ECS subset the plan calls for: `@timestamp`,
 *   `event.*`, `process.*`, `file.*`, plus a `bench.*` block naming the
 *   scenario, the step that produced the line and the expectation the step was
 *   declared to satisfy.
 *
 *   A field the actor did not observe is **omitted**, not set to `null`. This
 *   is the opposite convention from `manifest.js` on purpose: a manifest entry
 *   is a slot that exists whether or not the probe won, so absence has to be
 *   spelled out, while an ECS document is a bag of observed fields and a `null`
 *   in one reads as a measured null.
 *
 *   Nothing here imports from `src/`.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { neutralizeRecorded } = require('./paths');

/** @type {string} ECS version the field names below follow. */
const ECS_VERSION = '8.11.0';

/** @type {string} Name of the catalogue inside a run directory. */
const CATALOGUE_FILENAME = 'expected.ndjson';

/**
 * A UTC instant with milliseconds, exactly as `Date#toISOString` produces it.
 * A timestamp that does not match this was not read off a clock at the moment
 * the step ran, and the catalogue refuses it.
 * @type {RegExp}
 */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The closed set of event shapes the catalogue knows how to write.
 *
 * `observed` lists the fields the actor must supply. Every shape includes
 * `timestamp` and `pid`: a file event carries the pid of the process that
 * created or removed the file — the actor itself — so that no line in the
 * catalogue is without a real process behind it.
 * @type {Readonly<Object<string, Object>>}
 */
const EVENT_SHAPES = Object.freeze({
  'file.access': Object.freeze({
    category: 'file',
    type: 'access',
    action: 'fixture-file-read',
    observed: Object.freeze([
      'timestamp',
      'pid',
      'executable',
      'runId',
      'sourceStep',
      'fixtureLabel',
      'bytes',
      'sha256',
    ]),
    build: (o) => {
      const id = (value) =>
        typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
      if (
        !id(o.runId) ||
        !id(o.sourceStep) ||
        typeof o.executable !== 'string' ||
        !o.executable.trim() ||
        typeof o.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(o.timestamp)) ||
        new Date(o.timestamp).toISOString() !== o.timestamp ||
        typeof o.fixtureLabel !== 'string' ||
        !/^(project|outside-project|persistence-location)\/canary-[a-z0-9-]{1,40}\.txt$/.test(
          o.fixtureLabel,
        ) ||
        !Number.isSafeInteger(o.bytes) ||
        o.bytes <= 0 ||
        o.bytes > 16384 ||
        typeof o.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(o.sha256)
      )
        throw new Error('file-read-catalogue-input-invalid');
      return {
        process: { pid: o.pid, executable: o.executable },
        file: { size: o.bytes, hash: { sha256: o.sha256 } },
        bench: {
          runId: o.runId,
          sourceStep: o.sourceStep,
          fixtureLabel: o.fixtureLabel,
          timestampBasis: 'harness-read-completion-observation',
        },
      };
    },
  }),
  'network.start': Object.freeze({
    category: 'network',
    type: 'start',
    action: 'loopback-canary-write-finished',
    observed: Object.freeze(['timestamp', 'pid', 'executable', 'sentBytes', 'runId', 'nonce']),
    build: (o) => {
      const safeId = (value) =>
        typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
      if (
        !safeId(o.runId) ||
        !safeId(o.nonce) ||
        typeof o.executable !== 'string' ||
        !o.executable.trim() ||
        !Number.isSafeInteger(o.sentBytes) ||
        o.sentBytes <= 0 ||
        o.sentBytes > 512 ||
        typeof o.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(o.timestamp)) ||
        new Date(o.timestamp).toISOString() !== o.timestamp
      )
        throw new Error('loopback-catalogue-input-invalid');
      return {
        process: { pid: o.pid, executable: o.executable },
        destination: { ip: '127.0.0.1' },
        network: { transport: 'tcp', protocol: 'http', bytes: o.sentBytes },
        bench: { runId: o.runId, nonce: o.nonce, timestampBasis: 'harness-completion-observation' },
      };
    },
  }),
  'process.start': Object.freeze({
    category: 'process',
    type: 'start',
    action: 'process-started',
    observed: Object.freeze(['timestamp', 'pid', 'name', 'executable', 'args', 'parentPid']),
    build: (o) => ({
      process: {
        pid: o.pid,
        name: o.name,
        executable: o.executable,
        // The argv the actor handed CreateProcess, verbatim. `process.command_line`
        // is deliberately absent: the actor never saw the command line the OS
        // assembled, and a re-quoted reconstruction of it would be a guess that
        // a later join could mistake for an observation.
        args: o.args,
        start: o.timestamp,
        parent: { pid: o.parentPid },
      },
    }),
  }),
  'process.end': Object.freeze({
    category: 'process',
    type: 'end',
    action: 'process-ended',
    observed: Object.freeze(['timestamp', 'pid', 'name', 'executable']),
    build: (o) => {
      const out = {
        process: {
          pid: o.pid,
          name: o.name,
          executable: o.executable,
        },
      };
      // Node reports either an exit code or the signal it used, never both:
      // `child_process` nulls the code whenever a signal is set, which is what
      // a `kill()` on Windows produces. Whichever of the two the OS actually
      // gave is written; the other is left out rather than inferred. ECS 8.11
      // has `process.exit_code` and no field for a terminating signal, so that
      // observation goes in the bench namespace instead of being dropped or
      // squeezed into a field that means something else.
      if (typeof o.exitCode === 'number') out.process.exit_code = o.exitCode;
      if (typeof o.signal === 'string') out.bench = { terminationSignal: o.signal };
      return out;
    },
  }),
  'file.creation': Object.freeze({
    category: 'file',
    type: 'creation',
    action: 'file-created',
    observed: Object.freeze([
      'timestamp',
      'pid',
      'executable',
      'path',
      'name',
      'directory',
      'sizeBytes',
      'sha256',
    ]),
    build: (o) => ({
      file: {
        path: o.path,
        name: o.name,
        directory: o.directory,
        size: o.sizeBytes,
        hash: { sha256: o.sha256 },
      },
      process: { pid: o.pid, executable: o.executable },
    }),
  }),
  'file.deletion': Object.freeze({
    category: 'file',
    type: 'deletion',
    action: 'file-deleted',
    observed: Object.freeze(['timestamp', 'pid', 'executable', 'path', 'name', 'directory']),
    build: (o) => ({
      file: {
        path: o.path,
        name: o.name,
        directory: o.directory,
      },
      process: { pid: o.pid, executable: o.executable },
    }),
  }),
});

/** @type {ReadonlyArray<string>} Shape names, in declaration order. */
const SHAPE_NAMES = Object.freeze(Object.keys(EVENT_SHAPES));

/**
 * Reject an observation that cannot have come from a real execution.
 * @param {string} shape - Shape name, for the message.
 * @param {string} step - Step id, for the message.
 * @param {Object} observed - What the actor captured.
 * @param {ReadonlyArray<string>} required - Field names that must be present.
 * @throws {Error} Naming the first field that is missing or not credible.
 */
function assertObserved(shape, step, observed, required) {
  const refuse = (field, why) => {
    throw new Error(
      `catalogue: refusing a "${shape}" line for step "${step}" — observed field "${field}" ${why}. ` +
        'The catalogue records what the actor saw happen; it never fills a gap with a placeholder.',
    );
  };
  for (const field of required) {
    const value = observed[field];
    if (value === undefined || value === null) refuse(field, 'was not captured');
    if (typeof value === 'string' && value.trim() === '') refuse(field, 'is empty');
  }
  if (!ISO_UTC_MS.test(String(observed.timestamp))) {
    refuse('timestamp', `is "${observed.timestamp}", which is not a UTC instant read off a clock`);
  }
  if (!Number.isSafeInteger(observed.pid) || observed.pid <= 0) {
    refuse('pid', `is ${JSON.stringify(observed.pid)}, which is not a pid the OS handed out`);
  }
}

/**
 * Build one catalogue line.
 * @param {Object} opts
 * @param {string} opts.scenario - Scenario id.
 * @param {string} opts.step - Id of the step that produced this event.
 * @param {string} opts.expect - Id of the expectation the step was declared to
 *   satisfy, from the scenario's `expect` block.
 * @param {string} opts.shape - One of {@link SHAPE_NAMES}.
 * @param {Object} opts.observed - What the actor captured while executing.
 * @returns {Object} An ECS document, ready to serialize.
 * @throws {Error} On an unknown shape or an observation with a hole in it.
 */
function buildEvent(opts) {
  const shape = EVENT_SHAPES[opts.shape];
  if (!shape) {
    throw new Error(
      `catalogue: unknown event shape "${opts.shape}" — known shapes are ${SHAPE_NAMES.join(', ')}`,
    );
  }
  if (opts.shape === 'network.start' || opts.shape === 'file.access') {
    const value = opts.observed;
    if (
      !value ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== shape.observed.length ||
      shape.observed.some(
        (key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) || {}, 'value'),
      )
    )
      throw new Error(
        opts.shape === 'file.access'
          ? 'file-read-catalogue-input-invalid'
          : 'loopback-catalogue-input-invalid',
      );
  }
  // A shape may hand back a `bench` fragment for an observation ECS has no
  // field for. It is merged into the bench block, never allowed to overwrite
  // the three keys that identify where the line came from.
  let built;
  if (opts.shape === 'network.start' || opts.shape === 'file.access') {
    try {
      assertObserved(opts.shape, opts.step, opts.observed, shape.observed);
      built = shape.build(opts.observed);
    } catch {
      throw new Error(
        opts.shape === 'file.access'
          ? 'file-read-catalogue-input-invalid'
          : 'loopback-catalogue-input-invalid',
      );
    }
  } else {
    assertObserved(opts.shape, opts.step, opts.observed, shape.observed);
    built = shape.build(opts.observed);
  }
  const { bench: benchExtra, ...fields } = built;
  return neutralizeRecorded({
    '@timestamp': opts.observed.timestamp,
    ecs: { version: ECS_VERSION },
    event: {
      kind: 'event',
      category: [shape.category],
      type: [shape.type],
      action: shape.action,
    },
    ...fields,
    bench: {
      ...benchExtra,
      scenario: opts.scenario,
      step: opts.step,
      expect: opts.expect,
    },
  });
}

/**
 * Render events as NDJSON: one document per line, newline-terminated.
 * @param {Object[]} events
 * @returns {string} Empty string for no events — an empty catalogue is a real
 *   outcome (a run that failed on its first step) and is written as such.
 */
function serialize(events) {
  if (events.length === 0) return '';
  return `${events.map((e) => JSON.stringify(neutralizeRecorded(e))).join('\n')}\n`;
}

/**
 * Write the catalogue into a run directory.
 * @param {string} runDir - Absolute path of the run directory.
 * @param {Object[]} events
 * @returns {string} Absolute path of the file written.
 */
function write(runDir, events) {
  const file = path.join(runDir, CATALOGUE_FILENAME);
  fs.writeFileSync(file, serialize(events), 'utf8');
  return file;
}

module.exports = {
  CATALOGUE_FILENAME,
  ECS_VERSION,
  EVENT_SHAPES,
  ISO_UTC_MS,
  SHAPE_NAMES,
  buildEvent,
  serialize,
  write,
};
