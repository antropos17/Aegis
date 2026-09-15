import { beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ipc = require('../../src/main/local-security-ipc');
let window, event, dialog, backend, retained;
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
