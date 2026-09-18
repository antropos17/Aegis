import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let owned, catalog, actions;
beforeEach(() => {
  owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-catalog-check-'));
  catalog = path.join(owned, 'PRIVATE_CATALOG.json');
  actions = ['allow', 'ask', 'deny'].map((decision) => {
    const action = {
      executable: process.execPath,
      cwd: owned,
      args: ['-e', `require('node:fs').writeFileSync('PRIVATE_SENTINEL','PRIVATE_BODY')`],
      env: {
        PRIVATE_ENV: 'PRIVATE_SECRET',
        TEMP: owned,
        TMP: owned,
        ...(process.platform === 'win32'
          ? {
              SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT,
              WINDIR: process.env.WINDIR || process.env.SystemRoot,
            }
          : {}),
      },
    };
    const entry = {
      id: decision,
      policyPath: path.join(owned, 'PRIVATE_' + decision + '_policy.json'),
      requestPath: path.join(owned, 'PRIVATE_' + decision + '_request.json'),
    };
    fs.writeFileSync(
      entry.policyPath,
      JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
    );
    fs.writeFileSync(entry.requestPath, JSON.stringify({ schemaVersion: 1, action }));
    return entry;
  });
  fs.writeFileSync(catalog, JSON.stringify({ schemaVersion: 1, actions }));
});
afterEach(() => {
  expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
  fs.rmSync(owned, { recursive: true, force: true });
});
function run(args = ['--action-catalog-check-json', 'mcp-stdio', catalog], options = {}) {
  const env = { TEMP: owned, TMP: owned };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR'])
    if (process.env[key]) env[key] = process.env[key];
  const child = spawnSync(
    process.execPath,
    [...(options.preload ? ['--require', options.preload] : []), 'src/main/main.js', ...args],
    {
      env: { ...env, ...options.env },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 65536,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.stderr).toBe('');
  expect(child.stdout).not.toContain('PRIVATE');
  expect(child.stdout).not.toContain(owned);
  expect(child.stdout).not.toContain(owned.replaceAll('\\', '\\\\'));
  expect(child.stdout.trim().split('\n')).toHaveLength(1);
  expect(fs.existsSync(path.join(owned, 'PRIVATE_SENTINEL'))).toBe(false);
  return { code: child.status, report: JSON.parse(child.stdout) };
}

it('checks mixed allow/ask/deny without executing, binding or granting approval', () => {
  const result = run();
  expect(result.code).toBe(0);
  expect(result.report).toMatchObject({
    schemaVersion: 1,
    mode: 'action-catalog-check',
    route: 'mcp-stdio',
    configuration: 'valid',
    policyDecision: 'unknown',
    runtime: 'supported',
    terminal: 'not-required',
    configurationObservation: 'bounded-revision-check-not-retained',
    executionPerformed: false,
    authorization: 'none',
    connection: 'not-checked',
    blockingVerification: 'not-performed',
  });
  expect(result.report.actions).toEqual(
    ['allow', 'ask', 'deny'].map((decision) => ({
      name: 'aegis_action_' + decision,
      configuration: 'valid',
      policyDecision: decision,
      reason: 'policy-' + decision,
    })),
  );
});

it('reports review terminal unavailable on actual pipe stdio while still checking configuration', () => {
  const result = run(['--action-catalog-check-json', 'mcp-review', catalog]);
  expect(result.code).toBe(2);
  expect(result.report).toMatchObject({
    route: 'mcp-review',
    configuration: 'valid',
    terminal: 'unavailable',
    policyDecision: 'unknown',
    executionPerformed: false,
    authorization: 'none',
  });
  expect(result.report.actions).toHaveLength(3);
});

it.each(['policyPath', 'requestPath'])('reports invalid selected member %s', (key) => {
  fs.writeFileSync(actions[1][key], JSON.stringify({ schemaVersion: 99, PRIVATE_DATA: true }));
  const result = run();
  expect(result.code).toBe(2);
  expect(result.report.configuration).toBe('invalid');
  expect(result.report.policyDecision).toBe('unknown');
  expect(result.report.actions.find((a) => a.name === 'aegis_action_ask')).toMatchObject({
    configuration: 'invalid',
    policyDecision: 'unknown',
  });
});

it.each(['policyPath', 'requestPath'])('reports missing selected member %s', (key) => {
  fs.unlinkSync(actions[1][key]);
  const result = run();
  expect(result.code).toBe(2);
  expect(result.report.configuration).toBe('unavailable');
  expect(result.report.policyDecision).toBe('unknown');
});

it.each(['missing', 'malformed', 'schema', 'duplicate', 'relative', 'extra'])(
  'rejects %s catalog without echoing contents',
  (kind) => {
    if (kind === 'missing') fs.unlinkSync(catalog);
    else if (kind === 'malformed') fs.writeFileSync(catalog, '{"PRIVATE_BROKEN":');
    else {
      const value = { schemaVersion: 1, actions };
      if (kind === 'schema') value.schemaVersion = 99;
      if (kind === 'duplicate') value.actions = [actions[0], actions[0]];
      if (kind === 'relative') value.actions[0].policyPath = './PRIVATE_POLICY';
      if (kind === 'extra') value.PRIVATE_FIELD = true;
      fs.writeFileSync(catalog, JSON.stringify(value));
    }
    const result = run();
    expect(result.code).toBe(2);
    expect(['invalid', 'unavailable']).toContain(result.report.configuration);
    expect(result.report.actions).toEqual([]);
    expect(result.report.policyDecision).toBe('unknown');
  },
);

it.each(
  [
    ['--action-catalog-check-json'],
    ['--action-catalog-check-json', 'direct', 'PRIVATE_CATALOG'],
    ['--action-catalog-check-json', 'mcp-stdio'],
    ['--action-catalog-check-json', 'mcp-stdio', 'PRIVATE_CATALOG', 'extra'],
  ].map((args) => [args]),
)('rejects invalid CLI arguments %#', (args) => {
  const result = run(args);
  expect(result.code).toBe(1);
  expect(result.report).toEqual({ error: 'expected-action-catalog-check-arguments' });
});

it('never spawns, prompts or listens for either route even for an allowed member', () => {
  const marker = path.join(owned, 'SIDE_EFFECT');
  const preload = path.join(owned, 'probe.cjs');
  fs.writeFileSync(
    preload,
    `const fail=()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'called');throw Error('PRIVATE_SIDE_EFFECT')};
const cp=require('node:child_process');for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=fail;
require('node:net').Server.prototype.listen=fail;
require(${JSON.stringify(require.resolve('../../src/main/action-confirmation'))}).confirmSelectedAction=fail;
require(${JSON.stringify(require.resolve('../../src/main/action-confirmation-terminal'))}).confirmInTerminal=fail;`,
  );
  for (const route of ['mcp-stdio', 'mcp-review']) {
    expect(
      run(['--action-catalog-check-json', route, catalog], { preload }).report.configuration,
    ).toBe('valid');
  }
  expect(fs.existsSync(marker)).toBe(false);
});

it('rejects cached startup debug before reading private catalog or members', () => {
  const marker = path.join(owned, 'READ_ATTEMPT');
  const preload = path.join(owned, 'read-probe.cjs');
  fs.writeFileSync(
    preload,
    `require(${JSON.stringify(require.resolve('../../src/main/action-policy'))}).readActionFile=async()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'read');throw Error('PRIVATE_READ')};delete process.env.NODE_DEBUG;`,
  );
  const result = run(undefined, { preload, env: { NODE_DEBUG: 'child_process' } });
  expect(result.code).toBe(2);
  expect(result.report).toMatchObject({
    runtime: 'unsupported',
    configuration: 'not-checked',
    policyDecision: 'unknown',
    actions: [],
    executionPerformed: false,
  });
  expect(fs.existsSync(marker)).toBe(false);
});

it('does not grant execution after a checked allow policy changes to deny', () => {
  expect(run().code).toBe(0);
  fs.writeFileSync(
    actions[0].policyPath,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [] }),
  );
  const executed = run(['--action-exec-json', actions[0].policyPath, actions[0].requestPath]);
  expect(executed.code).toBe(2);
  expect(executed.report).toMatchObject({ decision: 'deny', execution: { state: 'not-started' } });
});
