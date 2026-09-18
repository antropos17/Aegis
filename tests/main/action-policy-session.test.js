import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-policy-session');
const sessions = [];
const directories = [];
const json = (value) => Buffer.from(JSON.stringify(value));
const event = (extra = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 'PRIVATE_SESSION',
  tool_use_id: 'PRIVATE_TOOL',
  tool_name: 'Bash',
  cwd: process.cwd(),
  tool_input: { command: 'echo PRIVATE_COMMAND', timeout: 1000 },
  ...extra,
});
const post = (extra = {}) => event({ hook_event_name: 'PostToolUse', ...extra });
function session(evaluate = async () => ({ decision: 'allow', reason: 'policy-allow' })) {
  api._setDepsForTest({ evaluate });
  const instance = api.createActionPolicySession({ policyPath: 'PRIVATE_POLICY_PATH' });
  sessions.push(instance);
  return instance;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  for (const instance of sessions.splice(0)) instance.close();
  api._resetForTest();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('source-scoped before/after action linkage', () => {
  it.each(['allow', 'ask', 'deny'])(
    'links reported outcome to %s without implying approval',
    async (decision) => {
      const s = session(async () => ({ decision, reason: `policy-${decision}` }));
      const before = await s.before(json(event()));
      expect(before).toMatchObject({ decision });
      expect(typeof before.actionRef).toBe('string');
      expect(
        s.after(json(post({ tool_response: { secret: 'PRIVATE_OUTPUT' }, approved: true }))),
      ).toMatchObject({
        status: 'linked',
        actionRef: before.actionRef,
        decision,
        outcome: 'reported-completed',
      });
      expect(JSON.stringify(s.snapshot())).not.toMatch(/PRIVATE|approved|blocking-verified/);
      expect(s.after(json(post())).status).toBe('rejected');
    },
  );

  it('links failures separately from completed reports', async () => {
    const s = session();
    const before = await s.before(json(event()));
    expect(
      s.after(json(post({ hook_event_name: 'PostToolUseFailure', error: 'PRIVATE_ERROR' }))),
    ).toMatchObject({
      status: 'linked',
      actionRef: before.actionRef,
      decision: 'allow',
      outcome: 'reported-failed',
    });
    expect(JSON.stringify(s.close())).not.toContain('PRIVATE');
  });

  it('scopes repeated tool IDs by session and creates fresh source epochs', async () => {
    const first = session();
    const second = session();
    const a = await first.before(json(event()));
    const b = await first.before(json(event({ session_id: 'PRIVATE_OTHER_SESSION' })));
    const c = await second.before(json(event()));
    expect(new Set([a.actionRef, b.actionRef, c.actionRef]).size).toBe(3);
    expect(first.snapshot().sourceId).not.toBe(second.snapshot().sourceId);
    expect(first.after(json(post({ session_id: 'PRIVATE_OTHER_SESSION' }))).actionRef).toBe(
      b.actionRef,
    );
    expect(first.after(json(post())).actionRef).toBe(a.actionRef);
  });

  it('compares complete input with key-order independence', async () => {
    const s = session();
    const tool_input = { command: 'PRIVATE', nested: { x: 1, y: [2, null] } };
    const before = await s.before(json(event({ tool_input })));
    const reordered = { nested: { y: [2, null], x: 1 }, command: 'PRIVATE' };
    expect(s.after(json(post({ tool_input: reordered })))).toMatchObject({
      status: 'linked',
      actionRef: before.actionRef,
    });
  });

  it.each([
    { cwd: process.cwd() + path.sep },
    { tool_input: { command: 'echo PRIVATE_COMMAND', timeout: 1001 } },
    { tool_input: { command: 'echo PRIVATE_COMMAND', timeout: 1000, extra: true } },
    { tool_input: { command: 'echo PRIVATE_COMMAND' } },
  ])('consumes mismatched after %# so a corrected retry cannot rewrite history', async (extra) => {
    const s = session();
    await s.before(json(event()));
    expect(s.after(json(post(extra))).status).toBe('rejected');
    expect(s.after(json(post())).status).toBe('rejected');
    expect((await s.before(json(event()))).decision).toBe('deny');
    expect(s.snapshot().lossDetected).toBe(true);
  });

  it('rejects after without before and does not manufacture an action', () => {
    const s = session();
    expect(s.after(json(post())).status).toBe('rejected');
    expect(s.snapshot().actions).toHaveLength(0);
    expect(s.snapshot().lossDetected).toBe(true);
  });

  it.each([Buffer.from('{'), json(post({ tool_name: 'Write' }))])(
    'revokes correlation after an unidentifiable or unsupported after record %#',
    async (raw) => {
      const s = session();
      await s.before(json(event()));
      expect(s.after(raw).status).toBe('rejected');
      expect(s.after(json(post())).status).toBe('rejected');
      expect(s.snapshot()).toMatchObject({ closed: true, lossDetected: true });
    },
  );

  it('rejects malformed or unsupported before without consulting policy', async () => {
    const evaluate = vi.fn();
    const s = session(evaluate);
    for (const raw of [
      Buffer.from('{'),
      json(event({ tool_name: 'Write' })),
      json(event({ session_id: '' })),
      json(post()),
    ])
      expect((await s.before(raw)).decision).toBe('deny');
    expect(evaluate).not.toHaveBeenCalled();
    expect(s.snapshot().actions).toHaveLength(0);
    expect(s.snapshot().lossDetected).toBe(true);
  });

  it('uses the production policy evaluator when no test dependency is set', async () => {
    api._resetForTest();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-session-policy-'));
    directories.push(directory);
    const policyPath = path.join(directory, 'policy.json');
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 1,
        cwd: process.cwd(),
        defaultDecision: 'deny',
        rules: [{ tool: 'Bash', input: event().tool_input, decision: 'ask' }],
      }),
    );
    const s = api.createActionPolicySession({ policyPath });
    sessions.push(s);
    expect((await s.before(json(event()))).decision).toBe('ask');
    expect(s.after(json(post()))).toMatchObject({ status: 'linked', decision: 'ask' });
  });
});

