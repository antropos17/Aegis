'use strict';

const { randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { readHandoffLines } = require('./handoff-reader');

const LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  lineBytes: 64 * 1024,
  records: 10000,
  events: 2000,
  identifierBytes: 256,
  identities: 2000,
  diagnostics: 32,
});
const KINDS = Object.freeze({ SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop' });
const identifier = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted identifiers.
  !/[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(value) &&
  Buffer.byteLength(value, 'utf8') <= LIMITS.identifierBytes;

/**
 * Import metadata from explicitly selected Claude lifecycle JSONL. Report-local
 * references cannot bind OS processes or correlate across imports. Raw identifiers
 * and content remain confined to this invocation; no monitoring modules are used.
 * @param {string} adapter Supported adapter ID (claude-code).
 * @param {string} filename Explicit regular file.
 * @returns {Promise<object>} Redacted metadata and input-processing completeness.
 * @since v0.15.1
 */
async function importHandoffEvents(adapter, filename) {
  if (adapter !== 'claude-code') throw new Error('handoff-adapter-unsupported');
  const sourceId = randomUUID();
  const report = {
    schemaVersion: 1,
    mode: 'handoff-import',
    adapter: { id: adapter, version: 1, support: 'experimental', producerVersion: 'unknown' },
    sourceId,
    provenance: 'imported-unverified',
    processBinding: 'unbound',
    transferEvidence: 'unobserved',
    activityCoverage: 'unknown',
    complete: true,
    completenessScope: 'selected-input-processing',
    inputAvailable: false,
    limits: LIMITS,
    usage: { bytes: 0, records: 0, identities: 0 },
    counts: { accepted: 0, rejected: 0, unsupported: 0, diagnostics: 0 },
    diagnostics: [],
    events: [],
  };
  const issue = (code, record) => {
    report.complete = false;
    report.counts.diagnostics++;
    if (report.diagnostics.length < LIMITS.diagnostics)
      report.diagnostics.push(record === undefined ? { code } : { code, record });
  };
  const sessions = new Map();
  const agents = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const reject = (code, record) => {
    report.counts.rejected++;
    issue(code, record);
    return true;
  };
  const onLine = (line, ordinal) => {
    if (report.events.length >= LIMITS.events) {
      issue('event-limit', ordinal);
      return false;
    }
    if (line === null) return reject('line-size-limit', ordinal);
    let parsed;
    try {
      parsed = JSON.parse(decoder.decode(line));
    } catch (_) {
      return reject('invalid-json-record', ordinal);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return reject('invalid-event-record', ordinal);
    if (typeof parsed.hook_event_name !== 'string') return reject('missing-event-kind', ordinal);
    if (!Object.hasOwn(KINDS, parsed.hook_event_name)) {
      report.counts.unsupported++;
      issue('unsupported-event', ordinal);
      return true;
    }
    if (!identifier(parsed.session_id) || !identifier(parsed.agent_id))
      return reject('invalid-identifier', ordinal);
    const sessionKey = parsed.session_id;
    const agentKey = JSON.stringify([sessionKey, parsed.agent_id]);
    const needed = Number(!sessions.has(sessionKey)) + Number(!agents.has(agentKey));
    if (report.usage.identities + needed > LIMITS.identities) {
      issue('identity-limit', ordinal);
      return false;
    }
    if (!sessions.has(sessionKey)) sessions.set(sessionKey, `${sourceId}:s${sessions.size + 1}`);
    if (!agents.has(agentKey)) agents.set(agentKey, `${sourceId}:a${agents.size + 1}`);
    report.usage.identities += needed;
    report.events.push({
      kind: KINDS[parsed.hook_event_name],
      record: ordinal,
      sessionRef: sessions.get(sessionKey),
      agentRef: agents.get(agentKey),
    });
    report.counts.accepted++;
    return true;
  };
  try {
    const usage = await readHandoffLines(filename, LIMITS, onLine, issue);
    report.inputAvailable = usage.available;
    report.usage.bytes = usage.bytes;
    report.usage.records = usage.records;
    return report;
  } finally {
    sessions.clear();
    agents.clear();
  }
}

module.exports = { importHandoffEvents, LIMITS };
