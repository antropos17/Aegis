'use strict';

/** @file Verify package-manifest bytes against local loose Git objects without invoking Git. */
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const path = require('node:path').posix;
const { TextDecoder } = require('node:util');

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const join = (directory, name) => (directory ? `${directory}/${name}` : name);
const parent = (name) => (path.dirname(name) === '.' ? '' : path.dirname(name));
const decode = (data) => new TextDecoder('utf-8', { fatal: true }).decode(data);

function treeEntry(data, name, bytes) {
  const wanted = Buffer.from(name, 'utf8');
  let offset = 0;
  let found = null;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const end = data.indexOf(0, space + 1);
    if (space < offset || space - offset > 6 || end <= space + 1 || end + bytes >= data.length)
      throw new Error('invalid-tree');
    const mode = data.toString('utf8', offset, space);
    const filename = data.subarray(space + 1, end);
    if (
      !['40000', '100644', '100755', '120000', '160000'].includes(mode) ||
      filename.includes(0x2f) ||
      filename.equals(Buffer.from('.')) ||
      filename.equals(Buffer.from('..'))
    )
      throw new Error('invalid-tree');
    if (filename.equals(wanted)) {
      if (found) throw new Error('invalid-tree');
      found = { mode, oid: data.subarray(end + 1, end + 1 + bytes).toString('hex') };
    }
    offset = end + 1 + bytes;
  }
  return found;
}

/**
 * Create a bounded verifier sharing one inventory's filesystem/expansion budgets.
 * Local commit matches establish byte agreement only, never publisher identity.
 * @param {object} reader Shared inventory reader. No path may escape its selected root.
 * @returns {object} Manifest verifier and decompressed byte usage.
 * @since v0.15.1
 */
