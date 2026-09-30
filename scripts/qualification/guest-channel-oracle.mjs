import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exactKeys, requireVm } from './vm-contract.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const blob = (value) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(value)}\0${value}`)
    .digest('hex')
    .slice(0, 7);
const before = 'alpha\n',
  after = 'beta\n';
const test =
  "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\ntest('fixed edit', () => assert.equal(fs.readFileSync('source.txt', 'utf8'), 'beta\\n'));\n";
const expectedDiff = `diff --git a/source.txt b/source.txt\nindex ${blob(before)}..${blob(after)} 100644\n--- a/source.txt\n+++ b/source.txt\n@@ -1 +1 @@\n-alpha\n+beta\n`;

/**
 * Cross-check untrusted fixed-task result bytes against an independent expected
 * corpus and local file observations after the owning Job was confirmed empty.
 * Reads only this collector's generated fixture, never runs Git on returned data.
 * @param {string} root Collector-derived owned workspace.
 * @param {Buffer|null} data Authenticated result bytes, or no accepted result.
 * @param {boolean} expected Whether this fixed mode actually creates a project.
 * @returns {Readonly<object>} Local oracle digests, not guest VM evidence.
 * @since v0.17.0
 */
export function observeGuestFixedTask(root, data, expected) {
  if (!expected) {
    requireVm(!fs.existsSync(root) && data === null);
    return Object.freeze({ localFilesObserved: false, authenticatedTaskResultVerified: false });
  }
  requireVm(fs.realpathSync(root) === root && !fs.lstatSync(root).isSymbolicLink());
  const read = (name) => {
    const selected = path.join(root, name);
    const parent = path.dirname(selected);
    requireVm(fs.realpathSync(parent) === parent && !fs.lstatSync(parent).isSymbolicLink());
    const stat = fs.lstatSync(selected);
    requireVm(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 4096);
    return fs.readFileSync(selected);
  };
  requireVm(
    read('source.txt').equals(Buffer.from(after)) &&
      read('fixture.test.cjs').equals(Buffer.from(test)),
  );
  requireVm(read('.git/HEAD').equals(Buffer.from('ref: refs/heads/fixture\n')));
  requireVm(read('.git/index').length > 0);
  const hashes = {
    sourceBeforeSha256: digest(before),
    sourceAfterSha256: digest(after),
    testSha256: digest(test),
    diffSha256: digest(expectedDiff),
  };
  if (data !== null) {
    requireVm(Buffer.isBuffer(data) && data.length > 0 && data.length <= 2048);
    const result = JSON.parse(data.toString('utf8'));
    exactKeys(result, ['version', ...Object.keys(hashes), 'nodeTestPassed', 'gitBaselineCreated']);
    requireVm(
      result.version === 1 && result.nodeTestPassed === true && result.gitBaselineCreated === true,
    );
    for (const [name, value] of Object.entries(hashes)) requireVm(result[name] === value);
    requireVm(
      data.equals(
        Buffer.from(
          JSON.stringify({ version: 1, ...hashes, nodeTestPassed: true, gitBaselineCreated: true }),
        ),
      ),
    );
  }
  return Object.freeze({
    localFilesObserved: true,
    authenticatedTaskResultVerified: data !== null,
    ...hashes,
  });
}

/**
 * Remove a confirmed-closed bounded fixture tree, rejecting links and unexpected
 * root entries. A failed collection retains unconfirmed workspaces for diagnosis.
 * @param {string} root Exact owned project directory.
 * @returns {void}
 * @since v0.17.0
 */
export function cleanGuestFixedTask(root) {
  requireVm(fs.realpathSync(root) === root && !fs.lstatSync(root).isSymbolicLink());
  const allowed = ['.git', 'empty', 'fixture.test.cjs', 'source.txt'];
  requireVm(fs.readdirSync(root).every((name) => allowed.includes(name)));
  const files = [],
    directories = [];
  let bytes = 0;
  function inspect(directory, depth) {
    requireVm(depth <= 8 && files.length <= 256 && directories.length <= 64 && bytes <= 262144);
    requireVm(
      fs.realpathSync(directory) === directory && !fs.lstatSync(directory).isSymbolicLink(),
    );
    for (const name of fs.readdirSync(directory)) {
      const selected = path.join(directory, name);
      const stat = fs.lstatSync(selected);
      requireVm(!stat.isSymbolicLink());
      if (stat.isDirectory()) inspect(selected, depth + 1);
      else {
        requireVm(stat.isFile() && stat.nlink === 1);
        files.push(selected);
        bytes += stat.size;
      }
    }
    directories.push(directory);
  }
  inspect(root, 0);
  requireVm(files.length <= 256 && directories.length <= 64 && bytes <= 262144);
  // Inspect the entire exact tree before removing any leaf; no recursive shell delete.
  for (const filename of files) fs.unlinkSync(filename);
  for (const directory of directories) fs.rmdirSync(directory);
}
