import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const GUI_EXECUTABLE = 'AEGIS - AI Monitoring & Threat Detection.exe';
const invalid = () => {
  throw new Error('protected-gui-manifest-refused');
};

/** Validate one canonical bounded package-relative Windows path.
 * @param {string} value Relative path. @returns {void} @since v0.19.2-beta */
export function validateGuiPath(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 240 ||
    !/^[A-Za-z0-9_.$@()+ &/-]+$/.test(value) ||
    value.split('/').length > 12
  )
    invalid();
  for (const part of value.split('/')) {
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      /^[ .]|[ .]$/.test(part) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
    )
      invalid();
  }
}

/** Produce integrity metadata for a complete administrator-selected candidate.
 * This function grants no release provenance, enrollment or launch permission.
 * @param {string} sourceRoot Selected package directory. @returns {Buffer} Canonical manifest bytes. @since v0.19.2-beta */
export function produceGuiManifest(sourceRoot) {
  const root = path.resolve(sourceRoot);
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) invalid();
  const directories = [],
    files = [],
    names = new Set();
  let total = 0;
  function unique(relative) {
    validateGuiPath(relative);
    const key = relative.toLowerCase();
    if (names.has(key)) invalid();
    names.add(key);
    if (names.size > 2048) invalid();
  }
  function visit(relative = '') {
    const directory = path.join(root, relative);
    const handle = fs.opendirSync(directory),
      members = [];
    try {
      for (;;) {
        const member = handle.readSync();
        if (!member) break;
        members.push(member.name);
        if (members.length > 2048) invalid();
      }
    } finally {
      handle.closeSync();
    }
    for (const name of members.sort()) {
      const item = relative ? `${relative}/${name}` : name;
      unique(item);
      const absolute = path.join(root, item),
        before = fs.lstatSync(absolute, { bigint: true });
      if (before.isSymbolicLink()) invalid();
      if (before.isDirectory()) {
        directories.push(item);
        if (directories.length > 1024) invalid();
        visit(item);
      } else {
        if (
          !before.isFile() ||
          before.nlink !== 1n ||
          before.size > 536870912n ||
          files.length >= 1024
        )
          invalid();
        const file = fs.openSync(absolute, 'r'),
          buffer = Buffer.alloc(65536),
          hash = createHash('sha256');
        let count = 0;
        try {
          const held = fs.fstatSync(file, { bigint: true });
          if (held.ino !== before.ino || held.dev !== before.dev || held.size !== before.size)
            invalid();
          for (;;) {
            const read = fs.readSync(file, buffer, 0, buffer.length, null);
            if (!read) break;
            count += read;
            if (count > Number(before.size) || count > 536870912 || total + count > 2147483648)
              invalid();
            hash.update(buffer.subarray(0, read));
          }
          const after = fs.fstatSync(file, { bigint: true });
          if (
            count !== Number(before.size) ||
            after.size !== before.size ||
            after.nlink !== 1n ||
            after.ino !== before.ino ||
            after.mtimeNs !== before.mtimeNs ||
            after.ctimeNs !== before.ctimeNs
          )
            invalid();
        } finally {
          buffer.fill(0);
          fs.closeSync(file);
        }
        total += count;
        files.push({ path: item, bytes: count, sha256: hash.digest('hex') });
      }
    }
  }
  visit();
  directories.sort();
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    !files.some((file) => file.path === GUI_EXECUTABLE) ||
    !files.some((file) => file.path === 'resources/app.asar')
  )
    invalid();
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      scope: 'protected-gui-bundle-candidate',
      executable: GUI_EXECUTABLE,
      directories,
      files,
    }),
    'utf8',
  );
  if (bytes.length > 524288) invalid();
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) invalid();
    const manifest = produceGuiManifest(process.argv[2]);
    fs.writeFileSync(process.argv[3], manifest, { flag: 'wx' });
  } catch {
    process.stderr.write('protected-gui-manifest-refused\n');
    process.exitCode = 2;
  }
}
