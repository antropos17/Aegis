import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = require('../../src/main/action-catalog-check');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function setup(overrides = {}) {
  const cap = Object.freeze({});
  const bindings = [{}, {}, {}];
  const deps = {
    runtime: () => true,
    terminal: () => true,
    capture: vi.fn(async () => cap),
    revoke: vi.fn(),
    list: vi.fn(() => bindings.map((_b, i) => ({ name: 'aegis_action_' + i }))),
    select: vi.fn((_cap, name) => ({
      policyPath: 'PRIVATE_POLICY',
      requestPath: name,
      binding: bindings[Number(name.at(-1))],
    })),
    prepare: vi.fn(async (_p, name) => {
      const decision = ['allow', 'ask', 'deny'][Number(name.at(-1))];
      return { decision, reason: 'policy-' + decision, launch: { secret: 'PRIVATE_LAUNCH' } };
    }),
    ...overrides,
  };
  api._setDepsForTest(deps);
  return { deps, cap, bindings };
}
afterEach(() => {
  api._resetForTest();
  vi.useRealTimers();
});

it('checks mixed decisions with pinned selections, sanitized reports and final all-member liveness', async () => {
  const { deps, cap, bindings } = setup();
  const result = await api.checkActionCatalogRoute('mcp-stdio', 'PRIVATE_MANIFEST');
  expect(result).toMatchObject({
    schemaVersion: 1,
    mode: 'action-catalog-check',
    configuration: 'valid',
    reason: 'catalog-checked',
    policyDecision: 'unknown',
    authorization: 'none',
    executionPerformed: false,
    configurationObservation: 'bounded-revision-check-not-retained',
  });
  expect(result.actions.map((a) => a.policyDecision)).toEqual(['allow', 'ask', 'deny']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(deps.select).toHaveBeenCalledTimes(6);
  expect(deps.revoke).toHaveBeenCalledExactlyOnceWith(cap);
  bindings.forEach((binding, i) => expect(deps.prepare.mock.calls[i][2]).toEqual({ binding }));
});

it('retains sanitized structural failures with invalid precedence over unavailable', async () => {
  let n = 0;
  const f = setup({
    prepare: async () =>
      [
        { decision: 'allow', reason: 'policy-allow' },
        { decision: 'deny', reason: 'policy-invalid' },
        { decision: 'deny', reason: 'PRIVATE_ERROR' },
      ][n++],
  });
  const result = await api.checkActionCatalogRoute('mcp-stdio', 'catalog');
  expect(result.configuration).toBe('invalid');
  expect(result.actions.map((a) => a.configuration)).toEqual(['valid', 'invalid', 'unavailable']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(f.deps.revoke).toHaveBeenCalledOnce();
});

it('clears every earlier observation when evaluation revokes another member', async () => {
  let revoked = false;
  const f = setup({
    prepare: async () => {
      revoked = true;
      return { decision: 'deny', reason: 'configuration-changed' };
    },
    select: () => {
      if (revoked) throw Error('PRIVATE_ERROR');
      return { policyPath: 'p', requestPath: 'r', binding: {} };
    },
  });
  const result = await api.checkActionCatalogRoute('mcp-stdio', 'catalog');
  expect(result).toMatchObject({
    configuration: 'unavailable',
    reason: 'configuration-changed',
    actions: [],
  });
  expect(f.deps.revoke).toHaveBeenCalledOnce();
});

it('checks final liveness even for the last entry and discards all results', async () => {
  const f = setup({ list: () => [{ name: 'aegis_action_0' }] });
  f.deps.select
    .mockImplementationOnce(() => ({ policyPath: 'p', requestPath: 'aegis_action_0', binding: {} }))
    .mockImplementationOnce(() => {
      throw Error('PRIVATE_REVOKED');
    });
  expect(await api.checkActionCatalogRoute('mcp-stdio', 'catalog')).toMatchObject({
    reason: 'configuration-changed',
    actions: [],
  });
});

it('requires current-process terminal for review but still evaluates its files', async () => {
  const f = setup({ terminal: () => false });
  const result = await api.checkActionCatalogRoute('mcp-review', 'catalog');
  expect(result).toMatchObject({
    configuration: 'valid',
    terminal: 'unavailable',
    terminalScope: 'checking-process-only',
    askBehavior: 'terminal-confirmation',
  });
  expect(f.deps.prepare).toHaveBeenCalledTimes(3);
});

it('does no capture for unsupported runtime or pre-abort', async () => {
  const f = setup({ runtime: () => false });
  expect(await api.checkActionCatalogRoute('mcp-stdio', 'catalog')).toMatchObject({
    runtime: 'unsupported',
    configuration: 'not-checked',
  });
  const controller = new AbortController();
  controller.abort();
  expect(
    await api.checkActionCatalogRoute('mcp-review', 'catalog', { signal: controller.signal }),
  ).toMatchObject({ reason: 'check-cancelled', runtime: 'not-checked' });
  expect(f.deps.capture).not.toHaveBeenCalled();
});

it('redacts capture and evaluator exceptions and revokes captured capability', async () => {
  setup({
    capture: async () => {
      throw Error('PRIVATE_CAPTURE');
    },
  });
  expect(await api.checkActionCatalogRoute('mcp-stdio', 'catalog')).toMatchObject({
    reason: 'catalog-unavailable',
    actions: [],
  });
  const f = setup({
    prepare: async () => {
      throw Error('PRIVATE_PREPARE');
    },
  });
  const result = await api.checkActionCatalogRoute('mcp-stdio', 'catalog');
  expect(result).toMatchObject({ reason: 'check-unavailable', actions: [] });
  expect(f.deps.revoke).toHaveBeenCalledOnce();
});

it.each(['timeout', 'abort'])('revokes a late capture after %s without preparing', async (kind) => {
  vi.useFakeTimers();
  const late = deferred();
  const controller = new AbortController();
  const f = setup({ capture: () => late.promise });
  const pending = api.checkActionCatalogRoute('mcp-stdio', 'catalog', {
    signal: controller.signal,
  });
  if (kind === 'timeout') await vi.advanceTimersByTimeAsync(1500);
  else controller.abort();
  const result = await pending;
  expect(result.actions).toEqual([]);
  const cap = {};
  late.resolve(cap);
  await tick();
  expect(f.deps.revoke).toHaveBeenCalledExactlyOnceWith(cap);
  expect(f.deps.prepare).not.toHaveBeenCalled();
});

it('uses one deadline across capture and sequential preparation, ignores late allow', async () => {
  vi.useFakeTimers();
  const capture = deferred();
  const preparing = deferred();
  const f = setup({ capture: () => capture.promise, prepare: vi.fn(() => preparing.promise) });
  const pending = api.checkActionCatalogRoute('mcp-stdio', 'catalog');
  await vi.advanceTimersByTimeAsync(1000);
  capture.resolve(f.cap);
  await tick();
  await vi.advanceTimersByTimeAsync(500);
  expect(await pending).toMatchObject({
    configuration: 'unavailable',
    reason: 'check-timeout',
    actions: [],
  });
  expect(f.deps.revoke).toHaveBeenCalledExactlyOnceWith(f.cap);
  preparing.resolve({ decision: 'allow', reason: 'policy-allow' });
  await tick();
  expect(f.deps.prepare).toHaveBeenCalledOnce();
});

it('enforces monotonic deadline even when evaluator returns before timer callback', async () => {
  let time = 0;
  const f = setup({
    now: () => time,
    prepare: async () => {
      time = 1500;
      return { decision: 'allow', reason: 'policy-allow' };
    },
  });
  expect(await api.checkActionCatalogRoute('mcp-stdio', 'catalog')).toMatchObject({
    reason: 'check-timeout',
    actions: [],
  });
  expect(f.deps.revoke).toHaveBeenCalledOnce();
});

it('does not start the next evaluation before the previous one settles', async () => {
  const first = deferred();
  const f = setup();
  f.deps.prepare.mockImplementationOnce(() => first.promise);
  const pending = api.checkActionCatalogRoute('mcp-stdio', 'catalog');
  await tick();
  expect(f.deps.prepare).toHaveBeenCalledOnce();
  first.resolve({ decision: 'allow', reason: 'policy-allow' });
  expect((await pending).actions).toHaveLength(3);
});

it('removes cancellation listener and rejects unknown routes without capture', async () => {
  const f = setup();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await api.checkActionCatalogRoute('mcp-stdio', 'catalog', { signal: controller.signal });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  await expect(api.checkActionCatalogRoute('direct', 'catalog')).rejects.toThrow(
    'route-unsupported',
  );
  expect(f.deps.capture).toHaveBeenCalledOnce();
});

it('discards an earlier valid observation when the second evaluation reaches the total deadline', async () => {
  vi.useFakeTimers();
  const second = deferred();
  const f = setup();
  f.deps.prepare
    .mockResolvedValueOnce({ decision: 'allow', reason: 'policy-allow' })
    .mockImplementationOnce(() => second.promise);
  const pending = api.checkActionCatalogRoute('mcp-stdio', 'catalog');
  await tick();
  expect(f.deps.prepare).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toMatchObject({ reason: 'check-timeout', actions: [] });
  second.resolve({ decision: 'allow', reason: 'policy-allow' });
  await tick();
  expect(f.deps.prepare).toHaveBeenCalledTimes(2);
  expect(f.deps.revoke).toHaveBeenCalledOnce();
});
