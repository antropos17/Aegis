'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { importCsv } = require('./lib/oracles/procmon');
const { LIMITS } = require('./lib/oracles/procmon-csv');

/**
 * Read a regular file through a fixed-size buffer, including a growth sentinel byte.
 * @param {string} file Input filename.
 * @param {number} limit Maximum bytes.
 * @returns {Buffer} Bounded file contents.
 * @since v0.11.0
 */
function readBounded(file, limit) {
  if (!fs.lstatSync(file).isFile()) throw new Error('Regular input file required');
  const descriptor = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit) throw new Error('Input byte limit');
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = fs.readSync(descriptor, buffer, used, buffer.length - used, used);
      if (!count) break;
      used += count;
    }
    if (used > limit) throw new Error('Input byte limit');
    return buffer.subarray(0, used);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Write a fresh staging JSON file; never start Procmon or admit records to scoring.
 * @param {string[]} args CLI arguments.
 * @returns {number} Exit status.
 * @since v0.11.0
 */
function main(args) {
  try {
    const options = new Map();
    if (args.length !== 6) throw new Error('Expected --csv FILE --receipt FILE --out FILE');
    for (let index = 0; index < args.length; index += 2) {
      if (
        !['--csv', '--receipt', '--out'].includes(args[index]) ||
        options.has(args[index]) ||
        !args[index + 1] ||
        args[index + 1].startsWith('--')
      )
        throw new Error('Invalid arguments');
      options.set(args[index], args[index + 1]);
    }
    const output = options.get('--out');
    if (path.extname(output) !== '.json') throw new Error('Staging output must use .json');
    const staging = importCsv(
      readBounded(options.get('--csv'), LIMITS.csvBytes),
      readBounded(options.get('--receipt'), LIMITS.receiptBytes),
    );
    const bytes = JSON.stringify(staging) + '\n';
    if (Buffer.byteLength(bytes) > LIMITS.outputBytes) throw new Error('Output byte limit');
    fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    process.stdout.write('Procmon offline staging written; not admitted to scoring.\n');
    return 0;
  } catch (error) {
    // Filesystem and JSON parser diagnostics can include private paths or raw input.
    const reason = error.code || (error instanceof SyntaxError ? 'Malformed JSON' : error.message);
    process.stderr.write(`Procmon import refused: ${reason}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, readBounded };
