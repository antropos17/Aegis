import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const api = require('../../src/main/action-mcp-catalog');
const full = (name) => path.resolve('PRIVATE_' + name);
const manifest = (count = 2) => ({
  schemaVersion: 1,
  actions: Array.from({ length: count }, (_, i) => ({
    id: 'action' + i,
    policyPath: full('policy' + i),
    requestPath: full('request' + i),
  })),
});
function setup(value = manifest(), overrides = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  const captured = [];
  const revoked = new Set();
  const deps = {
    read: vi.fn(async () => bytes),
    capture: vi.fn(async () => {
      const cap = Object.freeze({});
      captured.push(cap);
      return cap;
    }),
    revoke: vi.fn((cap) => revoked.add(cap)),
    active: vi.fn((cap) => !revoked.has(cap)),
    ...overrides,
  };
  api._setDepsForTest(deps);
  return { bytes, deps, captured, revoked };
}
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
afterEach(() => {
  api._resetForTest();
  vi.useRealTimers();
});

it('captures bounded private actions and exposes detached immutable-name descriptors only', async () => {
  const f = setup();
  const cap = await api.captureActionCatalog(full('catalog'));
  expect(Object.isFrozen(cap)).toBe(true);
  expect(JSON.stringify(cap)).toBe('{}');
  expect(f.bytes.every((b) => b === 0)).toBe(true);
  const list = api.listActionCatalog(cap);
  expect(list.map((tool) => tool.name)).toEqual(['aegis_action_action0', 'aegis_action_action1']);
  expect(JSON.stringify(list)).not.toContain('PRIVATE');
  expect(list[0]).toMatchObject({
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: false },
  });
  list[0].inputSchema.properties.leak = {};
  expect(api.listActionCatalog(cap)[0].inputSchema.properties).toEqual({});
  const chosen = api.selectActionCatalog(cap, list[1].name);
  expect(chosen).toEqual({
    policyPath: full('policy1'),
    requestPath: full('request1'),
    binding: f.captured[1],
  });
  chosen.policyPath = 'changed';
  expect(api.selectActionCatalog(cap, list[1].name).policyPath).toBe(full('policy1'));
  expect(f.deps.active).toHaveBeenCalledTimes(4);
  expect(f.deps.read).toHaveBeenCalledTimes(1);
});

it('snapshots the manifest until another connection and never recaptures on selection', async () => {
  let current = manifest(1);
  const f = setup(current, { read: vi.fn(async () => Buffer.from(JSON.stringify(current))) });
  const first = await api.captureActionCatalog(full('catalog'));
  current = manifest(1);
  current.actions[0].id = 'new_action';
  expect(api.listActionCatalog(first)[0].name).toBe('aegis_action_action0');
  api.selectActionCatalog(first, 'aegis_action_action0');
  expect(f.deps.capture).toHaveBeenCalledTimes(1);
  const second = await api.captureActionCatalog(full('catalog'));
  expect(api.listActionCatalog(second)[0].name).toBe('aegis_action_new_action');
});

it.each([
  null,
  {},
  { ...manifest(), extra: true },
  { ...manifest(), schemaVersion: 2 },
  manifest(0),
  manifest(9),
  { schemaVersion: 1, actions: [manifest(1).actions[0], manifest(1).actions[0]] },
])('rejects invalid catalog shape before captures (%j)', async (value) => {
  const f = setup(value);
  await expect(api.captureActionCatalog(full('catalog'))).rejects.toThrow('catalog-unavailable');
  expect(f.deps.capture).not.toHaveBeenCalled();
  expect(f.bytes.every((b) => b === 0)).toBe(true);
});

it.each(['', 'UPPER', 'a'.repeat(33), 'a/b', '1bad', 'a.b', 'é'])(
  'rejects invalid id %s',
  async (id) => {
    const value = manifest(1);
    value.actions[0].id = id;
    const f = setup(value);
    await expect(api.captureActionCatalog(full('catalog'))).rejects.toThrow('catalog-unavailable');
    expect(f.deps.capture).not.toHaveBeenCalled();
  },
);

it.each(['relative.json', '\\\\server\\share\\file', '//server/share/file', 'bad\0file'])(
  'rejects nonlocal or unqualified selected path %s',
  async (selected) => {
    const value = manifest(1);
    value.actions[0].requestPath = selected;
    setup(value);
    await expect(api.captureActionCatalog(full('catalog'))).rejects.toThrow('catalog-unavailable');
  },
);

it('accepts exactly eight actions and valid boundary ids', async () => {
  const value = manifest(8);
  value.actions[0].id = 'a' + '_-0'.repeat(10) + 'z';
  const f = setup(value);
  expect(api.listActionCatalog(await api.captureActionCatalog(full('catalog')))).toHaveLength(8);
  expect(f.deps.capture).toHaveBeenCalledTimes(8);
});

it('revokes all members after any observed revocation while retaining published metadata', async () => {
  const f = setup();
  const cap = await api.captureActionCatalog(full('catalog'));
  const published = api.listActionCatalog(cap);
  f.revoked.add(f.captured[1]);
  expect(() => api.selectActionCatalog(cap, 'aegis_action_action0')).toThrow('catalog-unavailable');
  expect(f.captured.every((binding) => f.revoked.has(binding))).toBe(true);
  expect(api.listActionCatalog(cap)).toEqual(published);
  expect(() => api.selectActionCatalog(cap, 'aegis_action_action1')).toThrow('catalog-unavailable');
});

