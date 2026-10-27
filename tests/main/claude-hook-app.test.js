import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { profileCommand } = require('../../src/main/claude-hook-app-profile');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
const {
  projectClaudeEvidence,
  boundedChild,
} = require('../../scripts/qualification/claude-hook-app.cjs');
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
    makeIO: async () => {
      state.ioCreates = (state.ioCreates || 0) + 1;
      let ended = false;
      return {
        contract: IO_CONTRACT,
        async readTarget() {
          if (state.readFailure) throw Error('fixture read failed');
          if (state.beforeRead) await state.beforeRead();
          if (ended) throw Error('fixture IO closed');
          return { identity: state.identity || 'owned-fixture', bytes: await fs.readFile(target) };
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
          ended = true;
          state.closes = (state.closes || 0) + 1;
        },
        status: () => ({
          admission: ended ? 'closed' : 'open',
          exit: ended && !state.releaseUnknown ? 'confirmed' : 'unknown',
        }),
      };
    },
  };
  service = createClaudeHookApp(options);
});
afterEach(async () => {
  await service?.close();
  vi.useRealTimers();
  if (root) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^aegis-hook-app-/);
    await fs.rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== 'win32')(
  'revokes reporting before a profile removal review, even when removal is cancelled',
  async () => {
    await service.close();
    const program = path.join(root, 'claude.exe');
    await fs.writeFile(program, 'fixture never executed');
    await fs.writeFile(
      target,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: profileCommand(options.executable, options.appPath, policy),
                  timeout: 5,
                },
              ],
            },
          ],
        },
      }),
    );
    const initial = await fs.readFile(target);
    const choices = [program, root];
    options.clipboard = { writeText: vi.fn() };
    options.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [choices.shift()] });
    let readerClosed = false;
    options.makeReadIO = async () => ({
      readTarget: async () => ({ identity: 'fixture-object', bytes: await fs.readFile(target) }),
      close: async () => {
        readerClosed = true;
      },
      status: () => ({
        admission: readerClosed ? 'closed' : 'open',
        exit: readerClosed ? 'confirmed' : 'unknown',
      }),
    });
    service = createClaudeHookApp(options);
    expect((await service.handle('guard-start', () => true)).code).toBe('GUARD_READY');
    state.approve = false;
    const removed = await service.handle('remove', () => true);
    expect(removed.code).toBe('CANCELLED');
    expect(removed.guardSession).toMatchObject({
      status: 'refused',
      available: false,
      lossDetected: true,
    });
    expect(readerClosed).toBe(true);
    expect(await fs.readFile(target)).toEqual(initial);
  },
);

it('quotes the default packaged executable and literal ampersands in every hook path', () => {
  const executable = path.join(root, 'AEGIS - AI Monitoring & Threat Detection.exe');
  const appPath = path.join(root, 'resources & application', 'app.asar');
  const policyPath = path.join(root, 'policy & scope.json');
  expect(profileCommand(executable, appPath, policyPath)).toBe(
    `"${executable.replaceAll('\\', '/')}" "${appPath.replaceAll('\\', '/')}" --action-policy-hook "${policyPath.replaceAll('\\', '/')}"`,
  );
  const doubled = path.join(root, 'literal&&name.json');
  expect(
    profileCommand(executable, appPath, doubled).endsWith(
      `--action-policy-hook "${doubled.replaceAll('\\', '/')}"`,
    ),
  ).toBe(true);
});

