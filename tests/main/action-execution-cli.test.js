import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let root;
let policyPath;
let requestPath;
let sentinel;
const require = createRequire(import.meta.url);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-execution-cli-'));
  policyPath = path.join(root, 'PRIVATE_POLICY.json');
  requestPath = path.join(root, 'PRIVATE_REQUEST.json');
  sentinel = path.join(root, 'PRIVATE_SENTINEL');
});
afterEach(() => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

function prepare(decision = 'allow', options = {}) {
  const action = {
    executable: process.execPath,
    cwd: root,
    args: [
      '-e',
      options.code ||
        `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'PRIVATE_BODY');console.log('PRIVATE_STDOUT');console.error('PRIVATE_STDERR');`,
    ],
    env:
      process.platform === 'win32'
        ? {
            SYSTEMROOT: process.env.SystemRoot,
            WINDIR: process.env.SystemRoot,
            TEMP: root,
            TMP: root,
          }
        : {},
    ...options.action,
  };
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policyPath,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
  );
  return action;
}

function launch(args = ['--action-exec-json', policyPath, requestPath]) {
  const result = spawnSync(process.execPath, ['src/main/main.js', ...args], {
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: 65536,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('PRIVATE');
  expect(result.stdout).not.toContain(root);
  const lines = result.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  return { code: result.status, report: JSON.parse(lines[0]) };
}

describe('explicit action execution Node entry', () => {
  it('rejects startup child-process debug logging before preparing or spawning an action', () => {
    prepare();
    const preparationMarker = path.join(root, 'PRIVATE_PREPARATION');
    const preload = path.join(root, 'debug-check.cjs');
    const policyModule = require.resolve('../../src/main/execution-policy');
    fs.writeFileSync(
      preload,
      `require(${JSON.stringify(policyModule)}).prepareExecution=()=>{require('node:fs').writeFileSync(${JSON.stringify(preparationMarker)},'called');throw Error('PRIVATE_PREPARATION_CALLED')};`,
    );
    const result = spawnSync(
      process.execPath,
      ['--require', preload, 'src/main/main.js', '--action-exec-json', policyPath, requestPath],
      {
        env: { ...process.env, NODE_DEBUG: 'child_process' },
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 65536,
        windowsHide: true,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('PRIVATE');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      decision: 'deny',
      reason: 'runtime-unsupported',
      execution: { state: 'not-started', exitCode: null },
    });
    expect(fs.existsSync(preparationMarker)).toBe(false);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('does not classify exited zero as success when output capture is incomplete', async () => {
    const api = require('../../src/main/action-execution');
    const incomplete = vi.spyOn(api, 'executeAction').mockResolvedValue({
      schemaVersion: 1,
      mode: 'action-exec',
      decision: 'allow',
      reason: 'child-exited',
      execution: {
        state: 'exited',
        exitCode: 0,
        outputComplete: false,
        termination: 'not-requested',
      },
      control: 'direct-child-only',
      descendantControl: 'unsupported',
    });
    try {
      expect(
        await require('../../src/main/action-execution-cli').handleActionExecutionCLI(
          ['--action-exec-json', policyPath, requestPath],
          () => {},
        ),
      ).toBe(2);
    } finally {
      incomplete.mockRestore();
    }
  });
  it('reports unknown execution state after an unexpected executor exception', async () => {
    const api = require('../../src/main/action-execution');
    const failing = vi
      .spyOn(api, 'executeAction')
      .mockRejectedValue(new Error('PRIVATE_AFTER_SPAWN'));
    const output = [];
    try {
      const code = await require('../../src/main/action-execution-cli').handleActionExecutionCLI(
        ['--action-exec-json', policyPath, requestPath],
        (text) => output.push(text),
      );
      expect(code).toBe(2);
      expect(output).toHaveLength(1);
      expect(output[0]).not.toContain('PRIVATE');
      expect(JSON.parse(output[0])).toMatchObject({
        decision: 'unknown',
        reason: 'execution-unavailable',
        execution: { state: 'unknown', exitCode: null, termination: 'unconfirmed' },
      });
    } finally {
      failing.mockRestore();
    }
  });

  it('executes an exact allow rule and emits only redacted metadata before Electron starts', () => {
    prepare();
    const result = launch();
    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({
      schemaVersion: 1,
      mode: 'action-exec',
      decision: 'allow',
      execution: { state: 'exited', exitCode: 0 },
      control: 'direct-child-only',
      descendantControl: 'unsupported',
    });
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('PRIVATE_BODY');
  });

  it.each(['deny', 'ask'])('does not spawn for an exact %s decision', (decision) => {
    prepare(decision);
    const result = launch();
    expect(result.code).toBe(2);
    expect(result.report).toMatchObject({
      decision,
      execution: { state: 'not-started', exitCode: null },
    });
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('does not spawn when the explicitly selected policy is missing', () => {
    prepare();
    fs.unlinkSync(policyPath);
    const result = launch();
    expect(result.code).toBe(2);
    expect(result.report).toMatchObject({ decision: 'deny', execution: { state: 'not-started' } });
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('does not spawn when the explicitly selected request is invalid', () => {
    prepare();
    fs.writeFileSync(requestPath, '{"PRIVATE":');
    const result = launch();
    expect(result.code).toBe(2);
    expect(result.report).toMatchObject({ decision: 'deny', execution: { state: 'not-started' } });
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('maps an allowed child nonzero exit to CLI exit 2', () => {
    prepare('allow', { code: "console.error('PRIVATE_FAILURE');process.exitCode=7;" });
    const result = launch();
    expect(result.code).toBe(2);
    expect(result.report).toMatchObject({
      decision: 'allow',
      execution: { state: 'exited', exitCode: 7 },
    });
  });

  it('passes shell metacharacters as one literal argument without shell interpretation', () => {
    const literal = `PRIVATE_LITERAL & echo PRIVATE_SHELL > "${sentinel}"`;
    const argumentFile = path.join(root, 'argument.json');
    prepare('allow', {
      action: {
        args: [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(argumentFile)},JSON.stringify(process.argv.slice(1)))`,
          literal,
        ],
      },
    });
    const result = launch();
    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(argumentFile, 'utf8'))).toEqual([literal]);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it.each(
    [[], ['PRIVATE'], ['PRIVATE', 'PRIVATE', 'PRIVATE'], ['--PRIVATE', 'PRIVATE']].map((args) => ({
      args,
    })),
  )('rejects malformed arguments $args without paths or exception output', ({ args }) => {
    const result = launch(['--action-exec-json', ...args]);
    expect(result.code).toBe(1);
    expect(result.report).toEqual({ error: 'expected-action-exec-arguments' });
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});
