import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
let root, target, policy, service, state, options;
const original = '{ "private": "PROFILE_PRIVATE_CANARY", "hooks": {"PreToolUse":[]} }\n';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-hook-app-'));
  target = path.join(root, 'claude-hook-profile', 'settings.json');
  policy = path.join(root, 'private-policy.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, original);
  await fs.writeFile(
    policy,
    JSON.stringify({ schemaVersion: 1, cwd: root, defaultDecision: 'deny', rules: [] }),
  );
  state = {
    writes: 0,
    backups: [],
    dialogs: [],
    approve: true,
    owned: true,
    time: 100,
    readbackFailure: false,
    opened: [],
  };
  const window = { isDestroyed: () => false };
  options = {
    userData: root,
    assetsRoot: path.join(root, 'assets'),
    platform: 'win32',
    executable: process.execPath,
    appPath: path.join(root, 'app'),
    getWindow: () => window,
    getAssets: async () => (state.assetsMissing ? null : {}),
    shell: { showItemInFolder: (file) => state.opened.push(file) },
    now: () => state.time,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [policy] };
      },
      async showMessageBox(_window, value) {
        state.dialogs.push(value);
        if (state.beforeConfirmation) await state.beforeConfirmation();
        return { response: state.approve ? 1 : 0 };
      },
    },
    makeIO: async () => ({
      contract: IO_CONTRACT,
      async readTarget() {
        return { identity: 'owned-fixture', bytes: await fs.readFile(target) };
      },
      async retainPrivate(value) {
        const ref = {};
        state.backups.push({ ref, bytes: Buffer.from(value.bytes), manifest: value.manifest });
        return ref;
      },
      async readPrivate(ref) {
        const item = state.backups.find((value) => value.ref === ref);
        return { bytes: Buffer.from(item.bytes), manifest: item.manifest };
      },
      async compareAndWrite(value) {
        if (state.beforeWrite) await state.beforeWrite();
        if (!(await fs.readFile(target)).equals(value.beforeBytes)) return 'stale';
        state.writes++;
        await fs.writeFile(target, state.readbackFailure ? '{}' : value.afterBytes);
        return 'written';
      },
      async close() {
        state.closes = (state.closes || 0) + 1;
      },
      status: () => ({ admission: 'open' }),
    }),
  };
  service = createClaudeHookApp(options);
});
afterEach(async () => {
  await service?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('installs and removes the app-owned profile through private native review with an exact rollback', async () => {
  const installed = await service.handle('install', () => state.owned);
  expect(installed).toMatchObject({
    success: true,
    code: 'INSTALLED',
    presence: 'Configured',
    canRemove: true,
  });
  const profile = JSON.parse(await fs.readFile(target, 'utf8'));
  expect(profile.private).toBe('PROFILE_PRIVATE_CANARY');
  expect(profile.hooks.PreToolUse).toHaveLength(1);
  expect(profile.hooks.PreToolUse[0]).toMatchObject({
    matcher: 'Bash',
    hooks: [{ type: 'command', timeout: 5 }],
  });
  expect(state.dialogs[0].detail).toContain(target);
  expect(state.dialogs[0].detail).toContain('PreToolUse');
  const removed = await service.handle('remove', () => state.owned);
  expect(removed).toMatchObject({ success: true, code: 'REMOVED', canRemove: false });
  expect(await fs.readFile(target, 'utf8')).toBe(original);
  expect(state.backups).toHaveLength(2);
  for (const reply of [installed, removed]) {
    const serialized = JSON.stringify(reply);
    for (const privateValue of [
      root,
      policy,
      'PROFILE_PRIVATE_CANARY',
      'planId',
      'changedFragments',
      'command',
    ])
      expect(serialized).not.toContain(privateValue);
  }
});

it('does not write or retain a backup when native confirmation is cancelled', async () => {
  state.approve = false;
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'CANCELLED',
    canRemove: false,
  });
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(0);
  expect(await fs.readFile(target, 'utf8')).toBe(original);
});

it('rejects navigation after private review without disclosing or applying it', async () => {
  state.beforeConfirmation = async () => {
    state.owned = false;
  };
  expect(await service.handle('install', () => state.owned)).toEqual({
    success: false,
    error: 'Renderer request denied',
  });
  expect(state.writes).toBe(0);
});

