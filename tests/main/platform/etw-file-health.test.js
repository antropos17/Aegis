import { describe, it, expect } from 'vitest';
import model from '../../../src/main/platform/etw-file-health.js';
import protocol from '../../../src/main/platform/etw-file-protocol.js';
import { message, telemetry, observation, rawFrame } from './etw-file-fixtures.js';

const { createSession, reduceSession, failSession } = model;
function running(sample = telemetry()) {
  const start = createSession('launch-1', 'session-1');
  const hello = reduceSession(start, message(), 10);
  const ready = message('ready', '2');
  ready.data.telemetry = sample;
  return reduceSession(hello, ready, 20);
}
function report(state, sample, now = 30, seq = String(BigInt(state.lastSeq) + 1n)) {
  return reduceSession(state, message('health', seq, sample), now);
}
function losses(eventsLost, realTimeBuffersLost = '0', logBuffersLost = '0') {
  return telemetry({
    counters: { ...telemetry().counters, eventsLost, realTimeBuffersLost, logBuffersLost },
  });
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

describe('offline ETW session health', () => {
  it('starts without claiming a success and keeps the diagnostic profile degraded', () => {
    const fresh = createSession('launch-1', 'session-1');
    expect(fresh.record).toMatchObject({ state: 'STARTING', lastSuccessAt: null, lossCount: 0 });
    const live = running();
    expect(live.record).toMatchObject({ state: 'DEGRADED', lastSuccessAt: 20, lossCount: 0 });
    expect(live.reasons).toEqual(['experimental-correlation']);
  });

  it('counts only EventsLost deltas, including the first total and repeated samples', () => {
    const first = running(losses('5', '3', '2'));
    const same = report(first, losses('5', '3', '2'));
    const higher = report(same, losses('8', '9', '4'), 40);
    expect([first, same, higher].map((s) => s.record.lossCount)).toEqual([5, 5, 8]);
    expect(higher.latest.counters).toMatchObject({
      eventsLost: '8',
      realTimeBuffersLost: '9',
      logBuffersLost: '4',
    });
    expect(higher.record.lastSuccessAt).toBe(40);
  });

  it.each(['realTimeBuffersLost', 'logBuffersLost'])(
    'retains buffer-only loss %s without inventing lost events',
    (field) => {
      const sample = losses('0');
      sample.counters[field] = '4';
      const state = report(running(), sample);
      expect(state.record.lossCount).toBe(0);
      expect(state.sticky).toContain(field);
      expect(state.record.state).toBe('DEGRADED');
      const recovered = report(state, losses('0'));
      expect(recovered.sticky).toContain(field);
      expect(recovered.sticky).toContain('counter-regressed');
    },
  );

  it.each([
    'dropped',
    'ingressDropped',
    'outputDropped',
    'decoderErrors',
    'mapResets',
    'mapConflicts',
  ])('retains %s across successful callbacks', (field) => {
    const sample = telemetry();
    sample.totals[field] = '1';
    if (field === 'dropped') sample.totals.ingressDropped = '1';
    if (field === 'ingressDropped' || field === 'outputDropped') sample.totals.dropped = '1';
    const state = report(running(), sample);
    expect(state.record.lossCount).toBe(0);
    expect(state.sticky).toContain(field);
    const next = report(state, telemetry(), 40);
    expect(next.record.state).toBe('DEGRADED');
    expect(next.sticky).toContain(field);
    expect(next.record.lastSuccessAt).toBe(40);
  });

  it.each(['eventsLost', 'realTimeBuffersLost', 'logBuffersLost'])(
    'keeps a gap when the %s query was unavailable',
    (field) => {
      const sample = telemetry();
      sample.counters[field] = null;
      const missing = report(running(), sample);
      expect(missing.latest.counters[field]).toBeNull();
      const recovered = report(missing, telemetry(), 40);
      expect(recovered.sticky).toContain('unmeasured-interval');
      expect(recovered.record.state).toBe('DEGRADED');
    },
  );

  it('never trusts numeric values accompanying a failed native query', () => {
    const sample = losses('100');
    sample.counters.queryStatus = 5;
    const state = report(running(losses('3')), sample);
    expect(state.record.lossCount).toBe(3);
    expect(state.latest.counters.queryStatus).toBe(5);
    expect(state.sticky).toContain('unmeasured-interval');
    expect(report(state, losses('4')).record.lossCount).toBe(4);
  });

  it('holds the counter high-water mark through a decrease without double counting recovery', () => {
    const first = running(losses('10'));
    const decreased = report(first, losses('2'));
    const recovered = report(decreased, losses('12'));
    expect([first, decreased, recovered].map((s) => s.record.lossCount)).toEqual([10, 10, 12]);
    expect(recovered.sticky).toContain('counter-regressed');
  });

  it('retains exact uint64 totals while saturating only the health number', () => {
    const state = running(losses('18446744073709551615'));
    expect(state.record.lossCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(state.lossSaturated).toBe(true);
    expect(state.maxima.eventsLost).toBe('18446744073709551615');
    expect(report(state, losses('18446744073709551615')).record.lossCount).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('detects regressed QPC without interpreting receipt time as event time', () => {
    const sample = telemetry();
    sample.counters.asOfQpc = '99';
    const state = report(running(), sample, 1);
    expect(state.sticky).toContain('counter-time-regressed');
    expect(state.lastQueryQpc).toBe('100');
    expect(state.latest.counters.asOfQpc).toBe('99');
  });

  it('rejects foreign or replayed messages without mutating the current record', () => {
    const state = freeze(running(losses('3')));
    const before = JSON.stringify(state);
    for (const invalid of [
      { ...message('health', '3'), sessionId: 'old' },
      { ...message('health', '3'), launchId: 'old' },
      message('health', '2'),
    ])
      expect(() => reduceSession(state, invalid, 30)).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('makes transport gaps sticky while event gaps alone may reflect filtering', () => {
    const skipped = report(running(), telemetry(), 30, '4');
    expect(skipped.sticky).toContain('transport-gap');
    const event = reduceSession(
      running(),
      message('observations', '3', { records: [observation({ eventSeq: '20' })] }),
      30,
    );
    expect(event.sticky).not.toContain('transport-gap');
    expect(event.lastEventSeq).toBe('20');
    expect(() => reduceSession(event, message('observations', '4'), 40)).toThrow('event-replayed');
  });

  it('enforces hello/ready ordering and terminal failure', () => {
    const fresh = createSession('launch-1', 'session-1');
    expect(() => reduceSession(fresh, message('ready', '1'), 1)).toThrow('hello-required');
    const hello = reduceSession(fresh, message(), 1);
    expect(() => reduceSession(hello, message('health', '2'), 2)).toThrow('ready-required');
    expect(() => reduceSession(hello, message('hello', '2'), 2)).toThrow('unexpected-hello');
    expect(() => reduceSession(running(), message('ready', '3'), 30)).toThrow('unexpected-ready');
    expect(() => reduceSession(running(), message('stop', '3'), 30)).toThrow('wrong-direction');
    const failed = report(running(losses('3')), telemetry({ operational: false }));
    expect(failed.record.lastSuccessAt).toBe(20);
    expect(failed.phase).toBe('failed');
    expect(() => report(failed, telemetry())).toThrow('session-terminal');
  });

  it('does not borrow the old session counters or accept its frames after restart', () => {
    const old = failSession(running(losses('7')), 40, 'stream-ended');
    const fresh = createSession('launch-2', 'session-2');
    expect(fresh.record.lossCount).toBe(0);
    expect(old.record.lossCount).toBe(7);
    expect(() => reduceSession(fresh, message('health', '3'), 50)).toThrow('session-mismatch');
  });

  it('copies retained telemetry and never mutates frozen inputs', () => {
    const state = freeze(running());
    const frame = freeze(message('health', '3', losses('2')));
    const next = reduceSession(state, frame, 30);
    next.latest.counters.eventsLost = '999';
    expect(frame.data.counters.eventsLost).toBe('2');
    expect(state.record.lossCount).toBe(0);
    expect(next.maxima.eventsLost).toBe('2');
  });

  it('requires stop/drain evidence, keeps final losses, and treats post-stop EOF idempotently', () => {
    const done = message('stopped', '3');
    done.data.telemetry = losses('6');
    const state = reduceSession(running(), done, 30);
    expect(state.phase).toBe('stopped');
    expect(state.record).toMatchObject({ state: 'DEGRADED', lossCount: 6 });
    expect(failSession(state, 40, 'stream-ended')).toBe(state);
    const bad = message('stopped', '3');
    bad.data.drained = false;
    expect(reduceSession(running(), bad, 30).record.lastError).toBe('stop-unverified');
    expect(failSession(running(), 30, 'stream-ended').record.state).toBe('FAILED');
    expect(() => reduceSession(state, message('health', '4'), 40)).toThrow('session-terminal');
  });

  it('retains final query unavailability and catches a regressed final event sequence', () => {
    const sample = message('stopped', '3');
    sample.data.telemetry.counters.eventsLost = null;
    expect(reduceSession(running(), sample, 30).sticky).toContain('unmeasured-interval');
    const state = reduceSession(
      running(),
      message('observations', '3', { records: [observation({ eventSeq: '5' })] }),
      30,
    );
    expect(() => reduceSession(state, message('stopped', '4'), 40)).toThrow(
      'final-sequence-regressed',
    );
  });

  it('bounds reason accumulation and rejects arbitrary error text', () => {
    let state = running(losses('1'));
    for (let i = 0; i < 100; i++) state = report(state, losses('1'));
    expect(state.sticky).toEqual(['eventsLost']);
    expect(() => failSession(state, 30, 'X:/secret')).toThrow('invalid-error-code');
    expect(() => report(state, telemetry(), NaN)).toThrow('invalid-time');
  });

  it('streams diagnostic candidates through the real codec/reducer without producing FileEvents', () => {
    let state = createSession('launch-1', 'session-1');
    const d = protocol.createFrameDecoder({
      launchId: 'launch-1',
      sessionId: 'session-1',
      onMessage: (frame) => {
        state = reduceSession(state, frame, 100);
      },
    });
    d.push(
      Buffer.concat([
        rawFrame(message()),
        rawFrame(message('ready', '2')),
        rawFrame(message('observations', '3')),
      ]),
    );
    expect(state.lastEventSeq).toBe('1');
    expect(state).not.toHaveProperty('events');
    expect(JSON.stringify(state)).not.toContain('instanceId');
    d.end();
    state = failSession(state, 110, 'stream-ended');
    expect(state.record.state).toBe('FAILED');
  });
});
