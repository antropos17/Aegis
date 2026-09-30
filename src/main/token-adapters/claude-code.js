/**
 * @file claude-code.js
 * @module main/token-adapters/claude-code
 * @description Token-feed adapter for the Claude Code agent family. Reads ONLY the
 *   numeric `usage` blocks Claude Code persists to disk → honest measured
 *   (`estimated:false`) per-PID deltas; first adapter behind {@link module:main/token-feed}.
 *
 *   C-01 CHAIN (live disk — TRUST CODE OVER DOCS): proc {pid, startTime} →
 *   `sessions/<pid>.json` {sessionId, cwd, startedAt} → startedAt-guard rejects PID
 *   reuse → `projects/<enc-cwd>/<sessionId>.jsonl` → tail NEW bytes; parse
 *   `type==="assistant"` → dedup by `message.id` (a message spans N usage-repeating
 *   lines; per-line would N×-count) → delta. PRIVACY (gating): allowlist usage
 *   numbers + model + id only — never content, in objects or logs (errors use
 *   fixed codes); scope is monitored PIDs, no history sweep.
 *
 *   SUBAGENTS: delegated (Task) turns log to nested
 *   `projects/<enc>/<sessionId>/subagents/agent-*.jsonl` and ARE summed (see
 *   {@link module:main/token-adapters/claude-code-subagents}) — SAME line shape (so
 *   `_extractUsage` is reused), attributed to the MAIN session pid. Shared `seenIds`
 *   + per-file `subOffsets` block double-count; read independently of main activity.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../logger');
const { readSubagentUsage, readTranscriptBatch } = require('./claude-code-subagents');

/**
 * @typedef {Object} Proc
 * @property {number} pid - live process id (C-01 attribution key).
 * @property {string} [agent] - scanner display name, used by the feed for routing.
 * @property {number} startTime - live OS process-creation time (epoch ms), from the
 *   scan layer; compared against the registry to reject PID reuse.
 */

/**
 * @typedef {Object} UsageDelta
 * @property {number} pid - owning process (C-01).
 * @property {string} model - model id from the usage block (may be absent from the
 *   price table → cost approximate downstream; tokens stay measured).
 * @property {number} inputTokens - input_tokens + cache_creation + cache_read.
 * @property {number} outputTokens - output_tokens.
 * @property {{uncached:number, read:number, write5m:number, write1h:number, writeUnknown:number}} [inputBreakdown] - numeric cache categories only.
 * @property {boolean} estimated - always `false`: measured, not guessed.
 */

/** @type {string} stable adapter id used by the core registry. */
const id = 'claude-code';

/**
 * Max |registry.startedAt − live startTime| (ms) still treated as the SAME process.
 * Absorbs startup jitter yet rejects a reused PID (creation time off by min/hours);
 * bias toward rejection (honest empty) over mis-attribution. @type {number}
 */
const GUARD_TOLERANCE_MS = 60_000;

/**
 * @typedef {Object} SessionState
 * @property {number} offset - bytes of the MAIN transcript already consumed.
 * @property {Set<string>} seenIds - message.ids already counted (counts a
 *   boundary-straddling message once); SHARED across main + all subagent files.
 * @property {Map<string, number>} subOffsets - per-subagent-file byte offset
 *   (`agent-*.jsonl` path → bytes consumed); independent of `offset`.
 * @property {boolean} [skippingMain] - Discarding an oversized main record.
 * @property {Set<string>} [subSkipping] - Subagent files discarding oversized records.
 */

/** @type {Map<string, SessionState>} per-sessionId tail state. */
const sessions = new Map();

/** Injectable home dir (tests point this at a fixture root). @type {() => string} */
let _homedir = () => os.homedir();

/**
 * Injectable fs surface. `readRange(path, start, length)` returns a Buffer slice —
 * production reads only the new bytes, never the whole file.
 * @type {{ readFileSync: Function, existsSync: Function, statSync: Function, readdirSync: Function, readRange: Function }}
 */
let _fs = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  existsSync: (p) => fs.existsSync(p),
  statSync: (p) => fs.statSync(p),
  readdirSync: (p) => fs.readdirSync(p),
  readRange: (p, start, length) => {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.allocUnsafe(length);
      const bytesRead = fs.readSync(fd, buf, 0, length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  },
};

