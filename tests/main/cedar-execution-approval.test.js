import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { createSelection } = require('../fixtures/policy-characterization/selection.cjs');
const runner = require('../../src/main/action-execution');
const grants = require('../../src/main/execution-approval');
const bindings = require('../../src/main/execution-binding');
const { prepareExecution } = require('../../src/main/execution-policy');
const runtime = require('../../src/main/cedar-runtime');
const official = require('@cedar-policy/cedar-wasm/nodejs');
const permit = 'permit(principal, action == AEGIS::Action::"exec", resource);';
let fixture;
const handles = [];
const expected = {
  allow: { decision: 'allow', reason: 'child-exited' },
  ask: { decision: 'ask', reason: 'policy-ask' },
  review: { decision: 'ask', reason: 'review-required' },
  forbid: { decision: 'deny', reason: 'policy-deny' },
};
beforeEach(() => {
  fixture = createSelection();
});
afterEach(() => {
  runner._resetForTest();
  runtime._resetForTest();
  grants._resetForTest();
  for (const handle of handles.splice(0)) bindings.revokeExecutionBinding(handle);
  fixture.cleanup();
});
async function select(mode) {
  const policies =
    mode === 'forbid'
      ? { allowed: permit, forbidden: 'forbid(principal, action, resource);' }
      : {
          selected:
            (mode === 'ask'
              ? '@decision("ask") '
              : mode === 'review'
                ? '@reviewRequired("true") '
                : '') + permit,
        };
  fixture.write({ schemaVersion: 4, cedarSchema: 'aegis-execution-v1', policies });
  const binding = await bindings.captureExecutionBinding(fixture.policyPath, fixture.requestPath);
  handles.push(binding);
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    child.pid = 1;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    child.unref = vi.fn();
    queueMicrotask(() => {
      child.emit('exit', 0);
      child.emit('close', 0);
    });
    return child;
  });
  // Keep the production prepareExecution implementation; replace only OS launch.
  runner._setDepsForTest({ spawn });
  const run = (options = {}) =>
    runner.executeAction(fixture.policyPath, fixture.requestPath, { binding, ...options });
  return { binding, spawn, run };
}

describe('Cedar execution and private one-use approval integration', () => {
  it.each(['allow', 'ask', 'review', 'forbid'])(
    'keeps unapproved %s at the actual execution boundary',
    async (mode) => {
      const selected = await select(mode);
      const result = await selected.run();
      expect(result).toMatchObject(expected[mode]);
      expect(selected.spawn).toHaveBeenCalledTimes(mode === 'allow' ? 1 : 0);
      expect(result.execution.state).toBe(mode === 'allow' ? 'exited' : 'not-started');
      expect(result.authorization).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      if (mode === 'allow') {
        const [executable, args, options] = selected.spawn.mock.calls[0];
        expect(executable).toBe(fixture.action.executable);
        expect(args).toEqual(fixture.action.args);
        expect(options).toMatchObject({ cwd: fixture.root, shell: false, windowsHide: true });
        expect(options.env.NODE_V8_COVERAGE).toBe('');
      }
    },
  );

  it.each(['ask', 'review'])(
    'accepts only boolean review for %s preparation and still requires a grant to execute',
    async (mode) => {
      const selected = await select(mode);
      for (const review of [false, 'true', true]) {
        const prepared = await prepareExecution(fixture.policyPath, fixture.requestPath, {
          binding: selected.binding,
          review,
        });
        expect(prepared.decision).toBe('ask');
        expect(prepared.reason).toBe(expected[mode].reason);
        expect(Boolean(prepared.launch)).toBe(review === true);
        const result = await selected.run({ review });
        expect(result).toMatchObject(expected[mode]);
        expect(result.execution.state).toBe('not-started');
      }
      expect(selected.spawn).not.toHaveBeenCalled();
    },
  );

  it.each(['allow', 'ask', 'review'])(
    'consumes one opaque approval for %s without promoting the original policy decision',
    async (mode) => {
      const selected = await select(mode);
      const approval = grants.createExecutionApproval(selected.binding);
      expect(JSON.stringify(approval)).toBe('{}');
      const copied = await selected.run({ approval: JSON.parse(JSON.stringify(approval)) });
      expect(copied).toMatchObject({
        decision: 'deny',
        reason: 'approval-unavailable',
        execution: { state: 'not-started' },
      });
      expect(selected.spawn).not.toHaveBeenCalled();
      expect(grants.isExecutionApprovalActive(approval, selected.binding)).toBe(true);
      const result = await selected.run({ approval });
      expect(result).toMatchObject({
        decision: 'allow',
        authorization: 'operator-confirmed',
        policyDecision: mode === 'allow' ? 'allow' : 'ask',
        execution: { state: 'exited', exitCode: 0 },
      });
      expect(selected.spawn).toHaveBeenCalledOnce();
      expect(grants.isExecutionApprovalActive(approval, selected.binding)).toBe(false);
      expect(await selected.run({ approval })).toMatchObject({
        decision: 'deny',
        reason: 'approval-unavailable',
        execution: { state: 'not-started' },
      });
      expect(selected.spawn).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    },
  );

  it('never lets an approval override a Cedar forbid', async () => {
    const selected = await select('forbid');
    const approval = grants.createExecutionApproval(selected.binding);
    expect(await selected.run({ approval })).toMatchObject({
      decision: 'deny',
      reason: 'policy-deny',
      execution: { state: 'not-started' },
    });
    expect(selected.spawn).not.toHaveBeenCalled();
    expect(grants.isExecutionApprovalActive(approval, selected.binding)).toBe(true);
    grants.revokeExecutionApproval(approval);
  });

  it('denies partial evaluation errors without spending approval and recovers through the same bound route', async () => {
    const selected = await select('ask');
    const approval = grants.createExecutionApproval(selected.binding);
    let broken = true;
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized(call) {
          return broken
            ? {
                type: 'success',
                warnings: [],
                response: {
                  decision: 'allow',
                  diagnostics: {
                    reason: ['selected'],
                    errors: [{ policyId: 'selected', error: 'PRIVATE_PARTIAL ' + fixture.root }],
                  },
                },
              }
            : official.statefulIsAuthorized(call);
        },
      }),
    });
    const result = await selected.run({ approval });
    expect(result).toMatchObject({
      decision: 'deny',
      reason: 'policy-deny',
      execution: { state: 'not-started' },
    });
    expect(selected.spawn).not.toHaveBeenCalled();
    expect(grants.isExecutionApprovalActive(approval, selected.binding)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain(fixture.root);
    broken = false;
    expect(await selected.run({ approval })).toMatchObject({
      decision: 'allow',
      authorization: 'operator-confirmed',
      policyDecision: 'ask',
      execution: { state: 'exited' },
    });
    expect(selected.spawn).toHaveBeenCalledOnce();
    expect(grants.isExecutionApprovalActive(approval, selected.binding)).toBe(false);
  });
});
