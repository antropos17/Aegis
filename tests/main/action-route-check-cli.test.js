import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let root;
let policy;
let request;
let sentinel;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-route-check-'));
  policy = path.join(root, 'PRIVATE_POLICY.json');
  request = path.join(root, 'PRIVATE_REQUEST.json');
  sentinel = path.join(root, 'PRIVATE_SENTINEL');
});
afterEach(() => {
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
function prepare(decision = 'allow') {
  const action = {
    executable: process.execPath,
    cwd: root,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'PRIVATE_BODY')`],
    env: {
      PRIVATE_SECRET: 'PRIVATE_ENV_VALUE',
      ...(process.platform === 'win32'
        ? {
            SYSTEMROOT: process.env.SystemRoot,
            WINDIR: process.env.SystemRoot,
            TEMP: root,
            TMP: root,
          }
        : {}),
    },
  };
  fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policy,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
  );
  return action;
}
function run(args = ['--action-route-check-json', 'direct', policy, request], options = {}) {
  const result = spawnSync(
    process.execPath,
    [...(options.preload ? ['--require', options.preload] : []), 'src/main/main.js', ...args],
    {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 65536,
      windowsHide: true,
      env: { ...process.env, ...options.env },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('PRIVATE');
  expect(result.stdout).not.toContain(root);
  expect(result.stdout.trim().split('\n')).toHaveLength(1);
  return { code: result.status, report: JSON.parse(result.stdout) };
}

it.each(['direct', 'terminal', 'mcp-stdio', 'mcp-review'])(
  'checks actual selected files for %s without launching',
  (route) => {
    prepare();
    const terminal = ['terminal', 'mcp-review'].includes(route);
    const result = run(['--action-route-check-json', route, policy, request]);
    expect(result.code).toBe(terminal ? 2 : 0);
    expect(result.report).toMatchObject({
      schemaVersion: 1,
      mode: 'action-route-check',
      route,
      configuration: 'valid',
      policyDecision: 'allow',
      reason: 'policy-allow',
      runtime: 'supported',
      terminal: terminal ? 'unavailable' : 'not-required',
      askBehavior: terminal ? 'terminal-confirmation' : 'not-started',
      control: 'direct-child-only',
      descendantControl: 'unsupported',
      outsideRouteCoverage: 'unknown',
      connection: 'not-checked',
      blockingVerification: 'not-performed',
      executionPerformed: false,
      authorization: 'none',
    });
    expect(fs.existsSync(sentinel)).toBe(false);
  },
);

it.each(['allow', 'ask', 'deny'])(
  'valid %s configuration exits zero without granting authorization',
  (decision) => {
    prepare(decision);
    const result = run();
    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({
      configuration: 'valid',
      policyDecision: decision,
      reason: `policy-${decision}`,
      authorization: 'none',
      executionPerformed: false,
    });
    expect(fs.existsSync(sentinel)).toBe(false);
  },
);

it('reports the effective review-required decision from a real v3 policy', () => {
  const action = prepare('allow');
  fs.writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 3,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'allow' }],
      reviewRequired: [action],
    }),
  );
  const result = run();
  expect(result.code).toBe(0);
  expect(result.report).toMatchObject({
    configuration: 'valid',
    policyDecision: 'ask',
    reason: 'review-required',
    askBehavior: 'not-started',
    executionPerformed: false,
  });
  expect(fs.existsSync(sentinel)).toBe(false);
});

it.each(['policy', 'request'])(
  'reports unavailable selected %s with no private path',
  (missing) => {
    prepare();
    fs.unlinkSync(missing === 'policy' ? policy : request);
    const result = run();
    expect(result.code).toBe(2);
    expect(result.report).toMatchObject({
      configuration: 'unavailable',
      policyDecision: 'unknown',
      executionPerformed: false,
    });
    expect(fs.existsSync(sentinel)).toBe(false);
  },
);

it.each(['policy', 'request'])(
  'reports invalid selected %s without reflecting its contents',
  (invalid) => {
    prepare();
    fs.writeFileSync(invalid === 'policy' ? policy : request, '{"PRIVATE_BAD":');
    const result = run();
    expect(result.code).toBe(2);
    expect(result.report.configuration).toBe('unavailable');
    expect(result.report.reason).toBe('input-unavailable');
    expect(result.report.policyDecision).toBe('unknown');
    expect(result.report.executionPerformed).toBe(false);
    expect(fs.existsSync(sentinel)).toBe(false);
  },
);

it.each(
  [
    ['--action-route-check-json'],
    ['--action-route-check-json', 'unknown', 'PRIVATE_POLICY', 'PRIVATE_REQUEST'],
    ['--action-route-check-json', 'direct', 'PRIVATE_POLICY'],
    ['--action-route-check-json', 'direct', 'PRIVATE_POLICY', 'PRIVATE_REQUEST', 'extra'],
  ].map((args) => [args]),
)('rejects invalid arguments with a fixed error and exit one (%j)', (args) => {
  const result = run(args);
  expect(result.code).toBe(1);
  expect(typeof result.report.error).toBe('string');
  expect(Object.keys(result.report)).toEqual(['error']);
});

it.each(['policy', 'request'])('rejects structurally invalid %s schemas', (invalid) => {
  prepare();
  fs.writeFileSync(
    invalid === 'policy' ? policy : request,
    JSON.stringify({ schemaVersion: 99, PRIVATE_EXTRA: 'PRIVATE_BODY' }),
  );
  const result = run();
  expect(result.code).toBe(2);
  expect(result.report).toMatchObject({
    configuration: 'invalid',
    policyDecision: 'unknown',
    reason: invalid === 'policy' ? 'policy-invalid' : 'request-invalid',
    executionPerformed: false,
  });
  expect(fs.existsSync(sentinel)).toBe(false);
});

it('does not retain a check as permission when selected policy changes before execution', () => {
  prepare();
  expect(run().report.policyDecision).toBe('allow');
  fs.writeFileSync(
    policy,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [] }),
  );
  const execution = run(['--action-exec-json', policy, request]);
  expect(execution.code).toBe(2);
  expect(execution.report).toMatchObject({ decision: 'deny', execution: { state: 'not-started' } });
  expect(fs.existsSync(sentinel)).toBe(false);
});

it('never starts a child, network listener or confirmation owner even for allow and terminal routes', () => {
  prepare();
  const marker = path.join(root, 'SIDE_EFFECT');
  const preload = path.join(root, 'probe.cjs');
  fs.writeFileSync(
    preload,
    `const fail=()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'called');throw Error('PRIVATE_SIDE_EFFECT')};
const cp=require('node:child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=fail;
require('node:net').Server.prototype.listen=fail;
require(${JSON.stringify(require.resolve('../../src/main/action-confirmation'))}).confirmSelectedAction=fail;
require(${JSON.stringify(require.resolve('../../src/main/action-confirmation-terminal'))}).confirmInTerminal=fail;`,
  );
  for (const route of ['direct', 'terminal', 'mcp-stdio', 'mcp-review']) {
    expect(
      run(['--action-route-check-json', route, policy, request], { preload }).report.configuration,
    ).toBe('valid');
  }
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(sentinel)).toBe(false);
});

it('rejects startup child-process debug runtime with a redacted not-checked result', () => {
  prepare();
  const result = run(undefined, { env: { NODE_DEBUG: 'child_process' } });
  expect(result.code).toBe(2);
  expect(result.report).toMatchObject({
    runtime: 'unsupported',
    configuration: 'not-checked',
    policyDecision: 'unknown',
    executionPerformed: false,
  });
  expect(fs.existsSync(sentinel)).toBe(false);
});
