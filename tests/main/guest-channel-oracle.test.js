import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanGuestFixedTask,
  observeGuestFixedTask,
} from '../../scripts/qualification/guest-channel-oracle.mjs';

const fixedTest =
  "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\ntest('fixed edit', () => assert.equal(fs.readFileSync('source.txt', 'utf8'), 'beta\\n'));\n";
let scratch, root;
function makeProject() {
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'empty'));
  fs.writeFileSync(path.join(root, 'source.txt'), 'beta\n');
  fs.writeFileSync(path.join(root, 'fixture.test.cjs'), fixedTest);
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/fixture\n');
  fs.writeFileSync(path.join(root, '.git/index'), 'fixed disposable index');
}
beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-guest-oracle-test-')));
  root = path.join(scratch, 'project');
});
afterEach(() => {
  // Only these generated fixtures; fs.rm does not recurse through symlinks/junctions.
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('fixed-task local effect oracle', () => {
  it('refuses a Git parent junction instead of following it to another workspace', () => {
    makeProject();
    const outside = path.join(scratch, 'foreign-git');
    fs.renameSync(path.join(root, '.git'), outside);
    fs.symlinkSync(
      outside,
      path.join(root, '.git'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => observeGuestFixedTask(root, null, true)).toThrow();
    expect(fs.readFileSync(path.join(outside, 'HEAD'), 'utf8')).toBe('ref: refs/heads/fixture\n');
  });
  it('observes the fixed edit independently without trusting a task-result flag', () => {
    makeProject();
    expect(observeGuestFixedTask(root, null, true)).toMatchObject({
      localFilesObserved: true,
      authenticatedTaskResultVerified: false,
    });
    fs.writeFileSync(path.join(root, 'source.txt'), 'alpha\n');
    expect(() => observeGuestFixedTask(root, null, true)).toThrow();
  });
  it('refuses claimed successful tests with unrelated source/diff hashes', () => {
    makeProject();
    const dishonest = Buffer.from(
      JSON.stringify({
        version: 1,
        sourceBeforeSha256: '0'.repeat(64),
        sourceAfterSha256: '0'.repeat(64),
        testSha256: '0'.repeat(64),
        diffSha256: '0'.repeat(64),
        nodeTestPassed: true,
        gitBaselineCreated: true,
      }),
    );
    expect(() => observeGuestFixedTask(root, dishonest, true)).toThrow();
    expect(fs.readFileSync(path.join(root, 'source.txt'), 'utf8')).toBe('beta\n');
  });
  it('rejects a workspace appearing after a command-refusal mode', () => {
    expect(observeGuestFixedTask(root, null, false).localFilesObserved).toBe(false);
    makeProject();
    expect(() => observeGuestFixedTask(root, null, false)).toThrow();
  });
  it('refuses a source hard link without changing the external file', () => {
    makeProject();
    const outside = path.join(scratch, 'other-source.txt');
    fs.linkSync(path.join(root, 'source.txt'), outside);
    expect(() => observeGuestFixedTask(root, null, true)).toThrow();
    expect(fs.readFileSync(outside, 'utf8')).toBe('beta\n');
  });
});

describe('confirmed-closed fixture cleanup', () => {
  it('removes a bounded owned project and preserves an adjacent file', () => {
    makeProject();
    const outside = path.join(scratch, 'keep.txt');
    fs.writeFileSync(outside, 'keep');
    cleanGuestFixedTask(root);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
  });
  it('preserves every leaf if any unexpected root entry is present', () => {
    makeProject();
    fs.writeFileSync(path.join(root, 'retain.txt'), 'keep');
    expect(() => cleanGuestFixedTask(root)).toThrow();
    expect(fs.readFileSync(path.join(root, 'source.txt'), 'utf8')).toBe('beta\n');
    expect(fs.readFileSync(path.join(root, 'retain.txt'), 'utf8')).toBe('keep');
    expect(fs.existsSync(path.join(root, '.git/HEAD'))).toBe(true);
  });
  it('refuses a parent junction before deleting earlier inspected leaves', () => {
    makeProject();
    const outside = path.join(scratch, 'foreign-git');
    fs.renameSync(path.join(root, '.git'), outside);
    fs.symlinkSync(
      outside,
      path.join(root, '.git'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => cleanGuestFixedTask(root)).toThrow();
    expect(fs.existsSync(path.join(root, 'source.txt'))).toBe(true);
    expect(fs.existsSync(path.join(outside, 'HEAD'))).toBe(true);
  });
  it('refuses hard-linked leaves before any removal', () => {
    makeProject();
    const outside = path.join(scratch, 'keep-index');
    fs.linkSync(path.join(root, '.git/index'), outside);
    expect(() => cleanGuestFixedTask(root)).toThrow();
    expect(fs.existsSync(path.join(root, 'source.txt'))).toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('fixed disposable index');
  });
  it.each(['bytes', 'files', 'depth'])(
    'preserves the project when its %s budget is exceeded',
    (kind) => {
      makeProject();
      if (kind === 'bytes') fs.writeFileSync(path.join(root, '.git/large'), Buffer.alloc(262145));
      if (kind === 'files')
        for (let index = 0; index < 257; index++)
          fs.writeFileSync(path.join(root, '.git', `entry-${index}`), 'x');
      if (kind === 'depth') {
        let nested = path.join(root, '.git');
        for (let index = 0; index < 9; index++) {
          nested = path.join(nested, 'nested');
          fs.mkdirSync(nested);
        }
      }
      expect(() => cleanGuestFixedTask(root)).toThrow();
      expect(fs.readFileSync(path.join(root, 'source.txt'), 'utf8')).toBe('beta\n');
      expect(fs.existsSync(path.join(root, '.git/HEAD'))).toBe(true);
    },
  );
});
