'use strict';
const fs = require('node:fs');
const path = require('node:path');
const shared = require('./resource-replay-io');
const c = require('./linux-cpu-replay-common');
const ROOT = path.resolve(__dirname, '../..');
const SOURCES = Object.freeze([
  'bench/linux-cpu-replay.cjs',
  'bench/lib/linux-cpu-replay.js',
  'bench/lib/linux-cpu-replay-common.js',
  'bench/lib/linux-cpu-replay-packets.js',
  'bench/lib/linux-cpu-replay-observations.js',
  'bench/lib/linux-cpu-replay-bindings.js',
  'bench/lib/linux-cpu-replay-io.js',
  'bench/lib/resource-replay-json.js',
  'bench/lib/resource-replay-io.js',
  'bench/lib/resource-replay-common.js',
  'bench/lib/resource-replay-raw.js',
  'bench/lib/linux-own-cpu-model.js',
  'bench/lib/linux-own-cpu-proc.js',
]);
/** Validate paths/options without reading input or invoking accessors. @param {object} o Closed input/out. @returns {object} Resolved paths. @since unreleased */
function options(o) {
  try {
    c.assert(o && [Object.prototype, null].includes(Object.getPrototypeOf(o)));
    const d = Object.getOwnPropertyDescriptors(o);
    c.assert(Reflect.ownKeys(d).length === 2);
    for (const key of ['input', 'out'])
      c.assert(d[key]?.enumerable === true && Object.hasOwn(d[key], 'value'));
    const result = {};
    for (const key of ['input', 'out']) {
      const v = d[key].value;
      c.assert(
        typeof v === 'string' &&
          v.length > 0 &&
          v.length <= 4096 &&
          !v.includes('\0') &&
          !/^[/\\]{2}/.test(v),
      );
      result[key] = path.resolve(v);
      c.assert(result[key] !== path.parse(result[key]).root);
    }
    for (const [a, b] of [
      [result.input, result.out],
      [result.out, result.input],
    ]) {
      const rel = path.relative(a, b);
      c.assert(
        rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)),
      );
    }
    return result;
  } catch {
    throw Error('linux-cpu-replay-input-invalid');
  }
}
/** Preflight a fresh output without creating it. @param {string} out Resolved output. @returns {void} @since unreleased */
function fresh(out) {
  try {
    shared.directory(path.dirname(out));
    try {
      fs.lstatSync(out);
      throw Error('exists');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  } catch {
    throw Error('linux-cpu-replay-output-refused');
  }
}
/** Read only the five fixed artifacts with their real aggregate cap. @param {string} input Ordinary directory. @returns {object} Exact bytes. @since unreleased */
function bundle(input) {
  shared.directory(input);
  const b = {},
    budget = { bytes: 0 };
  for (const [file, cap] of Object.entries(c.FILES)) {
    const bytes = shared.read(path.join(input, file), cap, budget, true);
    c.assert(budget.bytes <= 131072);
    if (bytes) {
      const value = c.parse(bytes);
      c.safeData(value);
      b[file] = { file, value, sha256: c.hash(bytes), byteLength: bytes.length, closed: true };
    } else b[file] = null;
  }
  return b;
}
/** Hash fixed current checker/model disk bytes at one endpoint. @returns {object} Sanitized inventory. @since unreleased */
function inventory() {
  const budget = { bytes: 0 };
  return {
    basis: 'current-repository-disk-bytes-at-endpoint',
    loadedCodeAuthenticated: false,
    nodeVersion: process.version,
    files: SOURCES.map((file) => {
      const full = path.join(ROOT, file);
      shared.directory(path.dirname(full));
      const bytes = shared.read(full, 65536, budget);
      return { file, sha256: c.hash(bytes), byteLength: bytes.length };
    }),
  };
}
/** Publish fresh bounded report; successful return confirms this write/close only. @param {string} out Fresh directory. @param {object} report Safe report. @returns {void} @since unreleased */
function publish(out, report) {
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  c.assert(bytes.length <= 65536);
  try {
    shared.directory(path.dirname(out));
    fs.mkdirSync(out);
  } catch {
    throw Error('linux-cpu-replay-output-refused');
  }
  shared.directory(out);
  const fd = fs.openSync(
    path.join(out, 'linux-cpu-replay.json'),
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    let pos = 0;
    while (pos < bytes.length) {
      const n = fs.writeSync(fd, bytes, pos, bytes.length - pos, null);
      c.assert(c.integer(n, 1, bytes.length - pos));
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = { ROOT, SOURCES, options, fresh, bundle, inventory, publish };
