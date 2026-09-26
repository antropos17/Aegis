import { beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ipc = require('../../src/main/local-security-ipc');
let window, event, dialog, backend, retained;
it('observes only native-selected endpoints, permits readback while busy, and closes on navigation', async () => {
  const observation = { snapshot: vi.fn(() => ({ state: 'observed' })), close: vi.fn() };
  const observeActionRoute = vi.fn(() => observation);
  ipc.init({
    getWindow: () => window,
    dialog,
    backend,
    observeActionRoute,
    rendererUrl: 'file:///app/index.html',
  });
  expect(await ipc.handle(event, { action: 'observe-route', path: 'PRIVATE' })).toMatchObject({
    error: 'invalid-review-request',
  });
  expect(observeActionRoute).not.toHaveBeenCalled();
  expect(await ipc.handle(event, { action: 'observe-route' })).toMatchObject({
    success: true,
    observation: { state: 'observed' },
  });
  expect(observeActionRoute).toHaveBeenCalledExactlyOnceWith('/selected/project');
  let resolve;
  dialog.showOpenDialog.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = ipc.handle(event, run());
  expect(await ipc.handle(event, { action: 'route-observation' })).toMatchObject({
    success: true,
    observation: { state: 'observed' },
  });
  const navigation = window.webContents.on.mock.calls.find(
    ([name]) => name === 'did-start-navigation',
  )[1];
  navigation({ isMainFrame: true, isSameDocument: false });
  expect(observation.close).toHaveBeenCalledOnce();
  resolve({ canceled: true });
  await pending;
  expect(await ipc.handle(event, { action: 'route-observation' })).toEqual({
    success: true,
    observation: null,
  });
});

it('cancels endpoint selection without replacing evidence; rejects foreign observer controls', async () => {
  const observation = { snapshot: () => ({ state: 'observed' }), close: vi.fn() };
  const observeActionRoute = vi.fn(() => observation);
  ipc.init({
    getWindow: () => window,
    dialog,
    backend,
    observeActionRoute,
    rendererUrl: 'file:///app/index.html',
  });
  await ipc.handle(event, { action: 'observe-route' });
  dialog.showOpenDialog.mockResolvedValue({ canceled: true });
  expect(await ipc.handle(event, { action: 'observe-route' })).toMatchObject({ cancelled: true });
  expect(observation.close).not.toHaveBeenCalled();
  for (const action of ['observe-route', 'route-observation', 'stop-observing-route'])
    expect(await ipc.handle({ ...event, senderFrame: {} }, { action })).toMatchObject({
      error: 'request-denied',
    });
  await ipc.handle(event, { action: 'stop-observing-route' });
  expect(observation.close).toHaveBeenCalledOnce();
});

it('does not attach after navigation during endpoint selection, and destroys an attached observer with its window', async () => {
  const observation = { snapshot: () => ({ state: 'connecting' }), close: vi.fn() };
  const observeActionRoute = vi.fn(() => observation);
  ipc.init({
    getWindow: () => window,
    dialog,
    backend,
    observeActionRoute,
    rendererUrl: 'file:///app/index.html',
  });
  let finish;
  dialog.showOpenDialog.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = ipc.handle(event, { action: 'observe-route' });
  window.webContents.on.mock.calls.find(([name]) => name === 'did-start-navigation')[1]({
    isMainFrame: true,
    isSameDocument: false,
  });
  finish({ filePaths: ['/private/endpoint'] });
  expect(await pending).toMatchObject({ success: false });
  expect(observeActionRoute).not.toHaveBeenCalled();
  await ipc.handle(event, { action: 'observe-route' });
  window.webContents.on.mock.calls.find(([name]) => name === 'destroyed')[1]();
  expect(observation.close).toHaveBeenCalledOnce();
});
const run = (extra = {}) => ({
  action: 'run',
  mode: 'scan',
  adapter: 'project',
  tools: false,
  baseline: false,
  ...extra,
});
beforeEach(() => {
  window = {
    isDestroyed: () => false,
    webContents: { mainFrame: { url: 'file:///app/index.html' }, on: vi.fn() },
  };
  event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  dialog = {
    showOpenDialog: vi
      .fn()
      .mockResolvedValue({ filePaths: ['/selected/project'], canceled: false }),
    showSaveDialog: vi
      .fn()
      .mockResolvedValue({ filePath: '/outside/report.json', canceled: false }),
  };
  retained = {
    report: { mode: 'static-analysis', complete: false },
    subject: { root: '/selected/project' },
  };
  backend = {
    review: vi.fn().mockResolvedValue(retained),
    exportReport: vi.fn(),
    accept: vi.fn(),
    saveSnapshot: vi.fn(),
  };
  ipc.init({ getWindow: () => window, dialog, backend, rendererUrl: 'file:///app/index.html' });
});

it('rejects another window and a child frame before dialogs or reads', async () => {
  expect(await ipc.handle({ sender: {}, senderFrame: event.senderFrame }, run())).toMatchObject({
    error: 'request-denied',
  });
  expect(await ipc.handle({ ...event, senderFrame: {} }, run())).toMatchObject({
    error: 'request-denied',
  });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  expect(backend.review).not.toHaveBeenCalled();
});
it.each([
  'file:///private/unrelated.html',
  'https://untrusted.example/',
  'file:///app/index.html?different=1',
])('rejects a different top-level document: %s', async (url) => {
  event.senderFrame.url = url;
  expect(await ipc.handle(event, run())).toMatchObject({ error: 'request-denied' });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});
it('allows an in-page fragment but rejects a detached frame', async () => {
  event.senderFrame.url += '#local-security';
  expect(await ipc.handle(event, run())).toMatchObject({ success: true });
  event.senderFrame.detached = true;
  expect(await ipc.handle(event, run())).toMatchObject({ error: 'request-denied' });
});
it('invalidates a retained report on same-URL document reload', async () => {
  const result = await ipc.handle(event, run());
  const navigation = window.webContents.on.mock.calls.find(
    ([name]) => name === 'did-start-navigation',
  )[1];
  navigation({ isMainFrame: true, isSameDocument: false });
  expect(await ipc.handle(event, { action: 'export', id: result.review.id })).toMatchObject({
    error: 'review-expired',
  });
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});
it('invalidates a pending dialog across a same-frame navigation and return', async () => {
  let finish;
  dialog.showOpenDialog.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = ipc.handle(event, run());
  const navigation = window.webContents.on.mock.calls.find(
    ([name]) => name === 'did-start-navigation',
  )[1];
  navigation({ isMainFrame: true, isSameDocument: false });
  finish({ filePaths: ['/chosen/project'] });
  expect(await pending).toMatchObject({ success: false });
  expect(backend.review).not.toHaveBeenCalled();
});
it.each([
  null,
  [],
  {},
  run({ directory: '/secret' }),
  run({ adapter: '__proto__' }),
  run({ mode: 'exec' }),
  run({ tools: 'true' }),
  run({ baseline: true }),
  run({ format: 'cisco-skill-json' }),
  run({ mode: 'inventory', adapter: 'package' }),
  run({ mode: 'import', tools: true, format: 'cisco-skill-json' }),
  run({ mode: 'import', format: '__proto__' }),
  run({ mode: 'import', format: ['cisco-mcp-json'] }),
  run({ mode: 'import', format: { toString: null, valueOf: null } }),
])('rejects malformed or path-bearing requests before IO: %j', async (request) => {
  expect(await ipc.handle(event, request)).toMatchObject({
    success: false,
    error: 'invalid-review-request',
  });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});
it('uses only paths chosen in native dialogs', async () => {
  dialog.showOpenDialog
    .mockResolvedValueOnce({ filePaths: ['/chosen/root'] })
    .mockResolvedValueOnce({ filePaths: ['/chosen/tools.json'] });
  const result = await ipc.handle(event, run({ tools: true }));
  expect(result.success).toBe(true);
  expect(backend.review).toHaveBeenCalledWith(
    expect.objectContaining({ directory: '/chosen/root', toolsFile: '/chosen/tools.json' }),
  );
  expect(result.review).not.toHaveProperty('selection');
});
it.each(['gemini-user', 'gemini-project', 'gemini-system-windows'])(
  'accepts the built-in %s layout while keeping the directory native-selected',
  async (adapter) => {
    dialog.showOpenDialog.mockResolvedValueOnce({ filePaths: ['/chosen/gemini'] });
    const result = await ipc.handle(event, run({ mode: 'inventory', adapter }));
    expect(result.success).toBe(true);
    expect(backend.review).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'inventory', adapter, directory: '/chosen/gemini' }),
    );
    expect(result.review).not.toHaveProperty('selection');
  },
);
it('cancels without starting a scan when any required selection is cancelled', async () => {
  dialog.showOpenDialog
    .mockResolvedValueOnce({ filePaths: ['/chosen/root'] })
    .mockResolvedValueOnce({ canceled: true });
  expect(await ipc.handle(event, run({ tools: true }))).toEqual({
    success: false,
    cancelled: true,
  });
  expect(backend.review).not.toHaveBeenCalled();
});
it('serializes operations and rechecks ownership after the dialog', async () => {
  let resolveDialog;
  dialog.showOpenDialog.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveDialog = resolve;
    }),
  );
  const pending = ipc.handle(event, run());
  expect(await ipc.handle(event, run())).toMatchObject({ error: 'review-busy' });
  window.webContents.mainFrame = {};
  resolveDialog({ filePaths: ['/selected/project'] });
  expect(await pending).toMatchObject({ success: false });
  expect(backend.review).not.toHaveBeenCalled();
});
it('keeps a completed result available after cancelled or failed new runs', async () => {
  const first = await ipc.handle(event, run());
  dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true });
  await ipc.handle(event, run());
  backend.review.mockRejectedValueOnce(new Error('raw-secret /private/path'));
  expect(await ipc.handle(event, run())).toEqual({
    success: false,
    error: 'local-review-unavailable',
  });
  expect(await ipc.handle(event, { action: 'export', id: first.review.id })).toMatchObject({
    success: true,
    saved: true,
  });
  expect(backend.exportReport).toHaveBeenCalledWith(
    retained,
    '/outside/report.json',
    expect.any(Function),
  );
});
it('rejects a stale result id and arbitrary exported payloads', async () => {
  const first = await ipc.handle(event, run());
  backend.review.mockResolvedValueOnce({ ...retained });
  await ipc.handle(event, run());
  expect(await ipc.handle(event, { action: 'export', id: first.review.id })).toMatchObject({
    error: 'review-expired',
  });
  expect(
    await ipc.handle(event, { action: 'export', id: first.review.id, report: {} }),
  ).toMatchObject({ error: 'invalid-review-request' });
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});
it('requires the displayed digest and marks acceptance only after a successful write', async () => {
  retained.snapshot = { digest: 'a'.repeat(64), state: 'observed', body: { complete: true } };
  const result = await ipc.handle(event, run({ mode: 'inventory' }));
  expect(result.review.snapshot.canAccept).toBe(true);
  expect(
    await ipc.handle(event, { action: 'accept', id: result.review.id, digest: 'b'.repeat(64) }),
  ).toMatchObject({ error: 'snapshot-digest-mismatch' });
  backend.accept.mockRejectedValueOnce(new Error('snapshot-changed-since-review'));
  const request = { action: 'accept', id: result.review.id, digest: 'a'.repeat(64) };
  expect(await ipc.handle(event, request)).toMatchObject({
    error: 'snapshot-changed-since-review',
  });
  expect(retained.accepted).not.toBe(true);
  expect(await ipc.handle(event, request)).toMatchObject({
    success: true,
    accepted: true,
    saved: true,
  });
  expect(retained.accepted).toBe(true);
});
it('keeps cancellation distinct from successful saving', async () => {
  const result = await ipc.handle(event, run());
  dialog.showSaveDialog.mockResolvedValue({ canceled: true });
  expect(await ipc.handle(event, { action: 'export', id: result.review.id })).toEqual({
    success: false,
    cancelled: true,
  });
  expect(backend.exportReport).not.toHaveBeenCalled();
});

