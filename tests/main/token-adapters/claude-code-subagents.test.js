/**
 * @file claude-code-subagents.test.js
 * @description RED-first suite for the Claude Code SUBAGENT transcript reader.
 *   Claude Code logs delegated (Task) turns to a nested folder
 *   `projects/<enc>/<sessionId>/subagents/agent-*.jsonl` whose lines are shaped
 *   exactly like the main transcript (`type:"assistant"` → `message.{id,model,usage}`).
 *   The main adapter historically summed ONLY the main `<sessionId>.jsonl`, so any
 *   heavily-delegated session undercounted. This suite pins the fix:
 *     (a) distinct subagent ids across agent-1/agent-2 → summed,
 *     (b) one message split over N lines within a file → counted ×1, never ×N,
 *     (c) an id already in the shared `seenIds` (a main-file message) → not re-counted,
 *     (d) per-delta model is the LINE's model (sub=sonnet ≠ main=opus) — never hardcoded,
 *     (e) `.meta.json` sidecars are ignored — only `agent-*.jsonl` is read,
 *     (f) per-file byte offset means a re-read with no new bytes emits nothing,
 *     (g) a missing/empty `subagents/` degrades to [] (honest empty, never throws),
 *     (h) the tail's READ POSITION is pinned at the source: the first read starts at
 *         byte 0 and advances `subOffsets` to EOF; a no-append re-read NEVER re-reads
 *         from 0. This is asserted on the `readRange` start arg — NOT on emptiness —
 *         because the shared `seenIds` would swallow a re-read-from-0 regression and
 *         leave (f) green. (h) catches that regression independent of `seenIds`.
 *   plus an end-to-end pin through the adapter: subagent tokens attribute to the
 *   MAIN session pid (C-01) and BOTH models surface in the final deltas.
 *
 *   All fixtures are injected via DI (in-memory fs surface + caller-owned state) —
 *   no live disk, deterministic CI. No vi.mock (ESM/CJS identity trap); the helper
 *   carries no module state, so the test owns every byte of mutable state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import subagents from '../../../src/main/token-adapters/claude-code-subagents.js';
import adapter from '../../../src/main/token-adapters/claude-code.js';

const { readSubagentUsage } = subagents;
const {
  readUsage,
  _encodeCwd,
  _extractUsage,
  _setHomedirForTest,
  _setFsForTest,
  _setLoggerForTest,
  _resetForTest,
} = adapter;

const HOME = path.join('/fake', 'home');
const STARTED = 1_700_000_000_000;

/**
 * In-memory fs over a { path: utf8-content } map, byte-accurate, WITH a
 * directory-aware `readdirSync` (basenames whose dirname === the queried dir).
 */
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
      if (store.has(p)) return true;
      // a directory "exists" when any stored file lives under it
      const prefix = p.endsWith(path.sep) ? p : p + path.sep;
      for (const key of store.keys()) if (key.startsWith(prefix)) return true;
      return false;
    },
    statSync(p) {
      if (!store.has(p)) throw enoent(p);
      return { size: Buffer.byteLength(store.get(p), 'utf-8') };
    },
    readRange(p, start, length) {
      const buf = Buffer.from(store.get(p), 'utf-8');
      return buf.subarray(start, start + length);
    },
    readdirSync(dir) {
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      const names = [];
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes(path.sep)) names.push(rest); // direct child only
      }
      return names;
    },
  };
}

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

const sessionsPath = (pid) => path.join(HOME, '.claude', 'sessions', `${pid}.json`);
const projectDir = (cwd) => path.join(HOME, '.claude', 'projects', _encodeCwd(cwd));
const transcriptPath = (cwd, sid) => path.join(projectDir(cwd), `${sid}.jsonl`);
const sessionDirPath = (cwd, sid) => path.join(projectDir(cwd), sid);
const subagentFile = (cwd, sid, name) => path.join(sessionDirPath(cwd, sid), 'subagents', name);

const registry = ({ pid, sessionId, cwd, startedAt = STARTED }) =>
  JSON.stringify({
    pid,
    sessionId,
    cwd,
    startedAt,
    procStart: '639162008149103680',
    status: 'idle',
  });

