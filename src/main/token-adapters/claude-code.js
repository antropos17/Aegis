/**
 * @file claude-code.js
 * @module main/token-adapters/claude-code
 * @description Token-feed adapter for the Claude Code agent family. Claude Code
 *   persists its own decrypted per-turn `usage` block to local disk; this adapter
 *   reads ONLY those numeric counts and returns them as honest, measured
 *   (`estimated:false`) per-PID token deltas. It is the first concrete adapter
 *   behind the extensible {@link module:main/token-feed} core.
 *
 *   VERIFIED C-01 CHAIN (live disk, 2026-06-04 — TRUST CODE OVER DOCS):
 *     proc {pid, startTime}
 *       → ~/.claude/sessions/<pid>.json   { sessionId, cwd, startedAt }
 *       → startedAt-guard rejects PID reuse (|startedAt − startTime| ≤ tolerance)
 *       → ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *       → tail only NEW bytes since last offset; parse only `type==="assistant"`
 *       → dedup by `message.id` (one message spans many content-block lines, each
 *         repeating the same usage — counting per-line would N×-count)
 *       → { pid, model, inputTokens, outputTokens, estimated:false }
 *
 *   PRIVACY INVARIANT (gating): allowlist-extract ONLY the numeric usage fields +
 *   model + message id. Message content (prompts/responses) is never read into a
 *   returned object and never written to any log — on a parse error we log only
 *   `{ error }`, never the offending line. Scope is limited to the monitored PIDs
 *   passed in; we never sweep unrelated project history.
 *
 *   `procStart` in the registry is an opaque .NET-ticks-like string (version
 *   fragile) — the guard deliberately uses `startedAt` (clean epoch-ms) instead.
 *
 *   SCOPE / KNOWN LIMITATION: reads the main session transcript only. Subagent
 *   turns are logged to separate `projects/<enc>/<sessionId>/subagents/agent-*.jsonl`
 *   files; their usage is NOT yet summed, so heavily-delegated sessions undercount.
 *   This is honest-but-partial (never over-counts) and a deliberate later extension.
 *
 *   The line shape (`type:"assistant"` with `message.{id,model,usage}`) and the
 *   3-bucket input sum were validated against a live `2.1.x` transcript, not docs.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../logger');

/**
 * @typedef {Object} Proc
 * @property {number} pid - live process id (C-01 attribution key).
 * @property {number} startTime - live OS process-creation time (epoch ms),
 *   supplied by the scan layer; compared against the registry to reject PID reuse.
 */

/**
 * @typedef {Object} UsageDelta
 * @property {number} pid - owning process (C-01).
 * @property {string} model - model id from the usage block (may be absent from
 *   the price table → cost becomes approximate downstream; tokens stay measured).
 * @property {number} inputTokens - input_tokens + cache_creation + cache_read.
 * @property {number} outputTokens - output_tokens.
 * @property {boolean} estimated - always `false`: these are measured, not guessed.
 */

/** @type {string} stable adapter id used by the core registry. */
const id = 'claude-code';

/**
 * Max |registry.startedAt − live startTime| (ms) still considered the SAME
 * process. Generous enough to absorb startup jitter (startedAt is written a beat
 * after process birth), tight enough that a reused PID — whose real creation time
 * differs by minutes/hours — is rejected. Bias is toward rejection (honest empty)
 * over mis-attribution.
 * @type {number}
 */
const GUARD_TOLERANCE_MS = 60_000;

/**
 * @typedef {Object} SessionState
 * @property {number} offset - bytes of the transcript already consumed.
 * @property {Set<string>} seenIds - message.ids already counted (persists across
 *   calls so a message whose blocks straddle a tail boundary is counted once).
 */

/** @type {Map<string, SessionState>} per-sessionId tail state. */
const sessions = new Map();

/** Injectable home dir (tests point this at a fixture root). @type {() => string} */
let _homedir = () => os.homedir();

/**
 * Injectable fs surface. `readRange(path, start, length)` returns a Buffer of the
 * byte slice — production reads only the new bytes, never the whole file.
 * @type {{ readFileSync: Function, existsSync: Function, statSync: Function, readRange: Function }}
 */
