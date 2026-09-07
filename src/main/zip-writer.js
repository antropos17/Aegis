/**
 * @file zip-writer.js
 * @module main/zip-writer
 * @description Minimal ZIP archive creator using built-in zlib (no external deps).
 * @since v0.3.0
 */
'use strict';

const zlib = require('zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// ── CRC-32 lookup table ──
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

/**
 * Compute CRC-32 checksum of a buffer.
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Create a ZIP archive buffer from an array of entries.
 * @param {{ name: string, data: Buffer }[]} entries
 * @returns {Buffer}
 */
function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    // Local file header (30 bytes + filename)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    // Central directory header (46 bytes + filename)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push({ header: local, data: compressed });
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  // End of central directory (22 bytes)
  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const parts = [];
  for (const l of locals) {
    parts.push(l.header, l.data);
  }
  for (const c of centrals) {
    parts.push(c);
  }
  parts.push(eocd);
  return Buffer.concat(parts);
}

/**
 * Write a ZIP incrementally with asynchronous compression and data descriptors.
 * Each input and compressed chunk is backpressured by the destination write.
 * @param {Array<{name: string, chunks: AsyncIterable<Buffer|string>|Iterable<Buffer|string>}>} entries
 * @param {(chunk: Buffer) => Promise<void>} write
 * @returns {Promise<void>}
 * @since 0.15.0
 */
async function writeZip(entries, write) {
  let offset = 0;
  const centrals = [];
  const emit = async (chunk) => {
    if (offset + chunk.length >= 0xffffffff) throw new Error('ZIP64 is required for this export.');
    await write(chunk);
    offset += chunk.length;
  };
  for (const entry of entries) {
    const start = offset;
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length > 65535 || entries.length > 65535) throw new Error('ZIP limits exceeded.');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x808, 6); // UTF-8 + trailing data descriptor
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    await emit(local);
    let crc = 0xffffffff;
    let size = 0;
    let compressed = 0;
    async function* counted() {
      for await (const value of entry.chunks) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size >= 0xffffffff) throw new Error('ZIP64 is required for this export.');
        for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        yield chunk;
      }
    }
    await pipeline(Readable.from(counted()), zlib.createDeflateRaw(), async (source) => {
      for await (const chunk of source) {
        compressed += chunk.length;
        await emit(chunk);
      }
    });
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await emit(descriptor);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x808, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(start, 42);
    name.copy(central, 46);
    centrals.push(central);
  }
  const directoryOffset = offset;
  for (const central of centrals) await emit(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - directoryOffset, 12);
  end.writeUInt32LE(directoryOffset, 16);
  await emit(end);
}

module.exports = { createZip, writeZip };
