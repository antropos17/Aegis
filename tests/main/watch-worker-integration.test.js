import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watch } from '../../src/main/watch-worker-client.js';

const roots = [];
const watchers = [];
afterEach(async () => {
  await Promise.all(watchers.splice(0).map((w) => w.close()));
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
});
