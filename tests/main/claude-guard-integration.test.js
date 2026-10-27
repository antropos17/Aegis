import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { startClaudeGuardReceiver } = require('../../src/main/claude-guard-receiver');
const { createClaudeHookApp } = require('../../src/main/claude-hook-app');
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
  });
  const grant = await claim(receiver.port, receiver.sessionId);
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

it('connects explicit desktop session selection to the real hook CLI and redacted status', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-app-'));
  directories.push(directory);
  const profile = path.join(directory, 'claude-hook-profile');
  mkdirSync(profile);
  writeFileSync(path.join(profile, 'settings.json'), '{}');
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
  const choices = [program, directory];
  const dialogs = [];
  let clipboard = '';
  const app = createClaudeHookApp({
    userData: directory,
    executable: path.join(directory, 'AEGIS.exe'),
    appPath: path.join(directory, 'app.asar'),
    platform: 'win32',
    getAssets: async () => ({}),
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
    const address = clipboard.match(/--claude-guard-session (\d+) '([a-f0-9]{32})'/);
    expect(address).not.toBeNull();
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
});
