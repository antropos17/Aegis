import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
const require = createRequire(import.meta.url);
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../../..');
const directories = [];
/** Restore and remove only verified owned fixtures. @returns {void} @since unreleased */
export function cleanup() {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('resource-replay-fixture-') ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw Error('unsafe-fixture-cleanup');
    fs.rmSync(dir, { recursive: true });
  }
}
/** Build eight files through actual producer APIs with an injected child/readers. @param {object} [options] Optional copied root, durationMs or cancelled flag. @returns {Promise<object>} Owned bundle. @since unreleased */
export async function createBundle({
  root = DEFAULT_ROOT,
  durationMs = 3000,
  cancelled = false,
} = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-replay-fixture-'));
  directories.push(parent);
  const input = path.join(parent, 'input');
  const supervisor = require(path.join(root, 'bench/lib/resource-supervisor'));
  const session = require(path.join(root, 'bench/lib/self-resource-session'));
  const spawn = (_command, args) => {
    const child = new EventEmitter();
    for (const key of ['stdout', 'stderr']) {
      child[key] = new EventEmitter();
      child[key].destroy = () => child[key].emit('close');
    }
    child.kill = () => true;
    child.unref = () => {};
    queueMicrotask(async () => {
      child.emit('spawn');
      let ns = 0n,
        calls = 0;
      const controller = new AbortController();
      if (cancelled) controller.abort();
      const opts = {
        runId: 'replay-fixture',
        durationMs,
        maxAcquisitionUs: 1000,
        maxCpuUncertaintyUs: 2000,
        out: args.at(-1),
        signal: controller.signal,
      };
      const result = await session.runSelfResourceSession(opts, {
        nowNs: () => ns,
        cpuUsage: () => {
          ns += 5000n;
          return { user: ++calls * 100, system: calls * 20 };
        },
        rss: () => {
          ns += 7000n;
          return 4096;
        },
        setTimer: (fn, ms) => {
          ns += BigInt(Math.ceil(ms * 1000)) * 1000n;
          queueMicrotask(fn);
          return 1;
        },
        clearTimer: () => {},
      });
      child.emit('exit', result.exitCode, null);
      for (const key of ['stdout', 'stderr']) {
        child[key].emit('end');
        child[key].emit('close');
      }
      child.emit('close', result.exitCode, null);
    });
    return child;
  };
  const result = await supervisor.superviseSelfResources(
    {
      runId: 'replay-fixture',
      durationMs,
      maxAcquisitionUs: 1000,
      maxCpuUncertaintyUs: 2000,
      wallLimitMs: 10000,
      confirmMs: 1000,
      out: input,
    },
    { spawn, nowNs: () => 0n },
  );
  return { input, parent, root, producerResult: result };
}
/** Decode existing fixture JSON. @param {string} input Bundle. @param {string} file Fixed name. @returns {object} JSON. @since unreleased */
export const readJson = (input, file) =>
  JSON.parse(fs.readFileSync(path.join(input, file), 'utf8'));
/** Change only an existing owned fixture artifact. @param {string} input Bundle. @param {string} file Name. @param {Function} update Mutation. @returns {void} @since unreleased */
export function writeJson(input, file, update) {
  const value = readJson(input, file);
  update(value);
  fs.writeFileSync(path.join(input, file), JSON.stringify(value, null, 2) + '\n');
}
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Restamp byte links without repairing semantics or recomputing arithmetic. @param {string} input Bundle. @returns {void} @since unreleased */
export function restamp(input) {
  for (const prefix of ['capture/', '']) {
    const stem = prefix ? 'session' : 'supervision',
      planFile = path.join(input, prefix + stem + '-plan.json');
    const planHash = fs.existsSync(planFile) ? sha(planFile) : null;
    const pending = prefix + stem + '-pending.json',
      final = prefix + stem + '-final.json';
    if (planHash && fs.existsSync(path.join(input, pending)))
      writeJson(input, pending, (v) => {
        v.planSha256 = planHash;
      });
    if (prefix && planHash && fs.existsSync(path.join(input, 'capture/bracketed-intervals.json')))
      writeJson(input, 'capture/bracketed-intervals.json', (v) => {
        v.provenance.sourceSha256 = planHash;
      });
    if (fs.existsSync(path.join(input, final)))
      writeJson(input, final, (v) => {
        if (planHash) v.planSha256 = planHash;
        if (
          prefix &&
          v.rawSha256 !== null &&
          fs.existsSync(path.join(input, 'capture/raw-samples.json'))
        )
          v.rawSha256 = sha(path.join(input, 'capture/raw-samples.json'));
        for (const record of v.files) {
          const file = path.join(input, prefix + record.file);
          if (fs.existsSync(file)) {
            record.sha256 = sha(file);
            record.byteLength = fs.statSync(file).size;
          }
        }
      });
  }
}
