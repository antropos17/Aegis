import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  hookScript,
  hookCommand,
  policyFromCommand,
  readProfile,
  planProfileChange,
} = require('../../src/main/codex-profile-model');
const executable = 'C:\\Program Files\\AEGIS & Watch\\AEGIS.exe';
const appPath = 'C:\\Program Files\\AEGIS & Watch\\resources\\app.asar';
const policy = 'C:\\Private Policies\\project.json';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const options = { executable, appPath, powershell, target: 'C:\\AEGIS\\hooks.json' };

it('round-trips one exact app-owned Bash hook and refuses modified or foreign data', () => {
  const command = hookCommand(executable, appPath, policy, powershell);
  const install = planProfileChange(Buffer.from('{}\n'), {
    ...options,
    action: 'install',
    command,
  });
  expect(install).not.toBeNull();
  expect(JSON.parse(install.after)).toEqual({
    hooks: {
      PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command, timeout: 5 }] }],
    },
  });
  expect(readProfile(install.after, options)).toEqual({
    command,
    policy: policy.replaceAll('\\', '/'),
  });
  expect(policyFromCommand(command, executable, appPath, powershell)).toBe(
    policy.replaceAll('\\', '/'),
  );
  expect(hookScript(executable, appPath, policy)).toContain('--codex-pretool-hook');
  const removal = planProfileChange(install.after, { ...options, action: 'remove' });
  expect(JSON.parse(removal.after)).toEqual({});
  const altered = JSON.parse(install.after);
  altered.hooks.PreToolUse[0].hooks[0].timeout = 6;
  expect(readProfile(Buffer.from(JSON.stringify(altered)), options)).toBeNull();
  expect(
    planProfileChange(Buffer.from('{"other":true}'), { ...options, action: 'install', command }),
  ).toBeNull();
  expect(readProfile(Buffer.from('{"hooks":{},"hooks":{}}'), options)).toBeNull();
});

it.each([
  'C:\\Bad%PATH%\\policy.json',
  'C:\\Bad!PATH!\\policy.json',
  "C:\\Bad'\\policy.json",
  'C:\\x\\..\\policy.json',
  '\\\\server\\share\\policy.json',
])('rejects unsafe policy path %s', (file) => {
  expect(() => hookCommand(executable, appPath, file, powershell)).toThrow('unsupported-path');
});

it('rejects a non-system interpreter and changed commands', () => {
  expect(() => hookCommand(executable, appPath, policy, 'C:\\Temp\\powershell.exe')).toThrow(
    'unsupported-path',
  );
  const command = hookCommand(executable, appPath, policy, powershell);
  expect(policyFromCommand(command + ' ', executable, appPath, powershell)).toBeNull();
  expect(
    policyFromCommand(command.replace('NoProfile', 'NoExit'), executable, appPath, powershell),
  ).toBeNull();
});

it('keeps native Electron storage bound to a canonical child of the selected profile', () => {
  const target = path.resolve(os.tmpdir(), 'codex-owned-profile', 'hooks.json');
  const nativePath = path.join(path.dirname(target), 'native-' + 'a'.repeat(32));
  const command = hookCommand(executable, appPath, policy, powershell, undefined, nativePath);
  const change = planProfileChange(Buffer.from('{}'), { ...options, target, action: 'install', command });
  expect(change).not.toBeNull();
  expect(readProfile(change.after, { ...options, target })).toEqual({
    command, policy: policy.replaceAll('\\', '/'), nativePath,
  });
  expect(hookScript(executable, appPath, policy, undefined, nativePath)).toContain(
    " '--user-data-dir=" + nativePath + "'",
  );
  const foreign = hookCommand(executable, appPath, policy, powershell, undefined,
    path.join(os.tmpdir(), 'native-' + 'b'.repeat(32)));
  expect(planProfileChange(Buffer.from('{}'), { ...options, target, action: 'install', command: foreign })).toBeNull();
  expect(planProfileChange(change.after, { ...options, target, action: 'remove' })).not.toBeNull();
});

