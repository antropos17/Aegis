import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { evaluateActionPolicy } = require('../../src/main/action-policy');
const { checkProfilePolicy } = require('../../src/main/claude-hook-app-profile');
let root, file;
const encode = (value) => Buffer.from(JSON.stringify(value));
const request = (command, extra = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 'session',
  tool_use_id: 'tool',
  tool_name: 'Bash',
  cwd: root,
  tool_input: { command, ...extra },
});
const profile = () => ({
  schemaVersion: 2,
  cwd: root,
  profile: 'aegis-windows-project-review-v1',
});
async function run(command, extra = {}, selected = profile()) {
  fs.writeFileSync(file, encode(selected));
  return evaluateActionPolicy(file, encode(request(command, extra)));
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-project-policy-'));
  file = path.join(root, 'policy.json');
});
afterEach(() => {
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('bounded project review policy', () => {
  it.each(['pwd', 'ls', 'git status', 'git status --short', 'git diff --stat', 'cat README.md'])(
    'delegates ordinary command %s to the provider',
    async (command) => {
      expect(await run(command, { description: 'Read project', timeout: 5000 })).toEqual({
        decision: 'ask',
        reason: 'project-review-ordinary',
      });
    },
  );
  it.each(['cat .env', 'cat .env.local', 'cat id_rsa', 'cat credentials.json'])(
    'denies declared sensitive filename %s',
    async (command) => {
      expect(await run(command)).toEqual({ decision: 'deny', reason: 'project-deny-sensitive' });
    },
  );
  it.each(['rm -rf project', 'git reset --hard', 'git clean -fd'])(
    'denies destructive command %s',
    async (command) => {
      expect(await run(command)).toEqual({ decision: 'deny', reason: 'project-deny-destructive' });
    },
  );
  it.each([
    'git status; rm -rf project',
    'git status $(touch x)',
    'git status | sh',
    'git status >output',
    'git -c core.fsmonitor=payload status',
    'cat ../.env',
    'cat README.md .env',
    'cat "$SECRET"',
    'sh -c git',
    'npm test',
    'ls *',
  ])('denies unsupported syntax or program %s', async (command) => {
    expect(await run(command)).toEqual({ decision: 'deny', reason: 'project-deny-unsupported' });
  });
  it('denies unknown request fields and invalid selected profiles', async () => {
    expect(await run('pwd', { run_in_background: true })).toEqual({
      decision: 'deny',
      reason: 'project-deny-unsupported',
    });
    expect(await run('pwd', {}, { ...profile(), defaultDecision: 'allow' })).toEqual({
      decision: 'deny',
      reason: 'policy-invalid',
    });
  });
  it('accepts the selected profile in the existing picker validation and denies a changed cwd', async () => {
    fs.writeFileSync(file, encode(profile()));
    expect(await checkProfilePolicy(file)).toBe(true);
    expect(
      await evaluateActionPolicy(file, encode({ ...request('pwd'), cwd: path.dirname(root) })),
    ).toEqual({ decision: 'deny', reason: 'scope-mismatch' });
  });
  it.each([
    { description: 1 },
    { timeout: 0 },
    { timeout: 600001 },
    { timeout: 1.5 },
    { dangerouslyDisableSandbox: true },
  ])('denies unrecognized or invalid tool input metadata %#', async (extra) => {
    expect(await run('pwd', extra)).toEqual({
      decision: 'deny',
      reason: 'project-deny-unsupported',
    });
  });
  it.each([
    [
      'git status --short',
      'ask',
      'AEGIS project review requests provider confirmation for this supported command.',
    ],
    ['cat .env', 'deny', 'AEGIS project review denies this declared sensitive filename.'],
    [
      'git status; rm -rf project',
      'deny',
      'AEGIS project review does not support this command or input.',
    ],
  ])(
    'emits the fixed %s decision and reason through the real Node hook CLI',
    (command, decision, reason) => {
      fs.writeFileSync(file, encode(profile()));
      const result = spawnSync(
        process.execPath,
        ['src/main/main.js', '--action-policy-hook', file],
        {
          input: encode(request(command, { description: 'PRIVATE_DESCRIPTION' })),
          encoding: 'utf8',
          timeout: 6000,
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: reason,
        },
      });
      expect(result.stdout).not.toContain('PRIVATE_DESCRIPTION');
    },
  );
});
