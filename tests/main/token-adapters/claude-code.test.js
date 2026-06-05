/**
 * @file claude-code.test.js
 * @description Regression + privacy suite for the Claude Code token-feed adapter.
 *   All fixtures are injected via DI (fake homedir + in-memory fs + spy logger) —
 *   no live disk, so CI is deterministic. The three RED-first regression anchors
 *   are: (2) message.id dedup (one message spread over N lines counts ×1, not ×N),
 *   (4) startedAt-guard rejects PID reuse, (6) privacy — output carries no content.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import adapter from '../../../src/main/token-adapters/claude-code.js';

const {
  id,
  readUsage,
  GUARD_TOLERANCE_MS,
  _encodeCwd,
  _extractUsage,
  _passesGuard,
  _setHomedirForTest,
  _setFsForTest,
  _setLoggerForTest,
  _resetForTest,
} = adapter;

const HOME = path.join('/fake', 'home');
const STARTED = 1_700_000_000_000; // arbitrary epoch-ms used by every fixture

/** Build an in-memory fs over a { path: utf8-content } map (byte-accurate). */
function makeFs(files) {
  const store = new Map(Object.entries(files));
  const enoent = (p) => {
    const e = new Error(`ENOENT: no such file ${p}`);
    e.code = 'ENOENT';
    return e;
  };
  return {
    store,
    readFileSync(p) {
      if (!store.has(p)) throw enoent(p);
      return store.get(p);
    },
    existsSync(p) {
      return store.has(p);
    },
    statSync(p) {
      if (!store.has(p)) throw enoent(p);
      return { size: Buffer.byteLength(store.get(p), 'utf-8') };
    },
    readRange(p, start, length) {
      const buf = Buffer.from(store.get(p), 'utf-8');
      return buf.subarray(start, start + length);
    },
  };
}

const sessionsPath = (pid) => path.join(HOME, '.claude', 'sessions', `${pid}.json`);
const transcriptPath = (cwd, sessionId) =>
  path.join(HOME, '.claude', 'projects', _encodeCwd(cwd), `${sessionId}.jsonl`);

const registry = ({ pid, sessionId, cwd, startedAt = STARTED }) =>
  JSON.stringify({
    pid,
    sessionId,
    cwd,
    startedAt,
    procStart: '639162008149103680',
    status: 'idle',
  });

function assistantLine({
  id: msgId,
  model = 'claude-opus-4-8',
  input = 0,
  cacheCreate = 0,
  cacheRead = 0,
  output = 0,
  content,
}) {
  const message = {
    id: msgId,
    type: 'message',
    role: 'assistant',
    model,
    usage: {
      input_tokens: input,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
      output_tokens: output,
    },
  };
  if (content !== undefined) message.content = content;
  return JSON.stringify({ type: 'assistant', message });
}

const userLine = (content) => JSON.stringify({ type: 'user', message: { role: 'user', content } });
const jsonl = (...lines) => lines.join('\n') + '\n';

const logWarn = vi.fn();

beforeEach(() => {
  _resetForTest();
  logWarn.mockClear();
  _setHomedirForTest(() => HOME);
  _setLoggerForTest({ warn: logWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() });
});

describe('claude-code adapter — identity', () => {
  it('declares a stable adapter id', () => {
    expect(id).toBe('claude-code');
  });
});

describe('pure parsers', () => {
  it('_encodeCwd collapses : \\ / . to - (verified live encoding)', () => {
    expect(_encodeCwd('X:\\Future\\ESCAPE\\AEGIS')).toBe('X--Future-ESCAPE-AEGIS');
    expect(_encodeCwd('C:\\Users\\murtu')).toBe('C--Users-murtu');
    expect(_encodeCwd('/home/u/.config/app')).toBe('-home-u--config-app');
  });

  it('_extractUsage sums the three input buckets and keeps output separate', () => {
    const parsed = JSON.parse(
      assistantLine({ id: 'm1', input: 10, cacheCreate: 5, cacheRead: 2, output: 7 }),
    );
    expect(_extractUsage(parsed)).toEqual({
      id: 'm1',
      model: 'claude-opus-4-8',
      inputTokens: 17,
      outputTokens: 7,
    });
  });

  it('_extractUsage returns null for non-assistant or usage-less lines', () => {
    expect(_extractUsage(JSON.parse(userLine('hi')))).toBeNull();
    expect(
      _extractUsage(JSON.parse(JSON.stringify({ type: 'assistant', message: { id: 'x' } }))),
    ).toBeNull();
  });

  it('_passesGuard accepts within tolerance, rejects beyond it and on missing fields', () => {
    expect(_passesGuard({ startedAt: STARTED }, { startTime: STARTED })).toBe(true);
    expect(_passesGuard({ startedAt: STARTED }, { startTime: STARTED + GUARD_TOLERANCE_MS })).toBe(
      true,
    );
    expect(
      _passesGuard({ startedAt: STARTED }, { startTime: STARTED + GUARD_TOLERANCE_MS + 1 }),
    ).toBe(false);
    expect(_passesGuard({ startedAt: STARTED }, {})).toBe(false);
    expect(_passesGuard({}, { startTime: STARTED })).toBe(false);
  });
});

