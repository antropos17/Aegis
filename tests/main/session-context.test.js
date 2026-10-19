import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createSessionContext, LIMITS } = require('../../src/main/session-context');
const start = Date.parse('2026-10-19T10:00:00.000Z');
const make = (key = 7) => createSessionContext({ digestKey: Buffer.alloc(32, key) });
const selection = { sessionId: 'session-local', cwd: '/work', platform: 'posix' };
const proc = { pid: 42, startTime: start, instanceId: `42:${start}`, cwd: '/work' };
const evidence = {
  sessionId: 'session-local',
  pid: 42,
  processStartTime: start,
  cwd: '/work',
  oneToOne: true,
  provenance: 'verified-local-registry',
};
const timing = { clockSkewMs: 0, missingEndToleranceMs: 1500 };
const event = {
  instanceId: proc.instanceId,
  atMs: start + 1200,
  objectKind: 'path',
  objectValue: '/work/private.env',
};
const fixture = (name) =>
  readFileSync(new URL(`../fixtures/session-context/${name}.jsonl`, import.meta.url));
const lines = (rows) => Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
const claude = (extra = {}) => ({
  type: 'assistant',
  sessionId: 'session-local',
  cwd: '/work',
  timestamp: '2026-10-19T10:00:01.000Z',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'call-local',
        name: 'Read',
        input: { file_path: '/work/private.env' },
      },
    ],
  },
  ...extra,
});
const read = (engine, rows = [claude()], options = {}) =>
  engine.parse('claude-code', lines(rows), { ...selection, ...options });
const link = (engine, batch, ev = event, proof = evidence, window = timing, process = proc) =>
  engine.correlate(ev, [engine.bind(batch, process, proof)], window);