const checkRequest = (route = 'direct') => ({ action: 'check-route', route });
function checkDeps(overrides = {}) {
  const checkActionRoute = vi.fn(async () => ({
    schemaVersion: 1,
    mode: 'action-route-check',
    configuration: 'valid',
    policyDecision: 'deny',
    executionPerformed: false,
  }));
  const checkActionCatalogRoute = vi.fn(async () => ({
    schemaVersion: 1,
    mode: 'action-catalog-check',
    configuration: 'unavailable',
    actions: [],
    executionPerformed: false,
  }));
  ipc.init({
    getWindow: () => window,
    dialog,
    backend,
    rendererUrl: 'file:///app/index.html',
    checkActionRoute,
    checkActionCatalogRoute,
    ...overrides,
  });
  return { checkActionRoute, checkActionCatalogRoute };
}
it.each([
  { action: 'check-route' },
  { action: 'check-route', route: 'unknown' },
  { action: 'check-catalog', route: 'direct' },
  { action: 'check-catalog', route: 'terminal' },
  { action: 'check-route', route: 'direct', policyPath: '/private' },
  { action: 'check-catalog', route: 'mcp-stdio', manifest: '/private' },
  { action: 'check-route', route: ['direct'] },
])('rejects malformed GUI check requests before dialogs: %j', async (request) => {
  const checks = checkDeps();
  expect(await ipc.handle(event, request)).toMatchObject({ error: 'invalid-review-request' });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  expect(checks.checkActionRoute).not.toHaveBeenCalled();
});
it.each(['direct', 'terminal', 'mcp-stdio', 'mcp-review'])(
  'returns a check envelope for %s using only native selections',
  async (route) => {
    const checks = checkDeps();
    dialog.showOpenDialog
      .mockResolvedValueOnce({ filePaths: ['/PRIVATE_POLICY'] })
      .mockResolvedValueOnce({ filePaths: ['/PRIVATE_REQUEST'] });
    const response = await ipc.handle(event, checkRequest(route));
    expect(response).toMatchObject({
      success: true,
      check: {
        kind: 'single',
        route,
        report: { policyDecision: 'deny', executionPerformed: false },
      },
    });
    expect(response.check.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Number.isNaN(Date.parse(response.check.createdAt))).toBe(false);
    expect(checks.checkActionRoute).toHaveBeenCalledWith(
      route,
      '/PRIVATE_POLICY',
      '/PRIVATE_REQUEST',
      { signal: expect.any(AbortSignal) },
    );
    expect(JSON.stringify(response)).not.toContain('PRIVATE');
    expect(response).not.toHaveProperty('review');
    expect(backend.review).not.toHaveBeenCalled();
    expect(
      await ipc.handle(event, { action: 'save-snapshot', id: response.check.id }),
    ).toMatchObject({ error: 'review-expired' });
  },
);
it('returns unavailable catalog configuration as successful observation, not host failure', async () => {
  const checks = checkDeps();
  const response = await ipc.handle(event, { action: 'check-catalog', route: 'mcp-review' });
  expect(response).toMatchObject({
    success: true,
    check: { kind: 'catalog', route: 'mcp-review', report: { configuration: 'unavailable' } },
  });
  expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
  expect(checks.checkActionRoute).not.toHaveBeenCalled();
  expect(checks.checkActionCatalogRoute).toHaveBeenCalledOnce();
});
it.each([0, 1])(
  'does no core reads when selection stage %i is cancelled and preserves old review',
  async (stage) => {
    const checks = checkDeps();
    const old = await ipc.handle(event, run());
    if (stage) dialog.showOpenDialog.mockResolvedValueOnce({ filePaths: ['/PRIVATE_POLICY'] });
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true });
    expect(await ipc.handle(event, checkRequest())).toEqual({ success: false, cancelled: true });
    expect(checks.checkActionRoute).not.toHaveBeenCalled();
    expect(await ipc.handle(event, { action: 'export', id: old.review.id })).toMatchObject({
      saved: true,
    });
  },
);
it('preserves retained review across successful and failed checks without granting check export', async () => {
  const checks = checkDeps();
  const old = await ipc.handle(event, run());
  const checked = await ipc.handle(event, checkRequest());
  checks.checkActionRoute.mockRejectedValueOnce(Error('PRIVATE_PATH_AND_ERROR'));
  expect(await ipc.handle(event, checkRequest())).toEqual({
    success: false,
    error: 'local-review-unavailable',
  });
  expect(await ipc.handle(event, { action: 'export', id: checked.check.id })).toMatchObject({
    error: 'review-expired',
  });
  expect(await ipc.handle(event, { action: 'export', id: old.review.id })).toMatchObject({
    saved: true,
  });
});
it('rejects spoofed frames/documents for check requests', async () => {
  checkDeps();
  expect(
    await ipc.handle({ ...event, senderFrame: { url: event.senderFrame.url } }, checkRequest()),
  ).toMatchObject({ error: 'request-denied' });
  event.senderFrame.url = 'https://untrusted.example/';
  expect(await ipc.handle(event, checkRequest())).toMatchObject({ error: 'request-denied' });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});
