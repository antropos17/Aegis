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
 *     - on these live subagent files each `message.id` appeared on exactly ONE
 *       line (1 line/id); the N×-per-id repeat was NOT reproduced on subagents.
 *       That N×-count hazard is CONFIRMED only on the MAIN transcript (live: 86
 *       usage lines → 25 ids, one id spanning up to 7 lines). Subagent lines share
 *       the SAME line shape, so the SAME intra-file dedup by id is applied
 *       DEFENSIVELY — identical to the main path, not because it fired on today's
 *       files;
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
 * @typedef {import('./claude-code').SessionState} SessionState
 */

/** Only `agent-<anything>.jsonl` — excludes the `agent-*.meta.json` sidecars. */
const AGENT_FILE_RE = /^agent-.*\.jsonl$/;
const READ_CHUNK_BYTES = 64 * 1024;
const FILE_TICK_BYTES = 1024 * 1024;
const MAX_LINE_BYTES = 512 * 1024;

/** Read complete UTF-8 lines within byte budgets, without retaining transcript content.
 * An incomplete supported line is reread next tick. Oversized lines are skipped
 * through their newline; callers report a fixed diagnostic rather than parse fragments.
 * @param {string} file Transcript path.
 * @param {number} size Observed file byte size.
 * @param {number} start Previously consumed byte offset.
 * @param {boolean} skipping Whether an oversized line is being discarded.
 * @param {{readRange: Function}} fs Injected bounded reader.
 * @param {{remaining: number}} budget Shared call budget.
 * @returns {{lines: string[], offset: number, skipping: boolean, oversized: number}}
 * @since 0.18.0
 */
function readTranscriptBatch(file, size, start, skipping, fs, budget) {
  if (!Number.isSafeInteger(size) || size < 0) throw Error('transcript-size-invalid');
  let position = start;
  let offset = start;
  let spent = 0;
  let parts = [];
  let lineBytes = 0;
  let oversized = 0;
  const lines = [];
  while (position < size && spent < FILE_TICK_BYTES && budget.remaining > 0) {
    const length = Math.min(
      READ_CHUNK_BYTES,
      size - position,
      FILE_TICK_BYTES - spent,
      budget.remaining,
    );
    budget.remaining -= length;
    spent += length;
    const chunk = fs.readRange(file, position, length);
    if (!Buffer.isBuffer(chunk) || chunk.length > length) throw Error('transcript-read-invalid');
    if (!chunk.length) break;
    let cursor = 0;
    while (cursor < chunk.length) {
      const newline = chunk.indexOf(0x0a, cursor);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(cursor, end);
      if (!skipping) {
        if (lineBytes + segment.length > MAX_LINE_BYTES) {
          skipping = true;
          oversized++;
          parts = [];
          lineBytes = 0;
        } else {
          parts.push(segment);
          lineBytes += segment.length;
        }
      }
      if (newline < 0) break;
      if (!skipping) lines.push(Buffer.concat(parts, lineBytes).toString('utf8'));
      skipping = false;
      parts = [];
      lineBytes = 0;
      cursor = newline + 1;
      offset = position + cursor;
    }
    position += chunk.length;
    if (skipping) offset = position;
    if (chunk.length < length) break;
  }
  return { lines, offset, skipping, oversized };
}

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
 * @param {{ warn: Function }} log - injected logger (fixed error codes only).
 * @param {{remaining: number}} budget Shared call byte budget.
 * @returns {Array<{ model: string, inputTokens: number, outputTokens: number, estimated: false }>}
 */
function _tailAgentFile(file, state, extractUsage, fs, log, budget) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch (_err) {
    return []; // file vanished between listdir and stat
  }

  const prev = state.subOffsets.get(file) || 0;
  let offset = prev;
  state.subSkipping ??= new Set();
  if (size < offset) {
    offset = 0; // truncated/rotated → restart tail
    state.subSkipping.delete(file);
  }
  if (size <= offset) {
    state.subOffsets.set(file, offset);
    return []; // nothing new
  }

  const batch = readTranscriptBatch(file, size, offset, state.subSkipping.has(file), fs, budget);
  state.subOffsets.set(file, batch.offset);
  if (batch.skipping) state.subSkipping.add(file);
  else state.subSkipping.delete(file);
  if (batch.oversized)
    log.warn('token-feed:claude-code', 'oversized transcript records skipped', {
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
      log.warn('token-feed:claude-code', 'skipped unparseable subagent line', {
        error: 'subagent-transcript-parse-failed',
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
 * @param {{remaining: number}} [budget] Shared call byte budget.
 * @returns {Array<{ model: string, inputTokens: number, outputTokens: number, estimated: false }>}
 * @since v0.10.0-alpha
 */
function readSubagentUsage(
  sessionDir,
  state,
  extractUsage,
  fs,
  log,
  budget = { remaining: 4 * FILE_TICK_BYTES },
) {
  const files = _listAgentFiles(sessionDir, fs);
  if (files.length === 0) return [];
  const out = [];
  for (const file of files) {
    if (budget.remaining <= 0) break;
    let deltas;
    try {
      deltas = _tailAgentFile(file, state, extractUsage, fs, log, budget);
    } catch {
      log.warn('token-feed:claude-code', 'subagent read failed for a file', {
        error: 'subagent-read-failed',
      });
      continue;
    }
    for (const d of deltas) out.push(d);
  }
  return out;
}

module.exports = { readSubagentUsage, readTranscriptBatch, _listAgentFiles, AGENT_FILE_RE };
