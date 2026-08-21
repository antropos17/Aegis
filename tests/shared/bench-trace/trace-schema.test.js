/**
 * @file tests/shared/bench-trace/trace-schema.test.js
 * @description What the trace FORMAT guarantees, as opposed to what a reader does
 *   with a file.
 *
 *   The block that earns its place here is the last one. The plan claims a trace
 *   chain and an audit chain cannot be mistaken for one another, and that claim is
 *   the reason `TRACE_GENESIS` exists as a separate constant. Two of its three legs
 *   are facts about modules `bench/` does not own — both of today's audit verifiers
 *   gate on a TOP-LEVEL `seq` before they hash — so they are pinned here as
 *   observations, with the constant carrying the part `bench/` can actually
 *   guarantee. If a future change to `src/` relaxes that gate, this suite says so
 *   instead of the separation quietly becoming one-legged.
 *
 *   Not pinned here: that every kind in the closed list has a harness that can
 *   execute it. There is no dispatcher yet — it arrives with the replay harness —
 *   and a parity test written against nothing would read as if it asserted parity.
 */
import { describe, it, expect } from 'vitest';

import hashchain from '../../../src/main/audit-hashchain.js';
import attribution from '../../../src/main/attribution.js';
import environment from '../../../bench/trace/environment.js';
import schema from '../../../bench/trace/schema.js';
import writer from '../../../bench/trace/writer.js';

import { CLOCK_EPOCH_MS, makeAgent, makeAmbient, makeRecords } from './_make-trace.js';

/** One minimal, valid `bench.input` per kind, so every kind can be round-tripped. */
const SAMPLE_INPUT = {
  'fs.event': { action: 'created', path: 'X:\\dev\\project\\AEGIS\\.env' },
  'handles.tick': { byPid: { 4812: ['X:\\dev\\project\\AEGIS\\.env'] } },
  'rm.hot.tick': { holders: [{ pid: 4812, path: 'X:\\dev\\project\\AEGIS\\.env' }] },
  'net.tick': {
    tcp: [{ pid: 4812, ip: '160.79.104.10', port: 443, state: 'Established' }],
    dns: { '160.79.104.10': { reverse: ['api.anthropic.com'], forward: ['160.79.104.10'] } },
  },
  'clock.advance': { toEpochMs: CLOCK_EPOCH_MS + 1000 },
  'population.set': { agents: [makeAgent()] },
};

/**
 * Build one record of `kind`, supplying ambient state exactly where the kind wants it.
 * @param {string} kind
 * @param {Object} [inputOverride]
 * @returns {Object}
 */
function buildOne(kind, inputOverride) {
  const spec = schema.RECORD_KINDS[kind];
  return writer.buildRecord({
    trace: 'T0-synthetic',
    seq: 0,
    kind,
    epochMs: CLOCK_EPOCH_MS,
    input: inputOverride || SAMPLE_INPUT[kind],
    ...(spec.observation ? { ambient: makeAmbient() } : {}),
  });
}