/** Fresh caller-owned tail state, mirroring claude-code.js SessionState. */
const freshState = () => ({ offset: 0, seenIds: new Set(), subOffsets: new Map() });

const logWarn = vi.fn();
const log = { warn: logWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  _resetForTest();
  logWarn.mockClear();
  _setHomedirForTest(() => HOME);
  _setLoggerForTest(log);
});

describe('readSubagentUsage — helper (DI, caller-owned state)', () => {
  const CWD = 'X:\\proj';
  const SID = 'sid-sub';
  const dir = sessionDirPath(CWD, SID);

  it('(a) sums distinct ids across agent-1 and agent-2, pidless deltas', () => {
    const fs = makeFs({
      [subagentFile(CWD, SID, 'agent-1.jsonl')]: jsonl(
        assistantLine({ id: 's1', model: 'claude-sonnet-4-6', input: 10, output: 1 }),
      ),
      [subagentFile(CWD, SID, 'agent-2.jsonl')]: jsonl(
        assistantLine({ id: 's2', model: 'claude-sonnet-4-6', input: 20, output: 2 }),
      ),
    });
    const st = freshState();

    const out = readSubagentUsage(dir, st, _extractUsage, fs, log);

    const byInput = out.map((d) => d.inputTokens).sort((a, b) => a - b);
    expect(byInput).toEqual([10, 20]);
    // pidless: caller stamps pid, helper must not invent one
    for (const d of out) {
      expect(d.estimated).toBe(false);
      expect('pid' in d).toBe(false);
    }
  });

  it('(b) counts one message split over N lines within a file exactly once', () => {
    const dup = () =>
      assistantLine({
        id: 'msgDUP',
        model: 'claude-sonnet-4-6',
        input: 100,
        cacheCreate: 50,
        output: 7,
      });
    const fs = makeFs({
      [subagentFile(CWD, SID, 'agent-1.jsonl')]: jsonl(dup(), dup(), userLine('noise'), dup()),
    });
    const st = freshState();

    const out = readSubagentUsage(dir, st, _extractUsage, fs, log);

    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(150); // 100 + 50, NOT ×3
    expect(out[0].outputTokens).toBe(7);
  });

  it('(c) does not re-count an id already present in shared seenIds (cross-file/main dedup)', () => {
    const fs = makeFs({
      [subagentFile(CWD, SID, 'agent-1.jsonl')]: jsonl(
        assistantLine({ id: 'shared', model: 'claude-sonnet-4-6', input: 99, output: 9 }),
        assistantLine({ id: 'fresh', model: 'claude-sonnet-4-6', input: 5, output: 1 }),
      ),
    });
    const st = freshState();
    st.seenIds.add('shared'); // pretend the main transcript already counted it

    const out = readSubagentUsage(dir, st, _extractUsage, fs, log);

    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(5); // only the fresh id
  });

  it('(d) per-delta model is the line model, never hardcoded', () => {
    const fs = makeFs({
      [subagentFile(CWD, SID, 'agent-1.jsonl')]: jsonl(
        assistantLine({ id: 's1', model: 'claude-sonnet-4-6', input: 1, output: 1 }),
        assistantLine({ id: 'h1', model: 'claude-haiku-4-5', input: 2, output: 1 }),
      ),
    });
    const st = freshState();

    const out = readSubagentUsage(dir, st, _extractUsage, fs, log);

    const models = out.map((d) => d.model).sort();
    expect(models).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
  });

  it('(e) ignores .meta.json sidecars — reads only agent-*.jsonl', () => {
    const fs = makeFs({
      [subagentFile(CWD, SID, 'agent-1.jsonl')]: jsonl(
        assistantLine({ id: 's1', model: 'claude-sonnet-4-6', input: 7, output: 1 }),
      ),
      // a sidecar that, if globbed as agent-*, would be a JSON object with no usage
      [subagentFile(CWD, SID, 'agent-1.meta.json')]: JSON.stringify({
        agentType: 'researcher',
        toolUseId: 'toolu_x',
      }),
    });
    const st = freshState();

    const out = readSubagentUsage(dir, st, _extractUsage, fs, log);

    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(7);
    expect(logWarn).not.toHaveBeenCalled(); // .meta.json never parsed → no warn
  });

  it('(f) per-file offset: a re-read with no new bytes emits nothing; an append emits only the new id', () => {
    const file = subagentFile(CWD, SID, 'agent-1.jsonl');
    const fs = makeFs({
      [file]: jsonl(assistantLine({ id: 'a', model: 'claude-sonnet-4-6', input: 1, output: 1 })),
    });
    const st = freshState();

    expect(readSubagentUsage(dir, st, _extractUsage, fs, log)).toHaveLength(1);
    expect(readSubagentUsage(dir, st, _extractUsage, fs, log)).toEqual([]); // no new bytes

    fs.store.set(
      file,
      jsonl(
        assistantLine({ id: 'a', model: 'claude-sonnet-4-6', input: 1, output: 1 }),
        assistantLine({ id: 'b', model: 'claude-sonnet-4-6', input: 4, output: 2 }),
      ),
    );
    const third = readSubagentUsage(dir, st, _extractUsage, fs, log);
    expect(third).toHaveLength(1);
    expect(third[0].inputTokens).toBe(4);
  });

  it('(g) missing or empty subagents/ degrades to [] without throwing', () => {
    const st = freshState();
    // no subagents dir at all
    expect(readSubagentUsage(dir, st, _extractUsage, makeFs({}), log)).toEqual([]);
    // dir present but no agent files (only a sidecar)
    const onlyMeta = makeFs({
      [subagentFile(CWD, SID, 'agent-1.meta.json')]: '{}',
    });
    expect(readSubagentUsage(dir, st, _extractUsage, onlyMeta, log)).toEqual([]);
  });

  it('(h) offset is pinned at the readRange call site: first read starts at 0 and advances to EOF; a no-append re-read never re-reads from 0 (seenIds-independent regression guard)', () => {
    const file = subagentFile(CWD, SID, 'agent-1.jsonl');
    // A multibyte char in the line content makes file BYTES > char count, so the
    // `subOffsets === size` assert below pins a BYTE-exact advance, not a char one.
    const fs = makeFs({
      [file]: jsonl(
        assistantLine({
          id: 'o1',
          model: 'claude-sonnet-4-6',
          input: 11,
          output: 1,
          content: '日本語',
        }),
        assistantLine({ id: 'o2', model: 'claude-sonnet-4-6', input: 22, output: 2 }),
      ),
    });
    const size = fs.statSync(file).size; // byte length (multibyte → > char length)
    // Spy that STILL calls through to the real in-memory reader (vi.spyOn default),
    // so behaviour is unchanged — we only capture the (start, length) it was handed.
    const readRangeSpy = vi.spyOn(fs, 'readRange');
    const st = freshState();

    // 1st read: two fresh ids. The tail MUST start at byte 0 and read the whole file,
    // then advance subOffsets to EOF (byte-exact).
    const first = readSubagentUsage(dir, st, _extractUsage, fs, log);
    expect(first).toHaveLength(2);
    expect(readRangeSpy).toHaveBeenCalledTimes(1);
    expect(readRangeSpy.mock.calls[0][1]).toBe(0); // start === 0
    expect(readRangeSpy.mock.calls[0][2]).toBe(size); // length === whole file (bytes)
    expect(st.subOffsets.get(file)).toBe(size); // advanced to EOF in BYTES, not left at 0

    const callsAfterFirst = readRangeSpy.mock.calls.length;

    // 2nd read, file UNCHANGED. Honesty pin: even though seenIds alone would swallow
    // the duplicate ids and leave the result [] (so an emptiness assert can't tell a
    // correct tail from a broken one), the tail must NOT re-read from byte 0. The
    // correct code early-returns at `size <= offset` BEFORE readRange; a regression
    // that ignored subOffsets would call readRange(start=0) here — caught below.
    const second = readSubagentUsage(dir, st, _extractUsage, fs, log);
    expect(second).toEqual([]); // no new bytes → no new deltas
    const secondCalls = readRangeSpy.mock.calls.slice(callsAfterFirst);
    for (const call of secondCalls) {
      // if it read at all, it read FROM EOF — never rewound to 0
      expect(call[1]).toBe(size);
      expect(call[1]).not.toBe(0);
    }
    expect(st.subOffsets.get(file)).toBe(size); // offset unchanged, no rewind

    readRangeSpy.mockRestore();
  });
});

