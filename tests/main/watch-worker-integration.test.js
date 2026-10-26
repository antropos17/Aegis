import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { watch } from '../../src/main/watch-worker-client.js';
const require_ = createRequire(import.meta.url);
const fileWatcher = require_('../../src/main/file-watcher.js');

const roots = [];
const watchers = [];
afterEach(async () => {
  await Promise.all(watchers.splice(0).map((w) => w.close()));
  fileWatcher._resetForTest();
  for (const root of roots.splice(0)) {
    const resolved = await fs.realpath(root);
    expect(path.dirname(resolved)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(resolved)).toMatch(/^aegis-worker-test-/);
    await fs.rm(resolved, { recursive: true });
  }
});
function waitFor(watcher, type, expected) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out: ${type}`));
    }, 10000);
    const handler = (value) => {
      if (expected && value !== expected) return;
      cleanup();
      resolve(value);
    };
    const error = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      watcher.off(type, handler);
      watcher.off('error', error);
    }
    watcher.on(type, handler);
    watcher.on('error', error);
  });
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-worker-test-'));
  roots.push(root);
  return root;
}
function start(root, extra = {}) {
  const w = watch(root, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    followSymlinks: false,
    depth: 2,
    ...extra,
  });
  watchers.push(w);
  return w;
}

describe('real worker filesystem delivery', () => {
  it.each(['plain/project', 'build/project', 'build'])(
    'ignores only child build directories when the watched root is %s',
    async (rootSuffix) => {
      const base = await fixture();
      const root = path.join(base, rootSuffix);
      const ignored = path.join(root, 'build');
      const visibleDirectory = path.join(root, 'build-output');
      await fs.mkdir(ignored, { recursive: true });
      await fs.mkdir(visibleDirectory);
      const w = start(root, { ignoredDirectories: ['build'] });
      const added = [];
      w.on('add', (p) => added.push(p));
      await waitFor(w, 'ready');
      await fs.writeFile(path.join(ignored, 'ignored.txt'), 'fixture');
      const target = path.join(root, 'visible.txt');
      let received = waitFor(w, 'add', target);
      await fs.writeFile(target, 'fixture');
      await received;
      const nestedTarget = path.join(visibleDirectory, 'visible.txt');
      received = waitFor(w, 'add', nestedTarget);
      await fs.writeFile(nestedTarget, 'fixture');
      await received;
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(added).toEqual([target, nestedTarget]);
    },
    15000,
  );

  it('admits an explicitly watched nested root while retaining its child exclusions', async () => {
    const root = await fixture();
    const nestedRoot = path.join(root, 'build', 'project');
    const ignored = path.join(nestedRoot, 'build');
    await fs.mkdir(ignored, { recursive: true });
    const w = start([root, nestedRoot], { ignoredDirectories: ['build'] });
    const added = [];
    w.on('add', (p) => added.push(p));
    await waitFor(w, 'ready');
    await fs.writeFile(path.join(ignored, 'ignored.txt'), 'fixture');
    const target = path.join(nestedRoot, 'visible.txt');
    const received = waitFor(w, 'add', target);
    await fs.writeFile(target, 'fixture');
    await received;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(added).toEqual([target]);
  });

  it('observes existing and later home .env files while excluding siblings and nested files', async () => {
    const root = await fixture();
    const existing = path.join(root, '.env.local');
    await fs.writeFile(existing, 'fixture');
    await fs.mkdir(path.join(root, '.env-directory'));
    const w = start(root, { depth: 0, basenamePrefix: '.env' });
    const seen = [];
    for (const type of ['add', 'change', 'unlink']) w.on(type, (p) => seen.push([type, p]));
    await waitFor(w, 'ready');
    expect(seen).toEqual([]);
    let received = waitFor(w, 'change', existing);
    await fs.appendFile(existing, 'changed');
    await received;
    received = waitFor(w, 'unlink', existing);
    await fs.unlink(existing);
    await received;
    await fs.writeFile(path.join(root, 'unrelated.txt'), 'fixture');
    await fs.writeFile(path.join(root, '.env-directory', '.env'), 'fixture');
    const target = path.join(root, '.env');
    received = waitFor(w, 'add', target);
    await fs.writeFile(target, 'fixture');
    await received;
    received = waitFor(w, 'change', target);
    await fs.appendFile(target, 'changed');
    await received;
    received = waitFor(w, 'unlink', target);
    await fs.unlink(target);
    await received;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(seen).toEqual([
      ['change', existing],
      ['unlink', existing],
      ['add', target],
      ['change', target],
      ['unlink', target],
    ]);
  }, 15000);

  it('reports a native registration exception without claiming ready', async () => {
    const w = start(42);
    let ready = false;
    w.on('ready', () => {
      ready = true;
    });
    const error = await new Promise((resolve) => w.once('error', resolve));
    expect(error.message).toBe('watch-worker-provider-error');
    expect(ready).toBe(false);
  });
  it('delivers add/change/unlink in order and ignores pre-existing files at startup', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'existing.txt'), 'fixture');
    const w = start(root);
    const seen = [];
    for (const type of ['add', 'change', 'unlink']) w.on(type, (p) => seen.push([type, p]));
    await waitFor(w, 'ready');
    expect(seen).toEqual([]);
    const target = path.join(root, 'new.txt');
    let received = waitFor(w, 'add', target);
    await fs.writeFile(target, 'one');
    await received;
    received = waitFor(w, 'change', target);
    await fs.appendFile(target, 'two');
    await received;
    received = waitFor(w, 'unlink', target);
    await fs.unlink(target);
    await received;
    expect(seen.map(([type]) => type)).toEqual(['add', 'change', 'unlink']);
  });

  it('materializes project ignore descriptors in the worker without treating names as globs', async () => {
    const root = await fixture();
    const ignored = path.join(root, 'build[custom]');
    await fs.mkdir(ignored);
    const w = start(root, { ignoredDirectories: ['build[custom]'], ignorePackageLock: true });
    const added = [];
    w.on('add', (p) => added.push(p));
    await waitFor(w, 'ready');
    await fs.writeFile(path.join(ignored, 'ignored.js'), '{}');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
    const target = path.join(root, 'visible.js');
    const received = waitFor(w, 'add', target);
    await fs.writeFile(target, '{}');
    await received;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(added).toEqual([target]);
  });

  it('can close a real worker during registration and start a fresh lifetime', async () => {
    const root = await fixture();
    const first = start(root);
    await first.close();
    const second = start(root);
    await waitFor(second, 'ready');
    const target = path.join(root, 'fresh.txt');
    const received = waitFor(second, 'add', target);
    await fs.writeFile(target, 'fixture');
    await received;
  });

  it('reports a real rename at project depth and stops delivery after awaited close', async () => {
    const root = await fixture();
    const outside = await fixture();
    const nested = path.join(root, 'one', 'two', 'three', 'four', 'five');
    await fs.mkdir(nested, { recursive: true });
    await fs.symlink(
      outside,
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const w = start(root, { depth: 5, startupProgress: true });
    const seen = [];
    for (const type of ['add', 'change', 'unlink']) w.on(type, (p) => seen.push([type, p]));
    await waitFor(w, 'ready');
    await fs.writeFile(path.join(outside, 'outside.txt'), 'not followed');
    const before = path.join(nested, 'before.txt');
    const after = path.join(nested, 'after.txt');
    let received = waitFor(w, 'add', before);
    await fs.writeFile(before, 'fixture');
    await received;
    const renamed = Promise.all([waitFor(w, 'unlink', before), waitFor(w, 'add', after)]);
    await fs.rename(before, after);
    await renamed;
    received = waitFor(w, 'unlink', after);
    await fs.unlink(after);
    await received;
    await w.close();
    const settled = [...seen];
    await fs.writeFile(path.join(root, 'after-close.txt'), 'fixture');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(seen).toEqual(settled);
    expect(seen.every(([, file]) => file === before || file === after)).toBe(true);
    expect(seen).toContainEqual(['add', before]);
    expect(seen).toContainEqual(['unlink', before]);
    expect(seen).toContainEqual(['add', after]);
    expect(seen).toContainEqual(['unlink', after]);
  }, 15000);

  it('uses real shallow rule watching with underscore filtering and no initial delivery', async () => {
    const root = await fixture();
    const rules = path.join(root, 'rules', 'sequences');
    await fs.mkdir(path.join(rules, 'nested'), { recursive: true });
    await fs.writeFile(path.join(rules, 'existing.yaml'), 'fixture');
    fileWatcher._setDepsForTest({ appDir: root });
    let reloads = 0;
    const w = fileWatcher.setupSequenceRulesWatcher(() => {}, { reload: () => ++reloads });
    watchers.push(w);
    const seen = [];
    for (const type of ['add', 'change', 'unlink']) w.on(type, (file) => seen.push({ type, file }));
    await waitFor(w, 'ready');
    expect(seen).toEqual([]);
    expect(reloads).toBe(0);
    await fs.writeFile(path.join(rules, '_ignored.yaml'), 'fixture');
    await fs.writeFile(path.join(rules, 'nested', 'ignored.yaml'), 'fixture');
    const selected = path.join(rules, 'selected.yaml');
    const received = waitFor(w, 'add', selected);
    await fs.writeFile(selected, 'fixture');
    await received;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(seen).toContainEqual({ type: 'add', file: selected });
    expect(seen.every((event) => event.file === selected)).toBe(true);
    // A native create can deliver add followed by change as content is written.
    expect(reloads).toBeGreaterThanOrEqual(1);
  });
});