describe('readUsage — happy path (real tokens, estimated:false)', () => {
  it('returns one delta per distinct message.id with summed input buckets', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-aaa';
    _setFsForTest(
      makeFs({
        [sessionsPath(1234)]: registry({ pid: 1234, sessionId: sid, cwd }),
        [transcriptPath(cwd, sid)]: jsonl(
          assistantLine({ id: 'm1', input: 10, cacheCreate: 5, cacheRead: 2, output: 7 }),
          assistantLine({ id: 'm2', input: 100, output: 20 }),
        ),
      }),
    );

    const out = await readUsage([{ pid: 1234, startTime: STARTED }]);

    expect(out).toEqual([
      { pid: 1234, model: 'claude-opus-4-8', inputTokens: 17, outputTokens: 7, estimated: false },
      { pid: 1234, model: 'claude-opus-4-8', inputTokens: 100, outputTokens: 20, estimated: false },
    ]);
  });
});

describe('readUsage — message.id dedup (THE regression anchor)', () => {
  it('counts one message split across 5 lines exactly once, never ×5', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-dup';
    const dup = (extra) =>
      assistantLine({
        id: 'msgDUP',
        input: 8419,
        cacheCreate: 11335,
        cacheRead: 20060,
        output: 753,
        ...extra,
      });
    _setFsForTest(
      makeFs({
        [sessionsPath(42)]: registry({ pid: 42, sessionId: sid, cwd }),
        // mirrors live lines 18,19,20, (21 = non-assistant), 22,23 — all msgDUP
        [transcriptPath(cwd, sid)]: jsonl(
          dup(),
          dup(),
          dup(),
          userLine('UNRELATED USER PROMPT'),
          dup(),
          dup(),
        ),
      }),
    );

    const out = await readUsage([{ pid: 42, startTime: STARTED }]);

    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(8419 + 11335 + 20060); // 39814, NOT ×5
    expect(out[0].outputTokens).toBe(753);
  });
});

describe('readUsage — offset tailing & cross-call dedup', () => {
  it('emits nothing on a re-read with no new bytes, only new ids on append', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-tail';
    const fs = makeFs({
      [sessionsPath(7)]: registry({ pid: 7, sessionId: sid, cwd }),
      [transcriptPath(cwd, sid)]: jsonl(assistantLine({ id: 'a', input: 1, output: 1 })),
    });
    _setFsForTest(fs);
    const proc = [{ pid: 7, startTime: STARTED }];

    const first = await readUsage(proc);
    expect(first).toHaveLength(1);

    const second = await readUsage(proc);
    expect(second).toEqual([]); // nothing new

    // append a brand-new message id
    fs.store.set(
      transcriptPath(cwd, sid),
      jsonl(
        assistantLine({ id: 'a', input: 1, output: 1 }),
        assistantLine({ id: 'b', input: 2, output: 2 }),
      ),
    );
    const third = await readUsage(proc);
    expect(third).toHaveLength(1);
    expect(third[0].inputTokens).toBe(2);
  });

  it('does not re-count a message whose blocks straddle a read boundary', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-straddle';
    const blk = () => assistantLine({ id: 'split', input: 5, output: 5 });
    const fs = makeFs({
      [sessionsPath(9)]: registry({ pid: 9, sessionId: sid, cwd }),
      [transcriptPath(cwd, sid)]: jsonl(blk(), blk()),
    });
    _setFsForTest(fs);
    const proc = [{ pid: 9, startTime: STARTED }];

    const first = await readUsage(proc);
    expect(first).toHaveLength(1); // 2 blocks, one id → once

    // more blocks of the SAME message arrive after the boundary
    fs.store.set(transcriptPath(cwd, sid), jsonl(blk(), blk(), blk(), blk()));
    const second = await readUsage(proc);
    expect(second).toEqual([]); // same id already counted last call
  });
});