function createInventoryGit(reader) {
  const files = new Map();
  const repositories = new Map();
  const objects = new Map();
  const reported = new Set();
  let inflatedBytes = 0;

  function failure(name, status) {
    const key = `${name}:${status}`;
    if (!reported.has(key)) {
      reader.issues.push({ path: name, reason: `git-${status}` });
      reported.add(key);
    }
    return { status };
  }

  async function read(name) {
    if (files.has(name)) return files.get(name);
    const before = reader.issues.length;
    let file = null;
    await reader.visit(name, (_name, value) => {
      file = value;
    });
    const result = file
      ? { status: 'read', file }
      : {
          status: reader.isStopped()
            ? 'inventory-incomplete'
            : reader.issues.length > before
              ? 'unavailable'
              : 'not-observed',
        };
    files.set(name, result);
    return result;
  }

  async function loadRepository(directory) {
    const gitDirectory = join(directory, '.git');
    const headPath = `${gitDirectory}/HEAD`;
    const head = await read(headPath);
    if (!head.file) return head;
    try {
      const text = decode(head.file.data).replace(/\r?\n$/, '');
      let oid = text;
      if (text.startsWith('ref: ')) {
        const ref = text.slice(5);
        // No gitdir, commondir, alternates, includes, replacements or remote access.
        if (
          !/^refs\/(?:heads|tags)\/[A-Za-z0-9_./-]+$/.test(ref) ||
          ref.split('/').some((part) => !part || part === '.' || part === '..')
        )
          return failure(headPath, 'invalid-head');
        const loose = await read(`${gitDirectory}/${ref}`);
        if (loose.file) oid = decode(loose.file.data).replace(/\r?\n$/, '');
        else {
          if (loose.status !== 'not-observed') return { status: loose.status };
          const packed = await read(`${gitDirectory}/packed-refs`);
          if (!packed.file) return failure(headPath, 'head-unavailable');
          const matches = decode(packed.file.data)
            .split(/\r?\n/)
            .filter((line) => line.endsWith(` ${ref}`));
          if (matches.length !== 1) return failure(headPath, 'head-unavailable');
          oid = matches[0].split(' ')[0];
          if (matches[0] !== `${oid} ${ref}`) return failure(headPath, 'invalid-head');
        }
      }
      if (!OID.test(oid)) return failure(headPath, 'invalid-head');
      return {
        status: 'resolved',
        directory,
        gitDirectory,
        oid,
        algorithm: oid.length === 40 ? 'sha1' : 'sha256',
      };
    } catch (_) {
      return failure(headPath, 'invalid-head');
    }
  }

  async function repository(directory, boundary) {
    while (true) {
      if (!repositories.has(directory))
        repositories.set(directory, await loadRepository(directory));
      const result = repositories.get(directory);
      if (result.status !== 'not-observed') return result;
      if (directory === boundary || !directory) return result;
      directory = parent(directory);
    }
  }

  async function object(repo, oid) {
    const name = `${repo.gitDirectory}/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
    if (objects.has(name)) return objects.get(name);
    const result = await read(name);
    if (!result.file)
      return failure(name, result.status === 'not-observed' ? 'object-unavailable' : result.status);
    const remaining = reader.limits.totalBytes - inflatedBytes;
    const maxOutputLength = Math.min(reader.limits.fileBytes + 64, remaining);
    if (maxOutputLength <= 0) return failure(name, 'expanded-bytes-limit');
    try {
      const expanded = zlib.inflateSync(result.file.data, { maxOutputLength, info: true });
      const data = expanded.buffer;
      inflatedBytes += data.length;
      if (expanded.engine.bytesWritten !== result.file.data.length)
        return failure(name, 'invalid-object');
      const end = data.indexOf(0);
      if (end < 0 || end > 63) return failure(name, 'invalid-object');
      const header = /^(commit|tree|blob|tag) (0|[1-9][0-9]*)$/.exec(data.toString('utf8', 0, end));
      if (
        !header ||
        Number(header[2]) !== data.length - end - 1 ||
        crypto.createHash(repo.algorithm).update(data).digest('hex') !== oid
      )
        return failure(name, 'invalid-object');
      const loaded = { status: 'read', type: header[1], data: data.subarray(end + 1) };
      objects.set(name, loaded);
      return loaded;
    } catch (_) {
      // Charge the full attempted expansion on a rejected stream/bomb as well.
      inflatedBytes = Math.min(reader.limits.totalBytes, inflatedBytes + maxOutputLength);
      return failure(name, 'invalid-or-oversized-object');
    }
  }

  async function verifyManifest(manifest, boundary, blobs) {
    const repo = await repository(parent(manifest), boundary);
    if (repo.status !== 'resolved') return { status: repo.status };
    const evidence = {
      repository: repo.directory,
      commit: repo.oid,
      algorithm: repo.algorithm,
      signature: 'not-verified',
      publisher: 'not-verified',
      scope: 'manifest-only',
    };
    const result = (status) => ({ ...evidence, status });
    const commit = await object(repo, repo.oid);
    if (commit.status !== 'read') return result(commit.status);
    if (commit.type !== 'commit')
      return result(failure(`${repo.gitDirectory}/HEAD`, 'invalid-commit').status);
    const newline = commit.data.indexOf(0x0a);
    const line = newline < 0 ? '' : commit.data.subarray(0, newline).toString('utf8');
    let oid = line.startsWith('tree ') ? line.slice(5) : '';
    if (!OID.test(oid) || oid.length !== repo.oid.length)
      return result(failure(`${repo.gitDirectory}/HEAD`, 'invalid-commit').status);
    const parts = path.relative(repo.directory || '.', manifest).split('/');
    try {
      for (let i = 0; i < parts.length; i++) {
        const tree = await object(repo, oid);
        if (tree.status !== 'read') return result(tree.status);
        if (tree.type !== 'tree') throw new Error('invalid-tree');
        const entry = treeEntry(tree.data, parts[i], repo.oid.length / 2);
        if (!entry) return result('not-in-commit');
        if (i === parts.length - 1) {
          if (!['100644', '100755'].includes(entry.mode)) return result('not-regular-in-commit');
          const blob = await object(repo, entry.oid);
          if (blob.status !== 'read') return result(blob.status);
          if (blob.type !== 'blob') throw new Error('invalid-tree');
          const strongHash = crypto
            .createHash('sha256')
            .update(`blob ${blob.data.length}\0`)
            .update(blob.data)
            .digest('hex');
          return result(
            entry.oid === blobs[repo.algorithm] && strongHash === blobs.sha256
              ? 'matches-local-commit'
              : 'differs-from-local-commit',
          );
        }
        if (entry.mode !== '40000') return result('not-in-commit');
        oid = entry.oid;
      }
    } catch (_) {
      return result(failure(`${repo.gitDirectory}/HEAD`, 'invalid-tree').status);
    }
    return result('not-in-commit');
  }

  return { verifyManifest, usage: () => ({ inflatedBytes }) };
}

module.exports = { createInventoryGit };
