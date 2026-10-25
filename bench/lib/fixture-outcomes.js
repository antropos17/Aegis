'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { LIMITS } = require('./loopback-receiver');
const FILENAME = 'fixture-outcomes.json';
const MAX_BYTES = 16384;
const fail = () => {
  throw new Error('fixture-outcomes-invalid');
};
/**
 * Check a bounded public identity without coercion.
 * @param {unknown} value Identity candidate.
 * @returns {boolean} Whether it is a safe string identity.
 * @since unreleased
 */
const safeId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 5;
const nullableBoolean = (value) => value === null || typeof value === 'boolean';
const receiverReasons = [
  'timeout',
  'request-limit',
  'connection-limit',
  'listen-unavailable',
  'receipt-unconfirmed',
  'cleanup-unconfirmed',
  'duplicate-receipt',
  'wrong-receipt',
  'receipt-count-mismatch',
  'cleanup-api-failed',
  'cancelled',
];
const senderReasons = [
  'not-attempted',
  'timeout',
  'cancelled',
  'receiver-ended',
  'response-unavailable',
  'response-invalid',
  'request-unavailable',
  ...receiverReasons,
];
function exact(value, fields) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        Object.getOwnPropertyDescriptor(value, key).enumerable !== true ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'),
    )
  )
    fail();
}
function list(value, max) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail();
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, index) || {}, 'value')) fail();
}

/**
 * Validate and copy the bounded control receipt without accepting private extra fields.
 * @param {object} control Declared control result.
 * @param {string} runId Actual run identity.
 * @param {string} nonce Adapter-generated nonce.
 * @param {number} durationMs Predeclared bounded duration.
 * @returns {object} Exact safe copy.
 * @since unreleased
 */
function validateControl(control, runId, nonce, durationMs) {
  try {
    if (!safeId(runId) || !safeId(nonce)) fail();
    exact(control, [
      'version',
      'runId',
      'nonce',
      'scope',
      'sender',
      'receiver',
      'confirmed',
      'limits',
    ]);
    if (
      control.version !== 'loopback-control/1' ||
      control.runId !== runId ||
      control.nonce !== nonce ||
      control.scope !== 'controlled-node-loopback' ||
      typeof control.confirmed !== 'boolean'
    )
      fail();
    const s = control.sender;
    exact(s, [
      'attempted',
      'writeFinished',
      'sentBytes',
      'responseCompleted',
      'statusCode',
      'socketClosed',
      'reason',
    ]);
    if (
      typeof s.attempted !== 'boolean' ||
      ![s.writeFinished, s.responseCompleted, s.socketClosed].every(nullableBoolean) ||
      (s.sentBytes !== null &&
        (!Number.isSafeInteger(s.sentBytes) ||
          s.sentBytes <= 0 ||
          s.sentBytes > LIMITS.bodyBytes)) ||
      (s.statusCode !== null &&
        (!Number.isSafeInteger(s.statusCode) || s.statusCode < 100 || s.statusCode > 599)) ||
      (s.reason !== null && !senderReasons.includes(s.reason))
    )
      fail();
    const r = control.receiver;
    exact(r, [
      'version',
      'runId',
      'nonce',
      'expectedCount',
      'expectedSha256',
      'plannedDurationMs',
      'expectedBytes',
      'connections',
      'requests',
      'completedBodies',
      'matchingPayloads',
      'duplicates',
      'wrong',
      'oversize',
      'incomplete',
      'protocolErrors',
      'observedHashes',
      'verifiedCount',
      'exact',
      'reason',
      'cleanup',
    ]);
    const bytes = Buffer.from(`AEGIS_PUBLIC_INERT_LOOPBACK_V1\n${runId}\n${nonce}\n`, 'ascii');
    if (
      r.version !== 'loopback-receiver/1' ||
      r.runId !== runId ||
      r.nonce !== nonce ||
      r.expectedCount !== 1 ||
      r.expectedBytes !== bytes.length ||
      r.expectedSha256 !== createHash('sha256').update(bytes).digest('hex') ||
      !Number.isSafeInteger(r.plannedDurationMs) ||
      r.plannedDurationMs !== durationMs ||
      r.plannedDurationMs < 50 ||
      r.plannedDurationMs > LIMITS.durationMs ||
      ![
        'connections',
        'requests',
        'completedBodies',
        'matchingPayloads',
        'duplicates',
        'wrong',
        'oversize',
        'incomplete',
        'protocolErrors',
      ].every((key) => count(r[key])) ||
      !Array.isArray(r.observedHashes) ||
      r.observedHashes.length > LIMITS.requests ||
      (r.verifiedCount !== null && !count(r.verifiedCount)) ||
      !nullableBoolean(r.exact) ||
      (r.reason !== null && !receiverReasons.includes(r.reason))
    )
      fail();
    list(r.observedHashes, LIMITS.requests);
    if (!r.observedHashes.every(hash)) fail();
    exact(r.cleanup, ['listenerClosed', 'socketsClosed', 'confirmed']);
    if (!Object.values(r.cleanup).every((value) => typeof value === 'boolean')) fail();
    exact(control.limits, Object.keys(LIMITS));
    if (Object.keys(LIMITS).some((key) => control.limits[key] !== LIMITS[key])) fail();
    const encoded = JSON.stringify(control);
    if (Buffer.byteLength(encoded) > LIMITS.outputBytes) fail();
    return JSON.parse(encoded);
  } catch {
    fail();
  }
}

