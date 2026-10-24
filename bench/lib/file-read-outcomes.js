'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  exact,
  safeId,
  sha,
  name,
  TARGETS,
  MAX_BYTES,
  ordinaryDirectory,
} = require('./file-read-identity');
const FILENAME = 'file-read-outcomes.json';
const MAX_OUTPUT_BYTES = 16384;
const DIGESTS = [
  'originalIdentitySha256',
  'preIdentitySha256',
  'postIdentitySha256',
  'namedIdentitySha256',
];
const REASONS = [
  'fixture-token-invalid',
  'identity-unavailable',
  'unsafe-owned-path',
  'changed-before-read',
  'open-unavailable',
  'read-unavailable',
  'read-limit',
  'identity-after-unavailable',
  'changed-during-read',
  'length-mismatch',
  'digest-mismatch',
  'close-unavailable',
];
const fail = () => {
  throw new Error('file-read-outcomes-invalid');
};

/**
 * Validate one closed safe outcome against its declared source and actual run binding.
 * @param {object} record Reader observations.
 * @param {object} binding Expected run, scenario, step, fromStep, fixture label and byte/hash facts.
 * @returns {object} Safe JSON copy.
 * @since unreleased
 */
function validateReadOutcome(record, binding) {
  try {
    if (
      !exact(record, [
        'version',
        'runId',
        'scenario',
        'step',
        'fromStep',
        'fixtureLabel',
        ...DIGESTS,
        'expectedBytes',
        'expectedSha256',
        'readBytes',
        'readSha256',
        'progressKnown',
        'status',
        'reason',
        'closure',
      ]) ||
      record.version !== 'file-read-control/1'
    )
      fail();
    if (
      !['runId', 'scenario', 'step', 'fromStep'].every(
        (key) => safeId(record[key]) && record[key] === binding[key],
      ) ||
      !DIGESTS.every((key) => record[key] === null || sha(record[key]))
    )
      fail();
    if (
      !['complete', 'failed'].includes(record.status) ||
      (record.status === 'complete' ? record.reason !== null : !REASONS.includes(record.reason))
    )
      fail();
    if (
      record.fixtureLabel === null
        ? record.reason !== 'fixture-token-invalid'
        : typeof record.fixtureLabel !== 'string' ||
          !/^(project|outside-project|persistence-location)\/canary-[a-z0-9-]{1,40}\.txt$/.test(
            record.fixtureLabel,
          ) ||
          record.fixtureLabel !== binding.fixtureLabel
    )
      fail();
    if (
      record.expectedBytes === null
        ? record.expectedSha256 !== null || record.reason !== 'fixture-token-invalid'
        : !Number.isSafeInteger(record.expectedBytes) ||
          record.expectedBytes <= 0 ||
          record.expectedBytes > MAX_BYTES ||
          !sha(record.expectedSha256) ||
          record.expectedBytes !== binding.expectedBytes ||
          record.expectedSha256 !== binding.expectedSha256
    )
      fail();
    if (
      record.readBytes === null
        ? record.readSha256 !== null || record.progressKnown !== null
        : !Number.isSafeInteger(record.readBytes) ||
          record.readBytes < 0 ||
          record.readBytes > MAX_BYTES + 1 ||
          !sha(record.readSha256) ||
          typeof record.progressKnown !== 'boolean'
    )
      fail();
    const c = record.closure;
    if (
      !exact(c, ['opened', 'closeAttempted', 'closed']) ||
      typeof c.opened !== 'boolean' ||
      typeof c.closeAttempted !== 'boolean' ||
      (c.closed !== null && c.closed !== true) ||
      (c.opened ? c.closeAttempted !== true : c.closeAttempted !== false || c.closed !== null) ||
      (record.readBytes !== null && !c.opened)
    )
      fail();
    if (
      record.status === 'complete' &&
      (record.fixtureLabel === null ||
        record.expectedBytes === null ||
        record.expectedBytes <= 0 ||
        record.expectedBytes > MAX_BYTES ||
        record.readBytes !== record.expectedBytes ||
        record.readSha256 !== record.expectedSha256 ||
        record.progressKnown !== true ||
        c.closed !== true ||
        record.originalIdentitySha256 === null ||
        !DIGESTS.every((key) => record[key] === record.originalIdentitySha256))
    )
      fail();
    const encoded = JSON.stringify(record);
    if (Buffer.byteLength(encoded) > 4096) fail();
    return JSON.parse(encoded);
  } catch {
    fail();
  }
}

/**
 * Persist separate bounded file read outcomes without changing loopback or OS oracle formats.
 * @param {object} opts Owned directory, actual run/scenario/arm and at most one retained outcome.
 * @returns {string} New artifact filename.
 * @since unreleased
 */
function writeFileReadOutcomes(opts) {
  try {
    if (
      !safeId(opts.runId) ||
      !safeId(opts.scenario.id) ||
      !['A', 'B', 'C'].includes(opts.arm) ||
      !Array.isArray(opts.outcomes) ||
      Object.getPrototypeOf(opts.outcomes) !== Array.prototype ||
      opts.outcomes.length > 1 ||
      Reflect.ownKeys(opts.outcomes).length !== opts.outcomes.length + 1
    )
      fail();
    for (let i = 0; i < opts.outcomes.length; i++) {
      const d = Object.getOwnPropertyDescriptor(opts.outcomes, i);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail();
    }
    const outcomes = opts.outcomes.map((record) => {
      if (
        !exact(record, [
          'version',
          'runId',
          'scenario',
          'step',
          'fromStep',
          'fixtureLabel',
          ...DIGESTS,
          'expectedBytes',
          'expectedSha256',
          'readBytes',
          'readSha256',
          'progressKnown',
          'status',
          'reason',
          'closure',
        ])
      )
        fail();
      const index = opts.scenario.steps.findIndex(
          (step) => step.kind === 'read-fixture' && step.id === record.step,
        ),
        declared = opts.scenario.steps[index];
      const sourceIndex = opts.scenario.steps.findIndex(
          (step) => step.id === declared?.with.fromStep,
        ),
        source = opts.scenario.steps[sourceIndex];
      if (
        !declared ||
        sourceIndex < 0 ||
        sourceIndex >= index ||
        source.kind !== 'write-fixture' ||
        !TARGETS.includes(source.with.target) ||
        !name(source.with.name) ||
        typeof source.with.content !== 'string' ||
        !source.with.content.length ||
        source.with.content.length > 4096
      )
        fail();
      const bytes = Buffer.from(source.with.content, 'utf8');
      return validateReadOutcome(record, {
        runId: opts.runId,
        scenario: opts.scenario.id,
        step: declared.id,
        fromStep: source.id,
        fixtureLabel: `${source.with.target}/${source.with.name}`,
        expectedBytes: bytes.length,
        expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      });
    });
    const encoded =
      JSON.stringify({
        schema: 'file-read-outcomes',
        schemaVersion: 1,
        runId: opts.runId,
        scenario: opts.scenario.id,
        arm: opts.arm,
        scope: 'owned-file-read-control',
        osOracle: false,
        sourceAuthenticated: false,
        sensorScored: false,
        measurementAccepted: false,
        outcomes,
      }) + '\n';
    if (Buffer.byteLength(encoded) > MAX_OUTPUT_BYTES) fail();
    const file = path.join(ordinaryDirectory(opts.dir), FILENAME),
      fd = fs.openSync(
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
module.exports = { validateReadOutcome, writeFileReadOutcomes, FILENAME, MAX_OUTPUT_BYTES };
