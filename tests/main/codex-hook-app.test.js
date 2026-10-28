import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createCodexHookApp, verifyCodexExecutable } = require('../../src/main/codex-hook-app');
const { hookCommand } = require('../../src/main/codex-profile-model');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
const executable = 'C:\\Program Files\\AEGIS & Watch\\AEGIS.exe';
const appPath = 'C:\\Program Files\\AEGIS & Watch\\resources\\app.asar';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const selectedPolicyPath = 'C:\\Private Policies\\codex.json';
let root, target, policy, state, service;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-codex-profile-'));
  target = path.join(root, 'codex-hook-profile', 'hooks.json');
  policy = path.join(root, 'policy.json');
  await fs.writeFile(
    policy,
    JSON.stringify({ schemaVersion: 1, cwd: root, defaultDecision: 'deny', rules: [] }),
  );
  state = {
    approved: true,
    owned: true,
    profileId: 'profile-identity',
    policyId: 'policy-identity',
    backups: [],
    writes: 0,
    time: 100,
    codexIdentity: 'device:file',
    codexSha256: 'a'.repeat(64),
  };
  const closeable = () => {
    let closed = false;
    return {
      close: async () => {
        closed = true;
      },
      status: () => ({
        admission: closed ? 'closed' : 'open',
        exit: closed ? 'confirmed' : 'unknown',
      }),
    };
  };
  service = createCodexHookApp({
    userData: root,
    assetsRoot: root,
    executable,
    appPath,
    powershell,
    platform: 'win32',
    packaged: true,
    getWindow: () => ({}),
    getAssets: async () => ({}),
    now: () => state.time,
    verifyExecutable: async (codexPath) => ({
      codexPath,
      codexIdentity: state.codexIdentity,
      codexSha256: state.codexSha256,
    }),
    dialog: {
      showOpenDialog: async (_window, options) => ({
        canceled: options.title === 'Select codex.exe' && !!state.codexCanceled,
        filePaths: [
          options.title === 'Select codex.exe'
            ? 'C:\\Tools\\codex.exe'
            : state.selectedPolicy || selectedPolicyPath,
        ],
      }),
      showMessageBox: async (_window, dialog) => {
        state.dialog = dialog;
        await state.onReview?.();
        return { response: state.approved ? 1 : 0 };
      },
    },
    makeDraftIO: async () => ({
      ...closeable(),
      create: async (bytes) => {
        try {
          await fs.writeFile(target, bytes, { flag: 'wx' });
          return 'written';
        } catch {
          return 'refused';
        }
      },
      checkCreated: async () => 'valid',
    }),
    makeReadIO: async (options) => ({
      ...closeable(),
      readTarget: async () =>
        options.selectedPolicy
          ? { identity: state.policyId, bytes: await fs.readFile(policy) }
          : { identity: state.profileId, bytes: await fs.readFile(target) },
    }),
    makeIO: async () => ({
      ...closeable(),
      contract: IO_CONTRACT,
      readTarget: async () => ({ identity: state.profileId, bytes: await fs.readFile(target) }),
      retainPrivate: async ({ bytes, manifest }) => {
        const ref = {};
        state.backups.push({ ref, bytes: Buffer.from(bytes), manifest });
        await state.onRetain?.();
        return ref;
      },
      readPrivate: async (ref) => {
        const item = state.backups.find((value) => value.ref === ref);
        return {
          bytes: Buffer.from(state.backupTamper ? 'tampered' : item.bytes),
          manifest: item.manifest,
        };
      },
      compareAndWrite: async ({ beforeBytes, afterBytes }) => {
        if (!(await fs.readFile(target)).equals(beforeBytes)) return 'stale';
        state.writes++;
        if (state.writeUncertain) throw Error('fixture write failed');
        await fs.writeFile(target, afterBytes);
        return 'written';
      },
    }),
  });
});