it.skipIf(process.platform !== 'win32')(
  'passes inherited stdin through the fixed command in cmd and Windows PowerShell',
  () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'aegis-codex-shell-'));
    const fixture = path.join(directory, 'fixture.js');
    try {
      writeFileSync(
        fixture,
        "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({payload:s,args:process.argv.slice(2)})));",
        { flag: 'wx' },
      );
      const command = hookCommand(
        process.execPath,
        fixture,
        path.join(directory, 'policy.json'),
        powershell,
        'a'.repeat(64),
        path.join(directory, 'native-' + 'b'.repeat(32)),
      );
      for (const [program, args] of [
        [process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', command]],
        [powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]],
      ]) {
        const result = spawnSync(program, args, {
          input: 'fixed-input',
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          payload: 'fixed-input',
          args: ['--codex-pretool-hook', path.join(directory, 'policy.json').replaceAll('\\', '/'),
            'a'.repeat(64), '--user-data-dir=' + path.join(directory, 'native-' + 'b'.repeat(32))],
        });
      }
      const unavailable = hookCommand(
        path.join(directory, 'missing.exe'),
        fixture,
        path.join(directory, 'policy.json'),
        powershell,
      );
      const failed = spawnSync(
        process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
        ['/d', '/s', '/c', unavailable],
        { input: 'private-input', encoding: 'utf8', timeout: 10000, windowsHide: true },
      );
      expect(failed.status, failed.stderr).toBe(0);
      expect(JSON.parse(failed.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      expect(failed.stdout + failed.stderr).not.toContain('private-input');
    } finally {
      unlinkSync(fixture);
      rmdirSync(directory);
    }
  },
);

it.skipIf(process.platform !== 'win32' || !process.env.AEGIS_CODEX_TEST_GUI)(
  'passes inherited stdin through the fixed command using the explicitly selected packaged GUI executable',
  () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'aegis-codex-gui-'));
    const fixture = path.join(directory, 'fixture.js');
    try {
      writeFileSync(
        fixture,
        "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({payload:s,flag:process.argv[2]})));",
        { flag: 'wx' },
      );
      const command = hookCommand(
        process.env.AEGIS_CODEX_TEST_GUI,
        fixture,
        path.join(directory, 'policy.json'),
        powershell,
      );
      for (const [program, args] of [
        [process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', command]],
        [powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]],
      ]) {
        const result = spawnSync(program, args, {
          input: 'fixed-input',
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          payload: 'fixed-input',
          flag: '--codex-pretool-hook',
        });
      }
    } finally {
      unlinkSync(fixture);
      rmdirSync(directory);
    }
  },
);

it.skipIf(process.platform !== 'win32' || !process.env.AEGIS_CODEX_TEST_GUI)(
  'delivers an existing packaged hook through the fixed wrapper without Electron Node mode',
  () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'aegis-codex-packaged-'));
    const policy = path.join(directory, 'policy.json');
    try {
      writeFileSync(
        policy,
        JSON.stringify({ schemaVersion: 1, cwd: directory, defaultDecision: 'deny', rules: [] }),
        { flag: 'wx' },
      );
      const archive = path.join(
        path.dirname(process.env.AEGIS_CODEX_TEST_GUI),
        'resources',
        'app.asar',
      );
      const script = hookScript(process.env.AEGIS_CODEX_TEST_GUI, archive, policy).replace(
        '--codex-pretool-hook',
        '--action-policy-hook',
      );
      const command = `${powershell.replaceAll('\\', '/')} -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const input = JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'fixture',
        tool_use_id: 'fixture',
        tool_name: 'Bash',
        cwd: directory,
        tool_input: { command: 'pwd' },
      });
      for (const [program, args] of [
        [process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', command]],
        [powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]],
      ]) {
        const result = spawnSync(program, args, {
          input,
          encoding: 'utf8',
          timeout: 10000,
          windowsHide: true,
          env,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      }
    } finally {
      unlinkSync(policy);
      rmdirSync(directory);
    }
  },
  25000,
);
