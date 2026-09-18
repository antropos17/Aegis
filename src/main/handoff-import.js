'use strict';

const { createAgentEventReceiver, LIMITS: RECEIVER_LIMITS } = require('./agent-event-receiver');
const { readHandoffLines } = require('./handoff-reader');

const LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  lineBytes: RECEIVER_LIMITS.lineBytes,
  records: RECEIVER_LIMITS.attempts,
  events: RECEIVER_LIMITS.events,
  identifierBytes: RECEIVER_LIMITS.identifierBytes,
  identities: RECEIVER_LIMITS.identities,
  diagnostics: 32,
});
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
  const receiver = createAgentEventReceiver();
  const source = receiver.register('claude-code-offline');
  const { sourceId } = source;
  const report = {
    schemaVersion: 2,
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
    receiver.markLoss(source);
    report.counts.diagnostics++;
    if (report.diagnostics.length < LIMITS.diagnostics)
      report.diagnostics.push(record === undefined ? { code } : { code, record });
  };
  const onLine = (line, ordinal) => {
    const result = receiver.receive(source, ordinal, line);
    if (result.status === 'accepted') {
      report.events.push(result.event);
      report.counts.accepted++;
      return true;
    }
    if (!result.stop) report.counts[result.status]++;
    issue(result.code, ordinal);
    return !result.stop;
  };
  try {
    const usage = await readHandoffLines(filename, LIMITS, onLine, issue);
    report.inputAvailable = usage.available;
    report.usage.bytes = usage.bytes;
    report.usage.records = usage.records;
    return report;
  } finally {
    report.receiver = receiver.close(source);
    report.usage.identities = report.receiver.identities;
  }
}

module.exports = { importHandoffEvents, LIMITS };
