import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = () => {
  throw new Error('sealed-import-oracle-mismatch');
};

function readBounded(file, maximum, budget) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (!Number.isSafeInteger(size) || size < 0 || size > maximum || size > budget) fail();
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, bytes, offset, size - offset, offset);
      if (count === 0) fail();
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(fd, extra, 0, 1, size) !== 0 || fs.fstatSync(fd).size !== size) fail();
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Independently parse a bounded binary bundle and compare the selected clean corpus.
 * @param {string} bundle Published binary bundle, never an archive to extract.
 * @param {string} source Disposable clean corpus used by the independent oracle.
 * @returns {object} Redacted observed counts and hashes.
 * @since v0.17.0
 */
export function inspectSealedImportBundle(bundle, source) {
  const bytes = readBounded(bundle, 16 + 65536 + 1048576, 16 + 65536 + 1048576);
  if (
    bytes.length < 16 ||
    bytes.length > 16 + 65536 + 1048576 ||
    !bytes.subarray(0, 8).equals(Buffer.from('AEGSIM01', 'ascii'))
  )
    fail();
  const length = bytes.readInt32LE(8);
  const payloadLength = bytes.readInt32LE(12);
  if (
    length < 2 ||
    length > 65536 ||
    payloadLength < 0 ||
    payloadLength > 1048576 ||
    16 + length + payloadLength !== bytes.length
  )
    fail();
  const manifestBytes = bytes.subarray(16, 16 + length);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  const manifestKeys = [
    'schemaVersion',
    'profile',
    'developerOnly',
    'launchAllowed',
    'directories',
    'files',
  ];
  if (
    manifest.schemaVersion !== 1 ||
    manifest.launchAllowed !== false ||
    manifest.profile !== 'windows-x64-ntfs-dummy-v1' ||
    manifest.developerOnly !== true ||
    Object.keys(manifest).join() !== manifestKeys.join() ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.directories) ||
    manifest.directories.length > 32 ||
    Buffer.from(JSON.stringify(manifest)).compare(manifestBytes) !== 0 ||
    manifest.files.length > 128
  )
    fail();
  const expected = new Map();
  const directories = [];
  let totalBytes = 0;
  function walk(directory, prefix, depth = 0) {
    if (directories.length >= 32 || depth > 8) fail();
    directories.push(prefix);
    const handle = fs.opendirSync(directory, { bufferSize: 32 });
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (relative.length > 240 || entry.name.length > 64 || depth + 1 > 8) fail();
        if (entry.isDirectory()) walk(path.join(directory, entry.name), relative, depth + 1);
        else if (entry.isFile()) {
          if (expected.size >= 128) fail();
          const original = readBounded(
            path.join(directory, entry.name),
            65536,
            1048576 - totalBytes,
          );
          totalBytes += original.length;
          expected.set(relative, original);
        } else fail();
      }
    } finally {
      handle.closeSync();
    }
  }
  walk(source, '');
  if (
    expected.size !== manifest.files.length ||
    JSON.stringify(directories.sort()) !== JSON.stringify(manifest.directories)
  )
    fail();
  const ordered = [...expected.keys()].sort();
  let offset = 0;
  for (let index = 0; index < manifest.files.length; index++) {
    const row = manifest.files[index];
    const original = expected.get(row.relativePath);
    if (
      Object.keys(row).join() !== 'relativePath,size,sha256,offset' ||
      row.relativePath !== ordered[index] ||
      !original ||
      row.offset !== offset ||
      row.size !== original.length ||
      row.size > 65536 ||
      !/^[a-f0-9]{64}$/.test(row.sha256)
    )
      fail();
    const copied = bytes.subarray(16 + length + offset, 16 + length + offset + row.size);
    if (!copied.equals(original) || hash(copied) !== row.sha256) fail();
    offset += row.size;
  }
  if (16 + length + offset !== bytes.length || offset > 1048576) fail();
  return {
    fileCount: expected.size,
    totalBytes: offset,
    manifestSha256: hash(manifestBytes),
    bundleSha256: hash(bytes),
  };
}
