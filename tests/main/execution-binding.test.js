import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const bindings = require('../../src/main/execution-binding');
const { prepareExecution } = require('../../src/main/execution-policy');
const runner = require('../../src/main/action-execution');
const directories = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-binding-'));
  directories.push(directory);
  const policy = path.join(directory, 'policy.json');
  const request = path.join(directory, 'request.json');
  const action = {
    executable: process.execPath,
    cwd: directory,
    args: ['PRIVATE_ARGUMENT'],
    env: {},
  };
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'allow' }],
    }),
  );
  return { policy, request, action };
}
const capture = (t, options) => bindings.captureExecutionBinding(t.policy, t.request, options);
const prepare = (t, binding) => prepareExecution(t.policy, t.request, { binding });
const active = (t, binding) => bindings.isExecutionBindingActive(binding, t.policy, t.request);
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
afterEach(() => {
  bindings._resetForTest();
  runner._resetForTest();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('private execution revision binding', () => {
  it('keeps only an opaque frozen capability and matches the selected bytes', async () => {
    const t = fixture();
    const binding = await capture(t);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Reflect.ownKeys(binding)).toEqual([]);
    expect(JSON.stringify(binding)).toBe('{}');
    for (const kind of ['request', 'policy']) {
      expect(
        bindings.matchesExecutionBinding(
          binding,
          t.policy,
          t.request,
          kind,
          fs.readFileSync(t[kind]),
        ),
      ).toBe(true);
    }
    expect(await prepare(t, binding)).toMatchObject({
      decision: 'allow',
      launch: { args: ['PRIVATE_ARGUMENT'] },
    });
    bindings.revokeExecutionBinding(binding);
    expect(active(t, binding)).toBe(false);
    expect((await prepare(t, binding)).reason).toBe('configuration-changed');
  });

  it.each([undefined, null, {}, 1, 'private', true])(
    'rejects explicitly supplied invalid capability %# without spawning',
    async (binding) => {
      const t = fixture();
      const spawn = vi.fn();
      runner._setDepsForTest({ spawn });
      expect((await runner.executeAction(t.policy, t.request, { binding })).reason).toBe(
        'configuration-changed',
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('does not allow a serialized copy to recover the scope', async () => {
    const t = fixture();
    const binding = await capture(t);
    expect((await prepare(t, JSON.parse(JSON.stringify(binding)))).decision).toBe('deny');
    expect(active(t, binding)).toBe(true);
  });

  it.each(['policy', 'request'])(
    'revokes on any observed %s byte change even after restoration',
    async (kind) => {
      const t = fixture();
      const binding = await capture(t);
      const original = fs.readFileSync(t[kind]);
      fs.appendFileSync(t[kind], ' ');
      expect((await prepare(t, binding)).reason).toBe('configuration-changed');
      fs.writeFileSync(t[kind], original);
      expect((await prepare(t, binding)).reason).toBe('configuration-changed');
      expect((await prepare(t, await capture(t))).decision).toBe('allow');
    },
  );

  it('revokes after an unavailable read, while standalone preparation can recover', async () => {
    const t = fixture();
    const binding = await capture(t);
    const original = fs.readFileSync(t.request);
    fs.unlinkSync(t.request);
    expect((await prepare(t, binding)).reason).toBe('configuration-unavailable');
    fs.writeFileSync(t.request, original);
    expect((await prepare(t, binding)).reason).toBe('configuration-changed');
    expect((await prepareExecution(t.policy, t.request)).decision).toBe('allow');
  });

  it('binds file role and exact selected path scope', async () => {
    const t = fixture();
    const first = await capture(t);
    expect(
      bindings.matchesExecutionBinding(
        first,
        t.policy,
        t.request,
        'policy',
        fs.readFileSync(t.request),
      ),
    ).toBe(false);
    const second = await capture(t);
    expect(bindings.isExecutionBindingActive(second, t.request, t.policy)).toBe(false);
    expect(active(t, second)).toBe(false);
  });

  it('snapshots the optional binding before execution yields', async () => {
    const t = fixture();
    const binding = await capture(t);
    const spawn = vi.fn();
    runner._setDepsForTest({ spawn });
    fs.appendFileSync(t.request, ' ');
    const options = { binding };
    const result = runner.executeAction(t.policy, t.request, options);
    delete options.binding;
    expect((await result).reason).toBe('configuration-changed');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps the preparation scope when the options object changes while reading', async () => {
    const t = fixture();
    const binding = await capture(t);
    const options = { binding };
    const result = prepareExecution(t.policy, t.request, options);
    options.binding = {};
    expect((await result).decision).toBe('allow');
  });

  it('rechecks revocation between successful preparation and launch', async () => {
    const t = fixture();
    const binding = await capture(t);
    const spawn = vi.fn();
    runner._setDepsForTest({
      spawn,
      prepare: async () => {
        const result = await prepare(t, binding);
        bindings.revokeExecutionBinding(binding);
        return result;
      },
    });
    expect((await runner.executeAction(t.policy, t.request, { binding })).reason).toBe(
      'configuration-changed',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('clears successful capture buffers and rejects malformed JSON without private errors', async () => {
    const buffers = [Buffer.from('{}'), Buffer.from('{}')];
    bindings._setDepsForTest({ read: async () => buffers.shift() });
    const originals = [...buffers];
    await bindings.captureExecutionBinding('policy', 'request');
    expect(originals.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    const malformed = Buffer.from('PRIVATE_INVALID');
    bindings._setDepsForTest({ read: async () => malformed });
    await expect(bindings.captureExecutionBinding('policy', 'request')).rejects.toThrow(
      /^binding-unavailable$/,
    );
    expect(malformed.every((byte) => byte === 0)).toBe(true);
  });

  it.each(['abort', 'timeout', 'failure'])(
    'clears late reader buffers after %s',
    async (reason) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let resolveLate;
      bindings._setDepsForTest({
        read: (filename) =>
          filename === 'policy'
            ? reason === 'failure'
              ? Promise.reject(new Error('PRIVATE_NATIVE_ERROR'))
              : Promise.resolve(Buffer.from('{}'))
            : new Promise((resolve) => {
                resolveLate = resolve;
              }),
      });
      const operation = bindings.captureExecutionBinding('policy', 'request', {
        signal: controller.signal,
      });
      const rejected = expect(operation).rejects.toThrow(/^binding-unavailable$/);
      await flush();
      if (reason === 'abort') controller.abort();
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(bindings.LIMITS.captureMs);
      await rejected;
      const late = Buffer.from('{"private":"late"}');
      resolveLate(late);
      await flush();
      expect(late.every((byte) => byte === 0)).toBe(true);
    },
  );

  it('rejects pre-aborted capture without reading and checks the monotonic deadline', async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn(async () => Buffer.from('{}'));
    bindings._setDepsForTest({ read });
    await expect(
      bindings.captureExecutionBinding('policy', 'request', { signal: controller.signal }),
    ).rejects.toThrow('binding-unavailable');
    expect(read).not.toHaveBeenCalled();
    let clock = 0;
    bindings._setDepsForTest({ read, now: () => (clock++ ? bindings.LIMITS.captureMs : 0) });
    await expect(bindings.captureExecutionBinding('policy', 'request')).rejects.toThrow(
      'binding-unavailable',
    );
  });
});
