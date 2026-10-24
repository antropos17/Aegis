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
  validIdentity,
  identityFromStat,
  identityDigest,
  ordinaryDirectory,
} = require('./file-read-identity');
/**
 * Read one owned creation token into safe outcome facts.
 * @param {object} opts Actual run binding and private owned fixture token.
 * @returns {object} Safe read outcome.
 * @since unreleased
 */
function readOwnedFixture(opts) {
  if (
    !exact(opts, ['runId', 'scenario', 'step', 'fromStep', 'runDir', 'ownedFixture']) ||
    !['runId', 'scenario', 'step', 'fromStep'].every((key) => safeId(opts[key]))
  )
    throw new Error('file-read-input-invalid');
  const result = {
    version: 'file-read-control/1',
    runId: opts.runId,
    scenario: opts.scenario,
    step: opts.step,
    fromStep: opts.fromStep,
    fixtureLabel: null,
    originalIdentitySha256: null,
    preIdentitySha256: null,
    postIdentitySha256: null,
    namedIdentitySha256: null,
    expectedBytes: null,
    expectedSha256: null,
    readBytes: null,
    readSha256: null,
    progressKnown: null,
    status: 'failed',
    reason: 'fixture-token-invalid',
    closure: { opened: false, closeAttempted: false, closed: null },
  };
  let stage = 'fixture-token-invalid',
    fd,
    hash;
  const fail = () => {
    throw new Error();
  };
  try {
    const token = opts.ownedFixture;
    if (
      !exact(token, [
        'version',
        'compartment',
        'name',
        'identity',
        'expectedBytes',
        'expectedSha256',
        'creationClosed',
      ]) ||
      token.version !== 'owned-fixture/1' ||
      !TARGETS.includes(token.compartment) ||
      !name(token.name) ||
      !Number.isSafeInteger(token.expectedBytes) ||
      token.expectedBytes <= 0 ||
      token.expectedBytes > MAX_BYTES ||
      !sha(token.expectedSha256) ||
      token.creationClosed !== true ||
      (token.identity !== null &&
        (!validIdentity(token.identity) || token.identity.size !== String(token.expectedBytes)))
    )
      fail();
    result.fixtureLabel = `${token.compartment}/${token.name}`;
    result.expectedBytes = token.expectedBytes;
    result.expectedSha256 = token.expectedSha256;
    result.originalIdentitySha256 = identityDigest(token.identity);
    stage = 'identity-unavailable';
    if (result.originalIdentitySha256 === null) fail();
    stage = 'unsafe-owned-path';
    const root = ordinaryDirectory(opts.runDir),
      dir = ordinaryDirectory(path.join(root, 'fixtures', token.compartment));
    const file = path.join(dir, token.name),
      named = fs.lstatSync(file, { bigint: true });
    if (named.isSymbolicLink() || !named.isFile() || named.nlink !== 1n) fail();
    result.preIdentitySha256 = identityDigest(identityFromStat(named));
    stage = 'changed-before-read';
    if (result.preIdentitySha256 !== result.originalIdentitySha256) fail();
    stage = 'open-unavailable';
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    result.closure.opened = true;
    stage = 'changed-before-read';
    result.preIdentitySha256 = identityDigest(identityFromStat(fs.fstatSync(fd, { bigint: true })));
    if (result.preIdentitySha256 !== result.originalIdentitySha256) fail();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    hash = createHash('sha256');
    result.readBytes = 0;
    while (result.readBytes < bytes.length) {
      stage = 'read-unavailable';
      result.progressKnown = false;
      const used = result.readBytes,
        read = fs.readSync(fd, bytes, used, bytes.length - used, used);
      if (!Number.isSafeInteger(read) || read < 0 || read > bytes.length - used) fail();
      result.progressKnown = true;
      result.readBytes += read;
      if (read) hash.update(bytes.subarray(used, used + read));
      if (!read) break;
    }
    stage = 'read-limit';
    if (result.readBytes > MAX_BYTES) fail();
    stage = 'identity-after-unavailable';
    result.postIdentitySha256 = identityDigest(
      identityFromStat(fs.fstatSync(fd, { bigint: true })),
    );
    result.namedIdentitySha256 = identityDigest(
      identityFromStat(fs.lstatSync(file, { bigint: true })),
    );
    stage = 'changed-during-read';
    if (
      result.postIdentitySha256 !== result.originalIdentitySha256 ||
      result.namedIdentitySha256 !== result.originalIdentitySha256
    )
      fail();
    stage = 'length-mismatch';
    if (result.readBytes !== token.expectedBytes) fail();
    result.readSha256 = hash.copy().digest('hex');
    stage = 'digest-mismatch';
    if (result.readSha256 !== token.expectedSha256) fail();
    result.status = 'complete';
    result.reason = null;
  } catch {
    result.reason = stage;
  } finally {
    if (hash && result.readSha256 === null) result.readSha256 = hash.digest('hex');
    if (fd !== undefined) {
      result.closure.closeAttempted = true;
      try {
        fs.closeSync(fd);
        result.closure.closed = true;
      } catch {
        result.status = 'failed';
        result.reason ??= 'close-unavailable';
      }
    }
  }
  return result;
}
/**
 * Adapt only a prior successful write-fixture token to actor stimulus and separate outcome facts.
 * @param {object} step Closed fromStep declaration.
 * @param {object} ctx Actual actor context.
 * @returns {object} Actor observation and retained read outcome.
 * @since unreleased
 */
function executeFileReadStep(step, ctx) {
  const readOutcome = readOwnedFixture({
    runId: ctx.runId,
    scenario: ctx.scenario,
    step: step.id,
    fromStep: step.with.fromStep,
    runDir: ctx.runDir,
    ownedFixture: ctx.results.get(step.with.fromStep)?.ownedFixture,
  });
  return {
    failed: readOutcome.status !== 'complete',
    readOutcome,
    result: {},
    observed:
      readOutcome.status === 'complete'
        ? {
            timestamp: new Date().toISOString(),
            pid: process.pid,
            executable: process.execPath,
            runId: ctx.runId,
            sourceStep: step.with.fromStep,
            fixtureLabel: readOutcome.fixtureLabel,
            bytes: readOutcome.readBytes,
            sha256: readOutcome.readSha256,
          }
        : null,
  };
}
module.exports = { readOwnedFixture, executeFileReadStep };