let _fs = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  existsSync: (p) => fs.existsSync(p),
  statSync: (p) => fs.statSync(p),
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
 * Encode an absolute cwd into Claude Code's `projects/` directory name. The
 * encoding is lossy by design (`:` `\` `/` `.` all collapse to `-`); we only
 * forward-encode a known cwd and existence-check the result — never reverse it.
 * @param {string} cwd
 * @returns {string}
 */
function _encodeCwd(cwd) {
  return String(cwd).replace(/[/\\:.]/g, '-');
}

/**
 * True when `v` is a usable pid (finite integer > 0).
 * @param {*} v
 * @returns {boolean}
 */
function isPositivePid(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/**
 * Decide whether a session registry belongs to the live process (PID-reuse
 * guard). Both timestamps must be finite numbers and agree within tolerance.
 * @param {{ startedAt?: number }} registry
 * @param {{ startTime?: number }} proc
 * @returns {boolean}
 */
function _passesGuard(registry, proc) {
  if (!registry || typeof registry.startedAt !== 'number') return false;
  if (!proc || typeof proc.startTime !== 'number') return false;
  return Math.abs(registry.startedAt - proc.startTime) <= GUARD_TOLERANCE_MS;
}

/**
 * Allowlist-extract the measured usage from one parsed transcript line. Returns
 * `null` for any line that is not an assistant message carrying a usage block, so
 * prompt/content-bearing lines are dropped before any content field is touched.
 * @param {*} parsed - a parsed JSONL line object.
 * @returns {{ id: string, model: string, inputTokens: number, outputTokens: number }|null}
 */
function _extractUsage(parsed) {
  if (!parsed || parsed.type !== 'assistant') return null;
  const msg = parsed.message;
  if (!msg || !msg.usage || typeof msg.id !== 'string') return null;
  const u = msg.usage;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const inputTokens =
    num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
  return {
    id: msg.id,
    model: typeof msg.model === 'string' ? msg.model : '',
    inputTokens,
    outputTokens: num(u.output_tokens),
  };
}

/** Get-or-create the tail state for a sessionId. @param {string} sessionId @returns {SessionState} */
function _stateFor(sessionId) {
  let st = sessions.get(sessionId);
  if (!st) {
    st = { offset: 0, seenIds: new Set() };
    sessions.set(sessionId, st);
  }
  return st;
}

/**
 * Read the registry for one pid. Returns the parsed object or `null` (absent /
 * unreadable / malformed) — never logs the file body.
 * @param {number} pid
 * @returns {*}
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
 * Resolve and tail one proc's transcript, returning new measured deltas. All
 * failure modes degrade to `[]` (honest empty) without throwing.
 * @param {Proc} proc
 * @returns {UsageDelta[]}
 */
function _readOneProc(proc) {
  const pid = proc && proc.pid;
  if (!isPositivePid(pid)) return [];

  const registry = _readRegistry(pid);
  if (!_passesGuard(registry, proc)) return [];
  const { sessionId, cwd } = registry;
  if (typeof sessionId !== 'string' || typeof cwd !== 'string') return [];

  const tPath = path.join(_homedir(), '.claude', 'projects', _encodeCwd(cwd), `${sessionId}.jsonl`);
  if (!_fs.existsSync(tPath)) return [];

  const size = _fs.statSync(tPath).size;
  const st = _stateFor(sessionId);
  if (size < st.offset) st.offset = 0; // file truncated/rotated → restart tail
  if (size <= st.offset) return []; // nothing new

  const buf = _fs.readRange(tPath, st.offset, size - st.offset);
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl === -1) return []; // no complete line yet; re-read next call

  const complete = buf.subarray(0, lastNl + 1);
  st.offset += complete.length; // advance by BYTES (size is byte-counted)

  const deltas = [];
  for (const line of complete.toString('utf-8').split('\n')) {
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      _log.warn('token-feed:claude-code', 'skipped unparseable transcript line', {
        error: err.message,
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
      estimated: false,
    });
  }
  return deltas;
}

/**
 * Read new measured token deltas for the given live processes. Non-idempotent by
 * design: a second call with no newly-appended transcript bytes returns `[]`
 * (the deltas were already emitted), which matches the accumulating contract of
 * the downstream token-tracker.
 * @param {Proc[]} procs - live processes enriched with OS `startTime`.
 * @returns {Promise<UsageDelta[]>}
 * @since v0.10.0-alpha
 */
async function readUsage(procs) {
  if (!Array.isArray(procs) || procs.length === 0) return [];
  const out = [];
  for (const proc of procs) {
    let deltas;
    try {
      deltas = _readOneProc(proc);
    } catch (err) {
      _log.warn('token-feed:claude-code', 'adapter read failed for a pid', {
        error: err.message,
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