it('retains hook-path quote, substitution, operator and control rejection in every argument', () => {
  const safe = [process.execPath, path.join(root, 'app'), path.join(root, 'policy.json')];
  const unsafe = [
    '" & injected',
    "'",
    '`injected`',
    '$(injected)',
    '${injected}',
    '%EXPANSION%',
    '!EXPANSION!',
    '?',
    '|injected',
    '<input',
    '>output',
    '^escape',
    '\u0000',
    '\n',
    '\r',
    '\t',
    '\u0085',
  ];
  for (const suffix of unsafe) {
    for (let index = 0; index < safe.length; index++) {
      const selected = [...safe];
      selected[index] = path.join(root, `selected${suffix}`);
      expect(() => profileCommand(...selected)).toThrow('unsupported-path');
    }
  }
  for (const value of ['relative-path', '', null, path.join(root, 'x'.repeat(4097))]) {
    expect(() => profileCommand(value, safe[1], safe[2])).toThrow('unsupported-path');
  }
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

it.each(['deleted', 'changed bytes', 'changed identity', 'read failure'])(
  'fails closed when an installed profile has %s',
  async (kind) => {
    expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
    const before = await fs.readFile(target);
    if (kind === 'deleted') await fs.unlink(target);
    if (kind === 'changed bytes') await fs.appendFile(target, ' ');
    if (kind === 'changed identity') state.identity = 'replacement-fixture';
    if (kind === 'read failure') state.readFailure = true;
    const expected =
      kind === 'changed bytes' || kind === 'changed identity'
        ? 'TARGET_CHANGED'
        : 'TARGET_READ_FAILED';
    expect(await service.handle('status', () => true)).toMatchObject({
      code: expected,
      presence: 'Unknown',
      canInstall: false,
      canRemove: false,
      canReviewExisting: false,
    });
    expect(await service.handle('install', () => true)).toMatchObject({
      code: 'RETAINED_UNKNOWN',
      canInstall: false,
    });
    expect(await service.handle('remove', () => true)).toMatchObject({
      code: 'RETAINED_UNKNOWN',
      canRemove: false,
    });
    expect(state.writes).toBe(1);
    expect(state.backups).toHaveLength(1);
    expect(state.closes).toBe(1);
    if (kind === 'changed identity' || kind === 'read failure')
      expect(await fs.readFile(target)).toEqual(before);
  },
);

it('keeps mutations blocked if release is unconfirmed after reconciliation fails', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  state.readFailure = true;
  state.releaseUnknown = true;
  expect(await service.handle('status', () => true)).toMatchObject({
    code: 'TARGET_READ_FAILED',
    presence: 'Unknown',
    canInstall: false,
    canRemove: false,
  });
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'RETAINED_UNKNOWN',
    canInstall: false,
  });
  expect(state.writes).toBe(1);
  expect(state.backups).toHaveLength(1);
});

it('fails closed if the session expires during a guarded reconciliation read', async () => {
  vi.useFakeTimers();
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  let entered, release;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  state.beforeRead = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const status = service.handle('status', () => true);
  await reading;
  await vi.advanceTimersByTimeAsync(180000);
  release();
  expect(await status).toMatchObject({
    code: 'TARGET_READ_FAILED',
    presence: 'Unknown',
    canInstall: false,
    canRemove: false,
  });
  expect(state.writes).toBe(1);
  expect(state.backups).toHaveLength(1);
});

it('does not trust a matching read when the service closes during reconciliation', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  let entered, release;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  state.beforeRead = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const status = service.handle('status', () => true);
  await reading;
  const closing = service.close();
  release();
  expect(await status).toEqual({ success: false, error: 'Renderer request denied' });
  await closing;
  expect(state.writes).toBe(1);
  expect(state.backups).toHaveLength(1);
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

it('requires a fresh exact native review to remove a retained installation after restart', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  await service.close();
  service = createClaudeHookApp(options);
  expect(await service.handle('status', () => true)).toMatchObject({
    code: 'PROFILE_REVIEW_AVAILABLE',
    presence: 'Unknown',
    canRemove: false,
    canReviewExisting: true,
  });
  expect(state.ioCreates).toBe(1);
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'CONFIGURED_UNOWNED',
    canRemove: false,
    canReviewExisting: true,
  });
  expect(await service.handle('remove', () => true)).toMatchObject({
    code: 'OBSERVED_REMOVED',
    canRemove: false,
  });
  expect(await fs.readFile(target, 'utf8')).toBe(original);
  expect(state.dialogs[1].detail).toContain('fresh authorization');
  expect(state.writes).toBe(2);
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

