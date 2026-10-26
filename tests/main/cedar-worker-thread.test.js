import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  snapshotRequest,
  metadataReply,
  evaluateRequest,
  LIMITS,
} = require('../../src/main/cedar-worker-thread');
const runtime = require('../../src/main/cedar-runtime');
const official = require('@cedar-policy/cedar-wasm/nodejs');
const action = () => ({
  executable: process.execPath,
  cwd: process.cwd(),
  args: ['PRIVATE_ARG'],
  env: { SECRET: 'PRIVATE_VALUE' },
});
const permit = 'permit(principal, action == AEGIS::Action::"exec", resource);';
const policy = (policies = { allow: permit }) => ({
  schemaVersion: 4,
  cedarSchema: 'aegis-execution-v1',
  policies,
});
const request = (policies) => ({ policy: policy(policies), action: action() });
const deny = (reason) => ({ decision: 'deny', reason, policyIds: [] });
afterEach(() => {
  runtime._resetForTest();
  vi.restoreAllMocks();
});

describe('Cedar bounded private message validation', () => {
  it('rejects admitted proxy records before any trap, including nested records and revoked proxies', () => {
    let traps = 0;
    const trap = () => {
      traps++;
      throw Error('PROXY_INSPECTED');
    };
    const proxy = (value) =>
      new Proxy(value, {
        get: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
      });
    for (const [candidatePolicy, candidateAction, reason] of [
      [policy(), proxy(action()), 'request-invalid'],
      [policy(), { ...action(), env: proxy({}) }, 'request-invalid'],
      [proxy(policy()), action(), 'policy-invalid'],
      [policy(proxy({})), action(), 'policy-invalid'],
    ])
      expect(snapshotRequest(candidatePolicy, candidateAction)).toEqual({ ok: false, reason });
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(snapshotRequest(policy(), { ...action(), args: revoked.proxy })).toEqual({
      ok: false,
      reason: 'request-invalid',
    });
    expect(traps).toBe(0);
  });

  it('rejects admitted proxy arrays before changing length reads or oversized allocation attempts', () => {
    let traps = 0;
    let lengthReads = 0;
    let allocations = 0;
    const args = new Proxy([], {
      get(target, key) {
        traps++;
        if (key === 'length') return ++lengthReads <= 2 ? 0 : 129;
        return Reflect.get(target, key);
      },
      ownKeys() {
        traps++;
        return ['length'];
      },
      getOwnPropertyDescriptor(target, key) {
        traps++;
        return key === 'length'
          ? Reflect.getOwnPropertyDescriptor(target, key)
          : { value: '', enumerable: true, configurable: true, writable: true };
      },
    });
    const from = Array.from;
    const allocation = vi.spyOn(Array, 'from').mockImplementation((value, mapper) => {
      allocations++;
      if (value.length > 128) throw Error('OVERSIZED_ALLOCATION_BLOCKED_BY_TEST');
      return from(value, mapper);
    });
    const result = snapshotRequest(policy(), { ...action(), args });
    allocation.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'request-invalid' });
    expect({ traps, lengthReads, allocations }).toEqual({
      traps: 0,
      lengthReads: 0,
      allocations: 0,
    });
    const maximum = { ...action(), args: Array(128).fill('ok') };
    expect(snapshotRequest(policy(), maximum)).toEqual({
      ok: true,
      request: { policy: policy(), action: maximum },
    });
  });

  it('rejects proxy reply records and deciding-ID arrays without traps', () => {
    let traps = 0;
    const trap = () => {
      traps++;
      throw Error('PROXY_REPLY_INSPECTED');
    };
    const proxy = (value) =>
      new Proxy(value, {
        get: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
      });
    expect(metadataReply(proxy({}), [])).toBe(null);
    expect(
      metadataReply({ decision: 'allow', reason: 'policy-allow', policyIds: proxy(['allow']) }, [
        'allow',
      ]),
    ).toBe(null);
    expect(traps).toBe(0);
  });

  it('copies policy/action into data only, independent of later mutations', () => {
    const input = request();
    const result = snapshotRequest(input.policy, input.action);
    expect(result.ok).toBe(true);
    input.policy.policies.allow = 'CHANGED';
    input.action.args[0] = 'CHANGED';
    input.action.env.SECRET = 'CHANGED';
    expect(result.request).toEqual(request());
    expect(Object.keys(result.request)).toEqual(['policy', 'action']);
  });

  it('rejects accessors and hooks without invoking them', () => {
    let invoked = 0;
    const getter = {
      get() {
        invoked++;
        throw Error('PRIVATE_GETTER');
      },
      enumerable: true,
    };
    const args = ['ok'];
    Object.defineProperty(args, '0', getter);
    const env = {};
    Object.defineProperty(env, 'SECRET', getter);
    const p = policy();
    Object.defineProperty(p.policies, 'allow', getter);
    const a = action();
    Object.defineProperty(a, 'cwd', getter);
    for (const invalid of [
      a,
      { ...action(), args },
      { ...action(), env },
      {
        ...action(),
        toJSON() {
          invoked++;
        },
      },
    ])
      expect(snapshotRequest(policy(), invalid)).toEqual({ ok: false, reason: 'request-invalid' });
    expect(snapshotRequest(p, action())).toEqual({ ok: false, reason: 'policy-invalid' });
    expect(invoked).toBe(0);
  });

  it('rejects extra authority, prototypes, symbols, sparse arrays and selected-action overflow', () => {
    const sparse = new Array(1);
    const custom = ['ok'];
    custom.extra = 'PRIVATE';
    const cyclic = action();
    cyclic.env.SECRET = cyclic;
    for (const invalid of [
      null,
      [],
      Object.create(action()),
      { ...action(), principal: 'trusted' },
      { ...action(), [Symbol('private')]: true },
      { ...action(), args: sparse },
      { ...action(), args: custom },
      { ...action(), args: Array(129).fill('ok') },
      {
        ...action(),
        env: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['ENV_' + i, 'ok'])),
      },
      { ...action(), args: ['x'.repeat(LIMITS.actionBytes)] },
      { ...action(), args: ['\0'] },
      { ...action(), cwd: 'relative' },
      cyclic,
      { ...action(), env: { NODE_V8_COVERAGE: 'PRIVATE' } },
    ])
      expect(snapshotRequest(policy(), invalid)).toEqual({ ok: false, reason: 'request-invalid' });
    const maximum = {
      ...action(),
      args: Array(128).fill('ok'),
      env: Object.fromEntries(Array.from({ length: 64 }, (_, i) => ['ENV_' + i, 'ok'])),
    };
    expect(snapshotRequest(policy(), maximum).ok).toBe(true);
  });

  it('bounds policy count, source bytes, ID format, closed envelope and JSON expansion', () => {
    const many = (count) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => ['rule_' + i, permit]));
    expect(snapshotRequest(policy(many(33)), action()).ok).toBe(true);
    expect(snapshotRequest(policy({ ['a'.repeat(64)]: permit }), action()).ok).toBe(true);
    for (const invalid of [
      policy(many(34)),
      policy({ ['a'.repeat(65)]: permit }),
      policy({ 'a/b': permit }),
      policy({ allow: 'x'.repeat(LIMITS.policyBytes + 1) }),
      policy({ allow: '\u0001'.repeat(LIMITS.policyBytes / 5) }),
      policy({ allow: null }),
      policy([]),
      { ...policy(), schemaVersion: 3 },
      { ...policy(), cedarSchema: {} },
      { ...policy(), approval: {} },
      Object.create(policy()),
    ])
      expect(snapshotRequest(invalid, action())).toEqual({ ok: false, reason: 'policy-invalid' });
    const malformed = { policy: policy(), action: action(), launch: {} };
    expect(evaluateRequest(malformed)).toEqual(deny('cedar-evaluation-failed'));
  });
});