afterEach(async () => {
  await service.close();
  if (root) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^aegis-codex-profile-/);
    await fs.rm(root, { recursive: true, force: true });
  }
});
const call = (action) => service.handle(action, () => state.owned);

it('reviews the exact hook and selected policy, then installs and removes only the owned profile', async () => {
  const response = await call('install');
  expect(response.code).toBe('INSTALLED');
  for (const secret of [root, policy, 'EncodedCommand'])
    expect(JSON.stringify(response)).not.toContain(secret);
  expect(state.dialog).toMatchObject({ defaultId: 0, cancelId: 0 });
  expect(state.dialog.detail).toContain(
    hookCommand(executable, appPath, selectedPolicyPath, powershell),
  );
  expect(state.dialog.detail).toContain('Decoded command script:');
  expect(state.dialog.detail).toContain('Hook failures or timeouts may continue');
  expect(await fs.readFile(target, 'utf8')).toContain('PreToolUse');
  expect((await call('remove')).code).toBe('REMOVED');
  expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({});
  expect(state.backups).toHaveLength(2);
});

it('does not write the hook or retain a backup on cancellation', async () => {
  state.approved = false;
  expect((await call('install')).code).toBe('CANCELLED');
  expect(await fs.readFile(target, 'utf8')).toBe('{}\n');
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(0);
});

it('refuses policy identity drift after native review even when bytes match', async () => {
  state.onReview = () => {
    state.policyId = 'replacement-identity';
  };
  expect((await call('install')).code).toBe('POLICY_CHANGED');
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(0);
});

it('refuses a changed profile before any native transaction', async () => {
  state.onReview = async () => fs.writeFile(target, '{"foreign":true}');
  expect((await call('install')).code).toBe('TARGET_CHANGED');
  expect(state.writes).toBe(0);
  expect(await fs.readFile(target, 'utf8')).toBe('{"foreign":true}');
});

it('rechecks policy identity again after retaining the private backup', async () => {
  state.onRetain = () => {
    state.policyId = 'replaced-during-backup';
  };
  expect((await call('install')).code).toBe('POLICY_CHANGED');
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(1);
});

it('does not write when the private backup cannot be verified', async () => {
  state.backupTamper = true;
  expect((await call('install')).code).toBe('BACKUP_FAILED');
  expect(state.writes).toBe(0);
});

it('retains an uncertain write and blocks later mutation', async () => {
  state.writeUncertain = true;
  expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
  expect((await call('remove')).code).toBe('RETAINED_UNKNOWN');
  expect(state.backups).toHaveLength(1);
});

it('returns an exact private launch binding after rechecking both native identities', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  const profileBytes = await fs.readFile(target),
    policyBytes = await fs.readFile(policy);
  const result = await service.reviewLaunch(() => state.owned);
  expect(result).toMatchObject({
    ok: true,
    profileIdentity: 'profile-identity',
    policyIdentity: 'policy-identity',
    profileSha256: digest(profileBytes),
    policySha256: digest(policyBytes),
    codexPath: 'C:\\Tools\\codex.exe',
    codexIdentity: 'device:file',
    codexSha256: 'a'.repeat(64),
    cwd: root,
  });
  expect(result.profilePath).toBe(
    path.win32.normalize(target).replace(/^[a-z](?=:)/, (drive) => drive.toUpperCase()),
  );
  expect(result.policyPath).toBe(
    path.win32.normalize(selectedPolicyPath).replace(/^[a-z](?=:)/, (drive) => drive.toUpperCase()),
  );
  expect(state.dialog).toMatchObject({ defaultId: 0, cancelId: 0 });
  expect(state.dialog.detail).toContain('Review and trust the hook manually');
  expect(state.dialog.detail).toContain('write_stdin');
  expect(state.dialog.detail).toContain('C:\\Tools\\codex.exe');
  expect(state.dialog.detail).toContain('a'.repeat(64));
  expect(state.dialog.detail).toContain(`'${digest(policyBytes)}'`);
  expect(state.dialog.detail).toContain('session hook denies if its policy bytes change');
});

