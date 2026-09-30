import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const ipc = require('../../src/main/local-security-ipc');
const {
  readResultReviewBundle,
  parseResultReviewBundle,
} = require('../../src/main/result-review-bundle');
let root, file, window, event, dialog;
const raw = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    captureSource: 'external-result',
    before: { complete: true, files: [] },
    after: {
      complete: true,
      files: [
        {
          path: 'safe.txt',
          kind: 'file',
          contentBase64: Buffer.from('<img src=x onerror=PRIVATE_SECRET>\u001b[31m').toString(
            'base64',
          ),
        },
      ],
    },
    claims: { accepted: true, stopped: true, boundaryPassed: true },
  }),
);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'aegis-result-ipc-'));
  file = path.join(root, 'selected.json');
  await fs.writeFile(file, raw);
  window = {
    isDestroyed: () => false,
    webContents: { mainFrame: { url: 'file:///app/index.html' }, on: vi.fn() },
  };
  event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  dialog = { showOpenDialog: vi.fn().mockResolvedValue({ filePaths: [file], canceled: false }) };
  ipc.init({ getWindow: () => window, rendererUrl: 'file:///app/index.html', dialog });
});
afterEach(async () => {
  expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
  expect((await fs.lstat(root)).isSymbolicLink()).toBe(false);
  await fs.rm(root, { recursive: true });
});
const navigate = () =>
  window.webContents.on.mock.calls.find(([name]) => name === 'did-start-navigation')[1]({
    isMainFrame: true,
    isSameDocument: false,
  });

it('reads only native-selected bundle bytes and retains safe path-free authority metadata on the existing channel', async () => {
  const value = await ipc.handle(event, { action: 'review-result' });
  expect(value).toMatchObject({
    success: true,
    result: {
      revision: 0,
      comparison: {
        writerState: 'stop-unconfirmed',
        launchAllowed: false,
        projectExportAllowed: false,
      },
    },
  });
  expect(value.result.comparison.changes[0].afterPreview).toMatchObject({
    state: 'text',
    text: '<img src=x onerror=PRIVATE_SECRET>[U+001B][31m',
  });
  expect(JSON.stringify(value)).not.toContain('\\u001b');
  expect(JSON.stringify(value)).not.toContain(root);
  expect(value.result.comparison.changes[0].path).toBe('safe.txt');
  expect(await ipc.handle(event, { action: 'result-status', id: value.result.id })).toEqual(value);
  expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
});

it('refuses renderer paths, payload, spoofed acceptance and foreign frame before dialogs', async () => {
  for (const request of [
    { action: 'review-result', path: file },
    { action: 'review-result', accepted: true },
    { action: 'review-result', raw },
    { action: 'result-status', id: 'a'.repeat(36), digest: 'a'.repeat(64) },
  ])
    expect(await ipc.handle(event, request)).toMatchObject({
      success: false,
      error: 'invalid-review-request',
    });
  expect(
    await ipc.handle({ ...event, senderFrame: {} }, { action: 'review-result' }),
  ).toMatchObject({ error: 'request-denied' });
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});

it('keeps prior comparison on cancelled selection or unavailable replacement', async () => {
  const first = await ipc.handle(event, { action: 'review-result' });
  dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true });
  expect(await ipc.handle(event, { action: 'review-result' })).toMatchObject({ cancelled: true });
  await fs.writeFile(file, '{}');
  expect(await ipc.handle(event, { action: 'review-result' })).toMatchObject({
    success: false,
    error: 'result-bundle-unavailable',
  });
  expect(await ipc.handle(event, { action: 'result-status', id: first.result.id })).toEqual(first);
});

it('invalidates retained opaque IDs on main navigation and denies completion during asynchronous read', async () => {
  const first = await ipc.handle(event, { action: 'review-result' });
  navigate();
  expect(await ipc.handle(event, { action: 'result-status', id: first.result.id })).toMatchObject({
    error: 'result-review-expired',
  });
  let finish;
  ipc.init({
    getWindow: () => window,
    rendererUrl: 'file:///app/index.html',
    dialog,
    readResultBundle: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  window.webContents.on.mockClear();
  const pending = ipc.handle(event, { action: 'review-result' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  navigate();
  finish(parseResultReviewBundle(raw));
  expect(await pending).toMatchObject({ success: false });
});

it('rechecks window authority at bounded reader await points before returning imported content', async () => {
  let checks = 0;
  await expect(
    readResultReviewBundle(file, () => {
      if (++checks === 4) throw Error('request-denied');
    }),
  ).rejects.toThrow('request-denied');
  expect(checks).toBe(4);
});