describe('Cedar closed worker metadata', () => {
  it('accepts decision/reason pairs and sorted deciding IDs without retaining source objects', () => {
    const input = { decision: 'ask', reason: 'review-required', policyIds: ['a', 'b'] };
    const reply = metadataReply(input, ['a', 'b']);
    input.policyIds[0] = 'CHANGED';
    expect(reply).toEqual({ decision: 'ask', reason: 'review-required', policyIds: ['a', 'b'] });
    expect(metadataReply(deny('policy-deny'), [])).toEqual(deny('policy-deny'));
    for (const reason of [
      'request-invalid',
      'policy-invalid',
      'cedar-unavailable',
      'cedar-evaluation-failed',
    ])
      expect(metadataReply(deny(reason), [])).toEqual(deny(reason));
  });

  it('rejects authority, diagnostics, malformed pairs, unexpected IDs and duplicate/unsorted IDs', () => {
    const valid = { decision: 'allow', reason: 'policy-allow', policyIds: ['allow'] };
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'reason', {
      get() {
        throw Error('PRIVATE');
      },
      enumerable: true,
    });
    const sparse = new Array(1);
    for (const invalid of [
      null,
      [],
      { ...valid, launch: {} },
      { ...valid, diagnostics: 'PRIVATE' },
      { ...valid, reason: 'PRIVATE_REASON' },
      { ...valid, decision: 'deny' },
      { ...valid, decision: 'constructor' },
      { ...valid, decision: 'ask' },
      { ...valid, policyIds: [] },
      { ...valid, policyIds: ['unknown'] },
      { ...valid, policyIds: ['b', 'allow'] },
      { ...valid, policyIds: ['allow', 'allow'] },
      { ...valid, policyIds: ['../PRIVATE'] },
      { ...valid, policyIds: sparse },
      { ...valid, policyIds: Array(34).fill('allow') },
      accessor,
      { decision: 'deny', reason: 'cedar-unavailable', policyIds: ['allow'] },
    ])
      expect(metadataReply(invalid, ['allow', 'b'])).toBe(null);
  });
});