it('expires the exact prepared review before dispatch rather than re-preparing silently', async () => {
  state.beforeConfirmation = async () => {
    state.time += 90000;
  };
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'EXPIRED',
    canRemove: false,
  });
  expect(state.writes).toBe(0);
});

it('preserves uncertain readback and refuses another installation', async () => {
  state.readbackFailure = true;
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'READBACK_FAILED',
    canInstall: false,
    canRemove: false,
  });
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'RETAINED_UNKNOWN' });
  expect(state.writes).toBe(1);
});

it('does not accept renderer paths, commands, confirmation IDs or unsupported operations', async () => {
  for (const request of [{ action: 'install', path: policy }, 'confirm', '../settings.json'])
    expect(await service.handle(request, () => true)).toMatchObject({
      success: false,
      error: 'Invalid profile operation',
    });
  expect(state.dialogs).toHaveLength(0);
  expect(state.writes).toBe(0);
});

it('labels missing prepared native assets unavailable without opening a target', async () => {
  await service.close();
  delete options.getAssets;
  service = createClaudeHookApp(options);
  expect(await service.handle('status', () => true)).toMatchObject({
    code: 'UNAVAILABLE',
    available: false,
  });
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(state.dialogs).toHaveLength(0);
  expect(state.writes).toBe(0);
});

it('refuses a present but unqualified helper descriptor before presenting a policy picker', async () => {
  await service.close();
  delete options.getAssets;
  await fs.mkdir(options.assetsRoot);
  await fs.writeFile(
    path.join(options.assetsRoot, 'assets.json'),
    JSON.stringify({
      schemaVersion: 1,
      hostFiles: [],
      runtimeRoot: root,
      runtimeVersion: '10.0.10',
      runtimeFiles: [],
      hostFxrSha256: '0'.repeat(64),
      executableSha256: '0'.repeat(64),
    }),
  );
  let picks = 0;
  options.dialog.showOpenDialog = async () => {
    picks++;
    return { canceled: true };
  };
  service = createClaudeHookApp(options);
  expect(await service.handle('status', () => true)).toMatchObject({
    code: 'UNAVAILABLE',
    available: false,
  });
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(picks).toBe(0);
  expect(state.writes).toBe(0);
});

it('rejects a malformed selected policy before native review or writing', async () => {
  await fs.writeFile(
    policy,
    JSON.stringify({ schemaVersion: 1, cwd: root, defaultDecision: 'allow', rules: [] }),
  );
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INVALID_POLICY' });
  expect(state.dialogs).toHaveLength(0);
  expect(state.writes).toBe(0);
});

it('does not claim ownership of an installation retained across an app restart', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  await service.close();
  service = createClaudeHookApp(options);
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'CONFIGURED_UNOWNED',
    canRemove: false,
  });
  expect(await service.handle('remove', () => true)).toMatchObject({ code: 'NO_OWNED_INSTALL' });
  expect(state.writes).toBe(1);
});

it('waits for an admitted writer outcome before closing its native IO', async () => {
  let release, entered;
  const inside = new Promise((resolve) => {
    entered = resolve;
  });
  state.beforeWrite = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const install = service.handle('install', () => true);
  await inside;
  const closing = service.close();
  await Promise.resolve();
  expect(state.closes || 0).toBe(0);
  release();
  expect(await install).toMatchObject({ code: 'INSTALLED' });
  await closing;
  expect(state.closes).toBe(1);
});

it('does not append a newly selected policy to an unowned retained profile', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  const installed = await fs.readFile(target);
  await service.close();
  const otherPolicy = path.join(root, 'another-policy.json');
  await fs.copyFile(policy, otherPolicy);
  options.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [otherPolicy] });
  service = createClaudeHookApp(options);
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'CONFIGURED_UNOWNED',
    canRemove: false,
  });
  expect(await fs.readFile(target)).toEqual(installed);
  expect(state.writes).toBe(1);
  expect(state.dialogs).toHaveLength(1);
});

it('reveals only the fixed retained profile when native assets disappear', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  state.assetsMissing = true;
  expect(await service.handle('open-profile', () => true)).toMatchObject({
    success: true,
    available: false,
    canOpen: true,
  });
  expect(state.opened).toEqual([target]);
  expect(state.writes).toBe(1);
  state.owned = false;
  expect(await service.handle('open-profile', () => state.owned)).toEqual({
    success: false,
    error: 'Renderer request denied',
  });
  expect(state.opened).toEqual([target]);
});
