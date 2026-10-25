/**
 * Inert file stimuli for the existing scenario actor. These are synthetic
 * controls; creating a fixture does not establish independent oracle truth.
 * @since v0.23.0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { identityFromStat } = require('./file-read-identity');

const TARGETS = Object.freeze(['project', 'outside-project', 'persistence-location']);

/**
 * Refuse symbolic links, junctions and non-directories at every owned component.
 * The caller owns the run directory exclusively; concurrent adversarial swaps
 * require OS handle-relative operations and are outside this fixture harness.
 * @param {string} directory - Existing directory to inspect.
 * @returns {void}
 * @since v0.23.0
 */
function assertDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('fixture directory must be an ordinary owned directory');
  }
}

/**
 * Write a bounded canary in a named compartment of an existing owned run.
 * No arbitrary path or installed persistence location is accepted. Exclusive
 * creation refuses existing files and linked targets, preserving prior evidence.
 * @param {{target: string, name: string, content: string}} input - Validated step.
 * @param {string} runDir - Exclusive, existing disposable run directory.
 * @returns {{observed: Object, result: Object}} Actual write observations.
 * @since v0.23.0
 */
function writeFixture(input, runDir) {
  if (!TARGETS.includes(input.target) || !/^canary-[a-z0-9-]{1,40}\.txt$/.test(input.name)) {
    throw new Error('fixture target or canary name is invalid');
  }
  if (typeof input.content !== 'string' || !input.content.length || input.content.length > 4096) {
    throw new Error('fixture content must contain 1 to 4096 characters');
  }
  let directory = path.resolve(runDir);
  assertDirectory(directory);
  for (const component of ['fixtures', input.target]) {
    directory = path.join(directory, component);
    try {
      fs.mkdirSync(directory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    assertDirectory(directory);
  }
  const destination = path.join(directory, input.name);
  const bytes = Buffer.from(input.content, 'utf8');
  const fd = fs.openSync(
    destination,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW || 0),
    0o600,
  );
  let created = null;
  try {
    fs.writeFileSync(fd, bytes);
    try {
      created = identityFromStat(fs.fstatSync(fd, { bigint: true }));
    } catch {
      /* Creation remains valid; a later read cannot use unavailable identity. */
    }
  } finally {
    fs.closeSync(fd);
  }
  let identity = null;
  try {
    const named = identityFromStat(fs.lstatSync(destination, { bigint: true }));
    if (created && named && ['dev', 'ino', 'size'].every((key) => created[key] === named[key]))
      identity = named;
  } catch {
    /* Never fabricate identity when post-close inspection is unavailable. */
  }
  const timestamp = new Date().toISOString();
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return {
    observed: {
      timestamp,
      pid: process.pid,
      executable: process.execPath,
      path: destination,
      name: input.name,
      directory,
      sizeBytes: bytes.length,
      sha256: digest,
    },
    result: {
      path: destination,
      name: input.name,
      ownedFixture: {
        version: 'owned-fixture/1',
        compartment: input.target,
        name: input.name,
        identity,
        expectedBytes: bytes.length,
        expectedSha256: digest,
        creationClosed: true,
      },
    },
  };
}

module.exports = { writeFixture };
