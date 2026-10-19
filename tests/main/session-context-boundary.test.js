import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSessionContext, LIMITS } = require('../../src/main/session-context');
const birth = Date.parse('2026-10-19T10:00:00Z');
const selection = { sessionId: 'local', cwd: '/work', platform: 'posix' };
const process = { pid: 42, startTime: birth, instanceId: `42:${birth}`, cwd: '/work' };
const proof = {
  sessionId: 'local',
  pid: 42,
  processStartTime: birth,
  cwd: '/work',
  oneToOne: true,
  provenance: 'verified-local-registry',
};
const event = {
  instanceId: process.instanceId,
  atMs: birth + 1200,
  objectKind: 'path',
  objectValue: '/work/file',
};
const timing = { clockSkewMs: 0, missingEndToleranceMs: 1500 };
const make = () => createSessionContext({ digestKey: Buffer.alloc(32, 7) });
const row = (content) => ({
  type: 'assistant',
  sessionId: 'local',
  cwd: '/work',
  timestamp: '2026-10-19T10:00:01Z',
  message: { content },
});
const tool = (id, extra = {}) => ({
  type: 'tool_use',
  id,
  name: 'Read',
  input: { file_path: '/work/file', ...extra },
});
const bytes = (...rows) => Buffer.from(rows.map(JSON.stringify).join('\n') + '\n');