it('rejects unknown tools/capabilities and revokes idempotently without recapture', async () => {
  const f = setup();
  const cap = await api.captureActionCatalog(full('catalog'));
  expect(() => api.selectActionCatalog(cap, full('policy0'))).toThrow('catalog-unavailable');
  expect(() => api.selectActionCatalog({}, 'aegis_action_action0')).toThrow('catalog-unavailable');
  expect(() => api.listActionCatalog({})).toThrow('catalog-unavailable');
  api.revokeActionCatalog(cap);
  api.revokeActionCatalog(cap);
  api.revokeActionCatalog({});
  expect(f.deps.revoke).toHaveBeenCalledTimes(2);
  expect(() => api.selectActionCatalog(cap, 'aegis_action_action0')).toThrow('catalog-unavailable');
  expect(f.deps.capture).toHaveBeenCalledTimes(2);
});

it('atomically revokes successful and late bindings when another capture fails', async () => {
  const late = deferred();
  const failure = deferred();
  const good = {};
  let index = 0;
  const f = setup(manifest(3), {
    capture: vi.fn(() => [Promise.resolve(good), failure.promise, late.promise][index++]),
  });
  const pending = api.captureActionCatalog(full('catalog'));
  const checked = expect(pending).rejects.toThrow('catalog-unavailable');
  await tick();
  failure.reject(Error('PRIVATE_ERROR'));
  await checked;
  expect(f.revoked.has(good)).toBe(true);
  const lateCap = {};
  late.resolve(lateCap);
  await tick();
  expect(f.revoked.has(lateCap)).toBe(true);
});

it('aborts initialization and revokes ignored-signal late captures', async () => {
  const controller = new AbortController();
  const late = deferred();
  const f = setup(manifest(1), { capture: vi.fn(() => late.promise) });
  const pending = api.captureActionCatalog(full('catalog'), { signal: controller.signal });
  const checked = expect(pending).rejects.toThrow('catalog-unavailable');
  await tick();
  controller.abort();
  await checked;
  expect(f.deps.capture.mock.calls[0][2].signal.aborted).toBe(true);
  const binding = {};
  late.resolve(binding);
  await tick();
  expect(f.revoked.has(binding)).toBe(true);
});

it('uses one total deadline including manifest reading and zeroes late read buffers', async () => {
  vi.useFakeTimers();
  const late = deferred();
  const f = setup(manifest(), { read: vi.fn(() => late.promise) });
  const pending = api.captureActionCatalog(full('catalog'));
  const checked = expect(pending).rejects.toThrow('catalog-unavailable');
  await vi.advanceTimersByTimeAsync(api.LIMITS.captureMs);
  await checked;
  const bytes = Buffer.from(JSON.stringify(manifest()));
  late.resolve(bytes);
  await tick();
  expect(bytes.every((b) => b === 0)).toBe(true);
  expect(f.deps.capture).not.toHaveBeenCalled();
});

it('rejects a pre-aborted request without reading and catches monotonic deadline overrun', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = setup();
  await expect(
    api.captureActionCatalog(full('catalog'), { signal: controller.signal }),
  ).rejects.toThrow('catalog-unavailable');
  expect(f.deps.read).not.toHaveBeenCalled();
  let clock = 0;
  const g = setup(manifest(1), {
    now: () => clock,
    capture: async () => {
      clock = 1501;
      return {};
    },
  });
  await expect(api.captureActionCatalog(full('catalog'))).rejects.toThrow('catalog-unavailable');
  expect(g.deps.revoke).toHaveBeenCalledTimes(1);
});

it('rejects extra entry fields and Windows drive-relative or alternate-stream paths', async () => {
  const extra = manifest(1);
  extra.actions[0].description = 'PRIVATE_TEXT';
  setup(extra);
  await expect(api.captureActionCatalog(full('catalog'))).rejects.toThrow('catalog-unavailable');
  if (process.platform === 'win32') {
    for (const selected of ['C:relative.json', '\\root-relative.json', 'C:\\safe.json:stream']) {
      const value = manifest(1);
      value.actions[0].policyPath = selected;
      setup(value);
      await expect(api.captureActionCatalog(full('catalog'))).rejects.toThrow(
        'catalog-unavailable',
      );
    }
  }
});

it('preserves one deadline across delayed reading and active binding captures', async () => {
  vi.useFakeTimers();
  const reading = deferred();
  const binding = deferred();
  const f = setup(manifest(1), { read: () => reading.promise, capture: () => binding.promise });
  const pending = api.captureActionCatalog(full('catalog'));
  const checked = expect(pending).rejects.toThrow('catalog-unavailable');
  await vi.advanceTimersByTimeAsync(1000);
  reading.resolve(Buffer.from(JSON.stringify(manifest(1))));
  await tick();
  await vi.advanceTimersByTimeAsync(500);
  await checked;
  const cap = {};
  binding.resolve(cap);
  await tick();
  expect(f.revoked.has(cap)).toBe(true);
});
