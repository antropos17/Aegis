import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { startClaudeGuardReceiver } = require('../../src/main/claude-guard-receiver');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
const { profileCommand } = require('../../src/main/claude-hook-app-profile');
const { createClaudeGuardAdmission } = require('../../src/main/claude-guard-admission');
const broker = require('../../src/main/claude-guard-broker');
const directories = [];
let receiver;

afterEach(async () => {
  broker._resetForTest();
  if (receiver) await receiver.close();
  receiver = null;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function claim(port, session) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ code: '123456', nonce: 'c'.repeat(32) });
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: `/claim/${session}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let result = '';
        res.on('data', (chunk) => (result += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(Error('claim-refused'));
          resolve(JSON.parse(result));
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function start(port, session, token) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: `/start/${session}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}

it('delivers a real hook CLI decision to the selected finite receiver without raw input', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-integration-'));
  directories.push(directory);
  const policy = path.join(directory, 'policy.json');
  writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      cwd: directory,
      profile: 'aegis-windows-project-review-v1',
    }),
  );
  receiver = await startClaudeGuardReceiver({
    selection: {
      executable: path.join(directory, 'claude.exe'),
      settings: path.join(directory, 'settings.json'),
      cwd: directory,
    },
    approve: async (code) => code === '123456',
    verify: async () => true,
  });
  const grant = await claim(receiver.port, receiver.sessionId);
  expect(await start(receiver.port, receiver.sessionId, grant.token)).toBe(204);
  const child = spawn(process.execPath, ['src/main/main.js', '--action-policy-hook', policy], {
    env: {
      ...process.env,
      AEGIS_CLAUDE_GUARD_PORT: String(receiver.port),
      AEGIS_CLAUDE_GUARD_SESSION: receiver.sessionId,
      AEGIS_CLAUDE_GUARD_CAPABILITY: grant.token,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (bytes) => (stdout += bytes));
  child.stderr.on('data', (bytes) => (stderr += bytes));
  child.stdin.end(
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'private-session',
      tool_use_id: 'private-tool',
      tool_name: 'Bash',
      cwd: directory,
      tool_input: { command: 'cat .env.production.local', description: 'PRIVATE_DESCRIPTION' },
    }),
  );
  const timer = setTimeout(() => child.kill(), 6000);
  const [code] = await once(child, 'close');
  clearTimeout(timer);
  expect(code).toBe(0);
  expect(stderr).toBe('');
  expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  const state = receiver.snapshot();
  expect(state.entries).toEqual([{ decision: 'deny', reason: 'project-deny-sensitive' }]);
  expect(state).toMatchObject({ sender: 'unverified', delivery: 'unknown', effect: 'unknown' });
  expect(JSON.stringify(state)).not.toContain('PRIVATE');
  expect(JSON.stringify(state)).not.toContain(grant.token);
  expect(JSON.stringify(state)).not.toContain(directory);
});

it('links an actual post-hook CLI report to its matching decision without exporting provider content', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-after-'));
  directories.push(directory);
  const policy = path.join(directory, 'policy.json');
  writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 2,
      cwd: directory,
      profile: 'aegis-windows-project-review-v1',
    }),
  );
  receiver = await startClaudeGuardReceiver({
    selection: {
      executable: path.join(directory, 'claude.exe'),
      settings: path.join(directory, 'settings.json'),
      cwd: directory,
    },
    approve: async () => true,
    verify: async () => true,
  });
  const grant = await claim(receiver.port, receiver.sessionId);
  expect(await start(receiver.port, receiver.sessionId, grant.token)).toBe(204);
  const env = {
    ...process.env,
    AEGIS_CLAUDE_GUARD_PORT: String(receiver.port),
    AEGIS_CLAUDE_GUARD_SESSION: receiver.sessionId,
    AEGIS_CLAUDE_GUARD_CAPABILITY: grant.token,
  };
  const request = {
    session_id: 'PRIVATE_SESSION',
    tool_use_id: 'PRIVATE_TOOL',
    tool_name: 'Bash',
    cwd: directory,
    tool_input: { command: 'pwd', description: 'PRIVATE_DESCRIPTION' },
  };
  async function send(flag, body) {
    const child = spawn(process.execPath, ['src/main/main.js', flag, policy], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (bytes) => (stdout += bytes));
    child.stderr.on('data', (bytes) => (stderr += bytes));
    child.stdin.end(JSON.stringify(body));
    const timer = setTimeout(() => child.kill(), 6000);
    const [code] = await once(child, 'close');
    clearTimeout(timer);
    return { code, stdout, stderr };
  }
  const before = await send('--action-policy-hook', { ...request, hook_event_name: 'PreToolUse' });
  expect(before.code).toBe(0);
  expect(JSON.parse(before.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  expect(before.stderr).toBe('');
  const after = await send('--action-policy-after-hook', {
    ...request,
    hook_event_name: 'PostToolUse',
    tool_response: 'PRIVATE_OUTPUT',
  });
  expect(after).toEqual({ code: 0, stdout: '', stderr: '' });
  expect(receiver.snapshot().entries).toEqual([
    { decision: 'ask', reason: 'project-review-ordinary', outcome: 'reported-completed' },
  ]);
  const publicState = JSON.stringify(receiver.snapshot());
  for (const secret of [
    'PRIVATE_SESSION',
    'PRIVATE_TOOL',
    'PRIVATE_DESCRIPTION',
    'PRIVATE_OUTPUT',
    directory,
    grant.token,
  ])
    expect(publicState).not.toContain(secret);
  expect(receiver.snapshot()).toMatchObject({
    sender: 'unverified',
    effect: 'unknown',
    delivery: 'unknown',
  });
});

