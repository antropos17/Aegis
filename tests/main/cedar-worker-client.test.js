import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const { createCedarWorkerClient } = require('../../src/main/cedar-worker-client');
const action = () => ({
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['PRIVATE_ARG'],
  env: { SECRET: 'PRIVATE_VALUE' },
});
const policy = () => ({
  schemaVersion: 4,
  cedarSchema: 'aegis-execution-v1',
  policies: { allow: 'permit(principal, action, resource);' },
});
const allow = { decision: 'allow', reason: 'policy-allow', policyIds: ['allow'] };
const clients = [];
const realWorkers = [];
class FakeWorker extends EventEmitter {
  static instances = [];
  constructor(filename, options) {
    super();
    this.filename = filename;
    this.options = options;
    this.terminate = vi.fn(() => new Promise(() => {}));
    this.stdout = { resume: vi.fn() };
    this.stderr = { resume: vi.fn() };
    FakeWorker.instances.push(this);
  }
}
function client(WorkerClass = FakeWorker) {
  const value = createCedarWorkerClient({ WorkerClass });
  clients.push(value);
  return value;
}
const last = () => FakeWorker.instances.at(-1);
const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });
afterEach(async () => {
  for (const value of clients.splice(0)) value.close();
  for (const worker of FakeWorker.instances.splice(0)) worker.emit('exit', 1);
  await Promise.all(realWorkers.splice(0).map((worker) => worker.terminate()));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Cedar worker cached diagnostics admission', () => {
  it.each(['normal', 'enabled', 'cached', 'late'])(
    'guards effective worker diagnostics before snapshot or construction: %s',
    async (control) => {
      const debug = control === 'enabled' || control === 'cached';
      const fixture = fileURLToPath(
        new URL('../fixtures/cedar-worker/adversary.cjs', import.meta.url),
      );
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [fixture, control, require.resolve('../../src/main/cedar-worker-client')],
        {
          cwd: process.cwd(),
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 64 * 1024,
          env: {
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            NODE_DEBUG: debug ? 'worker' : '',
          },
        },
      );
      expect(stderr.includes('CEDAR_R2_DIAGNOSTIC_CANARY_1049')).toBe(false);
      expect(stdout.includes('CEDAR_R2_DIAGNOSTIC_CANARY_1049')).toBe(false);
      const result = JSON.parse(stdout.trim());
      expect(result).toEqual({
        result: debug ? deny('cedar-unavailable') : allow,
        initialDebug: debug,
        effectiveDebug: debug,
        envDebugPresent: control === 'enabled' || control === 'late',
        snapshots: debug ? 0 : 1,
        constructed: debug ? 0 : 1,
      });
    },
  );
});

