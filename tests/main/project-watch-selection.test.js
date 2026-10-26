import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createProjectWatchSelection } = require('../../src/main/project-watch-selection');
let root, project, storage, options, owner, service, window;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-project-selection-'));
  const userData = path.join(root, 'state');
  project = path.join(root, 'project');
  for (const p of [
    userData,
    project,
    path.join(root, 'profiles', 'home'),
    path.join(root, 'blocked'),
  ])
    fs.mkdirSync(p, { recursive: true });
  storage = path.join(userData, 'project-watch-selection.json');
  window = { isDestroyed: () => false };
  owner = window;
  options = {
    userData,
    home: path.join(root, 'profiles', 'home'),
    blockedTrees: [path.join(root, 'blocked')],
    getWindow: () => owner,
    onChanged: vi.fn(),
    dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [project] })) },
  };
  service = createProjectWatchSelection(options);
});
afterEach(() => {
  service.close();
  vi.restoreAllMocks();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^aegis-project-selection-/);
  fs.rmSync(root, { recursive: true, force: true });
});
const act = (action) => service.handle(action, () => true);
it('status creates no preference file and returns only fixed selection metadata', async () => {
  expect(await act('status')).toEqual({
    success: true,
    code: 'UNSELECTED',
    selected: false,
    available: false,
  });
  expect(fs.existsSync(storage)).toBe(false);
  expect(await service.resolveRoot()).toEqual({ state: 'unselected' });
});
it('persists one native-selected identity privately and restores it after service recreation', async () => {
  expect(await act('select')).toMatchObject({ code: 'SELECTED', selected: true, available: true });
  const before = JSON.parse(fs.readFileSync(storage, 'utf8'));
  expect(before).toMatchObject({
    schema: 'aegis-project-watch/1',
    selection: { path: fs.realpathSync(project) },
  });
  expect(JSON.stringify(await act('status'))).not.toContain(root);
  service.close();
  service = createProjectWatchSelection(options);
  const selected = await service.resolveRoot();
  expect(selected).toMatchObject({ state: 'selected', path: fs.realpathSync(project) });
  expect(selected.isCurrent()).toBe(true);
  expect(await act('clear')).toMatchObject({ code: 'UNSELECTED', selected: false });
  expect(selected.isCurrent()).toBe(false);
  service.close();
  service = createProjectWatchSelection(options);
  expect(await service.resolveRoot()).toEqual({ state: 'unselected' });
});
it('cancellation and a lost owned frame cannot persist a root', async () => {
  options.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true });
  expect(await act('select')).toMatchObject({ code: 'CANCELLED' });
  let release;
  options.dialog.showOpenDialog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = act('select');
  expect(await act('clear')).toMatchObject({ code: 'BUSY' });
  owner = { isDestroyed: () => false };
  release({ canceled: false, filePaths: [project] });
  expect(await pending).toMatchObject({ success: false });
  expect(fs.existsSync(storage)).toBe(false);
});
it('closing the owner during a native choice fences its later completion', async () => {
  let release;
  options.dialog.showOpenDialog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = act('select');
  service.close();
  release({ canceled: false, filePaths: [project] });
  expect(await pending).toMatchObject({ success: false });
  expect(fs.existsSync(storage)).toBe(false);
});
it('refuses filesystem, home, application-state, blocked and linked directory roots', async () => {
  const linked = path.join(root, 'linked');
  fs.symlinkSync(project, linked, 'junction');
  for (const candidate of [
    path.parse(root).root,
    options.home,
    options.userData,
    path.join(root, 'blocked'),
    linked,
  ]) {
    options.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [candidate],
    });
    expect(await act('select')).toMatchObject({ code: 'DIRECTORY_REFUSED', selected: false });
  }
  expect(fs.existsSync(storage)).toBe(false);
});
it('a removed or replaced selected directory stays unavailable without adopting the replacement', async () => {
  await act('select');
  const selected = await service.resolveRoot();
  const key = service.getWatchKey();
  const retired = path.join(root, 'retired');
  expect(path.dirname(project)).toBe(root);
  expect(path.dirname(retired)).toBe(root);
  fs.renameSync(project, retired);
  fs.mkdirSync(project);
  expect(selected.isCurrent()).toBe(false);
  expect(await service.resolveRoot()).toEqual({ state: 'unavailable' });
  expect(service.getWatchKey()).not.toBe(key);
  service.close();
  service = createProjectWatchSelection(options);
  expect(await service.resolveRoot()).toEqual({ state: 'unavailable' });
  expect(await act('select')).toMatchObject({ code: 'SELECTED' });
  expect((await service.resolveRoot()).isCurrent()).toBe(true);
});
it('an invalid private record is unavailable and explicit clear can replace a regular corrupt record', async () => {
  fs.writeFileSync(storage, '{"schema":"wrong","selection":null}\n');
  expect(await act('status')).toMatchObject({ code: 'UNAVAILABLE', selected: true });
  expect(await service.resolveRoot()).toEqual({ state: 'unavailable' });
  expect(await act('clear')).toMatchObject({ code: 'UNSELECTED' });
});
it('oversized or linked storage fails closed without following or overwriting it', async () => {
  fs.writeFileSync(storage, Buffer.alloc(16385, 65));
  expect(await act('status')).toMatchObject({ code: 'UNAVAILABLE' });
  expect(await act('clear')).toMatchObject({ code: 'STORE_UNAVAILABLE' });
  expect(fs.statSync(storage).size).toBe(16385);
});
it('a concurrent private-record edit is retained rather than overwritten', async () => {
  await act('select');
  fs.appendFileSync(storage, ' ');
  const before = fs.readFileSync(storage);
  expect(await act('clear')).toMatchObject({ code: 'STORE_UNAVAILABLE' });
  expect(fs.readFileSync(storage)).toEqual(before);
});
it('failed atomic persistence keeps the prior selection and leaves no temporary files', async () => {
  await act('select');
  const before = fs.readFileSync(storage);
  const next = path.join(root, 'next');
  fs.mkdirSync(next);
  options.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [next] });
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw Error('PRIVATE_STORE_ERROR');
  });
  expect(await act('select')).toMatchObject({ code: 'STORE_UNAVAILABLE' });
  expect(fs.readFileSync(storage)).toEqual(before);
  expect(await service.resolveRoot()).toMatchObject({
    state: 'selected',
    path: fs.realpathSync(project),
  });
  expect(fs.readdirSync(options.userData)).toEqual(['project-watch-selection.json']);
});
it('selection and revalidation never open project-file contents', async () => {
  fs.writeFileSync(path.join(project, 'PRIVATE_CANARY.env'), 'PRIVATE_SECRET');
  const open = vi.spyOn(fs, 'openSync');
  await act('select');
  await act('status');
  await service.resolveRoot();
  expect(
    open.mock.calls.every(([file]) => file === storage || String(file).startsWith(storage + '.')),
  ).toBe(true);
  expect(JSON.stringify(await act('status'))).not.toContain('PRIVATE');
});
