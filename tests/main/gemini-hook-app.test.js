import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createGeminiHookApp } = require('../../src/main/gemini-hook-app');
const {
  hookCommand,
  removable,
  settingsBytes,
  shellPath,
} = require('../../src/main/gemini-profile-model');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
let root, target, service, state, opts;
const executable = 'C:\\Program Files\\AEGIS\\AEGIS.exe';
const appPath = 'C:\\Program Files\\AEGIS\\resources\\app.asar';
const policyPath = 'C:\\Private Policies\\gemini.json';
const policyText = JSON.stringify({
  schemaVersion: 1,
  provider: 'gemini-cli',
  hook: 'BeforeTool',
  cwd: 'C:\\work',
  tool: 'run_shell_command',
  deny: [{ command: 'blocked-command' }],
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-gemini-profile-'));
  target = path.join(root, 'gemini-hook-profile', '.gemini', 'settings.json');
  state = { approved: true, owned: true, content: policyText, backups: [], writes: 0, time: 0 };
  opts = {
    userData: root,
    assetsRoot: root,
    executable,
    appPath,
    platform: 'win32',
    packaged: true,
    getWindow: () => ({}),
    getAssets: async () => ({}),
    now: () => state.time,
    validPolicy: (value) => value.provider === 'gemini-cli' && value.deny?.length === 1,
    readPolicy: async () => Buffer.from(state.content),
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [policyPath] }),
      showMessageBox: async (_window, details) => {
        state.dialog = details;
        await state.onReview?.();
        return { response: state.approved ? 1 : 0 };
      },
    },
    makeDraftIO: async () => {
      let closed = false;
      return {
        create: async (bytes) => {
          try {
            await fs.writeFile(target, bytes, { flag: 'wx' });
            return 'written';
          } catch {
            return 'refused';
          }
        },
        checkCreated: async () => 'valid',
        close: async () => {
          closed = true;
        },
        status: () => ({
          admission: closed ? 'closed' : 'open',
          exit: closed ? 'confirmed' : 'unknown',
        }),
      };
    },
    makeReadIO: async () => {
      let closed = false;
      return {
        readTarget: async () => ({
          identity: state.identity || 'fixture',
          bytes: await fs.readFile(target),
        }),
        close: async () => {
          closed = true;
        },
        status: () => ({
          admission: closed ? 'closed' : 'open',
          exit: closed && !state.readReleaseUnknown ? 'confirmed' : 'unknown',
        }),
      };
    },
    makeIO: async () => {
      state.mutatingOpens = (state.mutatingOpens || 0) + 1;
      let closed = false;
      return {
        contract: IO_CONTRACT,
        readTarget: async () => ({
          identity: state.identity || 'fixture',
          bytes: await fs.readFile(target),
        }),
        retainPrivate: async ({ bytes, manifest }) => {
          const ref = {};
          state.backups.push({ ref, bytes: Buffer.from(bytes), manifest });
          return ref;
        },
        readPrivate: async (ref) => {
          const entry = state.backups.find((item) => item.ref === ref);
          if (state.advanceDuringBackup) state.time = 90001;
          return { bytes: Buffer.from(entry.bytes), manifest: entry.manifest };
        },
        compareAndWrite: async ({ beforeBytes, afterBytes }) => {
          if (!(await fs.readFile(target)).equals(beforeBytes)) return 'stale';
          state.writes++;
          if (state.writeThrows) throw Error('ambiguous write');
          await fs.writeFile(target, afterBytes);
          return 'written';
        },
        close: async () => {
          closed = true;
        },
        status: () => ({
          admission: closed ? 'closed' : 'open',
          exit: closed && !state.releaseUnknown ? 'confirmed' : 'unknown',
        }),
      };
    },
  };
  service = createGeminiHookApp(opts);
});
afterEach(async () => {
  await service.close();
  if (root) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^aegis-gemini-profile-/);
    await fs.rm(root, { recursive: true, force: true });
  }
});
const call = (action) => service.handle(action, () => state.owned);

it('reviews exact policy and settings, installs and removes only the unchanged owned draft', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  expect(state.dialog.defaultId).toBe(0);
  expect(state.dialog.cancelId).toBe(0);
  expect(state.dialog.detail).toContain(policyText);
  expect(state.dialog.detail).toContain(hookCommand(executable, appPath, policyPath));
  const actual = await fs.readFile(target);
  expect(actual.equals(settingsBytes(hookCommand(executable, appPath, policyPath)))).toBe(true);
  expect((await call('remove')).code).toBe('REMOVED');
  expect(await fs.readFile(target, 'utf8')).toBe('{}\n');
  expect(state.backups).toHaveLength(2);
});

it('allows a fresh removal review after restart without reconstructing old approval', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  await service.close();
  service = createGeminiHookApp(opts);
  expect((await call('remove')).code).toBe('REMOVED');
  expect(state.dialog.message).toContain('Remove');
});

it('cancels without writing the hook or retaining a backup', async () => {
  state.approved = false;
  for (let i = 0; i < 6; i++) expect((await call('install')).code).toBe('CANCELLED');
  expect(await fs.readFile(target, 'utf8')).toBe('{}\n');
  expect(state.writes).toBe(0);
  expect(state.backups).toHaveLength(0);
  expect(state.mutatingOpens || 0).toBe(0);
});

