#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readActionFile, parseActionJson, LIMITS } = require('../src/main/action-policy');
const { translateSchema2Policy, translateSchema3Policy } = require('../src/main/cedar-translator');
let testDeps = null;
const outcome = (code, status, reason, details = {}) => ({
  code,
  result: { status, reason, evaluated: false, activated: false, ...details },
});
const refused = (reason) => outcome(2, 'refused', reason);

const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameFile = (left, right) =>
  sameIdentity(left, right) &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

async function selectDestination(filename, io) {
  if (typeof filename !== 'string' || !filename || /^[\\/]{2}/.test(filename))
    throw Error('invalid');
  const selected = path.resolve(filename);
  const name = path.basename(selected);
  const stem = name.split('.')[0].replace(/[ .]+$/u, '');
  if (
    !name ||
    // eslint-disable-next-line no-control-regex -- Restrict the explicitly selected output basename.
    /[:\x00-\x1f]/.test(name) ||
    /[ .]$/u.test(name) ||
    /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(stem)
  )
    throw Error('invalid');
  const parent = await io.realpath(path.dirname(selected));
  const parentIdentity = await io.lstat(parent);
  if (!parentIdentity.isDirectory() || parentIdentity.isSymbolicLink()) throw Error('invalid');
  const absolute = path.join(parent, name);
  try {
    await io.lstat(absolute);
  } catch (error) {
    if (error?.code === 'ENOENT') return { absolute, parent, parentIdentity };
    throw error;
  }
  throw Error('exists');
}

async function checkDestination(selected, expected, size, io) {
  const { absolute, parent, parentIdentity } = selected;
  const stat = await io.lstat(absolute);
  const currentParent = await io.lstat(parent);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !sameIdentity(expected, stat) ||
    stat.size !== size ||
    !currentParent.isDirectory() ||
    currentParent.isSymbolicLink() ||
    !sameIdentity(parentIdentity, currentParent) ||
    (await io.realpath(absolute)) !== absolute ||
    (await io.realpath(parent)) !== parent
  )
    throw Error('changed');
  return stat;
}

async function writeFreshOutput(filename, bytes) {
  const io = {
    realpath: (...args) => fs.promises.realpath(...args),
    lstat: (...args) => fs.promises.lstat(...args),
    open: (...args) => fs.promises.open(...args),
    readBack: readActionFile,
    ...(testDeps?.outputIO || {}),
  };
  let selected;
  try {
    selected = await selectDestination(filename, io);
  } catch {
    return refused('destination-unavailable');
  }
  let handle;
  let closeAttempted = false;
  let readback;
  try {
    try {
      handle = await io.open(
        selected.absolute,
        fs.constants.O_RDWR |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
    } catch (error) {
      return error?.code === 'EEXIST'
        ? refused('destination-unavailable')
        : outcome(3, 'unconfirmed-output', 'output-unconfirmed');
    }
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== 0) throw Error('invalid');
    await checkDestination(selected, opened, 0, io);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (
        !Number.isSafeInteger(bytesWritten) ||
        bytesWritten <= 0 ||
        bytesWritten > bytes.length - offset
      )
        throw Error('write-unconfirmed');
      offset += bytesWritten;
    }
    await handle.sync();
    const written = await handle.stat();
    if (!written.isFile() || !sameIdentity(opened, written) || written.size !== bytes.length)
      throw Error('write-unconfirmed');
    await checkDestination(selected, written, bytes.length, io);
    closeAttempted = true;
    await handle.close();
    handle = null;
    // Windows may settle write timestamps on close; bind identity/size first.
    const finalized = await checkDestination(selected, written, bytes.length, io);
    readback = await io.readBack(selected.absolute);
    if (!Buffer.isBuffer(readback) || readback.length !== bytes.length || !readback.equals(bytes))
      throw Error('readback-unconfirmed');
    if (!sameFile(finalized, await checkDestination(selected, written, bytes.length, io)))
      throw Error('changed');
    return outcome(0, 'exported', 'output-verified', {
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  } catch {
    return outcome(3, 'unconfirmed-output', 'output-unconfirmed');
  } finally {
    if (Buffer.isBuffer(readback)) readback.fill(0);
    // An uncertain close is never retried; the named output is retained.
    if (handle && !closeAttempted) {
      closeAttempted = true;
      try {
        await handle.close();
      } catch {
        // Retain the unconfirmed output.
      }
    }
  }
}

/**
 * Export one explicitly selected schema-2/3 policy into a fresh schema-4 file.
 * This operation never evaluates a request or activates a policy.
 * @param {string[]} args Exactly one selected input and one fresh output path.
 * @returns {Promise<{code: number, result: object}>} Fixed metadata and exit code.
 * @since unreleased
 */
async function exportSelectedPolicy(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args.some((arg) => typeof arg !== 'string' || !arg)
  )
    return refused('arguments-invalid');
  let input;
  let output;
  try {
    try {
      input = await readActionFile(args[0]);
    } catch {
      return refused('input-unavailable');
    }
    let translated;
    try {
      const policy = parseActionJson(input);
      const translate =
        policy?.schemaVersion === 2
          ? translateSchema2Policy
          : policy?.schemaVersion === 3
            ? translateSchema3Policy
            : null;
      translated = translate?.(policy);
      if (!translated?.ok) return refused('policy-invalid');
      output = Buffer.from(JSON.stringify(translated.policy) + '\n');
    } catch {
      return refused('policy-invalid');
    }
    if (output.length > LIMITS.bytes) return refused('output-too-large');
    if (path.resolve(args[0]) === path.resolve(args[1])) return refused('destination-unavailable');
    return await writeFreshOutput(args[1], output);
  } catch {
    return outcome(3, 'unconfirmed-output', 'output-unconfirmed');
  } finally {
    input?.fill(0);
    output?.fill(0);
  }
}

/**
 * Supply output filesystem operations to isolated writer fault tests only.
 * No command-line argument or policy field selects these dependencies.
 * @param {object|null} deps Test-only outputIO overrides.
 * @returns {void}
 * @since unreleased
 */
function _setDepsForTest(deps) {
  testDeps = deps;
}

/** Restore actual output filesystem operations after a fault test.
 * @returns {void}
 * @since unreleased */
function _resetForTest() {
  testDeps = null;
}

module.exports = { exportSelectedPolicy, _setDepsForTest, _resetForTest };

if (require.main === module) {
  process.stdout.on('error', () => {
    process.exitCode = 2;
  });
  exportSelectedPolicy(process.argv.slice(2)).then(
    ({ code, result }) => {
      process.exitCode = code;
      try {
        process.stdout.write(JSON.stringify(result) + '\n');
      } catch {
        process.exitCode = 2;
      }
    },
    () => {
      process.exitCode = 3;
      try {
        const result = outcome(3, 'unconfirmed-output', 'output-unconfirmed').result;
        process.stdout.write(JSON.stringify(result) + '\n');
      } catch {
        process.exitCode = 3;
      }
    },
  );
}
