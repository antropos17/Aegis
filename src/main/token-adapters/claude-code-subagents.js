/**
 * @file claude-code-subagents.js
 * @module main/token-adapters/claude-code-subagents
 * @description Subagent-transcript reader for the Claude Code token-feed adapter.
 *   Claude Code logs delegated (Task) turns to a nested folder
 *   `projects/<enc-cwd>/<sessionId>/subagents/agent-*.jsonl`, SIBLING to the main
 *   `<sessionId>.jsonl`. Each line is shaped exactly like the main transcript
 *   (`type:"assistant"` → `message.{id,model,usage}`), so the SAME `_extractUsage`
 *   parser from {@link module:main/token-adapters/claude-code} is reused verbatim —
 *   this module never re-implements parsing. Historically only the main transcript
 *   was summed, so heavily-delegated sessions undercounted; this module closes that
 *   gap WITHOUT touching the main tail/guard/dedup machinery.
 *
 *   VERIFIED ON LIVE DISK (2026-06-05 — TRUST CODE OVER DOCS):
 *     - path: `projects/<enc>/<sessionId>/subagents/agent-<id>.jsonl` (subagents/
 *       nested under a folder named exactly <sessionId>, beside <sessionId>.jsonl);
 *     - a sidecar `agent-<id>.meta.json` carries {agentType, toolUseId} only — NO
 *       usage, NO pid — and is excluded by the strict `agent-*.jsonl` glob;
 *     - subagent lines repeat one `message.id` across N content-block lines (same
 *       N×-count hazard as the main file) → intra-file dedup by id is REQUIRED;
 *     - a subagent's `message.model` differs from the main session (e.g. sonnet
 *       under an opus session) → model is taken PER LINE, never hardcoded;
 *     - `message.id`s are globally unique, so cross-file double-count never occurs,
 *       but the caller's shared `seenIds` is still used (it also closes intra-file).
 *
 *   STATE OWNERSHIP: this module is pure of module-level state. The caller
 *   (claude-code.js) owns the `SessionState` and passes it in; tail position lives
 *   in `state.subOffsets` (one byte-offset PER agent file) and dedup in the shared
 *   `state.seenIds`. ATTRIBUTION: deltas are returned PIDLESS — a subagent is not a
 *   separate OS process, so the caller stamps the MAIN session pid (C-01). All
 *   failure modes (no folder, unreadable, malformed line) degrade to honest empty.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

const path = require('path');

/**
 * @typedef {import('./claude-code').UsageDelta} UsageDelta
 * @typedef {{ offset: number, seenIds: Set<string>, subOffsets: Map<string, number> }} SessionState
 */

/** Only `agent-<anything>.jsonl` — excludes the `agent-*.meta.json` sidecars. */
const AGENT_FILE_RE = /^agent-.*\.jsonl$/;

/**
 * List the session's subagent transcript files (absolute paths, sorted for
 * deterministic order). Returns `[]` when the folder is absent or unreadable.
 * @param {string} sessionDir - `projects/<enc>/<sessionId>` (the folder beside the
 *   main `<sessionId>.jsonl`).
 * @param {{ existsSync: Function, readdirSync: Function }} fs - injected fs surface.
 * @returns {string[]}
 */
function _listAgentFiles(sessionDir, fs) {
  const dir = path.join(sessionDir, 'subagents');
  if (!fs.existsSync(dir)) return [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_err) {
    return [];
  }
  if (!Array.isArray(names)) return [];
  return names
    .filter((n) => typeof n === 'string' && AGENT_FILE_RE.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Tail ONE agent file from its remembered byte offset, emitting measured deltas
 * for newly-seen `message.id`s. Mirrors the main transcript tail: advance only by
 * complete-line bytes, dedup with the shared `seenIds`. All failures → `[]`.
 * @param {string} file - absolute path to an `agent-*.jsonl`.
 * @param {SessionState} state - caller-owned tail + dedup state.
 * @param {(parsed:*) => ({id:string,model:string,inputTokens:number,outputTokens:number}|null)} extractUsage
 * @param {{ statSync: Function, readRange: Function }} fs - injected fs surface.
 * @param {{ warn: Function }} log - injected logger (allowlist `{ error }` only).
 * @returns {Array<{ model: string, inputTokens: number, outputTokens: number, estimated: false }>}
 */
function _tailAgentFile(file, state, extractUsage, fs, log) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch (_err) {
    return []; // file vanished between listdir and stat
  }

  const prev = state.subOffsets.get(file) || 0;
  let offset = prev;
  if (size < offset) offset = 0; // truncated/rotated → restart tail
  if (size <= offset) {
    state.subOffsets.set(file, offset);
    return []; // nothing new
  }

  const buf = fs.readRange(file, offset, size - offset);
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl === -1) return []; // no complete line yet; re-read next call

  const complete = buf.subarray(0, lastNl + 1);
  state.subOffsets.set(file, offset + complete.length); // advance by BYTES

  const deltas = [];
  for (const line of complete.toString('utf-8').split('\n')) {
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      log.warn('token-feed:claude-code', 'skipped unparseable subagent line', {
        error: err.message,
      });
      continue;
    }
    const u = extractUsage(parsed);
    if (!u || state.seenIds.has(u.id)) continue; // dedup by message.id (intra + cross + main)
    state.seenIds.add(u.id);
    deltas.push({
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      estimated: false,
    });
  }
  return deltas;
}

/**
 * Read new measured token deltas across ALL of a session's subagent transcripts.
 * Pidless by contract — the caller stamps the main session pid (C-01). Reuses the
 * caller's `extractUsage` and shared `seenIds`; keeps a byte offset per agent file
 * in `state.subOffsets`. A missing/empty/unreadable `subagents/` yields `[]`.
 * @param {string} sessionDir - `projects/<enc>/<sessionId>`.
 * @param {SessionState} state - caller-owned tail + dedup state.
 * @param {Function} extractUsage - the main adapter's `_extractUsage` (not duplicated).
 * @param {{ existsSync: Function, readdirSync: Function, statSync: Function, readRange: Function }} fs
 * @param {{ warn: Function }} log - injected logger.
 * @returns {Array<{ model: string, inputTokens: number, outputTokens: number, estimated: false }>}
 * @since v0.10.0-alpha
 */
function readSubagentUsage(sessionDir, state, extractUsage, fs, log) {
  const files = _listAgentFiles(sessionDir, fs);
  if (files.length === 0) return [];
  const out = [];
  for (const file of files) {
    let deltas;
    try {
      deltas = _tailAgentFile(file, state, extractUsage, fs, log);
    } catch (err) {
      log.warn('token-feed:claude-code', 'subagent read failed for a file', { error: err.message });
      continue;
    }
    for (const d of deltas) out.push(d);
  }
  return out;
}

module.exports = { readSubagentUsage, _listAgentFiles, AGENT_FILE_RE };
