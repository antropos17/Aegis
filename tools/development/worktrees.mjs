import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseWorktrees, retentionBlockers } from './verification-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { owners: { type: 'string' } } });
const ownership = values.owners
  ? JSON.parse(fs.readFileSync(values.owners, 'utf8'))
  : { worktrees: [] };
if (!Array.isArray(ownership.worktrees))
  throw new Error('Owners file must contain a worktrees array');
const canonical = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const owners = new Map();
for (const record of ownership.worktrees) {
  if (typeof record.path !== 'string' || !path.isAbsolute(record.path))
    throw new Error('Owner path must be absolute');
  const key = canonical(record.path);
  if (owners.has(key)) throw new Error('Duplicate owner path');
  if (
    record.receipts !== undefined &&
    (!Array.isArray(record.receipts) || record.receipts.some((x) => typeof x !== 'string'))
  )
    throw new Error('Receipt locations must be strings');
  owners.set(key, record);
}
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const trees = parseWorktrees(git(root, 'worktree', 'list', '--porcelain', '-z'));
const retained = ['out', 'dist', 'build/sidecar', '.tmp', '.serena', 'coverage'];
for (const [index, tree] of trees.entries()) {
  tree.primary = index === 0;
  tree.ownership = owners.get(canonical(tree.path)) ?? null;
  tree.dirty = null;
  tree.retainedPaths = [];
  tree.dependencies = { present: false, linked: false, realPath: null, consumers: [] };
  try {
    if (tree.bare) throw new Error('Bare repository');
    const status = git(tree.path, 'status', '--porcelain=v1', '-z', '--untracked-files=normal');
    tree.dirty = status.length > 0;
    // Count status records without persisting private changed filenames.
    tree.statusBytes = Buffer.byteLength(status);
    for (const name of retained) {
      try {
        const info = fs.lstatSync(path.join(tree.path, name));
        tree.retainedPaths.push({ path: name, linked: info.isSymbolicLink() });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const modules = path.join(tree.path, 'node_modules');
    let info;
    try {
      info = fs.lstatSync(modules);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (info) {
      tree.dependencies = {
        present: true,
        linked: info.isSymbolicLink(),
        realPath: null,
        consumers: [],
      };
      // A dangling/inaccessible junction is incomplete evidence, not absent dependencies.
      tree.dependencies.realPath = fs.realpathSync.native(modules);
      if (!fs.statSync(modules).isDirectory()) throw new Error('Dependencies are not a directory');
    }
  } catch (error) {
    tree.error = error.code ?? 'inspection-failed';
  }
}
for (const tree of trees) {
  const target = tree.dependencies.realPath;
  if (!target) continue;
  tree.dependencies.consumers = trees
    .filter(
      (other) =>
        other !== tree &&
        other.dependencies.realPath &&
        canonical(other.dependencies.realPath) === canonical(target),
    )
    .map((other) => other.path);
  tree.dependencies.owner =
    trees.find((other) => canonical(path.join(other.path, 'node_modules')) === canonical(target))
      ?.path ?? 'external-or-unknown';
}
const today = new Date().toISOString().slice(0, 10);
for (const tree of trees) {
  tree.retentionBlockers = retentionBlockers(tree, today);
  tree.retentionReview = tree.retentionBlockers.length ? 'blocked-or-retained' : 'human-review-due';
}
// stdout only: the caller chooses an owned private report destination.
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      readOnly: true,
      deletionAuthorized: false,
      storageBytes: 'not-measured',
      limitations: [
        'Point-in-time inventory; concurrent changes can invalidate it.',
        'Only registered worktrees and listed artifact roots are inspected.',
        'No recursive artifact sizing, process-use detection or orphan checkout discovery.',
      ],
      worktrees: trees,
    },
    null,
    2,
  ),
);