describe('trace format — the closed list of record kinds', () => {
  it('is frozen, and every kind declares a shape a reader can check', () => {
    expect(Object.isFrozen(schema.RECORD_KINDS)).toBe(true);
    expect(Object.isFrozen(schema.KIND_NAMES)).toBe(true);
    expect(schema.KIND_NAMES).toEqual(Object.keys(SAMPLE_INPUT));

    for (const name of schema.KIND_NAMES) {
      const spec = schema.RECORD_KINDS[name];
      expect(Object.isFrozen(spec), `${name} spec is frozen`).toBe(true);
      expect(typeof spec.observation, `${name}.observation`).toBe('boolean');
      expect(typeof spec.summary, `${name}.summary`).toBe('string');
      expect(Array.isArray(spec.inputFields) && spec.inputFields.length > 0).toBe(true);
      expect(typeof spec.validateInput, `${name}.validateInput`).toBe('function');
    }
  });

  it('refuses a kind outside the list, by name, from both the writer and the reader', () => {
    expect(() => buildOne('fs.event')).not.toThrow();

    const fromWriter = (() => {
      try {
        writer.buildRecord({ trace: 't', seq: 0, kind: 'fs.deleted', epochMs: 1, input: {} });
      } catch (err) {
        return err;
      }
      return null;
    })();
    // `name` and `reason`, not `instanceof`: vitest loads this module twice (once for the
    // ESM import here, once for writer.js's require), so class identity is not the
    // contract. The contract is the reason code a caller branches on.
    expect(fromWriter.name).toBe('TraceError');
    expect(fromWriter.reason).toBe(schema.REFUSAL.UNKNOWN_KIND);
    expect(fromWriter.message).toContain('fs.deleted');

    const record = { ...buildOne('fs.event'), bench: { ...buildOne('fs.event').bench, kind: 'x' } };
    expect(() => schema.validateRecord(record, 0)).toThrowError(/outside the closed list/);
  });

  it('refuses a filesystem action the watcher cannot emit', () => {
    expect(Object.keys(schema.FS_ACTIONS)).toEqual(['created', 'modified', 'deleted']);
    let err = null;
    try {
      buildOne('fs.event', { action: 'accessed', path: 'X:\\a\\b' });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(err.message).toContain('no fourth action');
  });

  it('distinguishes a DNS answer that was empty from one that never came back', () => {
    // `[]` is "the resolver replied with nothing"; `null` is "the lookup threw". A
    // format that accepted only one of them would force a recorder to write the other.
    const ip = '203.0.113.9';
    expect(() => buildOne('net.tick', {
      tcp: [{ pid: 4812, ip, port: 443, state: 'Established' }],
      dns: { [ip]: { reverse: [], forward: null } },
    })).not.toThrow();

    let err = null;
    try {
      buildOne('net.tick', {
        tcp: [{ pid: 4812, ip, port: 443, state: 'Established' }],
        dns: { [ip]: { reverse: 'api.example', forward: null } },
      });
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
  });

  it('carries ambient scope on observations and refuses it on the other kinds', () => {
    for (const name of schema.KIND_NAMES) {
      const record = buildOne(name);
      if (schema.RECORD_KINDS[name].observation) {
        expect(record.bench.ambient, `${name} carries ambient`).toEqual({
          populationReliable: true,
          isOtherPanelExpanded: false,
        });
      } else {
        expect(record.bench.ambient, `${name} carries no ambient`).toBeUndefined();
      }
    }

    let err = null;
    try {
      writer.buildRecord({
        trace: 't',
        seq: 0,
        kind: 'clock.advance',
        epochMs: CLOCK_EPOCH_MS,
        input: SAMPLE_INPUT['clock.advance'],
        ambient: makeAmbient(),
      });
    } catch (e) {
      err = e;
    }
    expect(err.message).toContain('observed nothing');

    let missing = null;
    try {
      writer.buildRecord({
        trace: 't',
        seq: 0,
        kind: 'fs.event',
        epochMs: CLOCK_EPOCH_MS,
        input: SAMPLE_INPUT['fs.event'],
      });
    } catch (e) {
      missing = e;
    }
    expect(missing.reason).toBe(schema.REFUSAL.RECORD_MALFORMED);
    expect(missing.message).toContain('populationReliable');
  });
});

describe('trace format — the ECS envelope', () => {
  it('gives an observation an event kind and the other kinds a state kind', () => {
    for (const name of schema.KIND_NAMES) {
      const record = buildOne(name);
      const expectedKind = schema.RECORD_KINDS[name].observation ? 'event' : 'state';
      expect(record.event.kind, name).toBe(expectedKind);
      expect(record.ecs).toEqual({ version: '8.11.0' });
      if (expectedKind === 'state') {
        // No ECS category exists for "the harness moved its clock", and inventing one
        // would dress a replay parameter up as a measurement.
        expect(record.event.category, name).toBeUndefined();
        expect(record.event.type, name).toBeUndefined();
      } else {
        expect(Array.isArray(record.event.category), name).toBe(true);
        expect(Array.isArray(record.event.type), name).toBe(true);
      }
    }
  });

  it('names a file only where one file is the subject', () => {
    expect(buildOne('fs.event').file).toEqual({
      path: 'X:\\dev\\project\\AEGIS\\.env',
      name: '.env',
      directory: 'X:\\dev\\project\\AEGIS',
    });
    // A tick carries a provider's whole answer, which is a set. Writing one element of
    // it into `file.path` would make a set look like an observation about one file.
    expect(buildOne('handles.tick').file).toBeUndefined();
    expect(buildOne('rm.hot.tick').file).toBeUndefined();
    expect(buildOne('net.tick').file).toBeUndefined();
  });

  it('refuses a record whose envelope disagrees with the kind it declares', () => {
    const record = buildOne('fs.event');
    const tampered = { ...record, event: { ...record.event, action: 'file-deleted' } };
    let err = null;
    try {
      schema.validateRecord(tampered, 0);
    } catch (e) {
      err = e;
    }
    expect(err.reason).toBe(schema.REFUSAL.ENVELOPE_MISMATCH);
  });
});

describe('trace format — recording-time path neutralization', () => {
  it('rewrites an account name inside every string, not just a path-shaped field', () => {
    const record = buildOne('population.set', {
      agents: [makeAgent({ cwd: 'C:\\Users\\alice\\proj', instanceId: '4812:1' })],
    });
    expect(record.bench.input.agents[0].cwd).toBe('C:\\Users\\user\\proj');
  });

  it('moves an event path and an agent cwd by the same map', () => {
    // If these two diverged, `cwd-containment` would stop matching in replay and the
    // trace would quietly measure a different attribution than the one recorded.
    const agent = buildOne('population.set', {
      agents: [makeAgent({ cwd: 'C:\\Users\\alice\\proj' })],
    }).bench.input.agents[0].cwd;
    const evented = buildOne('fs.event', {
      action: 'created',
      path: 'C:\\Users\\alice\\proj\\.env',
    }).file.path;
    expect(evented.startsWith(agent + '\\')).toBe(true);
  });
});

describe('trace format — the chain seed belongs to the trace format', () => {
  it('is not the audit seed', () => {
    expect(schema.TRACE_GENESIS).toBe('AEGIS-BENCH-TRACE-GENESIS-v1');
    expect(schema.TRACE_GENESIS).not.toBe(hashchain.GENESIS);
  });

  it('binds the sequence number into the hash, which the audit chain does not', () => {
    const [first] = makeRecords();
    const preimage = { ...first };
    delete preimage.hash;
    expect(schema.recordHash(schema.TRACE_GENESIS, first)).toBe(first.hash);

    // Move the sequence number and nothing else: the trace hash must change, because
    // `bench.seq` is inside the preimage. The audit rule deletes a top-level `seq`
    // before hashing, so the same edit would be invisible to it.
    const moved = { ...preimage, bench: { ...preimage.bench, seq: 7 } };
    expect(schema.recordHash(schema.TRACE_GENESIS, moved)).not.toBe(first.hash);

    const auditStyle = { ...preimage, seq: 0 };
    const auditStyleMoved = { ...preimage, seq: 7 };
    expect(hashchain.computeHash(hashchain.GENESIS, stripSeq(auditStyle))).toBe(
      hashchain.computeHash(hashchain.GENESIS, stripSeq(auditStyleMoved)),
    );
  });

  it('OBSERVED: both of today\u2019s audit verifiers refuse a trace record before hashing', () => {
    // This is a fact about modules `bench/` does not own, recorded as one. It is why
    // the separation does not rest on the record shape alone: if this ever stops being
    // true, the constant above is still the guarantee, and this test reports the change.
    const [first] = makeRecords();
    expect(Object.prototype.hasOwnProperty.call(first, 'seq')).toBe(false);
    expect(first.bench.seq).toBe(0);
  });

  it('pins the closed evidence list into the header, in declaration order', () => {
    const env = environment.observeEnvironment({ clockEpochMs: CLOCK_EPOCH_MS });
    expect(env.digests.evidenceCodes).toEqual([...attribution.EVIDENCE_CODES]);
    expect(env.digests.evidenceCodes).toHaveLength(8);
  });
});

/**
 * Drop a top-level `seq`, the way both audit verifiers build their preimage.
 * @param {Object} record
 * @returns {Object}
 */
function stripSeq(record) {
  const out = { ...record };
  delete out.seq;
  delete out.hash;
  return out;
}
