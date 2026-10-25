import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
const directories = [];
/** Restore spies and remove validated owned fixtures only. @returns {void} @since unreleased */
export function cleanup() {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('linux-own-cpu-') ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw Error('unsafe-fixture-cleanup');
    fs.rmSync(dir, { recursive: true });
  }
}
/** Create fresh fixed caller options. @returns {object} Options. @since unreleased */
export function options() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-own-cpu-'));
  directories.push(dir);
  return { runId: 'cpu-fixture', out: path.join(dir, 'output') };
}
/** Make a proc-format fixture without publishing its private identity fields. @param {object} [values] Selected test fields. @returns {Buffer} Raw stat. @since unreleased */
export function statText({
  pid = process.pid,
  comm = 'private name ) ( x',
  user = '100',
  system = '20',
  start = '500',
  state = 'R',
} = {}) {
  const fields = Array(50).fill('0');
  fields[0] = state;
  fields[11] = user;
  fields[12] = system;
  fields[19] = start;
  return Buffer.from(`${pid} (${comm}) ${fields.join(' ')}\n`);
}
/** Fixed exact comparison controls, independent of the sampler. @returns {object[]} Windows. @since unreleased */
export function referenceWindows() {
  return [0, 1].map((index) => {
    const tick = index ? '110' : '100',
      base = index * 20;
    const record = (start) => ({
      userTicks: tick,
      systemTicks: '20',
      startTicks: '500',
      byteLength: 100,
      sha256: '1'.repeat(64),
      closed: true,
      beforeNs: String(base + start),
      afterNs: String(base + start + 1),
    });
    return {
      index,
      before: record(1),
      api: {
        beforeNs: String(base + 3),
        afterNs: String(base + 4),
        userUs: index ? 1100000 : 1000000,
        systemUs: 200000,
        reason: null,
      },
      after: record(5),
      reason: null,
    };
  });
}
/** Deterministic actual-sampler dependency seam; no native command/proc/workload input. @param {bigint} [stepNs] Per-read virtual clock advance. @returns {object} Dependencies. @since unreleased */
export function fixtureDeps(stepNs = 1000000n) {
  let ns = 0n,
    refs = 0,
    api = 0;
  return {
    platform: () => 'linux',
    kernelVersion: () => '6.14-fixture',
    arch: () => 'x64',
    getconf: () => Buffer.from('100\n'),
    nowNs: () => {
      ns += stepNs;
      return ns;
    },
    readStat: () => statText({ user: refs++ < 2 ? '100' : '110' }),
    cpuUsage: () => ({ user: api++ ? 1100000 : 1000000, system: 200000 }),
    rss: () => 4096,
    setTimer: (fn, ms) => {
      ns += BigInt(Math.ceil(ms * 1000000));
      queueMicrotask(fn);
      return 1;
    },
    clearTimer: () => {},
  };
}
