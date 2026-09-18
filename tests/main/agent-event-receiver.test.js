import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAgentEventReceiver, LIMITS } = require('../../src/main/agent-event-receiver');
const payload = (extra = {}) =>
  Buffer.from(
    JSON.stringify({
      hook_event_name: 'SubagentStart',
      session_id: 'PRIVATE_SESSION',
      agent_id: 'PRIVATE_AGENT',
      ...extra,
    }),
  );
const setup = () => {
  const receiver = createAgentEventReceiver();
  return { receiver, source: receiver.register('claude-code-offline') };
};

describe('receiver-owned lifecycle boundary', () => {
  it('requires the registered capability and rejects cross-receiver and serialized handles', () => {
    const { receiver, source } = setup();
    const other = createAgentEventReceiver();
    expect(receiver.register('claude-code-live')).toBeNull();
    expect(receiver.register({ adapter: 'claude-code-offline', authenticated: true })).toBeNull();
    for (const handle of [null, {}, { ...source }, source.sourceId]) {
      expect(receiver.receive(handle, 1, payload()).code).toBe('source-unavailable');
      expect(receiver.snapshot(handle)).toBeNull();
    }
    expect(other.receive(source, 1, payload()).code).toBe('source-unavailable');
    expect(receiver.receive(source, 1, payload()).status).toBe('accepted');
  });

  it('constructs only the fixed envelope and ignores forged policy, ownership and source fields', () => {
    const { receiver, source } = setup();
    const result = receiver.receive(
      source,
      1,
      payload({
        sourceId: 'PRIVATE_FORGED',
        schemaVersion: 999,
        sequence: 99,
        eventId: 'PRIVATE_EVENT',
        adapterVersion: 999,
        sourceAuthentication: 'verified',
        phase: 'before',
        decision: 'allow',
        control: 'blocking',
        pid: 999,
        instanceId: 'PRIVATE_INSTANCE',
        severity: 'critical',
        processBinding: 'bound',
        sessionRef: 'PRIVATE_REF',
        prompt: 'PRIVATE_SECRET',
      }),
    );
    expect(result.event).toEqual({
      schemaVersion: 1,
      eventId: `${source.sourceId}:1`,
      sourceId: source.sourceId,
      adapter: 'claude-code',
      adapterVersion: 1,
      phase: 'observation',
      kind: 'subagent-start',
      record: 1,
      sessionRef: `${source.sourceId}:s1`,
      agentRef: `${source.sourceId}:a1`,
      provenance: 'imported-unverified',
      sourceAuthentication: 'none',
      processBinding: 'unbound',
      transferEvidence: 'unobserved',
      activityCoverage: 'unknown',
      control: 'not-supported',
      decision: 'not-applicable',
    });
    expect(Object.isFrozen(result.event)).toBe(true);
    expect(JSON.stringify([result, receiver.snapshot(source)])).not.toContain('PRIVATE');
  });

  it('rejects replay and late delivery while retaining repeated starts at distinct ordinals', () => {
    const { receiver, source } = setup();
    const first = receiver.receive(source, 1, payload()).event;
    const repeated = receiver.receive(source, 3, payload()).event;
    expect(repeated.agentRef).toBe(first.agentRef);
    expect(repeated.eventId).not.toBe(first.eventId);
    expect(receiver.receive(source, 3, payload()).code).toBe('replayed-or-out-of-order');
    expect(receiver.receive(source, 2, payload()).code).toBe('replayed-or-out-of-order');
    expect(receiver.snapshot(source)).toMatchObject({
      lastSequence: 3,
      accepted: 2,
      missingSequences: 1,
      replayed: 2,
      rejected: 2,
      lossDetected: true,
      activityCoverage: 'unknown',
    });
  });

  it('consumes rejected ordinals and never permits a retry to rewrite them', () => {
    const { receiver, source } = setup();
    expect(receiver.receive(source, 1, Buffer.from('{PRIVATE')).code).toBe('invalid-json-record');
    expect(receiver.receive(source, 1, payload()).code).toBe('replayed-or-out-of-order');
    expect(receiver.receive(source, 2, payload()).status).toBe('accepted');
    expect(receiver.snapshot(source)).toMatchObject({ accepted: 1, lossDetected: true });
  });

  it.each([0, -1, 1.1, NaN, Infinity, '1', LIMITS.attempts + 1])(
    'rejects invalid sequence %s',
    (n) => {
      const { receiver, source } = setup();
      expect(receiver.receive(source, n, payload()).code).toBe('invalid-sequence');
      expect(receiver.snapshot(source).lastSequence).toBe(0);
    },
  );

  it('separates sessions, sources and restarted receivers and revokes closed handles', () => {
    const { receiver, source } = setup();
    const second = receiver.register('claude-code-offline');
    const restarted = setup();
    const events = [
      receiver.receive(source, 1, payload()).event,
      receiver.receive(source, 2, payload({ session_id: 'PRIVATE_SECOND' })).event,
      receiver.receive(second, 1, payload()).event,
      restarted.receiver.receive(restarted.source, 1, payload()).event,
    ];
    expect(new Set(events.map((e) => e.agentRef)).size).toBe(4);
    const summary = receiver.close(source);
    expect(summary.state).toBe('closed');
    expect(receiver.receive(source, 3, payload()).code).toBe('source-unavailable');
    summary.lastSequence = 900;
    expect(receiver.snapshot(source).lastSequence).toBe(2);
    expect(receiver.close(source)).toEqual(receiver.snapshot(source));
  });

  it('keeps receiver loss sticky and does not confuse no detected loss with full activity coverage', () => {
    const { receiver, source } = setup();
    expect(receiver.snapshot(source)).toMatchObject({
      lossDetected: false,
      activityCoverage: 'unknown',
    });
    receiver.markLoss(source);
    receiver.receive(source, 1, payload());
    expect(receiver.close(source)).toMatchObject({
      lossDetected: true,
      activityCoverage: 'unknown',
    });
    receiver.markLoss({});
    expect(receiver.close({})).toBeNull();
  });

  it('bounds source epochs even after closing each source', () => {
    const receiver = createAgentEventReceiver();
    for (let i = 0; i < LIMITS.sources; i++) {
      const source = receiver.register('claude-code-offline');
      expect(source).not.toBeNull();
      receiver.close(source);
    }
    expect(receiver.register('claude-code-offline')).toBeNull();
  });

  it('shares event budget across sources without retaining event payloads in snapshots', () => {
    const { receiver, source } = setup();
    for (let i = 1; i <= LIMITS.events; i++)
      expect(receiver.receive(source, i, payload()).status).toBe('accepted');
    receiver.close(source);
    const next = receiver.register('claude-code-offline');
    expect(receiver.receive(next, 1, payload())).toMatchObject({ code: 'event-limit', stop: true });
    expect(receiver.snapshot(source)).not.toHaveProperty('events');
  });

  it('shares identity budget across sources including closed epochs', () => {
    const { receiver, source } = setup();
    for (let i = 1; i <= LIMITS.identities / 2; i++)
      expect(receiver.receive(source, i, payload({ session_id: `session${i}` })).status).toBe(
        'accepted',
      );
    receiver.close(source);
    const next = receiver.register('claude-code-offline');
    expect(receiver.receive(next, 1, payload())).toMatchObject({
      code: 'identity-limit',
      stop: true,
    });
    expect(receiver.snapshot(next).identities).toBe(0);
  });

  it('bounds intake work including rejected attempts and preserves fixed diagnostics', () => {
    const { receiver, source } = setup();
    for (let i = 1; i <= LIMITS.attempts; i++) receiver.receive(source, i, Buffer.from('{PRIVATE'));
    expect(receiver.receive(source, 1, payload())).toMatchObject({
      code: 'attempt-limit',
      stop: true,
    });
    expect(JSON.stringify(receiver.snapshot(source))).not.toContain('PRIVATE');
  });

  it('rejects non-bytes, oversized bytes, invalid UTF-8 and unsupported action events', () => {
    const { receiver, source } = setup();
    const inputs = [
      [null, 'line-size-limit'],
      [Buffer.alloc(LIMITS.lineBytes + 1), 'line-size-limit'],
      [{ hook_event_name: 'SubagentStart' }, 'invalid-event-record'],
      [Buffer.from([0xff]), 'invalid-json-record'],
      [payload({ hook_event_name: 'PreToolUse' }), 'unsupported-event'],
      [payload({ hook_event_name: 'PostToolUse' }), 'unsupported-event'],
    ];
    inputs.forEach(([line, code], i) =>
      expect(receiver.receive(source, i + 1, line).code).toBe(code),
    );
    expect(receiver.snapshot(source)).toMatchObject({ accepted: 0, lossDetected: true });
  });
});