describe('readUsage — PID-reuse guard (regression anchor)', () => {
  it('returns [] when the live startTime diverges from registry.startedAt', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-reuse';
    _setFsForTest(
      makeFs({
        [sessionsPath(555)]: registry({ pid: 555, sessionId: sid, cwd, startedAt: STARTED }),
        [transcriptPath(cwd, sid)]: jsonl(assistantLine({ id: 'm', input: 9, output: 9 })),
      }),
    );

    const reused = await readUsage([{ pid: 555, startTime: STARTED + 36_000_000 }]); // +10h
    expect(reused).toEqual([]);

    const same = await readUsage([{ pid: 555, startTime: STARTED }]);
    expect(same).toHaveLength(1);
  });
});

describe('readUsage — missing sources are honest empties (never throw)', () => {
  it('returns [] for missing registry, missing transcript, and bad pids', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-x';
    _setFsForTest(
      makeFs({
        // registry present but transcript absent
        [sessionsPath(111)]: registry({ pid: 111, sessionId: sid, cwd }),
      }),
    );

    expect(await readUsage([{ pid: 999, startTime: STARTED }])).toEqual([]); // no registry
    expect(await readUsage([{ pid: 111, startTime: STARTED }])).toEqual([]); // no transcript
    expect(await readUsage([{ pid: -1, startTime: STARTED }])).toEqual([]); // bad pid
    expect(await readUsage([])).toEqual([]);
    expect(await readUsage(null)).toEqual([]);
  });
});

describe('readUsage — privacy invariant (regression anchor)', () => {
  it('returns only numeric/token keys and never surfaces message content', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-priv';
    const SECRET = 'SECRET_PROMPT_DO_NOT_LEAK';
    _setFsForTest(
      makeFs({
        [sessionsPath(8)]: registry({ pid: 8, sessionId: sid, cwd }),
        [transcriptPath(cwd, sid)]: jsonl(
          userLine(SECRET),
          assistantLine({
            id: 'm',
            input: 3,
            output: 4,
            content: [{ type: 'text', text: SECRET }],
          }),
        ),
      }),
    );

    const out = await readUsage([{ pid: 8, startTime: STARTED }]);

    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(
      ['estimated', 'inputTokens', 'model', 'outputTokens', 'pid'].sort(),
    );
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('logs only { error } on a malformed line — never the raw line content', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-bad';
    const SECRET = 'GARBAGE_WITH_SECRET';
    _setFsForTest(
      makeFs({
        [sessionsPath(8)]: registry({ pid: 8, sessionId: sid, cwd }),
        [transcriptPath(cwd, sid)]:
          `not json ${SECRET}\n` + jsonl(assistantLine({ id: 'm', input: 1, output: 1 })),
      }),
    );

    const out = await readUsage([{ pid: 8, startTime: STARTED }]);

    expect(out).toHaveLength(1); // the good line still counts
    expect(logWarn).toHaveBeenCalled();
    for (const call of logWarn.mock.calls) {
      const meta = call[2] || {};
      expect(Object.keys(meta)).toEqual(['error']);
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });
});

describe('readUsage — C-01 cross-PID isolation', () => {
  it('attributes each session to its own pid, never cross-wired', async () => {
    _setFsForTest(
      makeFs({
        [sessionsPath(100)]: registry({ pid: 100, sessionId: 's100', cwd: 'X:\\a' }),
        [sessionsPath(200)]: registry({ pid: 200, sessionId: 's200', cwd: 'X:\\b' }),
        [transcriptPath('X:\\a', 's100')]: jsonl(assistantLine({ id: 'a', input: 11, output: 1 })),
        [transcriptPath('X:\\b', 's200')]: jsonl(assistantLine({ id: 'b', input: 22, output: 2 })),
      }),
    );

    const out = await readUsage([
      { pid: 100, startTime: STARTED },
      { pid: 200, startTime: STARTED },
    ]);

    const byPid = Object.fromEntries(out.map((d) => [d.pid, d.inputTokens]));
    expect(byPid).toEqual({ 100: 11, 200: 22 });
  });
});
