import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { profileCommand, profileAfterCommand } = require('../../src/main/claude-hook-app-profile');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
const {
  projectClaudeEvidence,
  boundedChild,
  boundedHeldChild,
  qualificationRequests,
  existingProfileBinding,
  runExistingProfile,
} = require('../../scripts/qualification/claude-hook-app.cjs');
let root, target, policy, service, state, options;
const original = '{ "private": "PROFILE_PRIVATE_CANARY", "hooks": {"PreToolUse":[]} }\n';
// Fresh removal cannot establish which empty event arrays predated installation.
const observedRemoved =
  '{ "private": "PROFILE_PRIVATE_CANARY", "hooks": {"PreToolUse":[],"PostToolUse":[],"PostToolUseFailure":[]} }\n';
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

it.skipIf(process.platform !== 'win32').each(['install', 'remove'])(
  'refuses %s and subsequent writes when the guard reader exit is unconfirmed',
  async (action) => {
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
    let closed = false;
    options.makeReadIO = async () => ({
      readTarget: async () => ({ identity: 'fixture-object', bytes: await fs.readFile(target) }),
      close: async () => {
        closed = true;
      },
      status: () => ({ admission: closed ? 'closed' : 'open', exit: 'unknown' }),
    });
    service = createClaudeHookApp(options);
    expect((await service.handle('guard-start', () => true)).code).toBe('GUARD_READY');
    const failed = await service.handle(action, () => true);
    expect(failed).toMatchObject({
      code: 'SESSION_RELEASE_UNCONFIRMED',
      canInstall: false,
      canRemove: false,
      canReviewExisting: false,
    });
    expect((await service.handle('status', () => true)).code).toBe('SESSION_RELEASE_UNCONFIRMED');
    expect((await service.handle(action, () => true)).code).toBe('RETAINED_UNKNOWN');
    expect(closed).toBe(true);
    expect(state.ioCreates || 0).toBe(0);
    expect(state.writes).toBe(0);
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

it.skipIf(process.platform !== 'win32')(
  'reviews the exact project policy before creating and adopting it',
  async () => {
    await service.close();
    const selected = root.replace(/^[a-z](?=:)/, (letter) => letter.toUpperCase());
    let created = false,
      policyTarget,
      policySource;
    options.dialog.showOpenDialog = async (_window, input) => {
      expect(input.properties).toEqual(['openDirectory']);
      return { canceled: false, filePaths: [selected] };
    };
    options.makePolicyIO = async ({ targetPath, scope }) => {
      policyTarget = targetPath;
      expect(scope).toBe(selected);
      return {
        create: async (bytes) => {
          expect(state.dialogs).toHaveLength(1);
          policySource = Buffer.from(bytes);
          await fs.writeFile(targetPath, bytes, { flag: 'wx' });
          created = true;
          return 'written';
        },
        checkCreated: async () => (created ? 'valid' : 'stale'),
        close: async () => ({ exit: 'confirmed' }),
      };
    };
    service = createClaudeHookApp(options);
    const result = await service.handle('install-project-policy', () => state.owned);
    expect(result).toMatchObject({ code: 'INSTALLED', canRemove: true });
    expect(JSON.parse(policySource)).toEqual({
      schemaVersion: 2,
      cwd: selected,
      profile: 'aegis-windows-project-review-v1',
    });
    expect(state.dialogs[0]).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect(state.dialogs[0].detail).toContain(policyTarget);
    expect(state.dialogs[0].detail).toContain(policySource.toString());
    expect(state.dialogs[0].detail).toContain(
      'narrow filename check denies .env variants, credentials and credentials.json, id_rsa and id_ed25519',
    );
    expect(await fs.readFile(target, 'utf8')).toContain(policyTarget.replaceAll('\\', '/'));
    for (const secret of [selected, policyTarget, 'aegis-windows-project-review-v1'])
      expect(JSON.stringify(result)).not.toContain(secret);
    expect(await service.handle('remove', () => true)).toMatchObject({ code: 'REMOVED' });
    expect(await fs.readFile(target, 'utf8')).toBe(original);
  },
);

it.skipIf(process.platform !== 'win32')(
  'does not create a project policy when native review is cancelled',
  async () => {
    await service.close();
    state.approve = false;
    options.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    const create = vi.fn();
    options.makePolicyIO = async () => ({ create, close: async () => ({ exit: 'confirmed' }) });
    service = createClaudeHookApp(options);
    expect(await service.handle('install-project-policy', () => true)).toMatchObject({
      code: 'CANCELLED',
    });
    expect(create).not.toHaveBeenCalled();
    expect(state.writes).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe(original);
  },
);

it.skipIf(process.platform !== 'win32')(
  'retains an unadopted policy when the profile changes after confirmation',
  async () => {
    await service.close();
    options.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    options.makePolicyIO = async () => ({
      create: async () => {
        await fs.writeFile(target, '{"changed": true}');
        return 'written';
      },
      checkCreated: async () => 'valid',
      close: async () => ({ exit: 'confirmed' }),
    });
    service = createClaudeHookApp(options);
    expect(await service.handle('install-project-policy', () => true)).toMatchObject({
      code: 'POLICY_UNADOPTED',
      canInstall: false,
    });
    expect(state.writes).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe('{"changed": true}');
  },
);

it.skipIf(process.platform !== 'win32').each([
  ['refused', 'POLICY_CREATE_REFUSED'],
  ['retained-unknown', 'POLICY_CREATE_UNCERTAIN'],
  ['transport-failure', 'POLICY_CREATE_UNCERTAIN'],
])('never installs the profile after policy creation reports %s', async (outcome, code) => {
  await service.close();
  options.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  options.makePolicyIO = async () => ({
    create: async () => {
      if (outcome === 'transport-failure') throw Error('private failure');
      return outcome;
    },
    close: async () => ({ exit: 'confirmed' }),
  });
  service = createClaudeHookApp(options);
  expect(await service.handle('install-project-policy', () => true)).toMatchObject({ code });
  expect(state.writes).toBe(0);
  expect(await fs.readFile(target, 'utf8')).toBe(original);
});

it.skipIf(process.platform !== 'win32')(
  'does not write a failure receipt into an existing fixture directory',
  async () => {
    const existing = path.join(root, 'existing-output');
    await fs.mkdir(existing);
    await fs.writeFile(path.join(existing, 'sentinel'), 'unchanged');
    const runner = path.resolve('scripts/qualification/claude-project-policy.cjs');
    const result = spawnSync(process.execPath, [runner, existing, path.join(root, 'assets')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(await fs.readdir(existing)).toEqual(['sentinel']);
    expect(await fs.readFile(path.join(existing, 'sentinel'), 'utf8')).toBe('unchanged');
  },
);

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
  expect(await fs.readFile(target, 'utf8')).toBe(observedRemoved);
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
  expect(await fs.readFile(target, 'utf8')).toBe(observedRemoved);
});

it('renews a cancelled draft after expiry only for a fresh review and confirmation', async () => {
  vi.useFakeTimers();
  state.approve = false;
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'CANCELLED' });
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(180000);
  expect(state.closes).toBe(1);
  expect(await service.handle('status', () => true)).toMatchObject({ canInstall: true });
  state.approve = true;
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  expect(state.ioCreates).toBe(2);
  expect(state.dialogs).toHaveLength(2);
  expect(state.writes).toBe(1);
  expect(state.backups).toHaveLength(1);
  expect(state.backups[0].bytes.toString()).toBe(original);
});