it('waits for a pending native IO creation and closes it after denying the operation', async () => {
  let release, entered, releaseClose, closeEntered;
  const creating = new Promise((resolve) => {
    entered = resolve;
  });
  const closingIO = new Promise((resolve) => {
    closeEntered = resolve;
  });
  const makeIO = options.makeIO;
  options.makeIO = async (...args) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    const io = await makeIO(...args);
    const close = io.close;
    io.close = async () => {
      closeEntered();
      await new Promise((resolve) => {
        releaseClose = resolve;
      });
      await close();
    };
    return io;
  };
  service = createClaudeHookApp(options);
  const install = service.handle('install', () => true);
  await creating;
  let closed = false;
  const closing = service.close().then(() => {
    closed = true;
  });
  const secondClose = service.close();
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  expect(await install).toEqual({ success: false, error: 'Renderer request denied' });
  await closingIO;
  expect(closed).toBe(false);
  expect(state.dialogs).toHaveLength(0);
  expect(state.writes).toBe(0);
  releaseClose();
  await Promise.all([closing, secondClose]);
  expect(state.closes).toBe(1);
  expect(await fs.readFile(target, 'utf8')).toBe(original);
});

it.each(['selection', 'confirmation'])(
  'closes without waiting for a pending %s dialog',
  async (phase) => {
    let entered, release;
    const dialogEntered = new Promise((resolve) => {
      entered = resolve;
    });
    const waitForDialog = () =>
      new Promise((resolve) => {
        release = resolve;
        entered();
      });
    if (phase === 'selection') {
      options.dialog.showOpenDialog = async () => {
        await waitForDialog();
        return { canceled: false, filePaths: [policy] };
      };
    } else {
      state.beforeConfirmation = waitForDialog;
    }
    service = createClaudeHookApp(options);
    const install = service.handle('install', () => true);
    await dialogEntered;
    await service.close();
    expect(state.closes || 0).toBe(phase === 'confirmation' ? 1 : 0);
    release();
    expect(await install).toEqual({ success: false, error: 'Renderer request denied' });
    expect(state.writes).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe(original);
  },
);

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
    canReviewExisting: true,
  });
  expect(await fs.readFile(target)).toEqual(installed);
  expect(state.writes).toBe(1);
  expect(state.dialogs).toHaveLength(1);
});

it('closes expired IO before a new targeted removal session without restoring old approval', async () => {
  vi.useFakeTimers();
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  await vi.advanceTimersByTimeAsync(180000);
  expect(state.closes).toBe(1);
  expect(await service.handle('status', () => true)).toMatchObject({
    code: 'PROFILE_REVIEW_AVAILABLE',
    canRemove: false,
    canReviewExisting: true,
  });
  expect(await service.handle('remove', () => true)).toMatchObject({ code: 'OBSERVED_REMOVED' });
  expect(state.ioCreates).toBe(2);
  expect(await fs.readFile(target, 'utf8')).toBe(original);
});

it.each(['deleted', 'changed'])(
  'reports Unknown and blocks installation after expiry and %s',
  async (kind) => {
    vi.useFakeTimers();
    expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
    await vi.advanceTimersByTimeAsync(180000);
    if (kind === 'deleted') await fs.unlink(target);
    else await fs.appendFile(target, ' ');
    expect(await service.handle('status', () => true)).toMatchObject({
      presence: 'Unknown',
      canInstall: false,
      canRemove: false,
    });
    expect(await service.handle('install', () => true)).toMatchObject({
      code: 'SESSION_ENDED',
      canInstall: false,
    });
    expect(state.writes).toBe(1);
    expect(state.backups).toHaveLength(1);
  },
);

it('status and missing-target removal create no draft or backup directories', async () => {
  expect(path.dirname(path.resolve(path.dirname(target)))).toBe(path.resolve(root));
  await fs.rm(path.dirname(target), { recursive: true });
  expect(await service.handle('status', () => true)).toMatchObject({
    canOpen: false,
    canRemove: false,
  });
  expect(await service.handle('remove', () => true)).toMatchObject({ code: 'NO_MATCHING_HOOK' });
  expect(await fs.stat(path.dirname(target)).catch(() => null)).toBeNull();
  expect(state.ioCreates || 0).toBe(0);
});

