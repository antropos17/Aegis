import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createClaudeGuardAdmission } = require('../../src/main/claude-guard-admission');
const { profileCommand } = require('../../src/main/claude-hook-app-profile');
const owned = [];

afterEach(() => {
  for (const directory of owned.splice(0)) {
    const parent = realpathSync(tmpdir());
    if (!path.resolve(directory).startsWith(parent + path.sep)) throw Error('fixture-outside-temp');
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(path.join(parent, 'aegis-admission-'));
  owned.push(directory);
  const policyPath = path.join(directory, 'policy.json');
  const selection = {
    target: path.join(directory, 'settings.json'),
    executable: process.execPath,
    appPath: path.join(directory, 'app.asar'),
  };
  const policy = {
    schemaVersion: 2,
    cwd: directory,
    profile: 'aegis-windows-project-review-v1',
  };
  writeFileSync(policyPath, JSON.stringify(policy));
  const command = profileCommand(selection.executable, selection.appPath, policyPath);
  const entry = { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 5 }] };
  const makeProfile = (entries) => Buffer.from(JSON.stringify({ hooks: { PreToolUse: entries } }));
  let contents = makeProfile([entry]);
  let identity = 'target-original';
  const issued = [];
  const io = {
    readTarget: vi.fn(async () => {
      const bytes = Buffer.from(contents);
      issued.push(bytes);
      return { identity, bytes };
    }),
  };
  const admission = createClaudeGuardAdmission({ ...selection, io });
  return {
    admission,
    policyPath,
    directory,
    entry,
    io,
    issued,
    setEntries: (entries) => (contents = makeProfile(entries)),
    setProfile: (value) => (contents = Buffer.from(JSON.stringify(value))),
    setRaw: (value) => (contents = Buffer.from(value)),
    changeIdentity: () => (identity = 'target-replacement'),
  };
}

it('admits one exact hook and policy for the selected cwd, retaining no public details', async () => {
  const f = fixture();
  const binding = await f.admission.capture(f.directory);
  expect(binding).toEqual({});
  expect(JSON.stringify(binding)).toBe('{}');
  expect(await f.admission.verify(binding)).toBe(true);
  expect(await f.admission.verify({})).toBe(false);
  expect(f.issued.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  f.admission.release(binding);
  expect(await f.admission.verify(binding)).toBe(false);
  expect(await f.admission.capture(path.join(f.directory, 'different'))).toBeNull();
  f.admission.close();
  expect(await f.admission.capture(f.directory)).toBeNull();
});

it.each(['disableAllHooks', 'allowManagedHooksOnly'])(
  'refuses enabled or ambiguous %s values in the selected profile',
  async (name) => {
    const f = fixture();
    for (const value of [true, null, 0, 'false', {}, []]) {
      f.setProfile({ [name]: value, hooks: { PreToolUse: [f.entry] } });
      expect(await f.admission.capture(f.directory)).toBeNull();
    }
    f.setProfile({ [name]: false, hooks: { PreToolUse: [f.entry] } });
    expect(await f.admission.capture(f.directory)).not.toBeNull();
    f.admission.close();
  },
);

it('refuses duplicate hook-disable settings without changing the target', async () => {
  const f = fixture();
  const initial = JSON.stringify({ hooks: { PreToolUse: [f.entry] } });
  f.setRaw(initial.replace('{', '{"disableAllHooks":false,"disableAllHooks":true,'));
  expect(await f.admission.capture(f.directory)).toBeNull();
  expect(f.issued.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  f.admission.close();
});

it.each(['empty', 'removed', 'changed', 'duplicate', 'mixed', 'additional'])(
  'refuses %s profile before issuing a binding',
  async (mode) => {
    const f = fixture();
    if (mode === 'empty' || mode === 'removed') f.setEntries([]);
    if (mode === 'changed')
      f.setEntries([{ ...f.entry, hooks: [{ ...f.entry.hooks[0], timeout: 6 }] }]);
    if (mode === 'duplicate') f.setEntries([f.entry, f.entry]);
    if (mode === 'mixed')
      f.setEntries([
        { ...f.entry, hooks: [...f.entry.hooks, { type: 'command', command: 'other' }] },
      ]);
    if (mode === 'additional') f.setEntries([f.entry, { matcher: 'Read', hooks: [] }]);
    expect(await f.admission.capture(f.directory)).toBeNull();
    expect(f.issued.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
    f.admission.close();
  },
);

it.each(['profile-bytes', 'profile-identity', 'policy-bytes', 'policy-identity', 'policy-invalid'])(
  'rejects %s drift after initial capture',
  async (mode) => {
    const f = fixture();
    const binding = await f.admission.capture(f.directory);
    expect(binding).not.toBeNull();
    if (mode === 'profile-bytes') f.setEntries([]);
    if (mode === 'profile-identity') f.changeIdentity();
    if (mode === 'policy-bytes')
      writeFileSync(f.policyPath, `${readFileSync(f.policyPath, 'utf8')} `);
    if (mode === 'policy-invalid') writeFileSync(f.policyPath, '{}');
    if (mode === 'policy-identity') {
      const bytes = readFileSync(f.policyPath);
      renameSync(f.policyPath, path.join(f.directory, 'old-policy.json'));
      writeFileSync(f.policyPath, bytes);
    }
    expect(await f.admission.verify(binding)).toBe(false);
    f.admission.close();
  },
);

it('refuses a profile that changes during capture', async () => {
  const f = fixture();
  const first = f.io.readTarget.getMockImplementation();
  f.io.readTarget.mockImplementationOnce(async () => {
    const value = await first();
    f.changeIdentity();
    return value;
  });
  expect(await f.admission.capture(f.directory)).toBeNull();
  f.admission.close();
});

it('revokes the binding after drift, even if the profile is later restored', async () => {
  const f = fixture();
  const binding = await f.admission.capture(f.directory);
  expect(binding).not.toBeNull();
  f.setEntries([]);
  expect(await f.admission.verify(binding)).toBe(false);
  f.setEntries([f.entry]);
  expect(await f.admission.verify(binding)).toBe(false);
  expect(await f.admission.capture(f.directory)).not.toBeNull();
  f.admission.close();
});

it('refuses in-flight verification after closure', async () => {
  const f = fixture();
  const binding = await f.admission.capture(f.directory);
  let unblock;
  const prior = f.io.readTarget.getMockImplementation();
  f.io.readTarget.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        unblock = async () => resolve(await prior());
      }),
  );
  const checking = f.admission.verify(binding);
  f.admission.close();
  await unblock();
  expect(await checking).toBe(false);
});