it.skipIf(process.platform !== 'win32')(
  'connects explicit desktop session selection to the real hook CLI and redacted status',
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-app-'));
    directories.push(directory);
    const profile = path.join(directory, 'claude-hook-profile');
    mkdirSync(profile);
    const settings = path.join(profile, 'settings.json');
    const program = path.join(directory, 'claude.exe');
    writeFileSync(program, 'fixture is never executed');
    const policy = path.join(directory, 'policy.json');
    writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 2,
        cwd: directory,
        profile: 'aegis-windows-project-review-v1',
      }),
    );
    const appExecutable = path.join(directory, 'AEGIS.exe');
    const appPath = path.join(directory, 'app.asar');
    writeFileSync(
      settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: profileCommand(appExecutable, appPath, policy),
                  timeout: 5,
                },
              ],
            },
          ],
        },
      }),
    );
    const choices = [program, directory];
    const dialogs = [];
    let clipboard = '';
    const app = createClaudeHookApp({
      userData: directory,
      executable: appExecutable,
      appPath,
      platform: 'win32',
      getAssets: async () => ({}),
      makeReadIO: async () => ({
        readTarget: async () => ({ identity: 'fixture-object', bytes: readFileSync(settings) }),
        close: async () => {},
        status: () => ({ admission: 'closed', exit: 'confirmed' }),
      }),
      getWindow: () => window,
      clipboard: { writeText: (text) => (clipboard = text) },
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [choices.shift()] }),
        showMessageBox: async (_window, value) => {
          dialogs.push(value);
          return { response: 1 };
        },
      },
    });
    const window = { isDestroyed: () => false };
    try {
      const started = await app.handle('guard-start', () => true);
      expect(started.code).toBe('GUARD_READY');
      expect(started.guardSession.status).toBe('waiting');
      expect(dialogs[0].detail).toContain(program);
      expect(dialogs[0].detail).toContain(directory);
      const secret = dialogs[1].detail.match(/Code: ([a-f0-9 ]+)/)[1].replaceAll(' ', '');
      expect(secret).toMatch(/^[a-f0-9]{24}$/);
      expect(clipboard).not.toContain(secret);
      // Parse the actual generated PowerShell as data; never execute it in this fixture.
      const parserScript = `
        $tokens=$null; $parseErrors=$null
        $ast=[System.Management.Automation.Language.Parser]::ParseInput($env:AEGIS_TEST_COMMAND,[ref]$tokens,[ref]$parseErrors)
        if ($parseErrors.Count -ne 0) { exit 1 }
        $commands=@($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Microsoft.PowerShell.Management\\Start-Process' },$true))
        if ($commands.Count -ne 1) { exit 2 }
        $elements=$commands[0].CommandElements
        $params=@($elements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] } | ForEach-Object { $_.ParameterName })
        function Arg($name) { for($i=0;$i -lt $elements.Count-1;$i++) { if($elements[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and $elements[$i].ParameterName -eq $name) { return $elements[$i+1].Value } }; throw 'missing parameter' }
        @{ file=(Arg 'FilePath'); arguments=(Arg 'ArgumentList'); wait=($params -contains 'Wait'); terminal=($params -contains 'NoNewWindow') } | ConvertTo-Json -Compress
      `;
      const parsed = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(parserScript, 'utf16le').toString('base64'),
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, AEGIS_TEST_COMMAND: clipboard },
        },
      );
      expect(parsed.status, parsed.stderr).toBe(0);
      const launch = JSON.parse(parsed.stdout);
      expect(launch).toMatchObject({ file: appExecutable, wait: true, terminal: true });
      const prefix = `"${appPath}" --claude-guard-session `;
      expect(launch.arguments.startsWith(prefix)).toBe(true);
      const [portText, sessionId, ...unexpected] = launch.arguments.slice(prefix.length).split(' ');
      expect(portText).toMatch(/^[1-9][0-9]{0,4}$/);
      expect(sessionId).toMatch(/^[a-f0-9]{32}$/);
      expect(unexpected).toEqual([]);
      const address = [null, portText, sessionId];
      let output = '';
      let inheritedToken = '';
      broker._setDepsForTest({
        terminal: () => true,
        readKey: async () => secret,
        randomInt: () => 123456,
        signals: new EventEmitter(),
        spawn: (executable, args, options) => {
          expect(executable).toBe(program);
          expect(args).toEqual(['--settings', path.join(profile, 'settings.json')]);
          expect(options.cwd).toBe(directory);
          expect(options.shell).toBe(false);
          inheritedToken = options.env.AEGIS_CLAUDE_GUARD_CAPABILITY;
          const child = spawn(
            process.execPath,
            ['src/main/main.js', '--action-policy-hook', policy],
            {
              env: options.env,
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          child.stdout.on('data', (chunk) => (output += chunk));
          child.stdin.end(
            JSON.stringify({
              hook_event_name: 'PreToolUse',
              session_id: 'private-session',
              tool_use_id: 'private-tool',
              tool_name: 'Bash',
              cwd: directory,
              tool_input: {
                command: 'cat .env.production.local',
                description: 'PRIVATE_DESCRIPTION',
              },
            }),
          );
          return child;
        },
      });
      const messages = [];
      const code = await broker.handleClaudeGuardSession(
        ['--claude-guard-session', address[1], address[2]],
        (message) => messages.push(message),
      );
      expect(code).toBe(0);
      expect(dialogs[2].detail).toContain('Code: 123456');
      expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
      const status = await app.handle('status', () => true);
      expect(status.guardSession.entries).toEqual([
        { decision: 'deny', reason: 'project-deny-sensitive' },
      ]);
      expect(status.guardSession).toMatchObject({
        sender: 'unverified',
        effect: 'unknown',
        delivery: 'unknown',
      });
      expect(JSON.stringify(status)).not.toContain(directory);
      expect(JSON.stringify(status)).not.toContain(inheritedToken);
      expect(JSON.stringify(status)).not.toContain(secret);
      expect(JSON.stringify(messages)).not.toContain(secret);
      expect(JSON.stringify(messages)).not.toContain(inheritedToken);
    } finally {
      await app.close();
    }
  },
);