describe('source-backed bounded session context parsing', () => {
  it.each([
    ['claude-code', 'claude', 'Read'],
    ['codex', 'codex', 'exec_command'],
    ['gemini-cli', 'gemini', 'read_file'],
  ])('parses %s real metadata shape and only closed projections', (source, name, tool) => {
    const engine = make();
    const batch = engine.parse(source, fixture(name), selection);
    expect(batch.availability).toBe('available');
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0]).toMatchObject({ toolName: tool, startMs: start + 1000 });
    const binding = engine.bind(batch, proc, evidence);
    expect(binding.strength).toBe('confirmed');
    const correlation = engine.correlate(event, [binding], timing);
    expect(correlation.strength).toBe(source === 'codex' ? 'unattributed' : 'confirmed');
    const serialized = JSON.stringify({ batch, binding, correlation });
    for (const secret of ['PRIVATE_', '/work', 'session-local', 'call-local', 'cat '])
      expect(serialized).not.toContain(secret);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.calls[0].argsShape)).toBe(true);
  });

  it('uses explicit legacy Gemini JSON and never invents argument aliases', () => {
    const engine = make();
    const rows = fixture('gemini').toString().trim().split('\n').map(JSON.parse);
    const doc = { ...rows[0], messages: [rows[1]] };
    expect(
      engine.parse('gemini-cli', Buffer.from(JSON.stringify(doc)), { ...selection, format: 'json' })
        .calls,
    ).toHaveLength(1);
    doc.messages[0].toolCalls[0].args = { absolute_path: '/work/private.env' };
    const batch = engine.parse('gemini-cli', Buffer.from(JSON.stringify(doc)), {
      ...selection,
      format: 'json',
    });
    expect(batch.calls[0].objectDigest).toBeNull();
    expect(link(engine, batch).strength).toBe('unattributed');
  });

  it('ignores prompts, responses, arbitrary tool names and forged binding fields', () => {
    const engine = make();
    const row = claude({ processBinding: 'confirmed', pid: 42, prompt: 'PRIVATE_PROMPT' });
    row.message.content[0].name = 'PRIVATE_TOOL_NAME';
    row.message.content[0].input = { command: 'PRIVATE_COMMAND', env: { key: 'PRIVATE_ENV' } };
    const batch = read(engine, [row]);
    expect(batch.calls[0]).toMatchObject({ toolName: 'other', objectDigest: null });
    expect(JSON.stringify(batch)).not.toContain('PRIVATE');
    expect(
      link(engine, batch, event, { ...evidence, provenance: 'source-reported' }).strength,
    ).toBe('unattributed');
  });

  it('canonicalizes argument key order without retaining raw values and uses keyed digests', () => {
    const a = claude();
    const b = claude();
    a.message.content[0].input = { file_path: '/work/private.env', z: 1, a: [true, null] };
    b.message.content[0].input = { a: [true, null], z: 1, file_path: '/work/private.env' };
    const engine = make();
    const first = read(engine, [a]).calls[0];
    expect(read(engine, [b]).calls[0].argsDigest).toBe(first.argsDigest);
    expect(read(make(8), [a]).calls[0].argsDigest).not.toBe(first.argsDigest);
    expect(() => createSessionContext({ digestKey: Buffer.alloc(8) })).toThrow(
      'invalid-digest-key',
    );
  });

  it.each([
    ['null', null, 'source-unavailable'],
    ['oversize', Buffer.alloc(LIMITS.bytes + 1), 'oversize-input'],
    ['invalid utf8', Buffer.from([0xff, 0x0a]), 'invalid-encoding-or-json'],
  ])('preserves %s unavailability without exception text', (_label, bytes, reason) => {
    const batch = make().parse('claude-code', bytes, selection);
    expect(batch.reasons).toContain(reason);
    expect(batch.calls).toEqual([]);
  });

  it('discards trailing partial JSON and downgrades surviving complete records', () => {
    const engine = make();
    const raw = Buffer.concat([lines([claude()]), Buffer.from('{"PRIVATE_PARTIAL')]);
    const batch = engine.parse('claude-code', raw, selection);
    expect(batch.calls).toHaveLength(1);
    expect(batch.reasons).toContain('truncated-input');
    expect(link(engine, batch).strength).toBe('inferred');
    expect(engine.parse('claude-code', raw, { ...selection, headTruncated: true }).calls).toEqual(
      [],
    );
  });

  it('rejects missing or conflicting session metadata and cwd', () => {
    for (const rows of [
      [claude({ sessionId: undefined })],
      [claude({ cwd: '/elsewhere' })],
      [claude(), claude({ sessionId: 'forked' })],
    ]) {
      const batch = read(make(), rows);
      expect(batch.calls).toEqual([]);
      expect(batch.reasons).toContain('session-mismatch');
    }
    const missingHeader = fixture('codex').toString().split('\n').slice(1).join('\n');
    expect(make().parse('codex', Buffer.from(missingHeader), selection).reasons).toContain(
      'session-metadata-unavailable',
    );
  });

  it.each(['$set', '$patch', '$rewindTo'])('fails closed on Gemini history control %s', (key) => {
    const raw = Buffer.concat([fixture('gemini'), lines([{ [key]: { PRIVATE: 'SECRET' } }])]);
    const batch = make().parse('gemini-cli', raw, selection);
    expect(batch.calls).toEqual([]);
    expect(batch.reasons).toContain('unsupported-history-edit');
  });

  it('caps lines, calls, records and nested arguments, preserving fixed reasons', () => {
    const engine = make();
    const oversized = Buffer.concat([
      lines([claude()]),
      Buffer.from(' '.repeat(LIMITS.lineBytes + 1) + 'x\n'),
    ]);
    expect(engine.parse('claude-code', oversized, selection).reasons).toContain('oversize-record');
    const row = claude();
    row.message.content = Array.from({ length: LIMITS.calls + 1 }, (_, i) => ({
      type: 'tool_use',
      id: `c${i}`,
      name: 'Read',
      input: { file_path: '/work/private.env' },
    }));
    const capped = read(engine, [row]);
    expect(capped.calls).toHaveLength(LIMITS.calls);
    expect(capped.reasons).toContain('call-limit');
    expect(link(engine, capped).strength).toBe('inferred');
    expect(read(engine, [claude(), ...Array(LIMITS.records).fill({})]).reasons).toContain(
      'record-limit',
    );
    let nested = {};
    for (let i = 0; i < LIMITS.depth + 2; i++) nested = { next: nested };
    row.message.content = [{ type: 'tool_use', id: 'deep', name: 'Read', input: nested }];
    expect(read(engine, [row]).reasons).toContain('argument-limit');
  });

  it('rejects replayed call IDs and malformed Codex argument JSON', () => {
    const engine = make();
    expect(read(engine, [claude(), claude()]).calls).toEqual([]);
    const raw = fixture('codex').toString().trim().split('\n').map(JSON.parse);
    raw[1].payload.arguments = 'PRIVATE_BAD_JSON';
    expect(engine.parse('codex', lines(raw), selection).reasons).toContain(
      'invalid-tool-arguments',
    );
  });

  it('distinguishes available empty source from unavailable input and preserves null times', () => {
    const engine = make();
    const empty = read(engine, [claude({ message: { content: [] } })]);
    expect(empty).toMatchObject({ availability: 'available', calls: [] });
    const missing = read(engine, [claude({ timestamp: null })]);
    expect(missing.calls[0]).toMatchObject({ startMs: null, endMs: null });
    expect(missing.calls[0].reasons).toContain('timestamp-unavailable');
    expect(link(engine, missing).strength).toBe('unattributed');
  });
});