it('refuses changed settings and leaves unrelated content untouched', async () => {
  expect((await call('install')).code).toBe('INSTALLED');
  const altered = '{"other":"preserve"}\n';
  await fs.writeFile(target, altered);
  expect((await call('remove')).code).toBe('PROFILE_CHANGED');
  expect(await fs.readFile(target, 'utf8')).toBe(altered);
});

it('does not install when selected policy changes during review', async () => {
  state.onReview = async () => {
    state.content += ' ';
  };
  expect((await call('install')).code).toBe('POLICY_CHANGED');
  expect(state.writes).toBe(0);
});

it('uses the Gemini adapter validator for selected policy admission', async () => {
  await service.close();
  delete opts.validPolicy;
  service = createGeminiHookApp(opts);
  state.content = JSON.stringify({ schemaVersion: 1, provider: 'gemini-cli' });
  expect((await call('install')).code).toBe('INVALID_POLICY');
  state.content = JSON.stringify({ ...JSON.parse(policyText), cwd: root });
  expect((await call('install')).code).toBe('INSTALLED');
});

it('refuses target changes during review without overwriting the other edit', async () => {
  state.onReview = async () => {
    await fs.writeFile(target, '{"owner-change":true}\n');
  };
  expect((await call('install')).code).toBe('TARGET_CHANGED');
  expect(await fs.readFile(target, 'utf8')).toBe('{"owner-change":true}\n');
  expect(state.writes).toBe(0);
});

it('does not advertise a successful write when native helper shutdown is unconfirmed', async () => {
  state.releaseUnknown = true;
  expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
  expect(state.writes).toBe(1);
  expect((await call('remove')).code).toBe('RETAINED_UNKNOWN');
});

it('expires review and revokes renderer ownership before writing', async () => {
  state.onReview = async () => {
    state.time = 90001;
  };
  expect((await call('install')).code).toBe('EXPIRED');
  state.time = 0;
  state.onReview = async () => {
    state.owned = false;
  };
  expect((await call('install')).success).toBe(false);
  expect(state.writes).toBe(0);
});

it('does not commit if approval expires during pre-commit backup verification', async () => {
  state.advanceDuringBackup = true;
  expect((await call('install')).code).toBe('EXPIRED');
  expect(state.writes).toBe(0);
  expect(await fs.readFile(target, 'utf8')).toBe('{}\n');
});

it('refuses mutation when the read-only helper shutdown is not confirmed', async () => {
  state.readReleaseUnknown = true;
  expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
  expect(state.mutatingOpens || 0).toBe(0);
});

it.each(['makeDraftIO', 'makeReadIO', 'makeIO'])(
  'locks when %s rejects without returning a verifiable native child',
  async (name) => {
    await service.close();
    opts[name] = async () => { throw Error('fixture native open failure'); };
    service = createGeminiHookApp(opts);
    expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
    expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
    expect(state.writes).toBe(0);
  },
);

it('locks further writes when write or helper cleanup is uncertain', async () => {
  state.writeThrows = true;
  expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
  state.writeThrows = false;
  expect((await call('install')).code).toBe('RETAINED_UNKNOWN');
  expect(state.writes).toBe(1);
});

it('rejects unsafe PowerShell and Gemini expansion paths instead of interpolating them', () => {
  expect(shellPath('C:\\Safe Folder\\app.exe')).toBe("'C:/Safe Folder/app.exe'");
  for (const value of [
    "C:\\Owner's\\a.exe",
    'C:\\$HOME\\a.exe',
    'C:\\é\\a.exe',
    'C:\\safe;bad\\a.exe',
    'C:\\safe\\..\\a.exe',
    '\\\\server\\share\\a.exe',
    'C:\\safe\\a`x.exe',
    'C:\\safe\\a&b.exe',
  ])
    expect(() => shellPath(value)).toThrow();
  expect(
    removable(settingsBytes(hookCommand(executable, appPath, policyPath)), executable, appPath),
  ).toBe(true);
  for (const unsafe of [
    "C:\\bad'name\\thing",
    'C:\\$GEMINI_CWD\\thing',
    'C:\\é\\thing',
    'C:\\semi;colon\\thing',
  ]) {
    expect(() => hookCommand(unsafe, appPath, policyPath)).toThrow();
    expect(() => hookCommand(executable, unsafe, policyPath)).toThrow();
    expect(() => hookCommand(executable, appPath, unsafe)).toThrow();
  }
  const command = hookCommand(executable, appPath, policyPath);
  expect(command).toContain(
    "[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE','1','Process')",
  );
  expect(command).toContain('\'"C:/Program Files/AEGIS/resources/app.asar/src/main/main.js"\'');
  expect(command).toContain('\'"C:/Private Policies/gemini.json"\'');
  expect(command).not.toContain('$');
  const shippedExe = 'C:\\Program Files\\AEGIS - AI Monitoring & Threat Detection\\AEGIS - AI Monitoring & Threat Detection.exe';
  const shippedApp = 'C:\\Program Files\\AEGIS - AI Monitoring & Threat Detection\\resources\\app.asar';
  const shipped = hookCommand(shippedExe, shippedApp, policyPath);
  expect(shipped).toContain("-FilePath 'C:/Program Files/AEGIS - AI Monitoring & Threat Detection/AEGIS - AI Monitoring & Threat Detection.exe'");
  expect(removable(settingsBytes(shipped), shippedExe, shippedApp)).toBe(true);
});
