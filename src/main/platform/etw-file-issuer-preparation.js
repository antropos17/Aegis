'use strict';

/** Select bounded current OS witnesses for readonly thread preparation.
 * These inputs never stamp a later file observation. New AI processes have
 * priority under the shared native handle cap; outages withdraw the scope.
 * @param {Object[]} agents Current annotated population.
 * @param {Object} health Current population/identity health.
 * @returns {Object[]} At most sixteen unique process targets. @since v0.19.2
 */
function selectIssuerTargets(agents, health) {
  if (
    !Array.isArray(agents) ||
    health?.populationReliable !== true ||
    health.identityDegraded === true
  )
    return [];
  const counts = new Map();
  for (const row of agents) counts.set(row.pid, (counts.get(row.pid) || 0) + 1);
  return agents
    .filter((row) => {
      if (
        row.category !== 'ai' ||
        !Number.isInteger(row.pid) ||
        row.pid <= 0 ||
        row.pid >= 0xffffffff ||
        counts.get(row.pid) !== 1 ||
        row.instanceIdSource !== 'os' ||
        typeof row.createTime100ns !== 'string' ||
        !/^[1-9]\d{0,19}$/.test(row.createTime100ns)
      )
        return false;
      const birth = BigInt(row.createTime100ns);
      if (birth > 0xffffffffffffffffn || birth <= 116444736000000000n) return false;
      const ms = (birth - 116444736000000000n) / 10000n;
      return ms <= BigInt(Number.MAX_SAFE_INTEGER) && row.instanceId === `${row.pid}:${ms}`;
    })
    .sort((a, b) =>
      a.createTime100ns === b.createTime100ns
        ? a.pid - b.pid
        : BigInt(a.createTime100ns) > BigInt(b.createTime100ns)
          ? -1
          : 1,
    )
    .slice(0, 16)
    .map(({ pid, createTime100ns }) => ({ pid, createTime100ns }));
}

/** Own one bounded, correlated preparation request outside renderer IPC.
 * A preparation receipt is scheduling evidence, never an event-time witness.
 * @param {Object} deps Current targets, monotonic clock, ID factory and sender.
 * @returns {Object} Flush, acknowledge, reset and detached private snapshot.
 * @since v0.19.2
 */
function createIssuerPreparation({ getTargets, mono, id, send }) {
  let pending = null,
    lastSignature = null,
    sentAt = null,
    receipt = null;
  const targets = () => (getTargets ? getTargets() : []);
  return {
    flush() {
      if (!getTargets) return;
      if (pending) {
        if (mono() - pending.at > 5000) throw new Error('etw-file:preparation-timeout');
        return;
      }
      const issuers = targets(),
        signature = JSON.stringify(issuers);
      if (
        (!issuers.length && lastSignature === null) ||
        (signature === lastSignature && mono() - sentAt < 20000)
      )
        return;
      const requestId = id();
      pending = { requestId, issuers: structuredClone(issuers), signature, at: mono() };
      try {
        if (!send('prime-issuers', { requestId, issuers })) {
          pending = null;
          return;
        }
        lastSignature = signature;
        sentAt = mono();
        receipt = null;
      } catch (error) {
        pending = null;
        throw error;
      }
    },
    accept(data) {
      if (
        !pending ||
        data.requestId !== pending.requestId ||
        data.prepared.some(
          (row) =>
            !pending.issuers.some(
              (target) => target.pid === row.pid && target.createTime100ns === row.createTime100ns,
            ),
        )
      )
        throw new Error('etw-file:unexpected-preparation');
      receipt = { data: structuredClone(data), signature: pending.signature };
      pending = null;
    },
    reset() {
      pending = null;
      lastSignature = null;
      sentAt = null;
      receipt = null;
    },
    snapshot() {
      return receipt && mono() - sentAt < 20000 && receipt.signature === JSON.stringify(targets())
        ? structuredClone(receipt.data)
        : null;
    },
  };
}
module.exports = { selectIssuerTargets, createIssuerPreparation };
