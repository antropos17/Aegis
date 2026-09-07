/** @file Bounded JSON/ZIP audit exports with atomic destination replacement. @since 0.15.0 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setImmediate: yieldTurn } = require('node:timers/promises');
const { writeZip } = require('./zip-writer');

const CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
let busy = false;

async function* jsonChunks(files, stats) {
  yield Buffer.from('[');
  let output = '';
  const append = (line) => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error('record-limit');
    output += (stats.count++ ? ',\n' : '\n') + JSON.stringify(JSON.parse(line));
  };
  for (const file of files) {
    const handle = await fs.promises.open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (stat.ino !== file.ino || stat.dev !== file.dev || stat.size < file.size)
        throw new Error('source-changed');
      if (!file.size) continue;
      const input = handle.createReadStream({
        encoding: 'utf8',
        highWaterMark: CHUNK_BYTES,
        end: file.size - 1,
        autoClose: false,
      });
      let pending = '';
      let bytes = 0;
      for await (const chunk of input) {
        bytes += Buffer.byteLength(chunk);
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          append(line);
          if (output.length >= CHUNK_BYTES) {
            yield Buffer.from(output);
            output = '';
          }
        }
        if (Buffer.byteLength(pending) > MAX_LINE_BYTES) throw new Error('record-limit');
        // Bound the main-thread parse/CRC work even when the disk is fully cached.
        await yieldTurn();
      }
      if (bytes !== file.size) throw new Error('source-truncated');
      append(pending);
      if (output.length >= CHUNK_BYTES) {
        yield Buffer.from(output);
        output = '';
      }
    } finally {
      await handle.close();
    }
  }
  yield Buffer.from(output + '\n]\n');
}

/**
 * Export the captured byte ranges, never an unbounded live journal tail.
 * The destination is replaced only after every read, parse, write and close succeeds.
 * @param {{filePath: string, files: Array<{path: string, size: number, ino: number, dev: number}>,
 *   zip?: boolean, extraEntries?: Array<{name: string, data: object}>}} options
 * @returns {Promise<{success: true, path: string, count: number}>}
 * @since 0.15.0
 */
async function writeAuditExport({ filePath, files, zip = false, extraEntries = [] }) {
  if (busy) throw new Error('An audit export is already running.');
  const resolved = path.resolve(filePath);
  const key = (p) =>
    process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  if (files.some((file) => key(file.path) === key(resolved)))
    throw new Error('Choose an export destination outside the source journal files.');
  busy = true;
  const temporary = path.join(path.dirname(resolved), `.aegis-export-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600);
    const stats = { count: 0 };
    const chunks = jsonChunks(files, stats);
    const write = async (chunk) => {
      await handle.writeFile(chunk);
    };
    if (zip) {
      const entries = [{ name: 'audit-log.json', chunks }];
      for (const entry of extraEntries)
        entries.push({
          name: entry.name,
          chunks: [Buffer.from(JSON.stringify(entry.data, null, 2))],
        });
      await writeZip(entries, write);
    } else {
      for await (const chunk of chunks) await write(chunk);
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(temporary, resolved);
    return { success: true, path: resolved, count: stats.count };
  } catch {
    // Neither a parser excerpt nor a filesystem path belongs in the IPC error.
    throw new Error(
      'Audit export incomplete: a source is unreadable, invalid or too large, or the destination could not be written.',
    );
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.unlink(temporary).catch(() => {});
    busy = false;
  }
}

module.exports = { writeAuditExport };