it('refuses to renew a cancelled draft if native release was not confirmed', async () => {
  vi.useFakeTimers();
  state.approve = false;
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'CANCELLED' });
  state.releaseUnknown = true;
  await vi.advanceTimersByTimeAsync(180000);
  state.approve = true;
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'SESSION_RELEASE_UNCONFIRMED',
    canInstall: false,
  });
  expect(state.ioCreates).toBe(1);
  expect(state.dialogs).toHaveLength(1);
  expect(state.writes).toBe(0);
  expect(await fs.readFile(target, 'utf8')).toBe(original);
});

it('does not overwrite a hook added to a cancelled draft before renewal', async () => {
  vi.useFakeTimers();
  state.approve = false;
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'CANCELLED' });
  await vi.advanceTimersByTimeAsync(180000);
  const changed = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'existing' }] }] },
  });
  await fs.writeFile(target, changed);
  state.approve = true;
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'CONFIGURED_UNOWNED' });
  expect(state.dialogs).toHaveLength(1);
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(0);
  expect(await fs.readFile(target, 'utf8')).toBe(changed);
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

function previewNativePath() {
  return /New native hook profile:\n([^\n]+)/.exec(state.dialogs.at(-1).detail)?.[1];
}

it('previews native storage without creating it before consent and preserves cancellation', async () => {
  state.approve = false;
  state.beforeConfirmation = async () => {
    const native = previewNativePath();
    expect(path.dirname(native)).toBe(path.dirname(target));
    expect(path.basename(native)).toMatch(/^native-[0-9a-f]{32}$/);
    await expect(fs.access(native)).rejects.toMatchObject({ code: 'ENOENT' });
  };
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'CANCELLED' });
  expect(
    (await fs.readdir(path.dirname(target))).filter((name) => name.startsWith('native-')),
  ).toEqual([]);
  expect(state.writes).toBe(0);
});

