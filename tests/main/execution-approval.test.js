import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const grants = require('../../src/main/execution-approval');
const bindings = require('../../src/main/execution-binding');
const policy = require('../../src/main/execution-policy');
const runner = require('../../src/main/action-execution');
const directories = [];
const handles = [];
async function fixture(decision = 'ask') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-approval-'));
  directories.push(directory);
  const policyPath = path.join(directory, 'PRIVATE_POLICY.json');
  const requestPath = path.join(directory, 'PRIVATE_REQUEST.json');
  const action = {
    executable: process.execPath,
    cwd: directory,
    args: ['-e', "require('node:fs').writeFileSync('sentinel','ok')"],
    env:
      process.platform === 'win32'
        ? {
            SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT,
            TEMP: directory,
            TMP: directory,
          }
        : {},
  };
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
  fs.writeFileSync(
    policyPath,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
  );
  const binding = await bindings.captureExecutionBinding(policyPath, requestPath);
  handles.push(binding);
  const approval = grants.createExecutionApproval(binding);
  return {
    directory,
    policyPath,
    requestPath,
    binding,
    approval,
    run: (options = { binding, approval }) =>
      runner.executeAction(policyPath, requestPath, options),
  };
}
function fakeSpawn() {
  return vi.fn(() => {
    const child = new EventEmitter();
    child.pid = 1;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    queueMicrotask(() => {
      child.emit('exit', 0);
      child.emit('close', 0);
    });
    return child;
  });
}
afterEach(() => {
  grants._resetForTest();
  runner._resetForTest();
  for (const handle of handles.splice(0)) bindings.revokeExecutionBinding(handle);
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('private one-use execution approval', () => {
  it('is opaque, identity-bound, single-use and cannot be copied or serialized into authority', () => {
    const binding = {};
    const approval = grants.createExecutionApproval(binding);
    expect(Object.isFrozen(approval)).toBe(true);
    expect(JSON.stringify(approval)).toBe('{}');
    expect(grants.isExecutionApprovalActive(approval, {})).toBe(false);
    expect(grants.isExecutionApprovalActive({ ...approval }, binding)).toBe(false);
    expect(grants.consumeExecutionApproval(JSON.parse(JSON.stringify(approval)), binding)).toBe(
      false,
    );
    expect(grants.consumeExecutionApproval(approval, binding)).toBe(true);
    expect(grants.consumeExecutionApproval(approval, binding)).toBe(false);
  });

  it.each([null, undefined, 1, 'PRIVATE', []])('rejects nonobject binding %#', (binding) => {
    expect(() => grants.createExecutionApproval(binding)).toThrow('approval-unavailable');
  });

  it('expires at five seconds and revocation cannot be reversed', () => {
    let now = 0;
    grants._setDepsForTest({ now: () => now });
    const binding = {};
    const approval = grants.createExecutionApproval(binding);
    now = grants.LIMITS.ttlMs - 1;
    expect(grants.isExecutionApprovalActive(approval, binding)).toBe(true);
    now++;
    expect(grants.isExecutionApprovalActive(approval, binding)).toBe(false);
    now = 0;
    expect(grants.consumeExecutionApproval(approval, binding)).toBe(false);
    const revoked = grants.createExecutionApproval(binding);
    grants.revokeExecutionApproval(revoked);
    grants.revokeExecutionApproval(revoked);
    expect(grants.isExecutionApprovalActive(revoked, binding)).toBe(false);
  });
});

describe('private review preparation', () => {
  it('reveals a private launch for ask only in explicit review mode', async () => {
    const f = await fixture();
    expect(
      await policy.prepareExecution(f.policyPath, f.requestPath, { binding: f.binding }),
    ).toEqual({ decision: 'ask', reason: 'policy-ask' });
    expect(
      await policy.prepareExecution(f.policyPath, f.requestPath, {
        binding: f.binding,
        review: true,
      }),
    ).toMatchObject({ decision: 'ask', launch: { executable: process.execPath } });
    const denied = await fixture('deny');
    expect(
      await policy.prepareExecution(denied.policyPath, denied.requestPath, {
        binding: denied.binding,
        review: true,
      }),
    ).toEqual({ decision: 'deny', reason: 'policy-deny' });
  });
});

describe('approved execution mediation', () => {
  it.each(['ask', 'allow'])(
    'executes an exact %s action once and reports its original policy decision',
    async (decision) => {
      const f = await fixture(decision);
      const result = await f.run();
      expect(result).toMatchObject({
        decision: 'allow',
        authorization: 'operator-confirmed',
        policyDecision: decision,
        execution: { state: 'exited', exitCode: 0 },
      });
      expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(await f.run()).toMatchObject({
        decision: 'deny',
        reason: 'approval-unavailable',
        execution: { state: 'not-started' },
      });
    },
  );

  it('keeps normal ask calls unstarted and normal allow calls working without a grant', async () => {
    const asked = await fixture();
    expect(await asked.run({ binding: asked.binding })).toMatchObject({
      decision: 'ask',
      execution: { state: 'not-started' },
    });
    expect(fs.existsSync(path.join(asked.directory, 'sentinel'))).toBe(false);
    const allowed = await fixture('allow');
    const result = await allowed.run({ binding: allowed.binding });
    expect(result).toMatchObject({
      decision: 'allow',
      execution: { state: 'exited', exitCode: 0 },
    });
    expect(result.authorization).toBeUndefined();
  });

  it.each([null, undefined, {}])(
    'rejects explicit invalid approval %# even under an allow policy',
    async (approval) => {
      const f = await fixture('allow');
      const spawn = fakeSpawn();
      runner._setDepsForTest({ spawn });
      expect(await f.run({ binding: f.binding, approval })).toMatchObject({
        decision: 'deny',
        reason: 'approval-unavailable',
      });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('requires the original live binding and refuses missing, copied or mismatched scope', async () => {
    const first = await fixture('allow');
    const second = await fixture('allow');
    for (const options of [
      { approval: first.approval },
      { binding: {}, approval: first.approval },
      { binding: second.binding, approval: first.approval },
      { binding: first.binding, approval: { ...first.approval } },
    ])
      expect((await first.run(options)).decision).toBe('deny');
    const fake = {};
    expect(
      (await first.run({ binding: fake, approval: grants.createExecutionApproval(fake) })).decision,
    ).toBe('deny');
    bindings.revokeExecutionBinding(first.binding);
    expect((await first.run()).decision).toBe('deny');
    expect(fs.existsSync(path.join(first.directory, 'sentinel'))).toBe(false);
  });

  it('never overrides policy deny and does not consume an earlier failed attempt', async () => {
    const f = await fixture('deny');
    expect(await f.run()).toMatchObject({ decision: 'deny', execution: { state: 'not-started' } });
    expect(grants.isExecutionApprovalActive(f.approval, f.binding)).toBe(true);
    expect(fs.existsSync(path.join(f.directory, 'sentinel'))).toBe(false);
  });

  it('atomically permits only one of concurrent calls sharing a grant', async () => {
    const f = await fixture();
    const spawn = fakeSpawn();
    runner._setDepsForTest({ spawn });
    const results = await Promise.all([f.run(), f.run()]);
    expect(results.map((result) => result.decision).sort()).toEqual(['allow', 'deny']);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it.each(['expiry', 'revocation'])('refuses %s during asynchronous preparation', async (mode) => {
    let now = 0;
    grants._setDepsForTest({ now: () => now });
    const f = await fixture();
    const prepared = await policy.prepareExecution(f.policyPath, f.requestPath, {
      binding: f.binding,
      review: true,
    });
    let complete;
    const spawn = fakeSpawn();
    runner._setDepsForTest({
      spawn,
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const pending = f.run();
    await Promise.resolve();
    if (mode === 'expiry') now = grants.LIMITS.ttlMs;
    else grants.revokeExecutionApproval(f.approval);
    complete(prepared);
    expect(await pending).toMatchObject({ decision: 'deny', reason: 'approval-unavailable' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('snapshots approval and binding options before awaiting preparation', async () => {
    const f = await fixture();
    const prepared = await policy.prepareExecution(f.policyPath, f.requestPath, {
      binding: f.binding,
      review: true,
    });
    let complete;
    const spawn = fakeSpawn();
    runner._setDepsForTest({
      spawn,
      prepare: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const options = { binding: f.binding, approval: f.approval };
    const pending = f.run(options);
    options.binding = {};
    options.approval = null;
    await Promise.resolve();
    complete(prepared);
    expect((await pending).decision).toBe('allow');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('consumes the launch attempt even when spawn fails', async () => {
    const f = await fixture();
    const spawn = vi.fn(() => {
      throw new Error('PRIVATE_SPAWN_ERROR');
    });
    runner._setDepsForTest({ spawn });
    expect(await f.run()).toMatchObject({
      decision: 'allow',
      execution: { state: 'spawn-failed' },
    });
    expect((await f.run()).decision).toBe('deny');
    expect(spawn).toHaveBeenCalledOnce();
  });
});