describe('binding plus object plus interval correlation', () => {
  it('requires exact independent identity, object and inclusive recorded interval', () => {
    const engine = make();
    const batch = engine.parse('claude-code', fixture('claude'), selection);
    for (const atMs of [start + 1000, start + 1200, start + 1600])
      expect(link(engine, batch, { ...event, atMs }).strength).toBe('confirmed');
    for (const atMs of [start + 999, start + 1601])
      expect(link(engine, batch, { ...event, atMs }).strength).toBe('unattributed');
    expect(link(engine, batch).candidates[0].deltaMs).toBe(200);
    expect(link(engine, batch, { ...event, objectValue: '/work/another.env' })).toMatchObject({
      strength: 'unattributed',
      candidates: [],
    });
    expect(link(engine, batch, { ...event, objectValue: '/work/another.env' }).reasons).toContain(
      'time-overlap-without-object-match',
    );
  });

  it.each([
    { pid: 43 },
    { processStartTime: start + 1 },
    { cwd: '/other' },
    { sessionId: 'other' },
  ])('rejects contradictory binding evidence %j', (change) => {
    const engine = make();
    expect(link(engine, read(engine), event, { ...evidence, ...change }).strength).toBe(
      'unattributed',
    );
  });

  it.each([
    { provenance: 'source-reported' },
    { oneToOne: false },
    { pid: null },
    { processStartTime: null },
    { cwd: null },
  ])('downgrades incomplete or unverified binding evidence %j', (change) => {
    const engine = make();
    expect(link(engine, read(engine), event, { ...evidence, ...change }).strength).toBe('inferred');
  });

  it('rejects unknown birth, reused process identity, other owner and serialized capabilities', () => {
    const engine = make();
    const batch = read(engine);
    const bound = engine.bind(batch, proc, evidence);
    expect(engine.bind(batch, { ...proc, startTime: null }, evidence).strength).toBe(
      'unattributed',
    );
    expect(engine.bind(batch, { ...proc, instanceId: '42:null' }, evidence).strength).toBe(
      'unattributed',
    );
    expect(make().bind(batch, proc, evidence).strength).toBe('unattributed');
    for (const binding of [{ ...bound }, null, {}])
      expect(engine.correlate(event, [binding], timing).strength).toBe('unattributed');
    expect(
      engine.correlate({ ...event, instanceId: `42:${start - 1}` }, [bound], timing).strength,
    ).toBe('unattributed');
  });

  it('downgrades all ambiguous calls, but deduplicates the same parsed candidate', () => {
    const engine = make();
    const row = claude();
    row.message.content.push({ ...row.message.content[0], id: 'second-call' });
    const batch = read(engine, [row]);
    const result = link(engine, batch);
    expect(result.strength).toBe('inferred');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.strength === 'inferred')).toBe(true);
    const single = read(engine);
    const bound = engine.bind(single, proc, evidence);
    expect(engine.correlate(event, [bound, bound], timing).strength).toBe('confirmed');
  });

  it.each(['one session with multiple instances', 'one instance with multiple sessions'])(
    'downgrades an earlier handle independently for %s',
    (direction) => {
      const engine = make();
      const batch = read(engine);
      const first = engine.bind(batch, proc, evidence);
      expect(first.strength).toBe('confirmed');
      expect(engine.correlate(event, [first], timing).strength).toBe('confirmed');
      if (direction === 'one session with multiple instances') {
        const process = { ...proc, pid: 43, instanceId: `43:${start}` };
        engine.bind(batch, process, { ...evidence, pid: 43 });
      } else {
        const other = read(engine, [claude({ sessionId: 'session-other' })], {
          sessionId: 'session-other',
        });
        engine.bind(other, proc, { ...evidence, sessionId: 'session-other' });
      }
      const correlated = engine.correlate(event, [first], timing);
      expect(correlated.strength).toBe('inferred');
      expect(correlated.candidates).toHaveLength(1);
      expect(correlated.candidates[0].strength).toBe('inferred');
    },
  );

  it('applies measured skew and explicitly bounded missing-end tolerance', () => {
    const engine = make();
    const batch = read(engine);
    expect(batch.calls[0].endMs).toBeNull();
    expect(link(engine, batch, { ...event, atMs: start + 3000 }).strength).toBe('unattributed');
    expect(
      link(engine, batch, { ...event, atMs: start + 3000 }, evidence, {
        ...timing,
        clockSkewMs: 1000,
      }).strength,
    ).toBe('confirmed');
    for (const clockSkewMs of [undefined, null, NaN, LIMITS.skewMs + 1])
      expect(link(engine, batch, event, evidence, { ...timing, clockSkewMs }).strength).toBe(
        'unattributed',
      );
    expect(
      link(engine, batch, event, evidence, {
        ...timing,
        missingEndToleranceMs: LIMITS.toleranceMs + 1,
      }).strength,
    ).toBe('unattributed');
  });

  it('rejects events outside process lifetime and pre-birth call windows', () => {
    const engine = make();
    const batch = read(engine);
    expect(
      link(engine, batch, event, evidence, timing, { ...proc, endTime: start + 1100 }).strength,
    ).toBe('unattributed');
    const before = read(engine, [claude({ timestamp: '2026-10-19T09:59:59.500Z' })]);
    expect(link(engine, before, { ...event, atMs: start + 1 }).strength).toBe('unattributed');
  });

  it('never links Codex shell text using time alone', () => {
    const engine = make();
    const batch = engine.parse('codex', fixture('codex'), selection);
    expect(batch.calls[0].objectDigest).toBeNull();
    expect(link(engine, batch).strength).toBe('unattributed');
  });

  it('confirms a non-null Windows path through verified binding, object and interval', () => {
    const engine = make();
    const row = claude({ cwd: 'C:\\work' });
    row.message.content[0].input.file_path = 'C:\\work\\a\\..\\private.env';
    const digest = engine.objectDigest('path', 'C:/work/private.env', 'win32');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    const batch = read(engine, [row], { cwd: 'C:/work', platform: 'win32' });
    expect(batch.availability).toBe('available');
    expect(batch.calls[0].objectDigest).toBe(digest);
    const binding = engine.bind(
      batch,
      { ...proc, cwd: 'C:\\work' },
      { ...evidence, cwd: 'C:/work' },
    );
    expect(binding.strength).toBe('confirmed');
    const correlated = engine.correlate(
      { ...event, objectValue: 'C:/work/private.env' },
      [binding],
      timing,
    );
    expect(correlated.strength).toBe('confirmed');
    expect(correlated.candidates).toHaveLength(1);
    expect(correlated.candidates[0]).toMatchObject({ objectDigest: digest, deltaMs: 200 });
  });
  it('compares explicit lexical platform paths and exact normalized HTTP resources', () => {
    const engine = make();
    const windowsDigest = engine.objectDigest('path', 'C:\\work\\a\\..\\private.env', 'win32');
    expect(windowsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(windowsDigest).toBe(engine.objectDigest('path', 'C:/work/private.env', 'win32'));
    expect(engine.objectDigest('path', '/work/Private.env', 'posix')).not.toBe(
      engine.objectDigest('path', '/work/private.env', 'posix'),
    );
    for (const v of ['C:relative', '\\rooted', '\\\\?\\C:\\work'])
      expect(engine.objectDigest('path', v, 'win32')).toBeNull();
    expect(engine.objectDigest('endpoint', 'https://EXAMPLE.com:443/a#fragment')).toBe(
      engine.objectDigest('endpoint', 'https://example.com/a'),
    );
    expect(engine.objectDigest('endpoint', 'https://example.com/a?x=1')).not.toBe(
      engine.objectDigest('endpoint', 'https://example.com/a?x=2'),
    );
    expect(engine.objectDigest('endpoint', 'https://user:PRIVATE@example.com/a')).toBeNull();
    const row = claude();
    row.message.content[0] = {
      type: 'tool_use',
      id: 'fetch',
      name: 'WebFetch',
      input: { url: 'https://example.com/a', prompt: 'PRIVATE' },
    };
    expect(
      link(engine, read(engine, [row]), {
        ...event,
        objectKind: 'endpoint',
        objectValue: 'https://example.com/a',
      }).strength,
    ).toBe('confirmed');
  });
});