describe('bounded repeated observations and failure controls', () => {
  function selectedLimitStops(engine, good, limited) {
    expect(limited.evidence).toEqual(['binding-limit']);
    for (const handles of [
      [good, limited],
      [limited, good],
    ]) {
      const result = engine.correlate(event, handles, timing);
      expect(result.strength).toBe('unattributed');
      expect(result.reasons).toContain('binding-limit');
      expect(result.candidates).toEqual([]);
    }
    expect(engine.correlate(event, [good], timing).strength).toBe('confirmed');
  }

  it('preserves selected partial-source rejection at attempt saturation without sticky or foreign poison', () => {
    const engine = make();
    const good = engine.bind(
      engine.parse('claude-code', bytes(row([tool('good')])), selection),
      process,
      proof,
    );
    const partial = engine.parse('claude-code', bytes(row([]), null), selection);
    expect(partial).toMatchObject({ availability: 'partial', calls: [] });
    for (let i = 1; i < LIMITS.records; i++) engine.bind(null, null, null);
    const limited = engine.bind(partial, process, proof);
    selectedLimitStops(engine, good, limited);
    for (let i = 0; i < 10; i++) expect(engine.bind(partial, process, proof)).toBe(limited);
    expect(Object.isFrozen(limited)).toBe(true);
    expect(Object.isFrozen(limited.evidence)).toBe(true);
    const foreign = make();
    for (let i = 0; i < LIMITS.records; i++) foreign.bind(null, null, null);
    const foreignLimit = foreign.bind(null, null, null);
    for (const handle of [foreignLimit, { ...limited }]) {
      for (const handles of [
        [good, handle],
        [handle, good],
      ]) {
        expect(engine.correlate(event, handles, timing).strength).toBe('confirmed');
      }
    }
  });

  it.each(['sessions', 'instances'])(
    'preserves selected partial-source rejection at %s map saturation',
    (kind) => {
      const engine = make();
      const good = engine.bind(
        engine.parse('claude-code', bytes(row([tool('good')])), selection),
        process,
        proof,
      );
      for (let i = 0; i < LIMITS.calls - 1; i++) {
        const sessionId = kind === 'sessions' ? `filler-${i}` : 'shared-filler';
        const pid = kind === 'instances' ? 1000 + i : 43;
        const current = { ...process, pid, instanceId: `${pid}:${birth}` };
        const selected = { ...selection, sessionId };
        const batch = engine.parse(
          'claude-code',
          bytes({ ...row([tool('filler')]), sessionId }),
          selected,
        );
        engine.bind(batch, current, { ...proof, pid, sessionId });
      }
      expect(engine.correlate(event, [good], timing).strength).toBe('confirmed');
      const partial = engine.parse('claude-code', bytes(row([]), null), selection);
      const limited = engine.bind(partial, process, proof);
      selectedLimitStops(engine, good, limited);
      expect(engine.bind(partial, process, proof)).toBe(limited);
    },
  );

  const geminiCall = {
    type: 'gemini',
    id: 'message',
    timestamp: '2026-10-19T10:00:01Z',
    toolCalls: [
      {
        id: 'tool',
        name: 'read_file',
        args: { file_path: '/work/file' },
        timestamp: '2026-10-19T10:00:01Z',
        status: 'success',
      },
    ],
  };

  it.each(['$rewindTo', '$patch', '$set'])(
    'rejects mixed metadata and embedded history control %s before session admission',
    (key) => {
      const metadata = { sessionId: 'local', projectHash: 'PRIVATE_PROJECT' };
      const mixed = { sessionId: 'local', [key]: { PRIVATE: 'CONTROL' } };
      const cases = [
        [bytes(metadata, geminiCall, mixed), {}],
        [bytes(metadata, geminiCall, { sessionId: 'local', messages: [mixed] }), {}],
        [
          Buffer.from(JSON.stringify({ ...metadata, messages: [geminiCall, mixed] })),
          { format: 'json' },
        ],
        [
          Buffer.from(JSON.stringify({ ...metadata, [key]: {}, messages: [geminiCall] })),
          { format: 'json' },
        ],
      ];
      for (const [raw, format] of cases) {
        const engine = make();
        const batch = engine.parse('gemini-cli', raw, { ...selection, ...format });
        expect(batch.reasons).toContain('unsupported-history-edit');
        expect(
          engine.correlate(event, [engine.bind(batch, process, proof)], timing).strength,
        ).not.toBe('confirmed');
        expect(JSON.stringify(batch)).not.toContain('PRIVATE');
      }
    },
  );

  it.each([null, {}, 'PRIVATE_CONTAINER', 1, false])(
    'marks declared malformed Gemini toolCalls %j partial',
    (toolCalls) => {
      const engine = make();
      const batch = engine.parse(
        'gemini-cli',
        bytes({ sessionId: 'local' }, geminiCall, { type: 'gemini', toolCalls }),
        selection,
      );
      expect(batch.reasons).toContain('invalid-tool-record');
      expect(batch.availability).toBe('partial');
      expect(engine.correlate(event, [engine.bind(batch, process, proof)], timing).strength).toBe(
        'inferred',
      );
    },
  );

  it.each([null, 1, 'PRIVATE_ENTRY', false, []])(
    'marks malformed Gemini toolCalls entry %j partial',
    (entry) => {
      const engine = make();
      const batch = engine.parse(
        'gemini-cli',
        bytes(
          { sessionId: 'local' },
          { ...geminiCall, toolCalls: [...geminiCall.toolCalls, entry] },
        ),
        selection,
      );
      expect(batch.reasons).toContain('invalid-tool-record');
      expect(batch.availability).toBe('partial');
      expect(engine.correlate(event, [engine.bind(batch, process, proof)], timing).strength).toBe(
        'inferred',
      );
    },
  );

  it('allows absent optional Gemini toolCalls without inventing loss', () => {
    const engine = make();
    const batch = engine.parse(
      'gemini-cli',
      bytes({ sessionId: 'local' }, geminiCall, { type: 'gemini', content: 'PRIVATE_PROMPT' }),
      selection,
    );
    expect(batch.availability).toBe('available');
    expect(engine.correlate(event, [engine.bind(batch, process, proof)], timing).strength).toBe(
      'confirmed',
    );
  });

  it.each(['1e309', '-1e309'])(
    'rejects recursive non-finite numeric argument %s without null digest dedup',
    (number) => {
      const engine = make();
      const raw = bytes(
        row([tool('same', { nested: [{ value: 'NONFINITE_SENTINEL' }] })]),
      ).toString();
      const overflow = engine.parse(
        'claude-code',
        Buffer.from(raw.replace('"NONFINITE_SENTINEL"', number)),
        selection,
      );
      const validNull = engine.parse(
        'claude-code',
        Buffer.from(raw.replace('"NONFINITE_SENTINEL"', 'null')),
        selection,
      );
      expect(overflow.availability).toBe('partial');
      expect(overflow.reasons).toContain('invalid-tool-arguments');
      expect(overflow.calls).toEqual([]);
      expect(validNull.availability).toBe('available');
      const bad = engine.bind(overflow, process, proof);
      const good = engine.bind(validNull, process, proof);
      expect(bad.strength).toBe('inferred');
      for (const selected of [
        [bad, good],
        [good, bad],
      ]) {
        const result = engine.correlate(event, selected, timing);
        expect(result.strength).toBe('inferred');
        expect(result.candidates).toHaveLength(1);
        expect(result.reasons).toContain('partial-source');
      }
      const unrelatedRaw = raw
        .replace('"sessionId":"local"', '"sessionId":"unrelated"')
        .replace('"NONFINITE_SENTINEL"', number);
      const unrelated = engine.parse('claude-code', Buffer.from(unrelatedRaw), {
        ...selection,
        sessionId: 'unrelated',
      });
      const otherProcess = { ...process, pid: 43, instanceId: `43:${birth}` };
      const otherProof = { ...proof, sessionId: 'unrelated', pid: 43 };
      const unrelatedBinding = engine.bind(unrelated, otherProcess, otherProof);
      for (const selected of [
        [unrelatedBinding, good],
        [good, unrelatedBinding],
      ]) {
        expect(engine.correlate(event, selected, timing).strength).toBe('confirmed');
      }
    },
  );

  it('keeps conflicting observations of one call distinct and ambiguous', () => {
    const engine = make();
    const first = engine.parse(
      'claude-code',
      bytes(row([tool('same', { version: 1 })])),
      selection,
    );
    const second = engine.parse(
      'claude-code',
      bytes(row([tool('same', { version: 2 })])),
      selection,
    );
    const result = engine.correlate(
      event,
      [engine.bind(first, process, proof), engine.bind(second, process, proof)],
      timing,
    );
    expect(result.strength).toBe('inferred');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.strength === 'inferred')).toBe(true);
  });

  it('does not exceed the combined candidate budget across individually bounded batches', () => {
    const engine = make();
    const selected = [0, 1].map((part) => {
      const batch = engine.parse(
        'claude-code',
        bytes(row(Array.from({ length: 130 }, (_, i) => tool(`${part}-${i}`)))),
        selection,
      );
      return engine.bind(batch, process, proof);
    });
    const result = engine.correlate(event, selected, timing);
    expect(result).toMatchObject({ strength: 'unattributed', candidates: [] });
    expect(result.reasons).toContain('candidate-limit');
    expect(
      engine.correlate(event, Array(LIMITS.calls + 1).fill(selected[0]), timing).strength,
    ).toBe('unattributed');
  });

  it('consumes a lifetime binding-attempt budget without retaining unbounded mappings', () => {
    const engine = make();
    for (let i = 0; i < LIMITS.records; i++) engine.bind(null, null, null);
    const batch = engine.parse('claude-code', bytes(row([tool('one')])), selection);
    expect(engine.bind(batch, process, proof).evidence).toEqual(['binding-limit']);
  });

  it('owns the digest key and returns detached frozen data after inputs change', () => {
    const key = Buffer.alloc(32, 7);
    const engine = createSessionContext({ digestKey: key });
    const raw = bytes(row([tool('one')]));
    const batch = engine.parse('claude-code', raw, selection);
    const before = JSON.stringify(batch);
    raw.fill(0);
    key.fill(0);
    expect(JSON.stringify(batch)).toBe(before);
    expect(engine.objectDigest('path', '/work/file', 'posix')).toBe(
      make().objectDigest('path', '/work/file', 'posix'),
    );
    const result = engine.correlate(event, [engine.bind(batch, process, proof)], timing);
    expect(result.strength).toBe('confirmed');
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
    expect(Object.isFrozen(result.candidates[0].reasons)).toBe(true);
  });

  it.each(['2026-02-30T10:00:01Z', '2026-10-19T24:00:00Z', '2026-10-19', null])(
    'preserves invalid calendar/time %j as null',
    (timestamp) => {
      const engine = make();
      const batch = engine.parse(
        'claude-code',
        bytes({ ...row([tool('one')]), timestamp }),
        selection,
      );
      expect(batch.calls[0].startMs).toBeNull();
    },
  );

  it('never confirms around other selected calls with unknown time or unsupported metadata', () => {
    const engine = make();
    const known = row([tool('known')]);
    const unknown = { ...row([tool('unknown')]), timestamp: null };
    const batch = engine.parse('claude-code', bytes(known, unknown), selection);
    expect(batch.availability).toBe('partial');
    expect(engine.correlate(event, [engine.bind(batch, process, proof)], timing).strength).toBe(
      'inferred',
    );
    const unsupported = row([{ ...tool('custom'), name: 'PRIVATE_TOOL' }]);
    const other = engine.parse('claude-code', bytes(known, unsupported), selection);
    expect(other.reasons).toContain('unsupported-tool-record');
    expect(engine.correlate(event, [engine.bind(other, process, proof)], timing).strength).toBe(
      'inferred',
    );
  });
  it('rejects unsupported sources, formats, missing selections and invalid event windows', () => {
    const engine = make();
    const raw = bytes(row([tool('one')]));
    expect(engine.parse('PRIVATE_PROVIDER', raw, selection)).toMatchObject({
      source: null,
      calls: [],
    });
    for (const selected of [
      null,
      {},
      { ...selection, cwd: 'relative' },
      { ...selection, platform: 'unknown' },
    ])
      expect(engine.parse('claude-code', raw, selected).reasons).toContain('invalid-selection');
    expect(engine.parse('claude-code', raw, { ...selection, format: 'xml' }).reasons).toContain(
      'unsupported-format',
    );
    expect(engine.correlate(null, [], timing).strength).toBe('unattributed');
    expect(engine.correlate(event, [], { ...timing, missingEndToleranceMs: -1 }).reasons).toContain(
      'invalid-time-tolerance',
    );
  });

  it('preserves invalid end state and downgrades source completeness', () => {
    const engine = make();
    const end = {
      type: 'user',
      sessionId: 'local',
      cwd: '/work',
      timestamp: '2026-10-19T09:59:59Z',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'one', content: 'PRIVATE_RESPONSE' }],
      },
    };
    const batch = engine.parse('claude-code', bytes(row([tool('one')]), end), selection);
    expect(batch.reasons).toContain('invalid-tool-end');
    expect(batch.calls[0].endMs).toBeNull();
    expect(engine.correlate(event, [engine.bind(batch, process, proof)], timing).strength).toBe(
      'inferred',
    );
  });
});