it('refuses renewal when previous native session release is unconfirmed', async () => {
  vi.useFakeTimers();
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  state.releaseUnknown = true;
  await vi.advanceTimersByTimeAsync(180000);
  expect(await service.handle('remove', () => true)).toMatchObject({
    code: 'SESSION_RELEASE_UNCONFIRMED',
    canInstall: false,
    canReviewExisting: false,
  });
  expect(state.ioCreates).toBe(1);
  expect(state.writes).toBe(1);
});

it.each(['cancel', 'navigation', 'expiry', 'changed'])(
  'keeps fresh targeted removal fenced for %s',
  async (mode) => {
    expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
    const installed = await fs.readFile(target);
    await service.close();
    service = createClaudeHookApp(options);
    if (mode === 'cancel') state.approve = false;
    state.beforeConfirmation = async () => {
      if (mode === 'navigation') state.owned = false;
      if (mode === 'expiry') state.time += 90000;
      if (mode === 'changed') await fs.appendFile(target, ' ');
    };
    const outcome = await service.handle('remove', () => state.owned);
    const code = { cancel: 'CANCELLED', expiry: 'EXPIRED', changed: 'TARGET_CHANGED' };
    if (mode === 'navigation')
      expect(outcome).toEqual({ success: false, error: 'Renderer request denied' });
    else expect(outcome.code).toBe(code[mode]);
    expect(state.writes).toBe(1);
    expect(await fs.readFile(target)).toEqual(
      mode === 'changed' ? Buffer.concat([installed, Buffer.from(' ')]) : installed,
    );
    expect(state.backups).toHaveLength(mode === 'changed' ? 2 : 1);
  },
);

it('retains fresh-removal readback uncertainty and refuses another write in that session', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  await service.close();
  service = createClaudeHookApp(options);
  state.readbackFailure = true;
  expect(await service.handle('remove', () => true)).toMatchObject({
    code: 'READBACK_FAILED',
    canInstall: false,
    canRemove: false,
  });
  expect(await service.handle('remove', () => true)).toMatchObject({ code: 'RETAINED_UNKNOWN' });
  expect(state.writes).toBe(2);
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

function genuineRecords() {
  return [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'one',
            name: 'Bash',
            input: {
              command: "printf 'AEGIS_W6_ALLOWED\\n' > aegis-w6-allowed.txt",
              description: 'AEGIS W6 allowed fixture',
              timeout: 1000,
            },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'one', content: 'PRIVATE_RESULT_CANARY' }],
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'two',
            name: 'Bash',
            input: {
              command: "printf 'AEGIS_W6_DENIED\\n' > aegis-w6-denied.txt",
              description: 'AEGIS W6 denied fixture',
              timeout: 1000,
            },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'two',
            is_error: true,
            content: 'AEGIS policy does not allow this tool request.',
          },
        ],
      },
    },
    {
      type: 'result',
      is_error: false,
      total_cost_usd: 0.12,
      modelUsage: { 'claude-opus-4-6': {} },
    },
    { type: 'system', subtype: 'init', cwd: 'X:\\fixture' },
  ];
}
const projectRecords = (rows) =>
  projectClaudeEvidence(rows.map((row) => JSON.stringify(row)).join('\n'), 'X:\\fixture');
