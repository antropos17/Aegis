import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = require('../../src/main/action-route-check');

const selected = {
  decision: 'allow',
  reason: 'policy-allow',
  launch: {
    executable: 'PRIVATE_EXECUTABLE',
    cwd: 'PRIVATE_CWD',
    args: ['PRIVATE_ARGS'],
    env: { PRIVATE_KEY: 'PRIVATE_TOKEN' },
  },
};
function setup(overrides = {}) {
  const deps = {
    runtime: vi.fn(() => true),
    terminal: vi.fn(() => true),
    prepare: vi.fn(async () => selected),
    ...overrides,
  };
  api._setDepsForTest(deps);
  return deps;
}
const check = (route = 'direct', options) =>
  api.checkActionRoute(route, 'PRIVATE_POLICY', 'PRIVATE_REQUEST', options);
afterEach(() => {
  api._resetForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(api.ROUTES)(
  'reports only current configuration and declared boundaries for %s',
  async (route) => {
    const deps = setup();
    const report = await check(route);
    expect(report).toMatchObject({
      schemaVersion: 1,
      mode: 'action-route-check',
      route,
      configuration: 'valid',
      policyDecision: 'allow',
      runtime: 'supported',
      executionPerformed: false,
      authorization: 'none',
      connection: 'not-checked',
      blockingVerification: 'not-performed',
      outsideRouteCoverage: 'unknown',
      descendantControl: 'unsupported',
      terminalScope: 'checking-process-only',
      configurationObservation: 'single-pass-not-retained',
    });
    expect(deps.prepare).toHaveBeenCalledExactlyOnceWith('PRIVATE_POLICY', 'PRIVATE_REQUEST');
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|launch/);
    expect(report).not.toHaveProperty('approval');
    expect(report.gaps).toContain('executable-content-binding');
  },
);

it.each(['direct', 'mcp-stdio'])('does not query a terminal for %s', async (route) => {
  const deps = setup({
    terminal: () => {
      throw Error('PRIVATE');
    },
  });
  expect(await check(route)).toMatchObject({
    terminal: 'not-required',
    askBehavior: 'not-started',
  });
  expect(deps.prepare).toHaveBeenCalledOnce();
});

it.each(['terminal', 'mcp-review'])(
  'separates unavailable current TTY from valid policy for %s',
  async (route) => {
    setup({ terminal: () => false });
    expect(await check(route)).toMatchObject({
      configuration: 'valid',
      terminal: 'unavailable',
      policyDecision: 'allow',
      askBehavior: 'terminal-confirmation',
      authorization: 'none',
    });
  },
);

it.each(['allow', 'ask', 'deny'])('preserves %s without granting permission', async (decision) => {
  setup({ prepare: async () => ({ decision, reason: `policy-${decision}` }) });
  expect(await check()).toMatchObject({
    configuration: 'valid',
    policyDecision: decision,
    reason: `policy-${decision}`,
    authorization: 'none',
    executionPerformed: false,
  });
});

it('reports a review-required action as a valid ask without exposing its launch', async () => {
  setup({ prepare: async () => ({ ...selected, decision: 'ask', reason: 'review-required' }) });
  const report = await check('mcp-review');
  expect(report).toMatchObject({
    configuration: 'valid',
    policyDecision: 'ask',
    reason: 'review-required',
    authorization: 'none',
  });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([
  [{ decision: 'deny', reason: 'request-invalid' }, 'invalid', 'request-invalid'],
  [{ decision: 'deny', reason: 'policy-invalid' }, 'invalid', 'policy-invalid'],
  [{ decision: 'deny', reason: 'input-unavailable' }, 'unavailable', 'input-unavailable'],
  [{ decision: 'allow', reason: 'policy-deny', PRIVATE: true }, 'unavailable', 'check-unavailable'],
  [{ decision: 'PRIVATE', reason: 'PRIVATE' }, 'unavailable', 'check-unavailable'],
  [undefined, 'unavailable', 'check-unavailable'],
])('projects only recognized evaluator outcomes %#', async (value, configuration, reason) => {
  setup({ prepare: async () => value });
  const report = await check();
  expect(report).toMatchObject({ configuration, reason, policyDecision: 'unknown' });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('does not read private launch fields even when they cannot be serialized', async () => {
  const value = { decision: 'allow', reason: 'policy-allow' };
  Object.defineProperty(value, 'launch', {
    get() {
      throw Error('PRIVATE_LAUNCH');
    },
  });
  setup({ prepare: async () => value });
  expect(await check()).toMatchObject({ configuration: 'valid', policyDecision: 'allow' });
});

it('does not read files for an unsupported runtime', async () => {
  const deps = setup({ runtime: () => false });
  expect(await check()).toMatchObject({
    runtime: 'unsupported',
    configuration: 'not-checked',
    policyDecision: 'unknown',
    reason: 'runtime-unsupported',
  });
  expect(deps.prepare).not.toHaveBeenCalled();
});

it('pre-abort admits no runtime, TTY or file work', async () => {
  const deps = setup();
  const controller = new AbortController();
  controller.abort();
  expect(await check('terminal', { signal: controller.signal })).toMatchObject({
    configuration: 'not-checked',
    runtime: 'not-checked',
    terminal: 'not-checked',
    reason: 'check-cancelled',
  });
  for (const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
});

it('bounds hung preparation and ignores a late allow', async () => {
  vi.useFakeTimers();
  let finish;
  setup({
    prepare: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const waiting = check();
  await vi.advanceTimersByTimeAsync(api.LIMITS.checkMs);
  const report = await waiting;
  expect(report).toMatchObject({
    configuration: 'unavailable',
    reason: 'check-timeout',
    policyDecision: 'unknown',
  });
  finish(selected);
  await Promise.resolve();
  expect(report.policyDecision).toBe('unknown');
  expect(vi.getTimerCount()).toBe(0);
});

it('checks monotonic elapsed time even if the timeout callback has not run', async () => {
  const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(api.LIMITS.checkMs);
  setup({ now });
  expect(await check()).toMatchObject({ configuration: 'unavailable', reason: 'check-timeout' });
});

it('aborts active preparation, removes listeners and ignores later failure', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  let fail;
  setup({
    prepare: () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  });
  const waiting = check('mcp-review', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  expect(await waiting).toMatchObject({ reason: 'check-cancelled', policyDecision: 'unknown' });
  fail(Error('PRIVATE_LATE_ERROR'));
  await Promise.resolve();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('suppresses a result when cancellation occurs inside preparation', async () => {
  const controller = new AbortController();
  setup({
    prepare: async () => {
      controller.abort();
      return selected;
    },
  });
  expect(await check('direct', { signal: controller.signal })).toMatchObject({
    reason: 'check-cancelled',
    policyDecision: 'unknown',
  });
});

it('never exports native errors', async () => {
  setup({
    prepare: async () => {
      throw Error('PRIVATE_FS_ERROR');
    },
  });
  const report = await check();
  expect(report).toMatchObject({ reason: 'check-unavailable', configuration: 'unavailable' });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it('returns independently owned reports and gap lists', async () => {
  setup();
  const first = await check();
  first.gaps.length = 0;
  first.authorization = 'PRIVATE';
  const next = await check();
  expect(next.gaps.length).toBeGreaterThan(0);
  expect(next.authorization).toBe('none');
});

it('rejects unsupported routes before file access with a fixed error', async () => {
  const deps = setup();
  await expect(check('PRIVATE_ROUTE')).rejects.toThrow('route-unsupported');
  expect(deps.prepare).not.toHaveBeenCalled();
});
