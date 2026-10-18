'use strict';
const { verifiedIssuer, validObservation } = require('./etw-file-schema');

/** Label only an already verified issuer matching the full, freshly observed witness.
 * The renderer's millisecond instanceId alone cannot distinguish same-ms PID reuse.
 * Candidate paths remain candidate paths; this snapshot never enters FileEvent sinks.
 * @param {Object|undefined} snapshot Bounded local diagnostic snapshot.
 * @param {Object[]} agents Current annotated population.
 * @param {Object} health Current population/identity health.
 * @returns {Object|undefined} Copy with optional agent labels. @since v0.19.2
 */
function attributeDiagnostics(snapshot, agents, health) {
  if (!snapshot) return snapshot;
  const reliable = health?.populationReliable === true && health.identityDegraded !== true;
  return {
    ...snapshot,
    records: snapshot.records.map((record) => {
      const unlabelled = { ...record, agent: null, instanceId: null };
      if (!reliable || !verifiedIssuer(record)) return unlabelled;
      const epochMs = Number((BigInt(record.generationWitness) - 116444736000000000n) / 10000n);
      if (!Number.isSafeInteger(epochMs) || epochMs <= 0) return unlabelled;
      const matches = agents.filter(
        (row) =>
          row.pid === record.issuerPid &&
          row.createTime100ns === record.generationWitness &&
          row.instanceIdSource === 'os' &&
          row.instanceId === `${row.pid}:${epochMs}` &&
          typeof row.agent === 'string' &&
          row.agent.length > 0,
      );
      return matches.length === 1
        ? { ...record, agent: matches[0].agent, instanceId: matches[0].instanceId }
        : unlabelled;
    }),
  };
}
/** Retain a bounded, metadata-only display of scoped read candidates. Labels are
 * stamped once at intake; later process exit or PID reuse cannot relabel history.
 * This view has no FileEvent, audit, scoring, baseline or sequence sink.
 * @param {Object} deps Current agents/health, path classifier and optional clock.
 * @returns {Object} Intake, detached display snapshot and session reset.
 * @since v0.19.2
 */
function createReadView({ getAgents, getHealth, classifySensitive, now = Date.now }) {
  let rows = [],
    bytes = 0,
    omitted = 0,
    lastSeq = 0n;
  return {
    reset() {
      rows = [];
      bytes = 0;
      omitted = 0;
      lastSeq = 0n;
    },
    accept(records) {
      const scoped = records.filter(
        (r) => validObservation(r) && r.eventId === 15 && r.path !== null,
      );
      const labelled = attributeDiagnostics({ records: scoped }, getAgents(), getHealth()).records;
      for (const r of labelled) {
        const seq = BigInt(r.eventSeq);
        if (seq <= lastSeq) continue;
        lastSeq = seq;
        const pid = r.agent === null ? null : r.issuerPid;
        const existing = rows.find(
          ({ value }) =>
            value.path === r.path &&
            value.pathEvidence === r.pathEvidence &&
            value.instanceId === r.instanceId &&
            value.pid === pid,
        );
        if (existing) {
          existing.value.reads++;
          existing.value.observedAt = now();
          continue;
        }
        const reason = classifySensitive(r.path);
        const value = {
          id: r.eventSeq,
          agent: r.agent,
          instanceId: r.instanceId,
          pid,
          path: r.path,
          pathEvidence: r.pathEvidence,
          sensitiveReason: typeof reason === 'string' ? reason.slice(0, 1024) : null,
          reads: 1,
          observedAt: now(),
        };
        const cost = Buffer.byteLength(JSON.stringify(value)) * 2 + 256;
        while (rows.length && (rows.length >= 64 || bytes + cost > 128 * 1024)) {
          const old = rows.shift();
          bytes -= old.cost;
          omitted += old.value.reads;
        }
        if (cost > 128 * 1024) {
          omitted++;
          continue;
        }
        rows.push({ cost, value });
        bytes += cost;
      }
    },
    snapshot: () => ({ reads: rows.map((row) => ({ ...row.value })), omitted }),
  };
}
module.exports = { attributeDiagnostics, createReadView };
