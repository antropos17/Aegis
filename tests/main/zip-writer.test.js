import { describe, it, expect } from 'vitest';
import { createZip } from '../../src/main/zip-writer.js';
import { inflateRawSync } from 'zlib';

/**
 * Extract entries from a ZIP buffer by parsing local file headers.
 * Returns array of { name, data } with decompressed data.
 */
function extractZipEntries(zipBuf) {
  const entries = [];
  let offset = 0;
  while (offset < zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // not a local file header
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const uncompressedSize = zipBuf.readUInt32LE(offset + 22);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const name = zipBuf.subarray(offset + 30, offset + 30 + nameLen).toString('utf-8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = zipBuf.subarray(dataStart, dataStart + compressedSize);
    const data = inflateRawSync(compressed);
    expect(data.length).toBe(uncompressedSize);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe('zip-writer', () => {
  it('creates a valid ZIP with a single entry', () => {
    const content = Buffer.from('hello world');
    const zip = createZip([{ name: 'test.txt', data: content }]);
    expect(zip).toBeInstanceOf(Buffer);

    const entries = extractZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('test.txt');
    expect(entries[0].data.toString()).toBe('hello world');
  });

  it('creates a valid ZIP with multiple entries', () => {
    const files = [
      { name: 'a.txt', data: Buffer.from('alpha') },
      { name: 'b.json', data: Buffer.from('{"key":"value"}') },
      { name: 'c.log', data: Buffer.from('line1\nline2\nline3') },
    ];
    const zip = createZip(files);
    const entries = extractZipEntries(zip);
    expect(entries).toHaveLength(3);
    expect(entries[0].data.toString()).toBe('alpha');
    expect(entries[1].data.toString()).toBe('{"key":"value"}');
    expect(entries[2].data.toString()).toBe('line1\nline2\nline3');
  });

  it('handles empty entries array', () => {
    const zip = createZip([]);
    expect(zip).toBeInstanceOf(Buffer);
    // Should still contain the end-of-central-directory record (22 bytes)
    expect(zip.length).toBeGreaterThanOrEqual(22);
    const entries = extractZipEntries(zip);
    expect(entries).toHaveLength(0);
  });

  it('handles empty file data', () => {
    const zip = createZip([{ name: 'empty.txt', data: Buffer.alloc(0) }]);
    const entries = extractZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('empty.txt');
    expect(entries[0].data.length).toBe(0);
  });

  it('preserves unicode filenames', () => {
    const name = 'файл-данных.txt';
    const zip = createZip([{ name, data: Buffer.from('данные') }]);
    const entries = extractZipEntries(zip);
    expect(entries[0].name).toBe(name);
    expect(entries[0].data.toString()).toBe('данные');
  });

  it('handles larger data (1KB)', () => {
    const largeData = Buffer.alloc(1024, 'A');
    const zip = createZip([{ name: 'large.bin', data: largeData }]);
    const entries = extractZipEntries(zip);
    expect(entries[0].data.length).toBe(1024);
    expect(entries[0].data.every((b) => b === 0x41)).toBe(true);
  });

  it('contains valid end-of-central-directory signature', () => {
    const zip = createZip([{ name: 'x.txt', data: Buffer.from('x') }]);
    // EOCD signature is at the end of the buffer
    const eocdSig = zip.readUInt32LE(zip.length - 22);
    expect(eocdSig).toBe(0x06054b50);
  });
});
