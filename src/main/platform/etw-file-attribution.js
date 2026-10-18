'use strict';
const { verifiedIssuer } = require('./etw-file-schema');

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
module.exports = { attributeDiagnostics };