describe('adapter readUsage — end-to-end subagent summation (C-01 + multi-model)', () => {
  it('attributes subagent tokens to the MAIN session pid and surfaces BOTH models', async () => {
    const cwd = 'X:\\proj';
    const sid = 'sid-e2e';
    const pid = 4321;
    _setFsForTest(
      makeFs({
        [sessionsPath(pid)]: registry({ pid, sessionId: sid, cwd }),
        [transcriptPath(cwd, sid)]: jsonl(
          assistantLine({ id: 'main1', model: 'claude-opus-4-8', input: 1000, output: 100 }),
        ),
        [subagentFile(cwd, sid, 'agent-1.jsonl')]: jsonl(
          assistantLine({ id: 'sub1', model: 'claude-sonnet-4-6', input: 30, output: 3 }),
          assistantLine({ id: 'sub1', model: 'claude-sonnet-4-6', input: 30, output: 3 }), // dup id
          assistantLine({ id: 'sub2', model: 'claude-sonnet-4-6', input: 40, output: 4 }),
        ),
      }),
    );

    const out = await readUsage([{ pid, startTime: STARTED }]);

    // every delta attributed to the one live pid (C-01)
    for (const d of out) expect(d.pid).toBe(pid);

    // main opus + two distinct subagent ids (dup collapsed) = 3 deltas
    const inputs = out.map((d) => d.inputTokens).sort((a, b) => a - b);
    expect(inputs).toEqual([30, 40, 1000]);

    // both model families present per-delta
    const models = new Set(out.map((d) => d.model));
    expect(models.has('claude-opus-4-8')).toBe(true);
    expect(models.has('claude-sonnet-4-6')).toBe(true);
  });

  it('counts subagent appends while the MAIN transcript is byte-idle (no lump-on-resume loss)', async () => {
    const cwd = 'X:\\idle';
    const sid = 'sid-idle';
    const pid = 7000;
    const agentFile = subagentFile(cwd, sid, 'agent-1.jsonl');
    const fs = makeFs({
      [sessionsPath(pid)]: registry({ pid, sessionId: sid, cwd }),
      [transcriptPath(cwd, sid)]: jsonl(
        assistantLine({ id: 'main1', model: 'claude-opus-4-8', input: 1000, output: 100 }),
      ),
      [agentFile]: jsonl(
        assistantLine({ id: 'sub1', model: 'claude-sonnet-4-6', input: 30, output: 3 }),
      ),
    });
    _setFsForTest(fs);
    const proc = [{ pid, startTime: STARTED }];

    const first = await readUsage(proc);
    expect(first.map((d) => d.inputTokens).sort((a, b) => a - b)).toEqual([30, 1000]);

    // MAIN stays byte-identical; only the subagent file grows.
    fs.store.set(
      agentFile,
      jsonl(
        assistantLine({ id: 'sub1', model: 'claude-sonnet-4-6', input: 30, output: 3 }),
        assistantLine({ id: 'sub2', model: 'claude-sonnet-4-6', input: 40, output: 4 }),
      ),
    );

    const second = await readUsage(proc);
    expect(second).toHaveLength(1);
    expect(second[0].inputTokens).toBe(40); // sub2 only — NOT lost behind an idle main file
    expect(second[0].pid).toBe(pid);
  });

  it('a session with no subagents/ folder is unchanged (main-only deltas)', async () => {
    const cwd = 'X:\\solo';
    const sid = 'sid-solo';
    const pid = 5555;
    _setFsForTest(
      makeFs({
        [sessionsPath(pid)]: registry({ pid, sessionId: sid, cwd }),
        [transcriptPath(cwd, sid)]: jsonl(
          assistantLine({ id: 'm1', model: 'claude-opus-4-8', input: 12, output: 2 }),
        ),
      }),
    );

    const out = await readUsage([{ pid, startTime: STARTED }]);

    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(12);
    expect(out[0].pid).toBe(pid);
  });
});
