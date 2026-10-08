'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixedCorpus = Object.freeze({
  'numbers.json': '{"a":2,"b":3}\n',
  'readme.txt': 'AEGIS fixed dummy sealed-copy guest qualification.\n',
  'sum.cjs': 'module.exports=(a,b)=>a-b;\n',
  'sum.test.cjs':
    "const t=require('node:test'),a=require('node:assert/strict');t('sealed sum',()=>a.equal(require('./sum.cjs')(2,3),5));\n",
});
const editedSum = 'module.exports=(a,b)=>a+b;\n';
const refuse = () => {
  throw new Error('fixed-sealed-copy-refused');
};
function plainAncestors(directory) {
  for (let selected = path.resolve(directory); ; selected = path.dirname(selected)) {
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse();
    if (path.dirname(selected) === selected) break;
  }
}
function readBounded(file, cap) {
  plainAncestors(path.dirname(file));
  const observed = fs.lstatSync(file);
  if (
    !observed.isFile() ||
    observed.isSymbolicLink() ||
    observed.nlink !== 1 ||
    observed.size > cap
  )
    refuse();
  const fd = fs.openSync(file, 'r');
  try {
    const held = fs.fstatSync(fd);
    if (
      held.ino !== observed.ino ||
      held.dev !== observed.dev ||
      held.size !== observed.size ||
      held.nlink !== 1
    )
      refuse();
    const bytes = Buffer.alloc(held.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) refuse();
      offset += count;
    }
    if (
      fs.readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) !== 0 ||
      fs.fstatSync(fd).size !== held.size
    )
      refuse();
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
/**
 * Consume only the fixed dummy corpus. Validate every byte before creating a copy.
 * The maintained caller supplies a fresh writable guest directory and trusted hash.
 * @param {Buffer} bytes Complete bounded AEGSIM01 artifact.
 * @param {string} expectedHash Hash observed by the trusted transfer manifest.
 * @param {string} destination Fresh disposable guest directory.
 * @returns {object} Bounded metrics; full E2.3 qualification remains false.
 * @since v0.19.2
 */
function consumeFixedCopy(bytes, expectedHash, destination) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 16 ||
    bytes.length > 16 + 65536 + 1048576 ||
    !/^[a-f0-9]{64}$/.test(expectedHash) ||
    hash(bytes) !== expectedHash ||
    bytes.subarray(0, 8).toString('ascii') !== 'AEGSIM01'
  )
    refuse();
  const length = bytes.readInt32LE(8),
    payload = bytes.readInt32LE(12);
  if (
    length < 2 ||
    length > 65536 ||
    payload < 0 ||
    payload > 1048576 ||
    16 + length + payload !== bytes.length
  )
    refuse();
  const manifestBytes = bytes.subarray(16, 16 + length);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  if (
    Object.keys(manifest).join() !==
      'schemaVersion,profile,developerOnly,launchAllowed,directories,files' ||
    manifest.schemaVersion !== 1 ||
    manifest.profile !== 'windows-x64-ntfs-dummy-v1' ||
    manifest.developerOnly !== true ||
    manifest.launchAllowed !== false ||
    JSON.stringify(manifest.directories) !== '[""]' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 4 ||
    !Buffer.from(JSON.stringify(manifest)).equals(manifestBytes)
  )
    refuse();
  const copies = [];
  let offset = 0;
  for (const [index, [name, text]] of Object.entries(fixedCorpus).entries()) {
    const row = manifest.files[index],
      content = Buffer.from(text);
    if (
      Object.keys(row).join() !== 'relativePath,size,sha256,offset' ||
      row.relativePath !== name ||
      row.offset !== offset ||
      row.size !== content.length ||
      row.sha256 !== hash(content)
    )
      refuse();
    const captured = bytes.subarray(16 + length + offset, 16 + length + offset + row.size);
    if (!captured.equals(content) || hash(captured) !== row.sha256) refuse();
    copies.push([name, Buffer.from(captured)]);
    offset += row.size;
  }
  if (offset !== payload) refuse();
  plainAncestors(path.dirname(destination));
  fs.mkdirSync(destination); // Existing directories, links and collisions are refused.
  for (const [name, content] of copies)
    fs.writeFileSync(path.join(destination, name), content, { flag: 'wx' });
  for (const [name, content] of copies)
    if (!readBounded(path.join(destination, name), 65536).equals(content)) refuse();
  const values = JSON.parse(readBounded(path.join(destination, 'numbers.json'), 65536));
  if (values.a !== 2 || values.b !== 3) refuse();
  const childOptions = {
    cwd: destination,
    timeout: 5000,
    maxBuffer: 8192,
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      TEMP: destination,
      TMP: destination,
    },
  };
  const before = spawnSync(
    process.execPath,
    ['--test', path.join(destination, 'sum.test.cjs')],
    childOptions,
  );
  if (before.error || before.status !== 1 || before.stderr.length !== 0) refuse();
  fs.writeFileSync(path.join(destination, 'sum.cjs'), editedSum);
  // The child receives no host profile, Git configuration, hooks, credentials or stores.
  const child = spawnSync(
    process.execPath,
    ['--test', path.join(destination, 'sum.test.cjs')],
    childOptions,
  );
  if (
    child.error ||
    child.status !== 0 ||
    child.stderr.length !== 0 ||
    !readBounded(path.join(destination, 'sum.cjs'), 65536).equals(Buffer.from(editedSum))
  )
    refuse();
  for (const [name, content] of copies)
    if (name !== 'sum.cjs' && !readBounded(path.join(destination, name), 65536).equals(content))
      refuse();
  if (hash(bytes) !== expectedHash) refuse();
  return {
    schemaVersion: 1,
    kind: 'fixed-sealed-copy',
    passed: true,
    bundleSha256: expectedHash,
    manifestSha256: hash(manifestBytes),
    fileCount: 4,
    totalBytes: payload,
    sourceUnchanged: true,
    guestReadVerified: true,
    guestEdited: true,
    initialTestExitCode: 1,
    testExitCode: 0,
    editedSha256: hash(Buffer.from(editedSum)),
    e2Qualified: false,
    launchAllowed: false,
  };
}
/**
 * Run in the existing admitted standard-user guest task using fixed trusted inputs.
 * @returns {object} Result consumed after native Job closure by the bootstrap.
 * @since v0.19.2
 */
function runFixedGuestCopy() {
  if (process.platform !== 'win32' || process.env.AEGIS_CLOUD_GUEST_TASK !== '1') refuse();
  const trusted = 'C:\\ProgramData\\AegisCloudLab\\trusted',
    work = 'C:\\AegisLab\\work';
  const manifest = JSON.parse(readBounded(path.join(trusted, 'manifest.json'), 65536));
  if (!Array.isArray(manifest.files)) refuse();
  const expected = manifest.files.filter((row) => row.name === 'sealed-copy.aegis');
  if (expected.length !== 1) refuse();
  const bytes = readBounded(path.join(trusted, 'sealed-copy.aegis'), 16 + 65536 + 1048576);
  const result = consumeFixedCopy(bytes, expected[0].sha256, path.join(work, 'sealed-copy'));
  if (
    hash(readBounded(path.join(trusted, 'sealed-copy.aegis'), 16 + 65536 + 1048576)) !==
    result.bundleSha256
  )
    refuse();
  fs.writeFileSync(path.join(work, 'sealed-copy-result.json'), JSON.stringify(result), {
    flag: 'wx',
  });
  return result;
}
module.exports = { fixedCorpus, consumeFixedCopy, runFixedGuestCopy };
