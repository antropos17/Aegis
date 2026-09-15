'use strict';

/** @file Bounded, read-only filesystem access for explicit project inventories. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({
  entries: 1024,
  fileBytes: 1048576,
  totalBytes: 8388608,
  depth: 6,
});

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/**
 * Create an inventory reader. The selected root is canonicalized; links below it
 * are skipped. This is a best-effort snapshot, not an OS sandbox against races.
 * @param {string} directory Explicit project directory.
 * @param {Partial<typeof DEFAULT_LIMITS>} [overrides] Lower bounds for fixture tests/callers.
 * @returns {Promise<object>} Reader with bounded visit operations and plain status.
 * @since v0.15.1
 */
async function createInventoryReader(directory, overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of Object.keys(limits)) {
    if (
      !Object.hasOwn(DEFAULT_LIMITS, key) ||
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > DEFAULT_LIMITS[key]
    ) {
      throw new Error('invalid-limits');
    }
  }
  const root = await fs.promises.realpath(directory);
  if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('invalid-root');
  const issues = [];
  let entries = 0;
  let bytes = 0;
  let stopped = false;

  function issue(relativePath, reason) {
    issues.push({ path: relativePath, reason });
  }

  async function checkedPath(relativePath) {
    const parts = relativePath.split('/');
    if (parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes(':'))) {
      throw new Error('invalid-path');
    }
    let absolute = root;
    let stat;
    for (const part of parts) {
      absolute = path.join(absolute, part);
      stat = await fs.promises.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('link-skipped');
    }
    if ((await fs.promises.realpath(absolute)) !== absolute) throw new Error('path-changed');
    return { absolute, stat };
  }

  async function readFile(relativePath, absolute, stat) {
    if (stat.size > limits.fileBytes) {
      issue(relativePath, 'file-size-limit');
      return null;
    }
    if (bytes + stat.size + 1 > limits.totalBytes) {
      stopped = true;
      issue(relativePath, 'total-bytes-limit');
      return null;
    }
    const handle = await fs.promises.open(
      absolute,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFile(stat, opened)) throw new Error('file-changed');
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, length);
        bytes += result.bytesRead;
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      const current = await checkedPath(relativePath);
      if (
        length !== stat.size ||
        !sameFile(opened, await handle.stat()) ||
        !sameFile(opened, current.stat)
      ) {
        throw new Error('file-changed');
      }
      const data = buffer.subarray(0, length);
      return { data, size: length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
    } finally {
      await handle.close();
    }
  }

  /** Visit only named paths, optionally walking a known skills directory. */
  async function visit(relativePath, onFile, recursive = false, depth = 0) {
    if (stopped) return;
    if (entries >= limits.entries) {
      stopped = true;
      issue(relativePath, 'entry-limit');
      return;
    }
    entries++;
    let observed = false;
    try {
      const { absolute, stat } = await checkedPath(relativePath);
      observed = true;
      if (stat.isFile()) {
        const file = await readFile(relativePath, absolute, stat);
        if (file) onFile(relativePath, file);
      } else if (stat.isDirectory() && recursive) {
        if (depth >= limits.depth) {
          issue(relativePath, 'depth-limit');
          return;
        }
        const directoryHandle = await fs.promises.opendir(absolute);
        for await (const entry of directoryHandle) {
          if (stopped) break;
          await visit(`${relativePath}/${entry.name}`, onFile, true, depth + 1);
        }
      } else {
        issue(relativePath, 'unsupported-file-type');
      }
    } catch (error) {
      // Missing selected locations are normal. Missing entries after enumeration
      // indicate a changing snapshot. Never return OS/parser error messages.
      if (error.code === 'ENOENT' && depth === 0 && !observed) return;
      const known = ['link-skipped', 'path-changed', 'file-changed', 'invalid-path'];
      issue(relativePath, known.includes(error.message) ? error.message : 'unreadable');
    }
  }

  return { visit, issues, limits, usage: () => ({ entries, bytes }) };
}

module.exports = { createInventoryReader };
