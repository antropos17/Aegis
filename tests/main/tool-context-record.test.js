import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const {
  createToolContext,
  projectToolContext,
  toolContextKey,
  LIMITS,
} = require('../../src/main/tool-context-record');
const { createSessionContext } = require('../../src/main/session-context');
const { candidate, result } = require('../fixtures/tool-context/capsule.cjs');
const clone = (v) => JSON.parse(JSON.stringify(v));

describe('closed optional preceding-tool custody capsule', () => {
  it('detaches a consistent synthetic association and preserves its closed JSON roundtrip', () => {
    const raw = result();
    const capsule = createToolContext(raw);
    expect(capsule).toMatchObject({
      relation: 'preceded-by',
      strength: 'confirmed',
      candidateCount: 1,
      candidatesTruncated: false,
      ambiguous: false,
      objectMatch: 'matched',
      sessionBinding: 'confirmed',
    });
    raw.candidates[0].toolName = 'PRIVATE_MUTATED';
    raw.reasons.push('PRIVATE_REASON');
    expect(projectToolContext(clone(capsule))).toEqual(capsule);
    expect(Object.isFrozen(capsule.candidates[0].argsShape)).toBe(true);
    expect(JSON.stringify(capsule)).not.toContain('PRIVATE');
  });

  it('uses an actual unavailable adapter result without inventing verifier evidence or measured skew', () => {
    const adapter = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
    const raw = adapter.correlate(
      { instanceId: '42:1000', atMs: 1200, objectKind: 'path', objectValue: '/PRIVATE' },
      [],
      { clockSkewMs: null, missingEndToleranceMs: 1500 },
    );
    const capsule = createToolContext(raw);
    expect(capsule).toMatchObject({
      strength: 'unattributed',
      candidateCount: 0,
      sessionBinding: 'unavailable',
      objectMatch: 'unavailable',
    });
    expect(capsule.reasons).toEqual(['clock-skew-unavailable']);
    expect(JSON.stringify(capsule)).not.toContain('PRIVATE');
  });

  it('caps 256 claimed candidates to eight without hiding total, ambiguity or incomplete evidence', () => {
    const capsule = createToolContext(
      result({ candidates: Array.from({ length: 256 }, (_, i) => candidate(i + 1)) }),
    );
    expect(capsule).toMatchObject({
      strength: 'inferred',
      candidateCount: 256,
      candidatesTruncated: true,
      ambiguous: true,
      sessionBinding: 'unavailable',
    });
    expect(capsule.candidates).toHaveLength(8);
    expect(toolContextKey(capsule)).toBeNull();
    expect(capsule.candidates.every((c) => c.strength === 'inferred')).toBe(true);
    expect(capsule.reasons).toEqual(['ambiguous-tool-calls', 'context-truncated']);
    expect(Buffer.byteLength(JSON.stringify(capsule), 'utf8')).toBeLessThanOrEqual(LIMITS.bytes);
    expect(projectToolContext(clone(capsule))).toEqual(capsule);
    expect(createToolContext(result({ candidates: Array(257).fill(candidate()) })).reasons).toEqual(
      ['context-invalid'],
    );
  });

  it('validates private metadata in undisplayed candidate nine before taking the display slice', () => {
    const candidates = Array.from({ length: 9 }, (_, i) => candidate(i + 1));
    expect(createToolContext(result({ candidates })).candidates).toHaveLength(8);
    candidates[8].prompt = 'PRIVATE_UNDISPLAYED';
    const capsule = createToolContext(result({ candidates }));
    expect(capsule).toMatchObject({
      strength: 'unattributed',
      candidateCount: 0,
      candidates: [],
      reasons: ['context-invalid'],
    });
    expect(JSON.stringify(capsule)).not.toContain('PRIVATE');
  });

  it('downgrades incomplete claims independently of candidate assertions and leaves absence absent', () => {
    const partial = createToolContext(
      result({ reasons: ['exact-binding-object-and-interval', 'partial-source'] }),
    );
    expect(partial).toMatchObject({ strength: 'inferred', sessionBinding: 'unavailable' });
    expect(partial.candidates[0].strength).toBe('inferred');
    expect(projectToolContext(undefined)).toBeUndefined();
    expect(projectToolContext(null).reasons).toEqual(['context-invalid']);
  });

  it('downgrades an actual missing-end adapter result while retaining its fixed diagnostic', () => {
    const adapter = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
    const start = Date.parse('2026-10-19T10:00:00.000Z');
    const bytes = readFileSync(
      new URL('../fixtures/session-context/claude.jsonl', import.meta.url),
    );
    const firstLine = Buffer.from(bytes.toString().split('\n')[0] + '\n');
    const batch = adapter.parse('claude-code', firstLine, {
      sessionId: 'session-local',
      cwd: '/work',
      platform: 'posix',
    });
    // Synthetic trusted-caller inputs exercise the adapter API, not a live verifier.
    const process = { pid: 42, startTime: start, instanceId: `42:${start}`, cwd: '/work' };
    const binding = adapter.bind(batch, process, {
      sessionId: 'session-local',
      pid: 42,
      processStartTime: start,
      cwd: '/work',
      oneToOne: true,
      provenance: 'verified-local-registry',
    });
    const correlation = adapter.correlate(
      {
        instanceId: process.instanceId,
        atMs: start + 1200,
        objectKind: 'path',
        objectValue: '/work/private.env',
      },
      [binding],
      { clockSkewMs: 0, missingEndToleranceMs: 1500 },
    );
    expect(correlation.strength).toBe('confirmed');
    expect(correlation.candidates[0]).toMatchObject({
      endMs: null,
      reasons: ['end-time-unavailable'],
    });
    const capsule = createToolContext(correlation);
    expect(capsule).toMatchObject({ strength: 'inferred', sessionBinding: 'unavailable' });
    expect(capsule.reasons).toContain('end-time-unavailable');
    expect(capsule.candidates[0]).toMatchObject({
      strength: 'inferred',
      endMs: null,
      reasons: ['end-time-unavailable'],
    });
    expect(projectToolContext(clone(capsule))).toEqual(capsule);
    const contradictoryHistorical = {
      ...createToolContext(result()),
      candidates: [candidate(1, { endMs: null, reasons: ['end-time-unavailable'] })],
    };
    expect(projectToolContext(contradictoryHistorical)).toMatchObject({
      strength: 'unattributed',
      candidateCount: 0,
      reasons: ['context-invalid'],
    });
    expect(JSON.stringify(capsule)).not.toMatch(/PRIVATE|private\.env|session-local/);
    for (const change of [
      { endMs: null, reasons: [] },
      { endMs: 1500, reasons: ['end-time-unavailable'] },
    ]) {
      const incomplete = createToolContext(result({ candidates: [candidate(1, change)] }));
      expect(incomplete).toMatchObject({ strength: 'inferred', sessionBinding: 'unavailable' });
      expect(incomplete.reasons).toContain('end-time-unavailable');
      expect(incomplete.candidates[0].strength).toBe('inferred');
    }
  });

  it.each(['source', 'toolName'])(
    'rejects non-primitive %s without invoking coercion hooks',
    (key) => {
      const literal = key === 'source' ? 'claude-code' : 'Read';
      let coerced = 0;
      const hostile = {
        prompt: 'PRIVATE_COERCION',
        toString() {
          coerced++;
          return literal;
        },
      };
      const boxed = Object.assign(new String(literal), { prompt: 'PRIVATE_BOXED' });
      const jsonObject = JSON.parse('{"prompt":"PRIVATE_JSON","toString":"' + literal + '"}');
      for (const value of [[literal], boxed, jsonObject, hostile]) {
        const raw = candidate(1, { [key]: value });
        const fromResult = createToolContext(result({ candidates: [raw] }));
        const fromCapsule = projectToolContext({
          ...createToolContext(result()),
          candidates: [raw],
        });
        for (const safe of [fromResult, fromCapsule]) {
          expect(safe).toMatchObject({
            strength: 'unattributed',
            reasons: ['context-invalid'],
            candidateCount: 0,
          });
          expect(JSON.stringify(safe)).not.toContain('PRIVATE');
        }
      }
      expect(coerced).toBe(0);
    },
  );

  it.each(['prompt', 'arguments', 'environment', 'response', 'path', 'endpoint', 'command'])(
    'rejects raw %s at every capsule boundary',
    (key) => {
      const good = createToolContext(result());
      for (const change of [
        { ...clone(good), [key]: 'PRIVATE_PAYLOAD' },
        {
          ...clone(good),
          candidates: [{ ...clone(good.candidates[0]), [key]: 'PRIVATE_PAYLOAD' }],
        },
        {
          ...clone(good),
          candidates: [
            {
              ...clone(good.candidates[0]),
              argsShape: { ...good.candidates[0].argsShape, [key]: 'PRIVATE_PAYLOAD' },
            },
          ],
        },
      ]) {
        const safe = projectToolContext(change);
        expect(safe).toMatchObject({
          strength: 'unattributed',
          candidateCount: 0,
          reasons: ['context-invalid'],
        });
        expect(JSON.stringify(safe)).not.toContain('PRIVATE');
      }
    },
  );

  it('rejects unknown provider/tool/ref/reason values and nonfinite or inconsistent timing', () => {
    for (const change of [
      { source: 'PRIVATE_PROVIDER' },
      { toolName: 'PRIVATE_TOOL' },
      { sessionRef: '/PRIVATE/path' },
      { objectDigest: null },
      { startMs: null },
      { deltaMs: Infinity },
      { deltaMs: -1 },
      { deltaMs: 501 },
      { endMs: 999 },
      { startMs: LIMITS.epoch + 1 },
      { reasons: ['PRIVATE_REASON'] },
      {
        source: 'codex',
        toolName: 'exec_command',
        argsShape: { operation: 'shell', objectKind: 'none' },
      },
    ])
      expect(createToolContext(result({ candidates: [candidate(1, change)] })).reasons).toEqual([
        'context-invalid',
      ]);
    const good = createToolContext(result());
    for (const change of [
      { relation: 'caused-by' },
      { candidateCount: 2 },
      { ambiguous: true },
      { objectMatch: 'unavailable' },
      { sessionBinding: 'unavailable' },
      { reasons: ['PRIVATE_REASON'] },
    ])
      expect(projectToolContext({ ...good, ...change }).reasons).toEqual(['context-invalid']);
  });

  it('rejects sparse or extended arrays instead of serializing unsupported slots and properties', () => {
    expect(createToolContext(result({ candidates: Array(1) })).reasons).toEqual([
      'context-invalid',
    ]);
    expect(createToolContext(result({ reasons: Array(1) })).reasons).toEqual(['context-invalid']);
    for (const key of ['candidates', 'reasons']) {
      const extended = result();
      extended[key].prompt = 'PRIVATE_ARRAY_PROPERTY';
      expect(createToolContext(extended).reasons).toEqual(['context-invalid']);
    }
    expect(
      projectToolContext({ ...createToolContext(result()), candidates: Array(1) }).reasons,
    ).toEqual(['context-invalid']);
  });
  it('changes material association keys while normalizing reason and candidate order', () => {
    const a = createToolContext(result());
    const b = createToolContext(result({ candidates: [candidate(2)] }));
    expect(toolContextKey(a)).not.toBe(toolContextKey(b));
    expect(toolContextKey(undefined)).toBe('');
    expect(toolContextKey(null)).not.toBe('');
    const multiple = createToolContext(result({ candidates: [candidate(1), candidate(2)] }));
    expect(toolContextKey(multiple)).toBe(
      toolContextKey({ ...multiple, candidates: [...multiple.candidates].reverse() }),
    );
  });
});
