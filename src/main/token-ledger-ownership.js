/** Positive file-identity witness for the durable token ledger. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const APPLICATION_ID = 0x41454754;
const WITNESS_LIMIT = 1024;

function identity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) throw Error('dedup-cache-not-owned');
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

function matches(a, b) {
  return a?.dev === b?.dev && a?.ino === b?.ino;
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function readChecked(file, expected, limit) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (
      !stat.isFile() ||
      stat.nlink !== 1n ||
      !matches(expected, {
        dev: String(stat.dev),
        ino: String(stat.ino),
      })
    )
      throw Error('dedup-cache-replaced');
    const bytes = Buffer.alloc(limit);
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, limit, 0));
  } finally {
    fs.closeSync(fd);
  }
}

function version(file, expected) {
  const header = readChecked(file, expected, 100);
  if (
    header.length !== 100 ||
    header.toString('ascii', 0, 16) !== 'SQLite format 3\0' ||
    header.readInt32BE(68) !== APPLICATION_ID
  )
    throw Error('dedup-cache-not-owned');
  return header.readInt32BE(60);
}

function reserveFile(file) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return identity(file);
}

function syncDirectory(file) {
  // Windows does not expose portable directory fsync through Node. This witness
  // covers process termination; it does not claim power-loss durability.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Reserve the database/journal and authenticate preexisting recovery artifacts.
 * Same-user concurrent path replacement or in-place modification is out of scope.
 * @param {string} file Database path.
 * @returns {{reopening: boolean, ready: Function}} Ownership lifecycle.
 * @since 0.19.2
 */
function reserveLedger(file) {
  const witnessFile = file + '.ownership';
  const nextFile = witnessFile + '.next';
  for (const suffix of ['-wal', '-shm'])
    if (exists(file + suffix)) throw Error('dedup-journal-not-owned');
  // An interrupted publication is retained for explicit recovery, never replaced.
  if (exists(nextFile)) throw Error('dedup-witness-incomplete');
  const reopening = exists(file);
  let witness;
  const publish = (state) => {
    const next = { ...witness, state };
    const bytes = Buffer.from(JSON.stringify(next));
    if (bytes.length > WITNESS_LIMIT) throw Error('dedup-witness-invalid');
    const fd = fs.openSync(nextFile, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(nextFile, witnessFile);
    syncDirectory(file);
    witness = next;
  };
  if (exists(witnessFile)) {
    const witnessIdentity = identity(witnessFile);
    if (fs.lstatSync(witnessFile).size > WITNESS_LIMIT) throw Error('dedup-witness-invalid');
    try {
      witness = JSON.parse(
        readChecked(witnessFile, witnessIdentity, WITNESS_LIMIT).toString('utf8'),
      );
    } catch {
      throw Error('dedup-witness-invalid');
    }
    const validIdentity = (value) =>
      value &&
      /^\d+$/.test(value.dev) &&
      /^\d+$/.test(value.ino) &&
      typeof value.dev === 'string' &&
      typeof value.ino === 'string';
    if (
      witness?.format !== 1 ||
      witness.state !== 'ready' ||
      !validIdentity(witness.database) ||
      !validIdentity(witness.journal)
    )
      throw Error('dedup-witness-invalid');
    if (!reopening || !matches(identity(file), witness.database))
      throw Error('dedup-cache-replaced');
    if (version(file, witness.database) !== 2) throw Error('dedup-cache-not-owned');
    if (exists(file + '-journal')) {
      if (!matches(identity(file + '-journal'), witness.journal))
        throw Error('dedup-journal-not-owned');
    } else {
      // SQLite may delete a hot journal while recovering it. Publish the new
      // exclusive reservation before any further SQLite write.
      witness.journal = reserveFile(file + '-journal');
      publish('ready');
    }
  } else {
    if (exists(file + '-journal')) throw Error('dedup-journal-not-owned');
    const database = reopening ? identity(file) : reserveFile(file);
    if (reopening && version(file, database) !== 1) throw Error('dedup-witness-missing');
    witness = {
      format: 1,
      state: 'initializing',
      database,
      journal: reserveFile(file + '-journal'),
    };
    publish('initializing');
  }
  return {
    reopening,
    prepareJournal() {
      if (!matches(identity(file), witness.database)) throw Error('dedup-cache-replaced');
      if (!exists(file + '-journal')) witness.journal = reserveFile(file + '-journal');
      if (!matches(identity(file + '-journal'), witness.journal))
        throw Error('dedup-journal-not-owned');
      publish(witness.state);
    },
    ready() {
      publish('ready');
    },
  };
}

module.exports = { reserveLedger };
