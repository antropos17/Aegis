'use strict';

const fs = require('fs');
const path = require('path');
const CHUNK_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;

/** Seed a captured journal prefix, yielding after each bounded read.
 * Later appends are excluded: the logger already counts them as live events.
 * @param {string} logDir Journal directory after retention.
 * @param {(entry: Object) => void} onEntry Valid historical event callback.
 * @param {(state: 'building'|'ready'|'unavailable') => void} onState Completion state.
 * @returns {{done: Promise<void>, cancel: () => void}} Cancellable seed task.
 * @since 0.18.0
 */
function seedCounters(logDir, onEntry, onState) {
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  let alive = true;
  let fd = null;
  let immediate;
  let files = [];
  let fileIndex = 0;
  let pos = 0;
  let carry = Buffer.alloc(0);
  let skipping = false;
  let incomplete = false;
  const chunk = Buffer.alloc(CHUNK_BYTES);
  const close = () => {
    if (fd !== null) {
      const closing = fd;
      fd = null;
      fs.closeSync(closing);
    }
  };
  const settle = (state) => {
    if (!alive) return;
    alive = false;
    clearImmediate(immediate);
    try {
      close();
    } catch {
      state = 'unavailable';
    }
    onState(state);
    finish();
  };
  const accept = (bytes) => {
    if (!bytes.length || !bytes.toString('utf8').trim()) return;
    try {
      const entry = JSON.parse(bytes.toString('utf8'));
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error();
      if (entry.type !== 'buffer-overflow-drop') onEntry(entry);
    } catch {
      incomplete = true;
    }
  };
  const consume = (bytes, end) => {
    let from = 0;
    for (;;) {
      const newline = bytes.indexOf(10, from);
      const to = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(from, to);
      if (!skipping) {
        if (carry.length + part.length > MAX_RECORD_BYTES) {
          carry = Buffer.alloc(0);
          skipping = true;
          incomplete = true;
        } else if (part.length) carry = Buffer.concat([carry, part]);
      }
      if (newline < 0) break;
      if (!skipping) accept(carry);
      carry = Buffer.alloc(0);
      skipping = false;
      from = newline + 1;
    }
    if (end) {
      if (!skipping) accept(carry);
      carry = Buffer.alloc(0);
      skipping = false;
    }
  };
  const step = () => {
    if (!alive) return;
    try {
      let emptyFiles = 0;
      let budget = CHUNK_BYTES;
      while (fileIndex < files.length) {
        const file = files[fileIndex];
        if (fd === null) {
          fd = fs.openSync(file.path, 'r');
          const current = fs.fstatSync(fd);
          if (current.ino !== file.ino || current.dev !== file.dev || current.size < file.size)
            throw new Error();
          pos = 0;
        }
        const length = Math.min(budget, file.size - pos);
        const n = length ? fs.readSync(fd, chunk, 0, length, pos) : 0;
        if (length && !n) throw new Error();
        pos += n;
        budget -= n;
        consume(chunk.subarray(0, n), pos === file.size);
        if (pos === file.size) {
          close();
          fileIndex++;
        }
        // Bound both bytes and zero-length files processed in one main-thread turn.
        if (budget === 0 || (!n && ++emptyFiles >= 32)) break;
      }
      if (fileIndex === files.length) settle(incomplete ? 'unavailable' : 'ready');
      else immediate = setImmediate(step);
    } catch {
      settle('unavailable');
    }
  };
  onState('building');
  try {
    files = fs
      .readdirSync(logDir)
      .filter((name) => name.startsWith('aegis-audit-') && name.endsWith('.json'))
      .sort()
      .map((name) => {
        const filePath = path.join(logDir, name);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) throw new Error();
        return { path: filePath, size: stat.size, ino: stat.ino, dev: stat.dev };
      });
    step();
  } catch {
    settle('unavailable');
  }
  return { done, cancel: () => settle('unavailable') };
}

module.exports = { seedCounters };
