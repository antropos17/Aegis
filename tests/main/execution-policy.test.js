import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { prepareExecution } = require('../../src/main/execution-policy');
let root, policyPath, requestPath, action;
const bytes = (value) => Buffer.from(JSON.stringify(value));
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-execution-policy-'));
  policyPath = path.join(root, 'policy.json');
  requestPath = path.join(root, 'request.json');
  action = {
    executable: process.execPath,
    cwd: root,
    args: ['-e', 'PRIVATE_COMMAND'],
    env: { PRIVATE_KEY: 'PRIVATE_SECRET' },
  };
});
afterEach(() => {
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
const policy = (rules = [{ action, decision: 'allow' }]) => ({
  schemaVersion: 2,
  defaultDecision: 'deny',
  rules,
});
async function prepare(p = policy(), r = { schemaVersion: 1, action }) {
  fs.writeFileSync(policyPath, Buffer.isBuffer(p) ? p : bytes(p));
  fs.writeFileSync(requestPath, Buffer.isBuffer(r) ? r : bytes(r));
  return prepareExecution(policyPath, requestPath);
}
describe('exact direct execution preparation', () => {
  it.each(['allow', 'ask', 'deny'])(
    'preserves decision %s without a launch for nonallow',
    async (decision) => {
      const result = await prepare(policy([{ action, decision }]));
      expect(result.decision).toBe(decision);
      expect(!!result.launch).toBe(decision === 'allow');
      if (result.launch) expect(result.launch.args).toEqual(action.args);
      else expect(JSON.stringify(result)).not.toContain('PRIVATE');
    },
  );
  it.each([
    { args: ['-e', 'PRIVATE_COMMAND', 'extra'] },
    { args: ['PRIVATE_COMMAND', '-e'] },
    { env: { PRIVATE_KEY: 'changed' } },
    { env: {} },
    { env: { PRIVATE_KEY: 'PRIVATE_SECRET', EXTRA: 'yes' } },
  ])('rejects changed operation %j', async (change) => {
    expect(
      (await prepare(policy(), { schemaVersion: 1, action: { ...action, ...change } })).decision,
    ).toBe('deny');
  });
  it('compares exact executable and cwd without normalizing paths', async () => {
    for (const change of [{ executable: path.join(root, 'other.exe') }, { cwd: root + path.sep }])
      expect(
        (await prepare(policy(), { schemaVersion: 1, action: { ...action, ...change } })).decision,
      ).toBe('deny');
  });
  it('accepts key reordering but rejects duplicate equivalent policy entries', async () => {
    const reordered = {
      env: action.env,
      args: action.args,
      cwd: action.cwd,
      executable: action.executable,
    };
    expect((await prepare(policy(), { schemaVersion: 1, action: reordered })).decision).toBe(
      'allow',
    );
    expect(
      (
        await prepare(
          policy([
            { action, decision: 'allow' },
            { action: reordered, decision: 'deny' },
          ]),
        )
      ).decision,
    ).toBe('deny');
  });
  it('default ask cannot create an executable launch', async () => {
    expect(await prepare({ ...policy([]), defaultDecision: 'ask' })).toEqual({
      decision: 'ask',
      reason: 'policy-ask',
    });
  });
  it.each([
    { executable: 'relative.exe' },
    { cwd: 'relative' },
    { executable: '//server/share/app' },
    { args: ['bad\0argument'] },
    { env: { KEY: 'bad\0value' } },
    { env: { 'BAD=KEY': 'value' } },
    { env: { PATH: 'a', Path: 'b' } },
    { env: { lower_case: 'value' } },
    { env: { NODE_V8_COVERAGE: '/private-output' } },
    { args: Array(129).fill('x') },
    { env: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['KEY' + i, 'x'])) },
    { shell: true },
  ])('rejects an invalid request even when its exact invalid rule allows it', async (change) => {
    const changed = { ...action, ...change };
    expect(
      (
        await prepare(policy([{ action: changed, decision: 'allow' }]), {
          schemaVersion: 1,
          action: changed,
        })
      ).decision,
    ).toBe('deny');
  });
  it('rejects alternate schema, extra policy fields and default allow', async () => {
    for (const p of [
      { ...policy(), schemaVersion: 1 },
      { ...policy(), extra: true },
      { ...policy(), defaultDecision: 'allow' },
      policy([{ action, decision: 'modify' }]),
    ])
      expect((await prepare(p)).decision).toBe('deny');
    for (const r of [
      { schemaVersion: 2, action },
      { schemaVersion: 1, action, approved: true },
    ])
      expect((await prepare(policy(), r)).decision).toBe('deny');
  });
  it('uses explicit empty defaults and a null-prototype environment', async () => {
    const result = await prepare();
    expect(Object.getPrototypeOf(result.launch.env)).toBe(null);
    expect(result.launch.env.PRIVATE_KEY).toBe('PRIVATE_SECRET');
    expect(result.launch.env.NODE_V8_COVERAGE).toBe('');
    if (process.platform === 'win32') {
      for (const name of ['PATH', 'USERPROFILE', 'SYSTEMROOT', 'TEMP'])
        expect(result.launch.env[name]).toBe('');
    }
  });
  it('honors only policy-matched explicit environment overrides', async () => {
    action.env = { PATH: '/selected/path', NODE_V8_COVERAGE: '' };
    expect((await prepare()).launch.env.PATH).toBe('/selected/path');
  });
  it('does not cache permission across invocations or unavailable files', async () => {
    expect((await prepare()).decision).toBe('allow');
    fs.unlinkSync(policyPath);
    expect((await prepareExecution(policyPath, requestPath)).decision).toBe('deny');
    expect((await prepare(policy([]))).decision).toBe('deny');
    fs.unlinkSync(requestPath);
    expect((await prepareExecution(policyPath, requestPath)).decision).toBe('deny');
  });
  it('rejects malformed UTF8, JSON and oversized selected input', async () => {
    for (const bad of [Buffer.from([0xff]), Buffer.from('{'), Buffer.alloc(65537, 32)]) {
      expect((await prepare(policy(), bad)).decision).toBe('deny');
      expect((await prepare(bad)).decision).toBe('deny');
    }
  });
  it.skipIf(process.platform !== 'win32')(
    'rejects drive-relative roots and device/stream targets',
    async () => {
      for (const executable of [
        '\\app.exe',
        'C:app.exe',
        '\\\\?\\C:\\app.exe',
        'C:\\app.exe:stream',
      ]) {
        action.executable = executable;
        expect((await prepare()).decision).toBe('deny');
      }
    },
  );
});