describe('Cedar thread official runtime semantics', () => {
  it('matches synchronous official allow, deny, ask, review, precedence and literal argument/environment semantics', () => {
    expect(official.getCedarVersion()).toBe('4.14.0');
    const matches =
      'permit(principal, action, resource) when { resource.args == "[\\\"PRIVATE_ARG\\\"]" && resource.env == "{\\\"SECRET\\\":\\\"PRIVATE_VALUE\\\"}" };';
    for (const policies of [
      {},
      { allow: permit },
      { deny: 'forbid(principal, action, resource);' },
      { allow: permit, deny: 'forbid(principal, action, resource);' },
      { plain: permit, ask: '@decision("ask") ' + permit },
      { plain: permit, review: '@reviewRequired("true") ' + permit },
      { literal: matches },
      { invalid: 'PRIVATE_INVALID_POLICY' },
    ]) {
      const input = request(policies);
      const compiled = runtime.compileCedarPolicy(input.policy);
      const expected = compiled.ok ? compiled.evaluate(input.action) : deny(compiled.reason);
      expect(evaluateRequest(input)).toEqual(expected);
    }
    expect(evaluateRequest(request({ literal: matches })).decision).toBe('allow');
    expect(
      evaluateRequest({
        ...request({ literal: matches }),
        action: { ...action(), args: ['CHANGED'] },
      }),
    ).toEqual(deny('policy-deny'));
    expect(evaluateRequest(request({ ask: '@decision("ask") ' + permit })).reason).toBe(
      'policy-ask',
    );
    expect(evaluateRequest(request({ review: '@reviewRequired("true") ' + permit })).reason).toBe(
      'review-required',
    );
  });

  it('denies missing/wrong official runtime and raw exceptions with closed redacted metadata', () => {
    for (const load of [
      () => {
        throw Error('PRIVATE_RUNTIME_PATH');
      },
      () => ({ getCedarVersion: () => 'WRONG_VERSION' }),
    ]) {
      runtime._setDepsForTest({ load });
      expect(evaluateRequest(request())).toEqual(deny('cedar-unavailable'));
    }
    runtime._setDepsForTest({
      load: () => ({
        ...official,
        statefulIsAuthorized() {
          throw Error('PRIVATE_EVAL');
        },
      }),
    });
    expect(evaluateRequest(request())).toEqual(deny('cedar-evaluation-failed'));
    runtime._resetForTest();
    expect(evaluateRequest(request()).decision).toBe('allow');
  });
});
