'use strict';

const { TextDecoder } = require('node:util');
const { LIMITS, object, text, timestamp } = require('./session-context-value');

// Closed built-in subset. Shell commands are never parsed as object evidence.
const TOOLS = Object.freeze({
  'claude-code': {
    Read: ['read', 'path', 'file_path'],
    Write: ['write', 'path', 'file_path'],
    Edit: ['write', 'path', 'file_path'],
    Bash: ['shell'],
    WebFetch: ['fetch', 'endpoint', 'url'],
  },
  codex: { exec_command: ['shell'], shell_command: ['shell'], shell: ['shell'] },
  'gemini-cli': {
    read_file: ['read', 'path', 'file_path'],
    write_file: ['write', 'path', 'file_path'],
    replace: ['write', 'path', 'file_path'],
    run_shell_command: ['shell'],
    web_fetch: ['fetch'],
  },
});

/** Parse caller-selected complete bytes from real local record formats; no file IO.
 * @param {string} source claude-code, codex or gemini-cli.
 * @param {Buffer|null} bytes Caller-bounded file bytes; null means unavailable.
 * @param {object} selection Trusted selection: sessionId, cwd, platform, format, headTruncated/tailTruncated.
 * @param {object} values Private digest implementation.
 * @returns {object} Frozen privacy projection and private binding metadata.
 * @since v0.19.0 */