describe('Cedar worker admission and delivery ownership', () => {
  it('is dormant; refuses concurrency before private getters and snapshots admitted data', async () => {
    const value = client();
    expect(FakeWorker.instances).toHaveLength(0);
    const input = action();
    const selected = policy();
    const pending = value.evaluate(selected, input);
    const worker = last();
    let inspected = 0;
    const inspect = () => {
      inspected++;
      throw Error('PRIVATE');
    };
    const privateInput = new Proxy({}, { get: inspect, getPrototypeOf: inspect, ownKeys: inspect });
    expect(await value.evaluate(privateInput, privateInput, privateInput)).toEqual(
      deny('cedar-worker-busy'),
    );
    expect(inspected).toBe(0);
    input.args[0] = 'CHANGED';
    selected.policies.allow = 'CHANGED';
    expect(worker.options.workerData.action.args).toEqual(['PRIVATE_ARG']);
    expect(worker.options.workerData.policy.policies.allow).toContain('permit');
    expect(worker.options).toMatchObject({
      env: {},
      execArgv: [],
      argv: [],
      stdout: true,
      stderr: true,
    });
    worker.emit('message', allow);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(await value.evaluate(policy(), action())).toEqual(deny('cedar-worker-busy'));
    worker.emit('exit', 0);
    expect(await pending).toEqual(allow);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.stdout.resume).toHaveBeenCalledOnce();
    expect(worker.stderr.resume).toHaveBeenCalledOnce();
  });

  it('holds success until exit, rejects duplicate metadata, and ignores old lifetime callbacks', async () => {
    const value = client();
    const pending = value.evaluate(policy(), action());
    const worker = last();
    let delivered = false;
    pending.then(() => {
      delivered = true;
    });
    worker.emit('message', allow);
    await Promise.resolve();
    expect(delivered).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit('message', allow);
    expect(await pending).toEqual(deny('cedar-worker-protocol'));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(await value.evaluate(policy(), action())).toEqual(deny('cedar-worker-busy'));
    worker.emit('exit', 1);
    const next = value.evaluate(policy(), action());
    worker.emit('message', allow);
    worker.emit('error', Error('PRIVATE_LATE_ERROR'));
    last().emit('message', allow);
    last().emit('exit', 0);
    expect(await next).toEqual(allow);
  });

  it.each(['messageerror', 'error', 'exit'])(
    'redacts %s and recovers only after exit',
    async (event) => {
      const value = client();
      const pending = value.evaluate(policy(), action());
      const worker = last();
      worker.emit(event, event === 'exit' ? 2 : Error('PRIVATE_PATH'));
      expect(await pending).toEqual(
        deny(event === 'messageerror' ? 'cedar-worker-protocol' : 'cedar-worker-failed'),
      );
      if (event !== 'exit') {
        expect(await value.evaluate(policy(), action())).toEqual(deny('cedar-worker-busy'));
        worker.emit('message', allow);
        worker.emit('exit', 1);
      }
      const next = value.evaluate(policy(), action());
      last().emit('message', allow);
      last().emit('exit', 0);
      expect(await next).toEqual(allow);
    },
  );

  it.each(['throw', 'reject', 'resolve-without-exit'])(
    'fails closed when termination %s gives no exit',
    async (mode) => {
      const value = client();
      const pending = value.evaluate(policy(), action());
      const worker = last();
      worker.terminate.mockImplementation(() => {
        if (mode === 'throw') throw Error('PRIVATE_TERMINATION');
        return mode === 'reject'
          ? Promise.reject(Error('PRIVATE_TERMINATION'))
          : Promise.resolve(1);
      });
      worker.emit('error', Error('PRIVATE'));
      expect(await pending).toEqual(deny('cedar-worker-failed'));
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(await value.evaluate(policy(), action())).toEqual(deny('cedar-worker-busy'));
      worker.emit('exit', 1);
      const next = value.evaluate(policy(), action());
      last().emit('message', allow);
      last().emit('exit', 0);
      expect(await next).toEqual(allow);
    },
  );

  it('times out startup, invalidates late replies and never releases admission without exit', async () => {
    vi.useFakeTimers();
    const value = client();
    const pending = value.evaluate(policy(), action(), { timeoutMs: 25 });
    const worker = last();
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual(deny('cedar-worker-timeout'));
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.emit('message', allow);
    await vi.advanceTimersByTimeAsync(100000);
    expect(await value.evaluate(policy(), action())).toEqual(deny('cedar-worker-busy'));
    worker.emit('exit', 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['message', 'exit'])(
    'rejects a late %s even before the timer callback gets its turn',
    async (event) => {
      let now = 100;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const value = client();
      const pending = value.evaluate(policy(), action(), { timeoutMs: 50 });
      if (event === 'exit') last().emit('message', allow);
      now = 151;
      last().emit(event, event === 'exit' ? 1 : allow);
      expect(await pending).toEqual(deny('cedar-worker-timeout'));
    },
  );

  it.each([1, 2])('denies abnormal exit %s even after valid metadata', async (code) => {
    const value = client();
    const pending = value.evaluate(policy(), action());
    last().emit('message', allow);
    last().emit('exit', code);
    expect(await pending).toEqual(deny('cedar-worker-failed'));
  });

  it('aborts before creation or during delivery; close is permanent and clears timers', async () => {
    vi.useFakeTimers();
    const value = client();
    const signal = new AbortController();
    signal.abort();
    expect(await value.evaluate(policy(), action(), { signal: signal.signal })).toEqual(
      deny('cedar-worker-cancelled'),
    );
    expect(FakeWorker.instances).toHaveLength(0);
    const live = new AbortController();
    const pending = value.evaluate(policy(), action(), { signal: live.signal });
    last().emit('message', allow);
    live.abort();
    expect(await pending).toEqual(deny('cedar-worker-cancelled'));
    last().emit('exit', 1);
    const final = value.evaluate(policy(), action());
    value.close();
    value.close();
    expect(await final).toEqual(deny('cedar-worker-cancelled'));
    expect(await value.evaluate(policy(), action())).toEqual(deny('cedar-worker-closed'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('denies constructor failure and invalid input/options without fallback', async () => {
    const broken = client(
      class {
        constructor() {
          throw Error('PRIVATE_STARTUP');
        }
      },
    );
    expect(await broken.evaluate(policy(), action())).toEqual(deny('cedar-worker-failed'));
    expect(await broken.evaluate(policy(), action())).toEqual(deny('cedar-worker-failed'));
    const value = client();
    for (const timeoutMs of [0, -1, 30001, NaN, Infinity, '5', 1.2])
      expect(await value.evaluate(policy(), action(), { timeoutMs })).toEqual(
        deny('request-invalid'),
      );
    expect(await value.evaluate(policy(), action(), { signal: {} })).toEqual(
      deny('request-invalid'),
    );
    expect(await value.evaluate(policy(), { ...action(), launch: {} })).toEqual(
      deny('request-invalid'),
    );
    expect(await value.evaluate({ ...policy(), binding: {} }, action())).toEqual(
      deny('policy-invalid'),
    );
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

function actualClient(mode, marker) {
  return client(
    class extends Worker {
      constructor(entry, options) {
        super(
          mode
            ? fileURLToPath(new URL('../fixtures/cedar-worker/adversary.cjs', import.meta.url))
            : entry,
          mode
            ? { ...options, workerData: { mode, marker, entry, request: options.workerData } }
            : options,
        );
        realWorkers.push(this);
      }
    },
  );
}

describe('Cedar real worker availability boundary', () => {
  it.each(['candidate-stall', 'delayed-duplicate'])(
    'denies %s after the parent observes a valid candidate',
    async (mode) => {
      const marker = new Int32Array(new SharedArrayBuffer(8));
      const value = actualClient(mode, marker);
      const pending = value.evaluate(policy(), action(), { timeoutMs: 700 });
      const worker = realWorkers.at(-1);
      const exited = new Promise((resolve) => worker.once('exit', resolve));
      const messages = [];
      worker.on('message', (reply) => {
        messages.push(reply);
        if (messages.length === 1) {
          Atomics.store(marker, 1, 1);
          Atomics.notify(marker, 1);
        }
      });
      expect(await pending).toEqual(
        deny(mode === 'candidate-stall' ? 'cedar-worker-timeout' : 'cedar-worker-protocol'),
      );
      await exited;
      expect(messages).toEqual(mode === 'candidate-stall' ? [allow] : [allow, allow]);
      expect(Atomics.load(marker, 0)).toBe(mode === 'candidate-stall' ? 2 : 3);
    },
  );

  it.each(['startup-hang', 'evaluation-hang'])(
    'keeps the parent heartbeat live during %s and confirms exit',
    async (mode) => {
      const marker = new Int32Array(new SharedArrayBuffer(4));
      const value = actualClient(mode, marker);
      let heartbeats = 0;
      const heartbeat = setInterval(() => {
        heartbeats++;
      }, 5);
      try {
        const pending = value.evaluate(policy(), action(), { timeoutMs: 700 });
        const exited = new Promise((resolve) => realWorkers.at(-1).once('exit', resolve));
        expect(await pending).toEqual(deny('cedar-worker-timeout'));
        expect(Atomics.load(marker, 0)).toBe(mode === 'evaluation-hang' ? 2 : 1);
        expect(heartbeats).toBeGreaterThan(5);
        await exited;
        const next = value.evaluate(policy(), action(), { timeoutMs: 700 });
        expect((await next).reason).toBe('cedar-worker-timeout');
      } finally {
        clearInterval(heartbeat);
      }
    },
  );

  it.each(['malformed', 'duplicate', 'crash'])(
    'denies real %s with redacted metadata',
    async (mode) => {
      expect(await actualClient(mode).evaluate(policy(), action())).toEqual(
        deny(mode === 'crash' ? 'cedar-worker-failed' : 'cedar-worker-protocol'),
      );
    },
  );

  it('loads official WASM, inherits no environment and cleans up before native decision delivery', async () => {
    const value = actualClient('environment');
    expect(await value.evaluate(policy(), action())).toEqual(allow);
    const next = actualClient();
    expect(await next.evaluate(policy(), action())).toEqual(allow);
    expect(
      await next.evaluate(
        { ...policy(), policies: { deny: 'forbid(principal, action, resource);' } },
        action(),
      ),
    ).toEqual({ decision: 'deny', reason: 'policy-deny', policyIds: ['deny'] });
  });
});
