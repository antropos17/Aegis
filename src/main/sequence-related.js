'use strict';
const { assess } = require('./sequence-evidence');
const FRESH_MS = 30000;
const MAX_AGENTS = 4096;
const MAX_EDGES = 1024;
const MAX_NEIGHBORS = 64;
const MAX_PENDING = 256;
const keyOf = (edge) => JSON.stringify([edge.parentInstanceId, edge.childInstanceId]);
const valid = (a) =>
  a?.instanceIdSource === 'os' &&
  Number.isInteger(a.pid) &&
  a.pid > 0 &&
  typeof a.instanceId === 'string' &&
  a.instanceId.length > 0 &&
  a.instanceId.length <= 512;

/** Bounded direct-relative correlation; every step retains its original process identity.
 * @param {object[]} rules Opted-in file/TCP rules.
 * @param {Function} emit Engine publication callback.
 * @param {Function} evidence Build allowlisted step metadata.
 * @param {Function} now Observation clock.
 * @returns Related observation lifecycle and statistics.
 * @since 0.15.1
 */
function createRelated(rules, emit, evidence, now) {
  let edges = new Map(),
    neighbors = new Map(),
    snapshotAt = null,
    clock = -Infinity;
  const pending = new Map();
  const counters = {
    emitted: 0,
    evicted: 0,
    expired: 0,
    invalidated: 0,
    droppedEdges: 0,
    staleSnapshots: 0,
  };
  const clear = () => {
    counters.invalidated += pending.size;
    pending.clear();
    edges.clear();
    neighbors.clear();
    snapshotAt = null;
  };
  const sweep = (at) => {
    if (at < clock) clear();
    clock = at;
    if (snapshotAt !== null && at - snapshotAt > FRESH_MS) {
      counters.staleSnapshots++;
      clear();
    }
    for (const [id, anchor] of pending)
      if (at - anchor.at > anchor.rule.timespanMs) {
        pending.delete(id);
        counters.expired++;
      }
  };
  return {
    observePopulation(agents, reliable) {
      const at = now();
      sweep(at);
      if (!reliable || !Array.isArray(agents) || agents.length > MAX_AGENTS) {
        clear();
        return;
      }
      const byId = new Map(),
        pids = new Set(),
        duplicate = new Set();
      for (const a of agents)
        if (valid(a)) {
          if (byId.has(a.instanceId) || pids.has(a.pid)) duplicate.add(a.pid);
          byId.set(a.instanceId, a);
          pids.add(a.pid);
        }
      const next = new Map(),
        adjacent = new Map();
      for (const child of byId.values()) {
        const relation = child.parentRelation;
        const parent = byId.get(relation?.parentInstanceId);
        if (
          !parent ||
          relation.source !== 'fresh-process-table' ||
          parent.pid !== relation.parentPid ||
          parent.instanceId === child.instanceId ||
          duplicate.has(parent.pid) ||
          duplicate.has(child.pid)
        )
          continue;
        const edge = {
          parentInstanceId: parent.instanceId,
          childInstanceId: child.instanceId,
          parentPid: parent.pid,
          childPid: child.pid,
          source: 'fresh-process-table',
          observedAt: at,
        };
        const ids = [parent.instanceId, child.instanceId];
        if (
          next.size >= MAX_EDGES ||
          ids.some((id) => (adjacent.get(id)?.size ?? 0) >= MAX_NEIGHBORS)
        ) {
          counters.droppedEdges++;
          continue;
        }
        const edgeKey = keyOf(edge);
        next.set(edgeKey, edge);
        for (const id of ids) {
          if (!adjacent.has(id)) adjacent.set(id, new Set());
          adjacent.get(id).add(edgeKey);
        }
      }
      for (const [key, anchor] of pending) {
        for (const edgeKey of anchor.edges.keys())
          if (!next.has(edgeKey)) anchor.edges.delete(edgeKey);
        if (!anchor.edges.size) {
          pending.delete(key);
          counters.invalidated++;
        }
      }
      edges = next;
      neighbors = adjacent;
      snapshotAt = at;
    },
    ingest(key, doc, categories, at) {
      sweep(at);
      if (snapshotAt === null || !neighbors.has(key)) return;
      for (const rule of rules) {
        if (categories.includes('file') && rule.steps[0].matcher(doc)) {
          const id = JSON.stringify([rule.id, key]);
          if (!pending.has(id) && pending.size >= MAX_PENDING) {
            pending.delete(pending.keys().next().value);
            counters.evicted++;
          }
          pending.delete(id);
          pending.set(id, {
            rule,
            at,
            evidence: evidence(rule.steps[0], doc, at, true),
            edges: new Map(
              [...neighbors.get(key)].map((edgeKey) => [edgeKey, { at: snapshotAt, reported: -1 }]),
            ),
          });
        }
        if (!categories.includes('network') || !rule.steps[1].matcher(doc)) continue;
        const network = evidence(rule.steps[1], doc, at, true);
        for (const edgeKey of neighbors.get(key)) {
          const edge = edges.get(edgeKey);
          const other =
            key === edge.parentInstanceId ? edge.childInstanceId : edge.parentInstanceId;
          const anchor = pending.get(JSON.stringify([rule.id, other]));
          const earlier = anchor?.edges.get(edgeKey);
          if (!earlier || at <= anchor.at) continue;
          const pidFor = (id) => (id === edge.parentInstanceId ? edge.parentPid : edge.childPid);
          if (network.pid !== pidFor(key) || anchor.evidence.pid !== pidFor(other)) continue;
          const steps = [anchor.evidence, network];
          const level = assess(rule, steps).level;
          const score = level === 'informational' ? 0 : 30;
          if (score <= earlier.reported) continue;
          earlier.reported = score;
          counters.emitted++;
          emit(
            rule,
            key,
            {
              agent: network.agent ?? '',
              pid: network.pid ?? null,
              evidence: steps,
              relationship: {
                ...edge,
                fileObservedAt: anchor.at,
                fileRelationObservedAt: earlier.at,
                causalLink: 'unproven',
              },
            },
            at,
          );
        }
      }
    },
    close(key) {
      for (const [id, edge] of edges)
        if (edge.parentInstanceId === key || edge.childInstanceId === key) {
          edges.delete(id);
          neighbors.get(edge.parentInstanceId)?.delete(id);
          neighbors.get(edge.childInstanceId)?.delete(id);
          for (const anchor of pending.values()) anchor.edges.delete(id);
        }
      for (const [id, anchor] of pending)
        if (!anchor.edges.size) {
          pending.delete(id);
          counters.invalidated++;
        }
    },
    clear,
    sweep,
    stats() {
      return {
        ...counters,
        edges: edges.size,
        pending: pending.size,
        freshnessMs: FRESH_MS,
        maxAgents: MAX_AGENTS,
        maxEdges: MAX_EDGES,
        maxNeighbors: MAX_NEIGHBORS,
        maxPending: MAX_PENDING,
      };
    },
  };
}
module.exports = { createRelated };