it.skipIf(process.platform !== 'win32')(
  'refuses launch when the verified hook is removed after confirmation',
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-drift-'));
    directories.push(directory);
    const target = path.join(directory, 'settings.json');
    const policy = path.join(directory, 'policy.json');
    const executable = path.join(directory, 'AEGIS.exe');
    const appPath = path.join(directory, 'app.asar');
    writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 2,
        cwd: directory,
        profile: 'aegis-windows-project-review-v1',
      }),
    );
    writeFileSync(
      target,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: profileCommand(executable, appPath, policy),
                  timeout: 5,
                },
              ],
            },
          ],
        },
      }),
    );
    const admission = createClaudeGuardAdmission({
      target,
      executable,
      appPath,
      io: { readTarget: async () => ({ identity: 'fixture-object', bytes: readFileSync(target) }) },
    });
    const binding = await admission.capture(directory);
    expect(binding).not.toBeNull();
    receiver = await startClaudeGuardReceiver({
      selection: {
        executable: path.join(directory, 'claude.exe'),
        settings: target,
        cwd: directory,
      },
      approve: async () => true,
      verify: () => admission.verify(binding),
    });
    const grant = await claim(receiver.port, receiver.sessionId);
    writeFileSync(target, '{}');
    expect(await start(receiver.port, receiver.sessionId, grant.token)).toBe(403);
    expect(receiver.snapshot().entries).toEqual([]);
    admission.close();
  },
);