it('revokes both concurrent verification attempts', async () => {
  const f = fixture();
  const binding = await f.admission.capture(f.directory);
  let unblock;
  const prior = f.io.readTarget.getMockImplementation();
  f.io.readTarget.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        unblock = async () => resolve(await prior());
      }),
  );
  const first = f.admission.verify(binding);
  expect(await f.admission.verify(binding)).toBe(false);
  await unblock();
  expect(await first).toBe(false);
  expect(await f.admission.verify(binding)).toBe(false);
  f.admission.close();
});

it('exposes after-observation capability only for the complete binding and clears it on release', async () => {
  const f = fixture();
  const { profileAfterCommand } = require('../../src/main/claude-hook-app-profile');
  const after = {
    matcher: 'Bash',
    hooks: [
      {
        type: 'command',
        command: profileAfterCommand(
          process.execPath,
          path.join(f.directory, 'app.asar'),
          f.policyPath,
        ),
        timeout: 5,
      },
    ],
  };
  f.setProfile({
    hooks: { PreToolUse: [f.entry], PostToolUse: [after], PostToolUseFailure: [after] },
  });
  const binding = await f.admission.capture(f.directory);
  expect(binding).toEqual({});
  expect(f.admission.hasAfterHooks(binding)).toBe(true);
  expect(f.admission.hasAfterHooks({})).toBe(false);
  f.admission.release(binding);
  expect(f.admission.hasAfterHooks(binding)).toBe(false);
  f.admission.close();
});

it('does not admit an incomplete after group or report it enabled on a legacy binding', async () => {
  const f = fixture();
  const legacy = await f.admission.capture(f.directory);
  expect(f.admission.hasAfterHooks(legacy)).toBe(false);
  f.admission.release(legacy);
  const { profileAfterCommand } = require('../../src/main/claude-hook-app-profile');
  const after = {
    matcher: 'Bash',
    hooks: [
      {
        type: 'command',
        command: profileAfterCommand(
          process.execPath,
          path.join(f.directory, 'app.asar'),
          f.policyPath,
        ),
        timeout: 5,
      },
    ],
  };
  f.setProfile({ hooks: { PreToolUse: [f.entry], PostToolUse: [after] } });
  expect(await f.admission.capture(f.directory)).toBeNull();
  f.admission.close();
});

it.each(['legacy', 'redirected', 'mixed', 'extra-shell'])(
  'admits only matched exact %s post commands',
  async (mode) => {
    const f = fixture();
    const {
      profileAfterCommand,
      profileAfterCommandLegacy,
    } = require('../../src/main/claude-hook-app-profile');
    const args = [process.execPath, path.join(f.directory, 'app.asar'), f.policyPath];
    const legacy = profileAfterCommandLegacy(...args);
    const redirected = profileAfterCommand(...args);
    const post = mode === 'legacy' ? legacy : redirected;
    const failure =
      mode === 'legacy' || mode === 'mixed'
        ? legacy
        : mode === 'extra-shell'
          ? redirected + ' 2>&1'
          : redirected;
    const make = (value) => ({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: value, timeout: 5 }],
    });
    f.setProfile({
      hooks: {
        PreToolUse: [f.entry],
        PostToolUse: [make(post)],
        PostToolUseFailure: [make(failure)],
      },
    });
    const binding = await f.admission.capture(f.directory);
    expect(Boolean(binding)).toBe(mode === 'legacy' || mode === 'redirected');
    if (binding) expect(f.admission.hasAfterHooks(binding)).toBe(true);
    f.admission.close();
  },
);
