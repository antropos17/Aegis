import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { runSelfResourceSession } = require('../../../bench/lib/self-resource-session');
const evaluator = require('../../../bench/lib/bracketed-resource-intervals');
const storage = require('../../../bench/lib/own-resource-storage');
const directories = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true });
});
function options() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'self-resource-session-'));
  directories.push(parent);
  return {
    runId: 'owned-idle-1',
    durationMs: 3000,
    maxAcquisitionUs: 1000,
    maxCpuUncertaintyUs: 2000,
    out: path.join(parent, 'new-session'),
  };
}
function readers(first = () => {}) {
  let ns = 0n,
    calls = 0;
  return {
    nowNs: () => {
      first();
      return ns;
    },
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
  };
}
const json = (out, name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
describe('retained own-Node resource sessions (CI only)', () => {
  it('persists the declared plan before actual sampler calls and raw bytes before existing evaluation', async () => {
    const opts = options(),
      open = fs.openSync,
      close = fs.closeSync,
      fstat = fs.fstatSync;
    const artifacts = [],
      active = new Map();
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, ...args) => {
      const fd = open(file, flags, ...args);
      if (
        path.dirname(String(file)) === opts.out &&
        typeof flags === 'number' &&
        flags & fs.constants.O_EXCL
      ) {
        const entry = { file: path.basename(file), fd, closeObserved: false };
        artifacts.push(entry);
        active.set(fd, entry);
      }
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      const entry = active.get(fd);
      if (entry) {
        entry.closeObserved = true;
        active.delete(fd);
      }
    });
    const closedAtBoundary = (names) =>
      names.map((file) => {
        const entry = artifacts.find((item) => item.file === file);
        let nativeError = null;
        if (entry) {
          try {
            fstat(entry.fd);
          } catch (err) {
            nativeError = err.code;
          }
        }
        return { file, closeObserved: entry?.closeObserved ?? false, nativeError };
      });
    let first = true,
      acquisitionBoundary,
      evaluationBoundary;
    const deps = readers(() => {
      if (!first) return;
      first = false;
      acquisitionBoundary = {
        closed: closedAtBoundary(['session-plan.json', 'session-pending.json']),
        pending: json(opts.out, 'session-pending.json'),
        plan: json(opts.out, 'session-plan.json'),
      };
    });
    const evaluate = evaluator.evaluateBracketedResources;
    vi.spyOn(evaluator, 'evaluateBracketedResources').mockImplementation((input) => {
      evaluationBoundary = {
        closed: closedAtBoundary(['raw-samples.json']),
        raw: json(opts.out, 'raw-samples.json'),
        input,
        planHash: sha(fs.readFileSync(path.join(opts.out, 'session-plan.json'))),
      };
      return evaluate(input);
    });
    const result = await runSelfResourceSession(opts, deps);
    expect(result.exitCode).toBe(0);
    expect(acquisitionBoundary.closed).toEqual(
      ['session-plan.json', 'session-pending.json'].map((file) => ({
        file,
        closeObserved: true,
        nativeError: 'EBADF',
      })),
    );
    expect(acquisitionBoundary.pending.state).toBe('pending');
    expect(acquisitionBoundary.plan.plan.phases).toEqual([
      { id: 'owned-idle', kind: 'idle', steady: true, startUs: 0, endUs: 3000000 },
    ]);
    expect(evaluationBoundary.closed).toEqual([
      { file: 'raw-samples.json', closeObserved: true, nativeError: 'EBADF' },
    ]);
    expect(evaluationBoundary.raw).toEqual(evaluationBoundary.input.raw);
    expect(evaluationBoundary.input.provenance.sourceSha256).toBe(evaluationBoundary.planHash);
    const raw = json(opts.out, 'raw-samples.json'),
      derived = json(opts.out, 'bracketed-intervals.json'),
      receipt = json(opts.out, 'session-final.json');
    expect(raw).toMatchObject({
      complete: true,
      readingMode: 'injected',
      scope: 'calling-node-process',
    });
    expect(derived.raw).toEqual(raw);
    expect(derived.intervals[0].rateBounds).toMatchObject({ unit: 'percent-one-core', scale: 100 });
    expect(receipt).toMatchObject({
      acquisition: { state: 'complete', complete: true },
      derivation: { state: 'written' },
      sources: { state: 'unchanged' },
      sourceAuthenticated: false,
      measurementAccepted: false,
      w8Accepted: false,
    });
    expect(fs.readdirSync(opts.out).sort()).toEqual([
      'bracketed-intervals.json',
      'raw-samples.json',
      'session-final.json',
      'session-pending.json',
      'session-plan.json',
    ]);
    for (const file of receipt.files) {
      const bytes = fs.readFileSync(path.join(opts.out, file.file));
      expect(file).toMatchObject({ sha256: sha(bytes), byteLength: bytes.length, closed: true });
    }
    expect(receipt.files.some((f) => f.file === 'session-final.json')).toBe(false);
    expect(receipt.finalPublication).toBe('not-self-attested');
    expect(receipt.rawSha256).toBe(sha(fs.readFileSync(path.join(opts.out, 'raw-samples.json'))));
    expect(
      fs.readdirSync(opts.out).reduce((n, f) => n + fs.statSync(path.join(opts.out, f)).size, 0),
    ).toBeLessThanOrEqual(1048576);
    expect(JSON.stringify(receipt)).not.toContain(JSON.stringify(opts.out).slice(1, -1));
  });
  it.each([
    ['session-pending.json', 'partial-write'],
    ['session-pending.json', 'uncertain-close'],
    ['raw-samples.json', 'partial-write'],
    ['raw-samples.json', 'uncertain-close'],
  ])('retains %s on %s without attesting an unconfirmed file', async (name, failure) => {
    const opts = options(),
      deps = readers(),
      open = fs.openSync,
      write = fs.writeSync,
      close = fs.closeSync,
      fstat = fs.fstatSync;
    deps.nowNs = vi.fn(deps.nowNs);
    const evaluate = vi.spyOn(evaluator, 'evaluateBracketedResources');
    const target = path.join(opts.out, name);
    let targetFd,
      targetActive = false,
      faultApplied = false;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      const fd = open(file, ...args);
      if (file === target && !faultApplied) {
        targetFd = fd;
        targetActive = true;
      }
      return fd;
    });
    vi.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset, length, position) => {
      if (failure === 'partial-write' && fd === targetFd && targetActive && !faultApplied) {
        write(fd, buffer, offset, Math.min(5, length), position);
        faultApplied = true;
        throw Error('private-partial-write');
      }
      return write(fd, buffer, offset, length, position);
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      if (fd === targetFd && targetActive) {
        targetActive = false;
        if (failure === 'uncertain-close' && !faultApplied) {
          faultApplied = true;
          throw Error('private-close-error');
        }
      }
    });
    const result = await runSelfResourceSession(opts, deps);
    expect(faultApplied).toBe(true);
    expect(result.exitCode).toBe(6);
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.receipt.rawSha256).toBe(null);
    expect(result.receipt.files.map((f) => f.file)).toEqual(
      name === 'session-pending.json'
        ? ['session-plan.json']
        : ['session-plan.json', 'session-pending.json'],
    );
    expect(result.receipt.files.every((f) => f.closed === true)).toBe(true);
    expect(() => fstat(targetFd)).toThrow();
    if (name === 'session-pending.json') {
      expect(deps.nowNs).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(opts.out, 'session-final.json'))).toBe(false);
    } else {
      expect(deps.nowNs).toHaveBeenCalled();
      expect(json(opts.out, 'session-final.json').rawSha256).toBe(null);
    }
    const retained = fs.readFileSync(target);
    expect(retained.length).toBeGreaterThan(0);
    if (failure === 'partial-write') expect(retained.length).toBe(5);
    else expect(JSON.parse(retained.toString('utf8'))).toBeTruthy();
    expect(JSON.stringify(result.receipt)).not.toContain('private-');
  });
  it('refuses an oversized fixed-roster artifact before creating its file', () => {
    const opts = options(),
      writer = storage.createStorage(opts.out),
      open = vi.spyOn(fs, 'openSync');
    expect(() =>
      writer.write('session-pending.json', {
        text: 'x'.repeat(storage.CAPS['session-pending.json']),
      }),
    ).toThrow('self-resource-storage-unavailable');
    expect(open).not.toHaveBeenCalled();
    expect(writer.files).toEqual([]);
    expect(fs.readdirSync(opts.out)).toEqual([]);
  });
  it('retains raw bytes and their exact digest when evaluation throws a private error', async () => {
    const opts = options();
    vi.spyOn(evaluator, 'evaluateBracketedResources').mockImplementation(() => {
      throw Error('private-evaluator-error');
    });
    const result = await runSelfResourceSession(opts, readers());
    const bytes = fs.readFileSync(path.join(opts.out, 'raw-samples.json'));
    expect(result.exitCode).toBe(3);
    expect(result.receipt).toMatchObject({
      rawSha256: sha(bytes),
      derivation: { state: 'refused', reason: 'derivation-unavailable' },
    });
    expect(fs.existsSync(path.join(opts.out, 'bracketed-intervals.json'))).toBe(false);
    expect(JSON.stringify(json(opts.out, 'session-final.json'))).not.toContain(
      'private-evaluator-error',
    );
  });
  it.each(['duration', 'acquisition', 'uncertainty', 'extra', 'getter', 'dependency'])(
    'refuses invalid %s before filesystem or sampler APIs',
    async (kind) => {
      const opts = options(),
        deps = readers();
      let getters = 0;
      if (kind === 'duration') opts.durationMs = 1500;
      if (kind === 'acquisition') opts.maxAcquisitionUs = opts.durationMs * 1000 + 1;
      if (kind === 'uncertainty') opts.maxCpuUncertaintyUs = opts.durationMs * 2000 + 1;
      if (kind === 'extra') opts.command = 'private-command';
      if (kind === 'getter')
        Object.defineProperty(opts, 'runId', {
          enumerable: true,
          get() {
            getters++;
            return 'private-id';
          },
        });
      if (kind === 'dependency') deps.rss = 'private-reader';
      const inspect = vi.spyOn(fs, 'lstatSync'),
        clock = vi.fn(deps.nowNs);
      deps.nowNs = clock;
      await expect(runSelfResourceSession(opts, deps)).rejects.toThrow(
        /^self-resource-session-input-invalid$/,
      );
      expect(inspect).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
      expect(getters).toBe(0);
    },
  );
  it('retains a fully cancelled plan and raw tail without inventing readings', async () => {
    const opts = options(),
      controller = new AbortController(),
      deps = readers();
    controller.abort();
    deps.nowNs = vi.fn(deps.nowNs);
    const result = await runSelfResourceSession({ ...opts, signal: controller.signal }, deps);
    expect(result.exitCode).toBe(3);
    expect(deps.nowNs).not.toHaveBeenCalled();
    expect(json(opts.out, 'raw-samples.json')).toMatchObject({
      complete: false,
      samples: [],
      unattempted: { firstScheduledUs: 0, count: 3, reason: 'cancelled' },
    });
    expect(json(opts.out, 'bracketed-intervals.json').intervals).toEqual([]);
    expect(result.receipt.acquisition).toMatchObject({
      state: 'cancelled',
      complete: false,
      reason: 'cancelled',
    });
  });
  it('keeps API failure and refused timing intervals distinct from artifact persistence', async () => {
    const opts = options(),
      deps = readers();
    deps.cpuUsage = () => {
      throw Error('private-api-error');
    };
    const result = await runSelfResourceSession(opts, deps);
    expect(result.exitCode).toBe(3);
    expect(result.receipt).toMatchObject({
      priorArtifactState: 'complete',
      acquisition: { state: 'incomplete', complete: false },
      derivation: { state: 'written' },
    });
    expect(json(opts.out, 'raw-samples.json').samples[0].cpu).toMatchObject({
      userUs: null,
      systemUs: null,
      reason: 'api-unavailable',
    });
    expect(JSON.stringify(result.receipt)).not.toContain('private-api-error');
  });
  it('retains tight-bound refusals normally without claiming all intervals admitted', async () => {
    const opts = { ...options(), maxAcquisitionUs: 1, maxCpuUncertaintyUs: 1 };
    const result = await runSelfResourceSession(opts, readers());
    expect(result.exitCode).toBe(0);
    expect(json(opts.out, 'bracketed-intervals.json').intervals[0]).toMatchObject({
      reason: 'acquisition-too-wide',
      rateBounds: null,
    });
    expect(result.receipt.state).toBe('complete-candidate');
    expect(result.receipt.measurementAccepted).toBe(false);
  });
  it.each(['changed', 'unavailable'])(
    'retains raw and derivation when final source inventory is %s',
    async (state) => {
      const opts = options(),
        inventory = storage.inventory;
      let calls = 0;
      vi.spyOn(storage, 'inventory').mockImplementation(() => {
        if (++calls === 1) return inventory();
        if (state === 'unavailable') throw Error('private-source-error');
        const after = inventory();
        after.files[0].sha256 = 'f'.repeat(64);
        return after;
      });
      const result = await runSelfResourceSession(opts, readers());
      expect(result.exitCode).toBe(4);
      expect(result.receipt.sources.state).toBe(state);
      expect(fs.existsSync(path.join(opts.out, 'raw-samples.json'))).toBe(true);
      expect(fs.existsSync(path.join(opts.out, 'bracketed-intervals.json'))).toBe(true);
      expect(JSON.stringify(result.receipt)).not.toContain('private-source-error');
    },
  );
  it('refuses an existing output before acquiring and preserves its sentinel', async () => {
    const opts = options(),
      deps = readers();
    fs.mkdirSync(opts.out);
    fs.writeFileSync(path.join(opts.out, 'sentinel'), 'owned');
    deps.nowNs = vi.fn(deps.nowNs);
    expect((await runSelfResourceSession(opts, deps)).exitCode).toBe(5);
    expect(deps.nowNs).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(opts.out, 'sentinel'), 'utf8')).toBe('owned');
  });
  it('preserves a raw-file exclusive-create race without deriving over a competitor', async () => {
    const opts = options(),
      open = fs.openSync,
      evaluate = vi.spyOn(evaluator, 'evaluateBracketedResources');
    const target = path.join(opts.out, 'raw-samples.json');
    let raced = false;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      if (file === target && !raced) {
        raced = true;
        const fd = open(file, 'wx');
        fs.writeSync(fd, 'owned-competing-raw');
        fs.closeSync(fd);
      }
      return open(file, ...args);
    });
    const result = await runSelfResourceSession(opts, readers());
    expect(result.exitCode).toBe(6);
    expect(evaluate).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, 'utf8')).toBe('owned-competing-raw');
    expect(result.receipt.rawSha256).toBe(null);
  });
  it('returns code 6 even if final JSON is parseable but its descriptor close was uncertain', async () => {
    const opts = options(),
      open = fs.openSync,
      close = fs.closeSync;
    let finalFd,
      failed = false;
    vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
      const fd = open(file, ...args);
      if (file === path.join(opts.out, 'session-final.json')) finalFd = fd;
      return fd;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      if (fd === finalFd && !failed) {
        failed = true;
        throw Error('private-close-error');
      }
    });
    const result = await runSelfResourceSession(opts, readers());
    expect(result.exitCode).toBe(6);
    expect(json(opts.out, 'session-final.json')).toMatchObject({
      finalPublication: 'not-self-attested',
      state: 'complete-candidate',
    });
    expect(result.receipt.state).toBe('persistence-failed');
  });
});