it('refuses executable selection cancellation or replacement after review', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.codexCanceled = true;
  expect(await service.reviewLaunch(() => state.owned)).toEqual({ ok: false, code: 'CANCELLED' });
  state.codexCanceled = false;
  state.onReview = () => {
    state.codexIdentity = 'different-file';
  };
  expect(await service.reviewLaunch(() => state.owned)).toEqual({
    ok: false,
    code: 'CODEX_CHANGED',
  });
  state.onReview = () => {
    state.codexSha256 = 'b'.repeat(64);
  };
  expect(await service.reviewLaunch(() => state.owned)).toEqual({
    ok: false,
    code: 'CODEX_CHANGED',
  });
});

it.runIf(process.platform === 'win32')(
  'observes a bounded real file and rejects invalid or linked paths',
  async () => {
    const binary = path.join(root, 'codex.exe');
    await fs.writeFile(binary, 'fixture executable, never run');
    const verified = await verifyCodexExecutable(binary);
    expect(verified.codexSha256).toBe(digest(Buffer.from('fixture executable, never run')));
    expect(verified.codexIdentity).toMatch(/^\d+:\d+$/);
    expect(await verifyCodexExecutable(binary)).toEqual(verified);
    await expect(verifyCodexExecutable('C:\\missing\\codex.exe')).rejects.toThrow();
    await expect(verifyCodexExecutable('\\\\server\\share\\codex.exe')).rejects.toThrow();
    await expect(verifyCodexExecutable(path.join(root, 'other.exe'))).rejects.toThrow();
    const linkDir = path.join(root, 'link');
    await fs.mkdir(linkDir);
    const linked = path.join(linkDir, 'codex.exe');
    try {
      await fs.symlink(binary, linked, 'file');
      await expect(verifyCodexExecutable(linked)).rejects.toThrow();
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
    }
    const junction = path.join(root, 'junction');
    await fs.symlink(root, junction, 'junction');
    await expect(verifyCodexExecutable(path.join(junction, 'codex.exe'))).rejects.toThrow();
  },
);

it('refuses a launch when the policy or profile identity changes after preview', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.onReview = () => {
    state.policyId = 'policy-replaced';
  };
  expect(await service.reviewLaunch(() => state.owned)).toEqual({
    ok: false,
    code: 'POLICY_CHANGED',
  });
  state.onReview = () => {
    state.profileId = 'profile-replaced';
  };
  expect(await service.reviewLaunch(() => state.owned)).toEqual({
    ok: false,
    code: 'PROFILE_CHANGED',
  });
});

it('does not produce a launch handoff on cancellation and never exposes it through handle', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.approved = false;
  expect(await service.reviewLaunch(() => state.owned)).toEqual({ ok: false, code: 'CANCELLED' });
  expect(await call('prepare-launch')).toEqual({
    success: false,
    error: 'Invalid profile operation',
  });
});

it('refuses a launch when the owner is lost during review', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.onReview = () => {
    state.owned = false;
  };
  expect(await service.reviewLaunch(() => state.owned)).toEqual({ ok: false, code: 'CANCELLED' });
});

it('refuses an expired launch review', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.onReview = () => {
    state.time += 90001;
  };
  expect(await service.reviewLaunch(() => state.owned)).toEqual({ ok: false, code: 'EXPIRED' });
});

it('refuses a modified policy at launch even when the identity stays the same', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.onReview = async () => fs.appendFile(policy, ' ');
  expect(await service.reviewLaunch(() => state.owned)).toEqual({
    ok: false,
    code: 'POLICY_CHANGED',
  });
});

it('requires the owner to reselect the same policy before launch review', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  state.selectedPolicy = 'C:\\Private Policies\\different.json';
  expect(await service.reviewLaunch(() => state.owned)).toEqual({
    ok: false,
    code: 'POLICY_CHANGED',
  });
});