it.each(['did-start-navigation', 'destroyed'])(
  'aborts pending core check on %s and suppresses late response',
  async (name) => {
    let resolve;
    let signal;
    checkDeps({
      checkActionRoute: (_route, _p, _r, options) => {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = ipc.handle(event, checkRequest());
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(await ipc.handle(event, run())).toMatchObject({ error: 'review-busy' });
    const listener = window.webContents.on.mock.calls.find(([eventName]) => eventName === name)[1];
    listener({ isMainFrame: true, isSameDocument: false });
    expect(signal.aborted).toBe(true);
    resolve({ configuration: 'valid', policyDecision: 'allow' });
    expect(await pending).toEqual({ success: false, error: 'local-review-unavailable' });
  },
);
it('rejects a frame replacement between file selections without invoking the core', async () => {
  const checks = checkDeps();
  let finish;
  dialog.showOpenDialog.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = ipc.handle(event, checkRequest());
  window.webContents.mainFrame = { url: 'file:///app/index.html' };
  finish({ filePaths: ['/PRIVATE_POLICY'] });
  expect((await pending).success).toBe(false);
  expect(checks.checkActionRoute).not.toHaveBeenCalled();
  expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
});
it('uses the real core on selected native files and returns a valid deny without launching', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gui-check-'));
  try {
    const policy = path.join(root, 'PRIVATE_POLICY.json');
    const request = path.join(root, 'PRIVATE_REQUEST.json');
    const sentinel = path.join(root, 'PRIVATE_SENTINEL');
    fs.writeFileSync(
      policy,
      JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [] }),
    );
    fs.writeFileSync(
      request,
      JSON.stringify({
        schemaVersion: 1,
        action: {
          executable: process.execPath,
          cwd: root,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)},'SECRET_BODY')`],
          env: { SECRET_ENV: 'SECRET_VALUE' },
        },
      }),
    );
    dialog.showOpenDialog
      .mockResolvedValueOnce({ filePaths: [policy] })
      .mockResolvedValueOnce({ filePaths: [request] });
    const response = await ipc.handle(event, checkRequest());
    expect(response).toMatchObject({
      success: true,
      check: {
        report: {
          configuration: 'valid',
          policyDecision: 'deny',
          authorization: 'none',
          executionPerformed: false,
        },
      },
    });
    const text = JSON.stringify(response);
    for (const privateValue of [root, 'SECRET_BODY', 'SECRET_VALUE', 'PRIVATE'])
      expect(text).not.toContain(privateValue);
    expect(fs.existsSync(sentinel)).toBe(false);
  } finally {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('aborts an active check when a replacement owned frame makes a new request', async () => {
  let resolve;
  let signal;
  checkDeps({
    checkActionRoute: (_route, _p, _r, options) => {
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const pending = ipc.handle(event, checkRequest());
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const frame = { url: 'file:///app/index.html' };
  window.webContents.mainFrame = frame;
  expect(
    await ipc.handle({ sender: window.webContents, senderFrame: frame }, checkRequest()),
  ).toMatchObject({ error: 'review-busy' });
  expect(signal.aborted).toBe(true);
  resolve({ configuration: 'valid' });
  expect((await pending).success).toBe(false);
});
