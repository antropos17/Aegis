import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
const directories = [];
/** Remove validated owned fixtures and restore spies. @returns {void} @since unreleased */
export function cleanup() {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith('resource-supervisor-') ||
      fs.lstatSync(directory).isSymbolicLink()
    )
      throw Error('unsafe-fixture-cleanup');
    fs.rmSync(directory, { recursive: true });
  }
}
/** Create fresh supervisor inputs. @returns {object} Owned output and limits. @since unreleased */
export function options() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-supervisor-'));
  directories.push(parent);
  return {
    runId: 'supervised-1',
    durationMs: 1000,
    maxAcquisitionUs: 1000,
    maxCpuUncertaintyUs: 2000,
    wallLimitMs: 100,
    confirmMs: 20,
    out: path.join(parent, 'outer'),
  };
}
/** Create deterministic child and clock seams. @returns {object} Owned fake lifecycle. @since unreleased */
export function fixture() {
  const child = new EventEmitter();
  for (const name of ['stdout', 'stderr']) {
    child[name] = new EventEmitter();
    child[name].destroy = vi.fn(() => child[name].emit('close'));
  }
  child.kill = vi.fn(() => true);
  child.unref = vi.fn();
  let now = 0,
    serial = 0;
  const timers = new Map();
  const deps = {
    spawn: vi.fn(() => child),
    nowNs: () => BigInt(now) * 1000000n,
    setTimer: (fn, delay) => {
      const id = ++serial;
      timers.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  };
  return {
    child,
    deps,
    tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.due <= now) {
          timers.delete(id);
          timer.fn();
        }
    },
    timers,
  };
}
/** Deliver a complete lifecycle. @param {object} child Fake child. @param {number} code Exit code. @returns {void} @since unreleased */
export function end(child, code = 0) {
  child.emit('exit', code, null);
  for (const name of ['stdout', 'stderr']) {
    child[name].emit('end');
    child[name].emit('close');
  }
  child.emit('close', code, null);
}
/** Decode an owned artifact. @param {string} out Output. @param {string} file File. @returns {object} JSON. @since unreleased */
export const json = (out, file) => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
/** Hash exact bytes. @param {Buffer} bytes Input. @returns {string} SHA-256. @since unreleased */
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