it.each(['directory', 'link'])(
  'refuses a preexisting native %s without adopting its data',
  async (kind) => {
    let native;
    state.beforeConfirmation = async () => {
      native = previewNativePath();
      const occupied = kind === 'link' ? path.join(root, 'other-native-data') : native;
      await fs.mkdir(occupied);
      await fs.writeFile(path.join(occupied, 'Local State'), 'UNOWNED_NATIVE_CANARY');
      if (kind === 'link') await fs.symlink(occupied, native, 'junction');
    };
    expect(await service.handle('install', () => true)).toMatchObject({ code: 'PLAN_REFUSED' });
    expect(state.writes).toBe(0);
    expect(await fs.readFile(path.join(native, 'Local State'), 'utf8')).toBe(
      'UNOWNED_NATIVE_CANARY',
    );
  },
);

it('generates three canonical native-profile commands and preserves storage across removal/reinstall', async () => {
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  const first = previewNativePath();
  const hooks = JSON.parse(await fs.readFile(target, 'utf8')).hooks;
  const prefix = `"${options.executable.replaceAll('\\', '/')}" "${options.appPath.replaceAll('\\', '/')}"`;
  const quotedPolicy = `"${policy.replaceAll('\\', '/')}"`;
  expect(hooks.PreToolUse[0].hooks[0].command).toBe(
    `${prefix} --action-policy-hook ${quotedPolicy} '--user-data-dir=${first}'`,
  );
  for (const event of ['PostToolUse', 'PostToolUseFailure'])
    expect(hooks[event][0].hooks[0].command).toBe(
      `${prefix} --action-policy-after-hook ${quotedPolicy} '--user-data-dir=${first}' > /dev/null`,
    );
  const { selectHookStartupArgs } = require('../../src/main/hook-startup-args');
  expect(
    selectHookStartupArgs([
      options.executable,
      options.appPath,
      '--action-policy-hook',
      policy,
      `--user-data-dir=${first}`,
    ]),
  ).toEqual({ isHook: true, args: ['--action-policy-hook', policy] });
  expect(state.dialogs[0].detail).toContain('Created native data is retained');
  await fs.writeFile(path.join(first, 'Local State'), 'OWNED_NATIVE_CANARY');
  expect(await service.handle('remove', () => true)).toMatchObject({ code: 'REMOVED' });
  expect(await fs.readFile(path.join(first, 'Local State'), 'utf8')).toBe('OWNED_NATIVE_CANARY');
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'INSTALLED' });
  const second = previewNativePath();
  expect(second).not.toBe(first);
  await service.close();
  service = createClaudeHookApp(options);
  expect(await service.handle('remove', () => true)).toMatchObject({ code: 'OBSERVED_REMOVED' });
  expect(await fs.readFile(path.join(first, 'Local State'), 'utf8')).toBe('OWNED_NATIVE_CANARY');
  expect((await fs.stat(second)).isDirectory()).toBe(true);
});