/** Injectable logger (DI, not vi.mock — dodges the ESM/CJS identity trap). */
let _log = logger;

/**
 * Encode an absolute cwd into Claude Code's `projects/` directory name. Lossy by
 * design (`:` `\` `/` `.` → `-`); we only forward-encode a known cwd and
 * existence-check the result — never reverse it. @param {string} cwd @returns {string}
 */
function _encodeCwd(cwd) {
  return String(cwd).replace(/[/\\:.]/g, '-');
}

/** True when `v` is a usable pid (finite integer > 0). @param {*} v @returns {boolean} */
function isPositivePid(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/**
 * Session registry belongs to the live process (PID-reuse guard): both timestamps
 * finite and within tolerance. @param {{ startedAt?: number }} registry
 * @param {{ startTime?: number }} proc @returns {boolean}
 */
function _passesGuard(registry, proc) {
  if (!registry || typeof registry.startedAt !== 'number') return false;
  if (!proc || typeof proc.startTime !== 'number') return false;
  return Math.abs(registry.startedAt - proc.startTime) <= GUARD_TOLERANCE_MS;
}

/**
 * Allowlist-extract measured usage from one parsed line; `null` for non-assistant
 * or usage-less lines (content-bearing lines drop first). @param {*} parsed
 * @returns {{ id: string, model: string, inputTokens: number, outputTokens: number, inputBreakdown?: {uncached:number, read:number, write5m:number, write1h:number, writeUnknown:number} }|null}
 */
function _extractUsage(parsed) {
  if (!parsed || parsed.type !== 'assistant') return null;
  const msg = parsed.message;
  if (!msg || !msg.usage || typeof msg.id !== 'string') return null;
  const u = msg.usage;
  const valid = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const num = (x) => (valid(x) ? x : 0);
  const uncached = num(u.input_tokens);
  const write = num(u.cache_creation_input_tokens);
  const read = num(u.cache_read_input_tokens);
  const inputTokens = uncached + write + read;
  const duration = u.cache_creation;
  const durationKnown =
    duration &&
    valid(duration.ephemeral_5m_input_tokens) &&
    valid(duration.ephemeral_1h_input_tokens) &&
    duration.ephemeral_5m_input_tokens + duration.ephemeral_1h_input_tokens === write;
  return {
    id: msg.id,
    model: typeof msg.model === 'string' ? msg.model : '',
    inputTokens,
    outputTokens: num(u.output_tokens),
    ...(write || read
      ? {
          inputBreakdown: {
            uncached,
            read,
            write5m: durationKnown ? duration.ephemeral_5m_input_tokens : 0,
            write1h: durationKnown ? duration.ephemeral_1h_input_tokens : 0,
            writeUnknown: durationKnown ? 0 : write,
          },
        }
      : {}),
  };
}

/** Get-or-create the tail state for a sessionId. @param {string} sessionId @returns {SessionState} */
function _stateFor(sessionId) {
  let st = sessions.get(sessionId);
  if (!st) {
    st = { offset: 0, seenIds: new Set(), subOffsets: new Map() };
    sessions.set(sessionId, st);
  }
  return st;
}

/**
 * Read the registry for one pid → parsed object or `null` (absent / unreadable /
 * malformed); never logs the file body. @param {number} pid @returns {*}
 */
function _readRegistry(pid) {
  const p = path.join(_homedir(), '.claude', 'sessions', `${pid}.json`);
  try {
    return JSON.parse(_fs.readFileSync(p, 'utf-8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Tail ONE proc's MAIN transcript → new measured deltas. Behaviour unchanged from
 * the original inline tail (offset/dedup machinery intact); failures degrade to `[]`.
 * Subagent files are handled separately so this never short-circuits them.
 * @param {string} tPath - absolute path to `<sessionId>.jsonl`.
 * @param {SessionState} st - session tail + dedup state. @param {number} pid - C-01 key.
 * @param {{remaining: number}} budget Shared byte budget for this readUsage call.
 * @returns {UsageDelta[]}
 */
function _tailMain(tPath, st, pid, budget) {
  if (!_fs.existsSync(tPath)) return [];
  const size = _fs.statSync(tPath).size;
  if (size < st.offset) {
    st.offset = 0; // file truncated/rotated → restart tail
    st.skippingMain = false;
  }
  if (size <= st.offset) return []; // nothing new

  const batch = readTranscriptBatch(tPath, size, st.offset, Boolean(st.skippingMain), _fs, budget);
  st.offset = batch.offset;
  st.skippingMain = batch.skipping;
  if (batch.oversized)
    _log.warn('token-feed:claude-code', 'oversized transcript records skipped', {
      error: 'transcript-record-too-large',
      count: batch.oversized,
    });

  const deltas = [];
  for (const line of batch.lines) {
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      _log.warn('token-feed:claude-code', 'skipped unparseable transcript line', {
        error: 'transcript-parse-failed',
      });
      continue;
    }
    const u = _extractUsage(parsed);
    if (!u || st.seenIds.has(u.id)) continue; // dedup by message.id
    st.seenIds.add(u.id);
    deltas.push({
      pid,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      ...(u.inputBreakdown ? { inputBreakdown: u.inputBreakdown } : {}),
      estimated: false,
    });
  }
  return deltas;
}

/**
 * Resolve one proc's session → new measured deltas from BOTH the main transcript and
 * its subagent transcripts. Subagent usage is read independently of main-file
 * activity (a subagent can append while the main agent is blocked on it) and shares
 * the pid (C-01). All failures degrade to `[]`. @param {Proc} proc @returns {UsageDelta[]}
 * @param {{remaining: number}} budget Shared call byte budget.
 */
function _readOneProc(proc, budget) {
  const pid = proc && proc.pid;
  if (!isPositivePid(pid)) return [];

  const registry = _readRegistry(pid);
  if (!_passesGuard(registry, proc)) return [];
  const { sessionId, cwd } = registry;
  if (typeof sessionId !== 'string' || typeof cwd !== 'string') return [];

  const projDir = path.join(_homedir(), '.claude', 'projects', _encodeCwd(cwd));
  const st = _stateFor(sessionId);

  const deltas = _tailMain(path.join(projDir, `${sessionId}.jsonl`), st, pid, budget);
  const sessionDir = path.join(projDir, sessionId);
  for (const d of readSubagentUsage(sessionDir, st, _extractUsage, _fs, _log, budget)) {
    deltas.push({ pid, ...d }); // C-01: subagent tokens → MAIN session pid
  }
  return deltas;
}

/**
 * Read new measured token deltas for the given live processes. Non-idempotent: a
 * second call with no newly-appended bytes returns `[]` (already emitted), matching
 * the accumulating contract of the downstream token-tracker.
 * @param {Proc[]} procs - live processes enriched with OS `startTime`.
 * @returns {Promise<UsageDelta[]>} @since v0.10.0-alpha
 */
async function readUsage(procs) {
  if (!Array.isArray(procs) || procs.length === 0) return [];
  const out = [];
  const budget = { remaining: 4 * 1024 * 1024 };
  for (const proc of procs) {
    if (budget.remaining <= 0) break;
    let deltas;
    try {
      deltas = _readOneProc(proc, budget);
    } catch {
      _log.warn('token-feed:claude-code', 'adapter read failed for a pid', {
        error: 'adapter-read-failed',
      });
      continue;
    }
    for (const d of deltas) out.push(d);
  }
  return out;
}

/** @internal Override the home dir (tests). @param {() => string} fn */
function _setHomedirForTest(fn) {
  _homedir = fn;
}

/** @internal Override the fs surface (tests). @param {Partial<typeof _fs>} obj */
function _setFsForTest(obj) {
  _fs = { ..._fs, ...obj };
}

/** @internal Override the logger (tests). @param {*} obj */
function _setLoggerForTest(obj) {
  _log = obj;
}

/** @internal Reset all module state + DI seams (tests). @returns {void} */
function _resetForTest() {
  sessions.clear();
  _homedir = () => os.homedir();
  _log = logger;
}

module.exports = {
  id,
  agentNames: Object.freeze(['Claude Code']),
  GUARD_TOLERANCE_MS,
  readUsage,
  _encodeCwd,
  _extractUsage,
  _passesGuard,
  _setHomedirForTest,
  _setFsForTest,
  _setLoggerForTest,
  _resetForTest,
};