it('genuine qualification requires both exact whole inputs and explicit denied tool result', () => {
  const receipt = projectRecords(genuineRecords());
  expect(receipt).toMatchObject({
    cwdMatched: true,
    exactTwoRequests: true,
    allowResultSucceeded: true,
    denyResultObserved: true,
    providerCompleted: true,
    costWithinLimit: true,
    opusObserved: true,
  });
  expect(JSON.stringify(receipt)).not.toContain('PRIVATE_RESULT_CANARY');
  expect(JSON.stringify(receipt)).not.toContain('printf');
  const rows = genuineRecords();
  rows[3].message.content[0].content = 'Denied by a different permission mechanism';
  expect(projectRecords(rows).denyResultObserved).toBe(false);
});
it('genuine qualification refuses metadata drift without adapting the allowed request', () => {
  for (const change of [
    (input) => {
      delete input.description;
    },
    (input) => {
      input.timeout = 2000;
    },
    (input) => {
      input.extra = 'PRIVATE_EXTRA_CANARY';
    },
  ]) {
    const rows = genuineRecords();
    change(rows[0].message.content[0].input);
    const receipt = projectRecords(rows);
    expect(receipt.exactTwoRequests).toBe(false);
    expect(receipt.attempts[0].exactInput).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE_EXTRA_CANARY');
  }
});
it('genuine qualification refuses retries, duplicate results, unpriced output and model substitution', () => {
  const duplicate = genuineRecords();
  duplicate.splice(2, 0, duplicate[1]);
  expect(projectRecords(duplicate).exactTwoRequests).toBe(false);
  const retry = genuineRecords();
  retry.splice(2, 0, retry[0]);
  expect(projectRecords(retry).exactTwoRequests).toBe(false);
  const unpriced = genuineRecords();
  delete unpriced[4].total_cost_usd;
  expect(projectRecords(unpriced).costWithinLimit).toBe(false);
  const expensive = genuineRecords();
  expensive[4].total_cost_usd = 0.51;
  expect(projectRecords(expensive).costWithinLimit).toBe(false);
  const replaced = genuineRecords();
  replaced[4].modelUsage = { 'claude-sonnet': {} };
  expect(projectRecords(replaced).opusObserved).toBe(false);
  replaced[4].modelUsage = { 'not-opus': {} };
  expect(projectRecords(replaced).opusObserved).toBe(false);
  const wrongCwd = genuineRecords();
  wrongCwd[5].cwd = 'X:\\other-fixture';
  expect(projectRecords(wrongCwd).cwdMatched).toBe(false);
});

function controlledChild() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
}
it('genuine child bounds cleanup settlement when the owned tree never closes', async () => {
  vi.useFakeTimers();
  const child = controlledChild(),
    killTree = vi.fn(() => {
      throw Error('fixed controlled failure');
    });
  let settled = false;
  const pending = boundedChild('owned.exe', [], {
    cwd: root,
    env: {},
    deadlineMs: 150,
    spawnChild: () => child,
    killTree,
  }).then((value) => {
    settled = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(150);
  expect(killTree).toHaveBeenCalledExactlyOnceWith(12345);
  await vi.advanceTimersByTimeAsync(4999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const result = await pending;
  expect(result).toMatchObject({
    cleanupConfirmed: false,
    ownedPid: 12345,
    code: null,
    terminated: true,
  });
  expect(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed).toBe(true);
  expect(killTree).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('genuine child confirms ordinary close and clears both cleanup clocks', async () => {
  vi.useFakeTimers();
  const child = controlledChild(),
    killTree = vi.fn();
  const pending = boundedChild('owned.exe', [], {
    cwd: root,
    env: {},
    deadlineMs: 150,
    spawnChild: () => child,
    killTree,
  });
  child.stdout.write(Buffer.from('bounded result'));
  child.exitCode = 0;
  child.emit('close', 0, null);
  const result = await pending;
  expect(result).toMatchObject({
    cleanupConfirmed: true,
    code: 0,
    terminated: false,
    stdoutBytes: 14,
  });
  expect(result.stdout.toString()).toBe('bounded result');
  expect(killTree).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
});

it.each([
  { code: 0, signal: null, close: true },
  { code: null, signal: 'SIGTERM', close: true },
  { code: 0, signal: null, close: false },
  { code: null, signal: 'SIGTERM', close: false },
])(
  'genuine child never targets an exited PID while awaiting close: %j',
  async ({ code, signal, close }) => {
    vi.useFakeTimers();
    const child = controlledChild();
    const killTree = vi.fn();
    let settled = false;
    const pending = boundedChild('owned.exe', [], {
      cwd: root,
      env: {},
      deadlineMs: 150,
      spawnChild: () => child,
      killTree,
    }).then((result) => {
      settled = true;
      return result;
    });
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
    await vi.advanceTimersByTimeAsync(5149);
    expect(settled).toBe(false);
    if (close) child.emit('close', code, signal);
    else await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(killTree).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cleanupConfirmed: close, code, signal });
    expect(vi.getTimerCount()).toBe(0);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  },
);