it('retains native directories and reports unknown if their identity changes during commit', async () => {
  state.beforeWrite = async () => {
    const native = previewNativePath();
    await fs.rename(native, native + '-retained');
    await fs.mkdir(native);
    await fs.writeFile(path.join(native, 'Local State'), 'REPLACEMENT_NATIVE_CANARY');
  };
  expect(await service.handle('install', () => true)).toMatchObject({
    code: 'RETAINED_UNKNOWN',
    canInstall: false,
  });
  const native = previewNativePath();
  expect((await fs.stat(native + '-retained')).isDirectory()).toBe(true);
  expect(await fs.readFile(path.join(native, 'Local State'), 'utf8')).toBe(
    'REPLACEMENT_NATIVE_CANARY',
  );
});

it('retains the newly created native directory after uncertain profile readback', async () => {
  state.readbackFailure = true;
  expect(await service.handle('install', () => true)).toMatchObject({ code: 'READBACK_FAILED' });
  expect((await fs.stat(previewNativePath())).isDirectory()).toBe(true);
});

async function existingFixture() {
  const suite = path.join(root, 'suite'),
    cwd = path.join(suite, 'workspace');
  const home = path.join(suite, 'home');
  const executable = path.join(suite, 'package', 'AEGIS - AI Monitoring & Threat Detection.exe');
  const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
  const descriptor = path.join(path.dirname(archive), 'hook-review', 'assets.json');
  const selectedTarget = path.join(suite, 'gui-app-data', 'claude-hook-profile', 'settings.json');
  const selectedPolicy = path.join(suite, 'policy.json');
  const nativePath = path.join(path.dirname(selectedTarget), 'native-' + 'a'.repeat(32));
  const cli = path.join(home, '.local', 'bin', 'claude.exe');
  const configured = path.join(home, '.claude', 'settings.json');
  const shell = path.join(suite, 'Git', 'bin', 'bash.exe');
  const shellDirectory = path.join(suite, 'shell-proof');
  const shellReceipt = path.join(shellDirectory, 'receipt.json');
  const destination = path.join(suite, 'provider-receipt');
  for (const folder of [
    cwd,
    nativePath,
    path.dirname(cli),
    path.dirname(configured),
    path.dirname(shell),
    shellDirectory,
    path.dirname(descriptor),
  ])
    await fs.mkdir(folder, { recursive: true });
  for (const file of [executable, archive, cli, descriptor, shell])
    await fs.writeFile(file, 'INERT: never executed');
  await fs.writeFile(configured, JSON.stringify({ model: 'haiku' }));
  const requests = qualificationRequests(true);
  const profile = {
    hooks: Object.fromEntries(
      ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].map((phase) => [
        phase,
        [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                timeout: 5,
                command:
                  phase === 'PreToolUse'
                    ? profileCommand(executable, archive, selectedPolicy, nativePath)
                    : profileAfterCommand(executable, archive, selectedPolicy, nativePath),
              },
            ],
          },
        ],
      ]),
    ),
  };
  const selected = {
    target: selectedTarget,
    policyPath: selectedPolicy,
    executable,
    archive,
    cwd,
    profile,
    policy: {
      schemaVersion: 1,
      cwd,
      defaultDecision: 'deny',
      rules: [{ tool: 'Bash', input: requests[0], decision: 'allow' }],
    },
  };
  await fs.writeFile(selectedTarget, JSON.stringify(profile));
  await fs.writeFile(selectedPolicy, JSON.stringify(selected.policy));
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const retained = Buffer.from('AEGIS_W6_SHELL_OK\n');
  await fs.writeFile(path.join(shellDirectory, 'shell-preflight.txt'), retained);
  await fs.writeFile(
    shellReceipt,
    JSON.stringify({
      schema: 'aegis-w6-shell-preflight/1',
      attempts: 1,
      exitCode: 0,
      exitConfirmed: true,
      actualBytesHex: retained.toString('hex'),
      cwd: shellDirectory,
      shellPath: shell,
      shellSha256: digest(await fs.readFile(shell)),
      outputSha256: digest(retained),
    }),
  );
  const pins = new Map([
    [executable, '8c67ceb62732b6f4d77acb878ebb11a743d3ed3804ce66976933fce38aed7e0b'],
    [archive, '636f9d2a55959d2ae49cddcbeeae0f7348c47209dec47c7bedee74a42fa6de4b'],
    [descriptor, 'e5d68c0d75115c00914aff50c7d2c00fe0bbf570a7958734eeadba87db9d7b59'],
    [cli, '966f4b2ce962298f5dee6a942e8c47c8f97392e69e728e622319a98b259c0680'],
  ]);
  const fixture = {
    selected,
    requests,
    destination,
    cwd,
    cli,
    shellReceipt,
    configured,
    effectCount: 1,
    model: 'claude-haiku-4-5',
    cleanup: true,
  };
  const child = vi.fn(async (program, args, call) => {
    if (program !== cli) {
      expect(program).toBe(shell);
      expect(args).toEqual([
        '--noprofile',
        '--norc',
        '-c',
        profile.hooks.PreToolUse[0].hooks[0].command,
      ]);
      expect(call.deadlineMs).toBe(5000);
      const input = JSON.parse(call.input);
      return {
        code: 0,
        cleanupConfirmed: true,
        terminated: false,
        stdout: Buffer.from(
          JSON.stringify({
            hookSpecificOutput: {
              permissionDecision: equalInput(input.tool_input, requests[0]) ? 'allow' : 'deny',
            },
          }),
        ),
      };
    }
    expect(call.cwd).toBe(cwd);
    expect(call.deadlineMs).toBe(150000);
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'haiku',
    ]);
    expect(args.slice(args.indexOf('--max-turns'), args.indexOf('--max-turns') + 2)).toEqual([
      '--max-turns',
      '3',
    ]);
    expect(
      args.slice(args.indexOf('--max-budget-usd'), args.indexOf('--max-budget-usd') + 2),
    ).toEqual(['--max-budget-usd', '0.50']);
    expect(call.env.DISABLE_AUTOUPDATER).toBe('1');
    const rows = genuineRecords();
    rows[0].message.content[0].input = requests[0];
    rows[2].message.content[0].input = requests[1];
    rows[4].modelUsage = { [fixture.model]: {} };
    const init = rows.pop();
    init.model = fixture.model;
    init.cwd = cwd;
    rows.unshift(init);
    const bytes = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const accepted = call.acceptStdout(bytes);
    await fs.writeFile(
      path.join(cwd, 'aegis-w6-allowed.txt'),
      'AEGIS_W6_ALLOWED\n'.repeat(fixture.effectCount),
    );
    if (fixture.mutateProfile) await fs.appendFile(selectedTarget, ' ');
    return {
      code: accepted ? 0 : 2,
      cleanupConfirmed: fixture.cleanup,
      terminated: !accepted,
      stdout: bytes,
      stdoutBytes: bytes.length,
      stderrBytes: 0,
      ownedPid: 12345,
    };
  });
  fixture.args = [
    destination,
    '--claude-existing-profile',
    shellReceipt,
    selectedTarget,
    selectedPolicy,
    executable,
  ];
  fixture.deps = {
    platform: 'win32',
    home,
    child,
    nativeIdentity: vi.fn(async () => 'inert-native-identity'),
    loadAssets: vi.fn(async () => ({ runtimeVersion: '10.0.10' })),
    fingerprint: async (file) => pins.get(file) || digest(await fs.readFile(file)),
  };
  return fixture;
}
function equalInput(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

it('existing-profile preparation uses one mocked Haiku invocation and independent one/zero effects without claiming GUI consent', async () => {
  const fixture = await existingFixture();
  const original = await fs.readFile(fixture.selected.target);
  const receipt = await runExistingProfile(fixture.args, fixture.deps);
  expect(fixture.deps.child).toHaveBeenCalledTimes(3); // Two hook-only preflights, one mocked paid CLI.
  expect(receipt).toMatchObject({
    complete: true,
    nativeUI: false,
    actualHumanConsent: false,
    scriptedConfirmation: false,
    configuredModel: 'haiku',
    providerCliInvocations: 1,
    controllerRetries: 0,
    retryQualification: false,
    hardBillingCap: false,
    allowedEffectCount: 1,
    deniedFileAbsent: true,
    inputsUnchanged: true,
    nativeIdentityUnchanged: true,
  });
  expect(receipt.claude).toMatchObject({
    selectedModelObserved: true,
    observedModels: ['claude-haiku-4-5'],
    exactTwoRequests: true,
    denyResultObserved: true,
  });
  expect(receipt.claude).not.toHaveProperty('opusObserved');
  expect(await fs.readFile(fixture.selected.target)).toEqual(original);
  expect(await fs.readFile(path.join(fixture.destination, 'receipt.json'), 'utf8')).not.toContain(
    'PRIVATE_RESULT_CANARY',
  );
});

it('existing-profile preparation refuses widened policy, legacy native binding and changed command timeout', async () => {
  const fixture = await existingFixture();
  for (const change of [
    (value) => {
      value.policy.rules.push({ tool: 'Bash', input: fixture.requests[1], decision: 'allow' });
    },
    (value) => {
      value.policy.cwd = path.dirname(value.cwd);
    },
    (value) => {
      value.profile.hooks.PreToolUse[0].hooks[0].command = profileCommand(
        value.executable,
        value.archive,
        value.policyPath,
      );
    },
    (value) => {
      value.profile.hooks.PostToolUse[0].hooks[0].timeout = 10;
    },
    (value) => {
      value.profile.disableAllHooks = true;
    },
    (value) => {
      value.profile.allowManagedHooksOnly = true;
    },
    (value) => {
      value.profile.hooks.PreToolUse.push(structuredClone(value.profile.hooks.PreToolUse[0]));
    },
    (value) => {
      value.profile.hooks.SessionStart = [];
    },
  ]) {
    const selected = structuredClone(fixture.selected);
    change(selected);
    expect(() => existingProfileBinding(selected)).toThrow();
  }
  expect(fixture.deps.child).not.toHaveBeenCalled();
});

it('existing-profile preparation stops before a child on configured-model or retained-shell mismatch', async () => {
  const fixture = await existingFixture();
  await fs.writeFile(fixture.configured, '{"model":"opus"}');
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  await fs.writeFile(fixture.configured, '{"model":"haiku"}');
  const retained = path.join(path.dirname(fixture.shellReceipt), 'shell-preflight.txt');
  await fs.writeFile(retained, 'not the verified bytes');
  const forged = JSON.parse(await fs.readFile(fixture.shellReceipt, 'utf8'));
  forged.outputSha256 = createHash('sha256')
    .update(await fs.readFile(retained))
    .digest('hex');
  await fs.writeFile(fixture.shellReceipt, JSON.stringify(forged));
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  expect(fixture.deps.child).not.toHaveBeenCalled();
});

it('existing-profile preparation detects a duplicate physical effect even when provider records claim two expected calls', async () => {
  const fixture = await existingFixture();
  fixture.effectCount = 2;
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  const failure = JSON.parse(
    await fs.readFile(path.join(fixture.destination, 'failure.json'), 'utf8'),
  );
  expect(failure).toMatchObject({
    complete: false,
    allowedEffectCount: 2,
    providerCliInvocations: 1,
  });
  expect(failure.claude.exactTwoRequests).toBe(true);
  expect(fixture.deps.child).toHaveBeenCalledTimes(3);
});

it('existing-profile preparation records model substitution and never starts a second provider invocation', async () => {
  const fixture = await existingFixture();
  fixture.model = 'claude-sonnet-4-6';
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  const failure = JSON.parse(
    await fs.readFile(path.join(fixture.destination, 'failure.json'), 'utf8'),
  );
  expect(failure).toMatchObject({
    complete: false,
    observedInitModel: 'claude-sonnet-4-6',
    modelMismatchObserved: true,
    providerCliInvocations: 1,
  });
  expect(fixture.deps.child).toHaveBeenCalledTimes(3);
});

it('existing-profile preparation preserves unknown child cleanup without claiming a stopped tree', async () => {
  const fixture = await existingFixture();
  fixture.cleanup = false;
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toMatchObject({
    qualificationCleanupUnknown: true,
  });
  const failure = JSON.parse(
    await fs.readFile(path.join(fixture.destination, 'failure.json'), 'utf8'),
  );
  expect(failure).toMatchObject({
    complete: false,
    failureCode: 'CHILD_CLEANUP_UNCONFIRMED',
    providerTransport: { cleanupConfirmed: false, ownedPid: 12345 },
  });
  expect(fixture.deps.child).toHaveBeenCalledTimes(3);
});

it('existing-profile preparation refuses input drift after the sole provider attempt', async () => {
  const fixture = await existingFixture();
  fixture.mutateProfile = true;
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  const failure = JSON.parse(
    await fs.readFile(path.join(fixture.destination, 'failure.json'), 'utf8'),
  );
  expect(failure.inputsUnchanged).toBe(false);
});

it('existing-profile preparation refuses changed frozen executable bytes before any child', async () => {
  const fixture = await existingFixture();
  const fingerprint = fixture.deps.fingerprint;
  fixture.deps.fingerprint = (file) => (file === fixture.cli ? '0'.repeat(64) : fingerprint(file));
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  expect(fixture.deps.child).not.toHaveBeenCalled();
});

it('existing-profile preparation retains native-binding replacement as uncertainty', async () => {
  const fixture = await existingFixture();
  fixture.deps.nativeIdentity = vi
    .fn()
    .mockResolvedValueOnce('original')
    .mockResolvedValue('replacement');
  await expect(runExistingProfile(fixture.args, fixture.deps)).rejects.toThrow();
  const failure = JSON.parse(
    await fs.readFile(path.join(fixture.destination, 'failure.json'), 'utf8'),
  );
  expect(failure).toMatchObject({
    complete: false,
    nativeIdentityUnchanged: false,
    inputsUnchanged: false,
  });
});

it('existing-profile preparation stops a bounded inert child when the live output guard fails', async () => {
  const child = controlledChild();
  const killTree = vi.fn(() => queueMicrotask(() => child.emit('close', 2, null)));
  const done = boundedChild('INERT: never executed', [], {
    cwd: root,
    env: {},
    deadlineMs: 1000,
    spawnChild: () => child,
    killTree,
    acceptStdout: () => {
      throw Error('fixture rejection');
    },
  });
  child.stdout.write('fixture model mismatch');
  const result = await done;
  expect(killTree).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ code: 2, terminated: true, cleanupConfirmed: true });
  expect(result.stdout.length).toBe(0);
});

it.each(['deadline', 'model-output'])(
  'existing-profile preparation signals only the held child once for %s and keeps forced cleanup unknown',
  async (kind) => {
    const child = controlledChild();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 2, null));
      return true;
    });
    const foreignTreeKill = vi.fn();
    const done = boundedHeldChild('INERT: never executed', [], {
      cwd: root,
      env: {},
      deadlineMs: kind === 'deadline' ? 10 : 1000,
      spawnChild: () => child,
      killTree: foreignTreeKill,
      acceptStdout: () => false,
    });
    if (kind === 'model-output') child.stdout.write('inert substituted model');
    const result = await done;
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith();
    expect(foreignTreeKill).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      terminated: true,
      cleanupConfirmed: false,
      heldCloseObserved: true,
      ownedPid: 12345,
    });
  },
);
