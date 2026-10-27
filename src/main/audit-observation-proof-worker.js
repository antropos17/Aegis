'use strict';

const { workerData, parentPort } = require('node:worker_threads');
const fs = require('node:fs');

function statFile(filename, required) {
  try {
    const stat = fs.lstatSync(filename, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('unavailable');
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return null;
    throw error;
  }
}

// The worker sends only fixed-shape digests and counts. Failures carry no
// filesystem paths, raw audit rows, or native diagnostics back to the parent.
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  const { captureObservationProof } = require('./audit-index-observation-proof');
  const database = statFile(workerData.databasePath, true);
  const wal = statFile(workerData.databasePath + '-wal', false);
  statFile(workerData.databasePath + '-shm', false);
  db = new DatabaseSync(workerData.databasePath, { readOnly: true });
  db.exec('PRAGMA cache_size = -2048; PRAGMA mmap_size = 0');
  const result = captureObservationProof(db, workerData.directory, workerData.targets);
  const same =
    database === statFile(workerData.databasePath, true) &&
    wal === statFile(workerData.databasePath + '-wal', false);
  const bytes = Buffer.from(JSON.stringify(same ? result : null), 'utf8');
  if (bytes.length > workerData.resultBuffer.byteLength) parentPort.postMessage(0);
  else {
    new Uint8Array(workerData.resultBuffer).set(bytes);
    parentPort.postMessage(bytes.length);
  }
  bytes.fill(0);
} catch {
  parentPort.postMessage(0);
} finally {
  try {
    db?.close();
  } catch {
    /* an unavailable proof remains unavailable */
  }
}