describe('action linkage races, expiry and privacy', () => {
  it('reserves IDs before evaluation and invalidates a pending duplicate', async () => {
    const d = deferred();
    const evaluate = vi.fn(() => d.promise);
    const s = session(evaluate);
    const pending = s.before(json(event()));
    await Promise.resolve();
    expect((await s.before(json(event()))).decision).toBe('deny');
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
    expect((await pending).decision).toBe('deny');
    expect(evaluate).toHaveBeenCalledOnce();
    expect(s.after(json(post())).status).toBe('rejected');
  });

  it('never authorizes after a post arrives while evaluation is pending', async () => {
    const d = deferred();
    const s = session(() => d.promise);
    const pending = s.before(json(event()));
    expect(s.after(json(post())).status).toBe('rejected');
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
    expect((await pending).decision).toBe('deny');
    expect(s.after(json(post())).status).toBe('rejected');
  });

  it('denies decision timeout and ignores a late evaluator success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const d = deferred();
    const s = session(() => d.promise);
    const pending = s.before(json(event()));
    await vi.advanceTimersByTimeAsync(api.LIMITS.decisionMs);
    expect((await pending).decision).toBe('deny');
    d.resolve({ decision: 'allow', reason: 'PRIVATE_REASON' });
    await Promise.resolve();
    expect(s.after(json(post())).status).toBe('rejected');
    expect(JSON.stringify(s.snapshot())).not.toContain('PRIVATE');
  });

  it('keeps one lifecycle deadline and tombstones an expired action', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const s = session();
    await s.before(json(event()));
    await vi.advanceTimersByTimeAsync(api.LIMITS.ttlMs);
    expect(s.after(json(post())).status).toBe('rejected');
    expect((await s.before(json(event()))).decision).toBe('deny');
    expect(s.snapshot().lossDetected).toBe(true);
    expect(JSON.stringify(s.snapshot())).not.toContain('PRIVATE');
  });

  it('starts lifecycle expiry at before admission rather than evaluator completion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const d = deferred();
    const s = session(() => d.promise);
    const pending = s.before(json(event()));
    await vi.advanceTimersByTimeAsync(1000);
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
    expect((await pending).decision).toBe('allow');
    await vi.advanceTimersByTimeAsync(api.LIMITS.ttlMs - 1000);
    expect(s.after(json(post())).status).toBe('rejected');
  });

  it('does not treat a missing after for a denied action as lost execution evidence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const s = session(async () => ({ decision: 'deny', reason: 'policy-deny' }));
    await s.before(json(event()));
    await vi.advanceTimersByTimeAsync(api.LIMITS.ttlMs);
    expect(s.snapshot().lossDetected).toBe(false);
    expect(s.close().lossDetected).toBe(false);
  });

  it('owns request bytes before asynchronous evaluation so caller mutation cannot alter the decision', async () => {
    let evaluated;
    const s = session(async (_filename, buffer) => {
      evaluated = JSON.parse(buffer.toString());
      return { decision: 'allow', reason: 'policy-allow' };
    });
    const raw = json(event());
    const pending = s.before(raw);
    raw.fill(0);
    expect((await pending).decision).toBe('allow');
    expect(evaluated.tool_input).toEqual(event().tool_input);
    expect(s.after(json(post())).status).toBe('linked');
  });

  it('close resolves in-flight decisions as deny and rejects future intake', async () => {
    const d = deferred();
    const s = session(() => d.promise);
    const pending = s.before(json(event()));
    expect(s.close()).toMatchObject({ closed: true });
    expect((await pending).decision).toBe('deny');
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
    expect((await s.before(json(event({ tool_use_id: 'new' })))).decision).toBe('deny');
    expect(s.after(json(post())).status).toBe('rejected');
    expect(JSON.stringify(s.snapshot())).not.toContain('PRIVATE');
  });

  it('clears owned raw request bytes on close even when evaluation has not settled', async () => {
    const d = deferred();
    let owned;
    const s = session((_filename, buffer) => {
      owned = buffer;
      return d.promise;
    });
    const pending = s.before(json(event()));
    await Promise.resolve();
    expect(owned.toString()).toContain('PRIVATE');
    s.close();
    expect((await pending).decision).toBe('deny');
    expect(owned.every((byte) => byte === 0)).toBe(true);
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
  });

  it('returns detached metadata snapshots', async () => {
    const s = session();
    const before = await s.before(json(event()));
    const snapshot = s.snapshot();
    snapshot.actions.length = 0;
    snapshot.usage.attempts = -100;
    expect(s.snapshot().actions).toHaveLength(1);
    expect(s.after(json(post())).actionRef).toBe(before.actionRef);
  });

  it.each([null, { decision: 'defer' }, { decision: 'allow', reason: 'PRIVATE_REASON' }])(
    'handles unexpected evaluator output %# without leaking it',
    async (result) => {
      const s = session(async () => result);
      const before = await s.before(json(event()));
      expect(JSON.stringify([before, s.snapshot()])).not.toContain('PRIVATE');
      if (!result || result.decision === 'defer') expect(before.decision).toBe('deny');
    },
  );

  it('denies evaluator exceptions without raw errors', async () => {
    const s = session(async () => {
      throw new Error('PRIVATE_EXCEPTION');
    });
    expect((await s.before(json(event()))).decision).toBe('deny');
    expect(JSON.stringify(s.snapshot())).not.toContain('PRIVATE');
  });
});