function parseRecords(source, bytes, selection, values) {
  const reasons = new Set();
  const calls = new Map();
  let sessionSeen = false;
  let incompatible = false;
  const supported = Object.hasOwn(TOOLS, source);
  const validSelection =
    object(selection) &&
    text(selection.sessionId) &&
    values.pathDigest(selection.cwd, selection.platform) !== null;
  const sessionRef =
    supported && validSelection ? values.digest(`session:${source}`, selection.sessionId) : null;
  const cwdDigest = validSelection ? values.pathDigest(selection.cwd, selection.platform) : null;
  function session(id, cwd) {
    if (
      id !== selection.sessionId ||
      (cwd !== undefined && values.pathDigest(cwd, selection.platform) !== cwdDigest)
    ) {
      reasons.add('session-mismatch');
      incompatible = true;
    } else sessionSeen = true;
  }
  function add(id, name, args, at) {
    if (!text(id) || !text(name) || !object(args)) {
      reasons.add('invalid-tool-record');
      return;
    }
    if (calls.size >= LIMITS.calls) {
      reasons.add('call-limit');
      return;
    }
    if (calls.has(id)) {
      reasons.add('duplicate-call-id');
      incompatible = true;
      return;
    }
    const spec = Object.hasOwn(TOOLS[source], name) ? TOOLS[source][name] : ['other'];
    if (spec[0] === 'other') reasons.add('unsupported-tool-record');
    const { argsDigest, reason } = values.projectArguments(args);
    if (reason !== null) {
      reasons.add(reason);
      return;
    }
    const startMs = timestamp(at);
    const objectDigest = spec[1]
      ? values.objectDigest(spec[1], args[spec[2]], selection.platform, selection.cwd)
      : null;
    const callReasons = [];
    if (startMs === null) {
      callReasons.push('timestamp-unavailable');
      reasons.add('timestamp-unavailable');
    }
    if (objectDigest === null) callReasons.push('object-unavailable');
    calls.set(id, {
      source,
      sessionRef,
      callRef: values.digest(`call:${source}`, `${selection.sessionId}\0${id}`),
      toolName: spec[0] === 'other' ? 'other' : name,
      argsDigest,
      argsShape: Object.freeze({
        operation: spec[0],
        objectKind: objectDigest === null ? 'none' : spec[1],
      }),
      objectDigest,
      startMs,
      endMs: null,
      reasons: callReasons,
    });
  }
  function finish(id, at) {
    const call = calls.get(id);
    if (!call) return;
    const end = timestamp(at);
    if (end === null || call.startMs === null || end < call.startMs) {
      reasons.add('invalid-tool-end');
      return;
    }
    if (call.endMs !== null) {
      reasons.add('duplicate-tool-end');
      incompatible = true;
      return;
    }
    call.endMs = end;
  }
  function historyEdit(row) {
    if (!['$rewindTo', '$patch', '$set'].some((key) => Object.hasOwn(row, key))) return false;
    reasons.add('unsupported-history-edit');
    incompatible = true;
    return true;
  }
  function consume(row) {
    if (!object(row)) {
      reasons.add('invalid-record');
      return;
    }
    if (source === 'claude-code') {
      if (!['assistant', 'user'].includes(row.type)) return;
      session(row.sessionId, row.cwd);
      const content = row.message?.content;
      if (!Array.isArray(content)) return;
      for (const part of content.slice(0, LIMITS.calls + 1)) {
        if (!object(part)) continue;
        if (row.type === 'assistant' && part.type === 'tool_use')
          add(part.id, part.name, part.input, row.timestamp);
        if (row.type === 'user' && part.type === 'tool_result')
          finish(part.tool_use_id, row.timestamp);
      }
      if (content.length > LIMITS.calls) reasons.add('call-limit');
    } else if (source === 'codex') {
      const p = row.payload;
      if (!object(p)) return;
      if (row.type === 'session_meta') {
        session(p.id, p.cwd);
        return;
      }
      if (row.type !== 'response_item') return;
      if (p.type === 'function_call') {
        let args;
        try {
          args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : null;
        } catch (_) {
          reasons.add('invalid-tool-arguments');
          return;
        }
        add(p.call_id, p.name, args, row.timestamp);
      } else if (p.type === 'function_call_output') finish(p.call_id, row.timestamp);
      else if (p.type === 'custom_tool_call' || p.type === 'local_shell_call')
        reasons.add('unsupported-tool-record');
    } else {
      if (historyEdit(row)) return;
      // JSONL metadata checkpoints with embedded history need replay semantics.
      if (Object.hasOwn(row, 'messages')) {
        reasons.add('unsupported-history-edit');
        incompatible = true;
        return;
      }
      if (Object.hasOwn(row, 'sessionId')) {
        if (row.type === 'gemini' || Object.hasOwn(row, 'toolCalls')) {
          reasons.add('invalid-session-metadata');
          incompatible = true;
          return;
        }
        session(row.sessionId);
        return;
      }
      if (!Object.hasOwn(row, 'toolCalls')) return;
      if (row.type !== 'gemini' || !Array.isArray(row.toolCalls)) {
        reasons.add('invalid-tool-record');
        return;
      }
      for (const call of row.toolCalls.slice(0, LIMITS.calls + 1)) {
        if (object(call)) add(call.id, call.name, call.args, call.timestamp);
        else reasons.add('invalid-tool-record');
      }
      if (row.toolCalls.length > LIMITS.calls) reasons.add('call-limit');
    }
  }
  if (!supported) reasons.add('unsupported-source');
  else if (!validSelection) reasons.add('invalid-selection');
  else if (bytes === null) reasons.add('source-unavailable');
  else if (!Buffer.isBuffer(bytes)) reasons.add('invalid-input');
  else if (bytes.length > LIMITS.bytes) reasons.add('oversize-input');
  else {
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (source === 'gemini-cli' && selection.format === 'json') {
        if (selection.headTruncated || selection.tailTruncated) reasons.add('truncated-input');
        else {
          const doc = JSON.parse(raw);
          if (!object(doc) || !Array.isArray(doc.messages)) reasons.add('invalid-record');
          else if (!historyEdit(doc)) {
            session(doc.sessionId);
            if (doc.messages.length > LIMITS.records) reasons.add('record-limit');
            for (const msg of doc.messages.slice(0, LIMITS.records)) consume(msg);
          }
        }
      } else if (selection.format !== undefined && selection.format !== 'jsonl')
        reasons.add('unsupported-format');
      else {
        let lines = raw.split('\n');
        if (selection.headTruncated) {
          lines.shift();
          reasons.add('truncated-input');
        }
        if (selection.tailTruncated || !raw.endsWith('\n')) {
          lines.pop();
          reasons.add('truncated-input');
        }
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        if (lines.length > LIMITS.records) reasons.add('record-limit');
        for (const line of lines.slice(0, LIMITS.records)) {
          if (!line.trim()) continue;
          if (Buffer.byteLength(line) > LIMITS.lineBytes) {
            reasons.add('oversize-record');
            continue;
          }
          let row;
          try {
            row = JSON.parse(line);
          } catch (_) {
            reasons.add('invalid-json-record');
            continue;
          }
          consume(row);
        }
      }
    } catch (_) {
      reasons.add('invalid-encoding-or-json');
    }
  }
  if (!sessionSeen && validSelection && supported) reasons.add('session-metadata-unavailable');
  const outputCalls =
    incompatible || !sessionSeen
      ? []
      : [...calls.values()].map((call) =>
          Object.freeze({
            ...call,
            reasons: Object.freeze(
              call.endMs === null ? [...call.reasons, 'end-time-unavailable'] : call.reasons,
            ),
          }),
        );
  const projection = Object.freeze({
    source: supported ? source : null,
    sessionRef,
    availability:
      sessionSeen && !incompatible ? (reasons.size ? 'partial' : 'available') : 'unavailable',
    reasons: Object.freeze([...reasons]),
    calls: Object.freeze(outputCalls),
  });
  return {
    projection,
    cwdDigest,
    platform: validSelection ? selection.platform : null,
    complete: reasons.size === 0,
  };
}

module.exports = { parseRecords };