/**
 * Write safe same-run fixture outcomes into a new file, separate from all oracle artifacts.
 * @param {object} opts Run directory, runId, scenario, arm and at most one outcome.
 * @returns {string} Written filename.
 * @since unreleased
 */
function writeFixtureOutcomes(opts) {
  try {
    if (!safeId(opts.runId) || !safeId(opts.scenario.id) || !['A', 'B', 'C'].includes(opts.arm))
      fail();
    list(opts.outcomes, 1);
    const seen = new Set();
    const outcomes = opts.outcomes.map((record) => {
      exact(record, ['runId', 'scenario', 'step', 'nonce', 'control', 'reason']);
      const declared = opts.scenario.steps.find(
        (step) => step.id === record.step && step.kind === 'send-loopback-canary',
      );
      if (
        record.runId !== opts.runId ||
        record.scenario !== opts.scenario.id ||
        !safeId(record.step) ||
        !safeId(record.nonce) ||
        seen.has(record.step) ||
        !declared
      )
        fail();
      seen.add(record.step);
      if (
        record.control === null ? record.reason !== 'control-unavailable' : record.reason !== null
      )
        fail();
      return {
        runId: record.runId,
        scenario: record.scenario,
        step: record.step,
        nonce: record.nonce,
        control:
          record.control === null
            ? null
            : validateControl(record.control, opts.runId, record.nonce, declared.with.durationMs),
        reason: record.reason,
      };
    });
    const encoded =
      JSON.stringify({
        schema: 'fixture-outcomes',
        schemaVersion: 1,
        runId: opts.runId,
        scenario: opts.scenario.id,
        arm: opts.arm,
        scope: 'controlled-node-loopback',
        osOracle: false,
        sensorScored: false,
        measurementAccepted: false,
        outcomes,
      }) + '\n';
    if (
      Buffer.byteLength(encoded) > MAX_BYTES ||
      typeof opts.dir !== 'string' ||
      opts.dir.length > 1024 ||
      /^[/\\]{2}/.test(opts.dir)
    )
      fail();
    const dir = path.resolve(opts.dir),
      root = path.parse(dir).root;
    let ancestor = root;
    for (const part of dir.slice(root.length).split(path.sep)) {
      if (part.includes(':')) fail();
      ancestor = path.join(ancestor, part);
      const stat = fs.lstatSync(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    }
    const file = path.join(dir, FILENAME);
    const fd = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    try {
      fs.writeFileSync(fd, encoded);
    } finally {
      fs.closeSync(fd);
    }
    return file;
  } catch {
    fail();
  }
}
module.exports = { writeFixtureOutcomes, validateControl, safeId, FILENAME, MAX_BYTES };