describe('session lifetime resource limits', () => {
  it('does not replenish concurrency when timed-out evaluators remain unresolved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const d = deferred();
    const evaluate = vi.fn(() => d.promise);
    const s = session(evaluate);
    const pending = Array.from({ length: api.LIMITS.concurrent }, (_, i) =>
      s.before(json(event({ tool_use_id: String(i) }))),
    );
    await vi.advanceTimersByTimeAsync(api.LIMITS.decisionMs);
    expect((await Promise.all(pending)).every((result) => result.decision === 'deny')).toBe(true);
    expect((await s.before(json(event({ tool_use_id: 'new-after-timeout' })))).decision).toBe(
      'deny',
    );
    expect(evaluate).toHaveBeenCalledTimes(api.LIMITS.concurrent);
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
  });

  it('bounds concurrent evaluation before admitting more work', async () => {
    const d = deferred();
    const evaluate = vi.fn(() => d.promise);
    const s = session(evaluate);
    const pending = Array.from({ length: api.LIMITS.concurrent }, (_, i) =>
      s.before(json(event({ tool_use_id: String(i) }))),
    );
    await Promise.resolve();
    expect((await s.before(json(event({ tool_use_id: 'overflow' })))).decision).toBe('deny');
    expect(evaluate).toHaveBeenCalledTimes(api.LIMITS.concurrent);
    s.close();
    expect((await Promise.all(pending)).every((result) => result.decision === 'deny')).toBe(true);
    d.resolve({ decision: 'allow', reason: 'policy-allow' });
  });

  it('does not replenish action capacity when completed actions become tombstones', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'allow', reason: 'policy-allow' }));
    const s = session(evaluate);
    for (let i = 0; i < api.LIMITS.actions; i++) {
      const extra = { tool_use_id: String(i) };
      expect((await s.before(json(event(extra)))).decision).toBe('allow');
      expect(s.after(json(post(extra))).status).toBe('linked');
    }
    expect((await s.before(json(event({ tool_use_id: 'overflow' })))).decision).toBe('deny');
    expect(evaluate).toHaveBeenCalledTimes(api.LIMITS.actions);
    expect(s.snapshot().actions.length).toBeLessThanOrEqual(api.LIMITS.actions);
    expect(s.snapshot().lossDetected).toBe(true);
  });

  it('charges malformed attempts against the lifetime budget', async () => {
    const evaluate = vi.fn();
    const s = session(evaluate);
    for (let i = 0; i < api.LIMITS.attempts; i++) await s.before(Buffer.from('{'));
    expect((await s.before(json(event()))).decision).toBe('deny');
    expect(evaluate).not.toHaveBeenCalled();
    expect(s.snapshot().lossDetected).toBe(true);
  });

  it('bounds cumulative input bytes before the action capacity is reached', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'allow', reason: 'policy-allow' }));
    const s = session(evaluate);
    const extra = { tool_input: { command: 'P'.repeat(60000) } };
    const count = Math.ceil(api.LIMITS.bytes / 60000) + 1;
    let denied = 0;
    for (let i = 0; i < count; i++) {
      const result = await s.before(json(event({ ...extra, tool_use_id: String(i) })));
      denied += Number(result.decision === 'deny');
    }
    expect(denied).toBeGreaterThan(0);
    expect(evaluate.mock.calls.length).toBeLessThan(count);
    expect(s.snapshot().lossDetected).toBe(true);
    expect(JSON.stringify(s.snapshot())).not.toContain('PPPP');
  });
});
