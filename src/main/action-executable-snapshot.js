'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_EXECUTABLE_BYTES = 128 * 1024 * 1024;
const HASH_MS = 4000;
const CHUNK_BYTES = 256 * 1024;

/** Read bounded executable bytes for one private AppContainer approval.
 * @param {string} selected Exact Windows executable path.
 * @param {{signal?: AbortSignal}} [options] Owning cancellation.
 * @returns {Promise<{path:string,size:number,sha256:string}>} Private frozen descriptor.
 * @since v0.17.0 */
async function readExecutableSnapshot(selected, { signal } = {}) {
  if (
    process.platform !== 'win32' ||
    typeof selected !== 'string' ||
    selected.length < 4 ||
    selected.length > 32000 ||
    !/^[a-zA-Z]:\\/.test(selected) ||
    selected.slice(2).includes(':') ||
    path.win32.normalize(selected) !== selected
  )
    throw new Error('executable-unavailable');
  const started = performance.now();
  const check = () => {
    if (signal?.aborted || performance.now() - started >= HASH_MS)
      throw new Error('executable-unavailable');
  };
  const root = path.win32.parse(selected).root;
  const parts = selected.slice(root.length).split('\\');
  if (
    !parts.length ||
    parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    throw new Error('executable-unavailable');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    check();
    current = path.win32.join(current, parts[index]);
    const info = await fs.promises.lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error('executable-unavailable');
  }
  check();
  const file = await fs.promises.open(selected, 'r');
  const bytes = Buffer.allocUnsafe(CHUNK_BYTES);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_EXECUTABLE_BYTES)
      throw new Error('executable-unavailable');
    const hash = createHash('sha256');
    let total = 0;
    while (true) {
      check();
      const { bytesRead } = await file.read(
        bytes,
        0,
        Math.min(bytes.length, MAX_EXECUTABLE_BYTES + 1 - total),
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_EXECUTABLE_BYTES) throw new Error('executable-unavailable');
      hash.update(bytes.subarray(0, bytesRead));
    }
    check();
    const after = await file.stat();
    const atPath = await fs.promises.lstat(selected);
    if (
      total !== before.size ||
      before.size !== after.size ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.mtimeMs !== after.mtimeMs ||
      atPath.isSymbolicLink() ||
      atPath.ino !== after.ino ||
      atPath.dev !== after.dev
    )
      throw new Error('executable-unavailable');
    return Object.freeze({ path: selected, size: total, sha256: hash.digest('hex') });
  } finally {
    bytes.fill(0);
    await file.close();
  }
}

/** Bound the asynchronous read even when a filesystem operation stalls.
 * @param {string} selected Exact Windows executable path.
 * @param {{signal?: AbortSignal}} [options] Owning cancellation.
 * @returns {Promise<{path:string,size:number,sha256:string}>} Private frozen descriptor.
 * @since v0.17.0 */
async function captureExecutableSnapshot(selected, { signal } = {}) {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, HASH_MS);
  let rejectAborted;
  const cancelled = new Promise((_resolve, reject) => {
    rejectAborted = () => reject(new Error('executable-unavailable'));
    lifetime.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([
      readExecutableSnapshot(selected, { signal: lifetime.signal }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    lifetime.signal.removeEventListener('abort', rejectAborted);
  }
}

module.exports = { captureExecutableSnapshot, MAX_EXECUTABLE_BYTES, HASH_MS };
