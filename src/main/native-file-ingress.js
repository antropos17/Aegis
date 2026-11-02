'use strict';
const { randomUUID } = require('node:crypto');
const { projectBoundReadObject } = require('../shared/bound-read-object');
const { EVIDENCE, makeAttribution } = require('./attribution');
const healthModel = require('./sensor-health');
const MAX_SOURCE_IDS = 4096;
const MAX_AGE_MS = 10000;
const cleanText = (value, max) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/\p{Cc}/u.test(value);
const localLabel = (value) => cleanText(value, 32768) && /^[a-z]:\\/i.test(value);

/** Create the closed live consumer for runtime-owned, verified native reads.
 * The producer's one-use admission method is the authority boundary; JSON,
 * display rows and historical audit replay never establish live authority.
 * @param {Object} deps Producer admission and existing operational consumers.
 * @returns {Object} Synchronous custody and pre-read policy methods.
 * @since v0.20.1
 */
function createNativeFileIngress(deps) {
  for (const key of [
    'takeAdmission',
    'isReady',
    'getPolicyGeneration',
    'classifySensitive',
    'acceptAudit',
    'dedupLive',
    'recordActivity',
    'recordBaseline',
    'publishLive',
  ])
    if (typeof deps?.[key] !== 'function') throw new Error('Invalid native file ingress');
  const now = deps.now ?? Date.now;
  const seen = new Set();
  const counters = {
    accepted: 0,
    live: 0,
    coalesced: 0,
    rejected: 0,
    bindings: 0,
    bindingRejected: 0,
    consumerFailures: 0,
  };
  let health = healthModel.markDisabled(
    healthModel.createSensorHealth('native-file-ingress'),
    now(),
    { detail: 'object-policy-opt-in-required' },
  );
  function enable() {
    if (health.state === 'DISABLED') health = healthModel.reenable(health, now());
  }
  function loss(code) {
    enable();
    health = healthModel.addLoss(health, 1, now(), { detail: code });
    health = healthModel.markDegraded(health, now(), { error: code });
    try {
      deps.onLoss?.(code);
    } catch {
      /* Diagnostics cannot retry a consumed observation. */
    }
  }
  function reject(code, countLoss = true) {
    counters.rejected++;
    if (countLoss) loss(code);
    return false;
  }
  function remember(id) {
    seen.add(id);
    if (seen.size > MAX_SOURCE_IDS) seen.delete(seen.values().next().value);
  }
  return Object.freeze({
    prepareBinding(candidate, context) {
      try {
        if (
          !candidate ||
          !localLabel(candidate.label) ||
          !cleanText(context?.scopeGeneration, 128) ||
          !deps.isReady({ actor: context.actor })
        ) {
          counters.bindingRejected++;
          return null;
        }
        const generation = deps.getPolicyGeneration();
        if (!cleanText(generation, 128)) return null;
        const classified = deps.classifySensitive(candidate.label);
        if (classified !== null && !cleanText(classified, 1024)) return null;
        if (generation !== deps.getPolicyGeneration()) return null;
        const reason = classified ?? '';
        const policy = Object.freeze({
          sensitive: classified !== null,
          reason,
          classification:
            classified === null
              ? 'ordinary'
              : /SSH|AWS/i.test(reason)
                ? 'ssh-aws'
                : reason.startsWith('AI agent config')
                  ? 'agent-config'
                  : 'sensitive',
        });
        counters.bindings++;
        enable();
        return Object.freeze({
          scopeGeneration: context.scopeGeneration,
          policyGeneration: generation,
          policy,
        });
      } catch {
        counters.bindingRejected++;
        return null;
      }
    },
    offer(observation) {
      let claim;
      try {
        claim = deps.takeAdmission(observation);
      } catch {
        return reject('native-admission-unavailable');
      }
      if (!claim) return reject('native-observation-unverified', false);
      try {
        if (!cleanText(claim.observationId, 256)) return reject('native-observation-id-invalid');
        if (seen.has(claim.observationId)) return reject('native-observation-replayed', false);
        remember(claim.observationId);
        const actor = claim.actor;
        const object = projectBoundReadObject(claim.object);
        const at = now();
        if (
          !actor ||
          actor.category !== 'ai' ||
          actor.instanceIdSource !== 'os' ||
          !Number.isInteger(actor.pid) ||
          actor.pid <= 0 ||
          actor.pid > 0x7fffffff ||
          !cleanText(actor.instanceId, 1024) ||
          !cleanText(actor.agent, 1024) ||
          !/^[1-9]\d{0,19}$/.test(actor.createTime100ns) ||
          BigInt(actor.createTime100ns) > 18446744073709551615n ||
          claim.createTime100ns !== actor.createTime100ns
        )
          return reject('native-actor-invalid');
        if (
          !object ||
          !localLabel(object.label) ||
          object.policyGeneration !== deps.getPolicyGeneration()
        )
          return reject('native-object-policy-invalid');
        if (
          !Number.isSafeInteger(claim.timestamp) ||
          claim.timestamp <= 0 ||
          claim.timestamp > at + 10 ||
          at - claim.timestamp > MAX_AGE_MS
        )
          return reject('native-observation-time-invalid');
        if (!deps.isReady(claim)) return reject('native-consumer-not-ready');
        Object.freeze(object.policy);
        Object.freeze(object);
        const event = {
          observationKind: 'bound-object-read',
          eventId: randomUUID(),
          agent: actor.agent,
          pid: actor.pid,
          instanceId: actor.instanceId,
          createTime100ns: actor.createTime100ns,
          parentEditor: cleanText(actor.parentEditor, 1024) ? actor.parentEditor : null,
          cwd: cleanText(actor.cwd, 32768) ? actor.cwd : null,
          category: 'ai',
          object,
          timestamp: claim.timestamp,
          action: 'accessed',
          sensitive: object.policy.sensitive,
          selfAccess: false,
          reason: object.policy.reason,
          attribution: makeAttribution([EVIDENCE.ETW_FILE_OBJECT]),
        };
        // Custody is synchronous and precedes every operational mutation, including
        // live dedup. A rejected read cannot poison a later accepted read's key.
        const accepted = deps.acceptAudit({
          type: object.policy.classification === 'agent-config' ? 'config-access' : 'file-access',
          sensor: 'other',
          timestamp: event.timestamp,
          details: {
            eventId: event.eventId,
            agent: event.agent,
            pid: event.pid,
            instanceId: event.instanceId,
            createTime100ns: event.createTime100ns,
            action: event.action,
            path: '',
            severity: event.sensitive ? 'sensitive' : 'normal',
            attribution: event.attribution,
            boundObject: object,
          },
        });
        if (accepted !== true) return reject('native-audit-custody-rejected');
        counters.accepted++;
        const winner = deps.dedupLive(event);
        if (winner === null) {
          counters.coalesced++;
          enable();
          health = healthModel.markHealthy(health, now());
          return true;
        }
        if (winner !== event) throw new Error('native-dedup-contract');
        deps.recordActivity(event);
        deps.recordBaseline(event);
        deps.publishLive(event);
        counters.live++;
        enable();
        health = healthModel.markHealthy(health, now());
        return true;
      } catch {
        // Audit custody cannot be rolled back. The one-use token and seen ID forbid
        // live retries after a partial consumer failure; audit replay stays historical.
        counters.consumerFailures++;
        return reject('native-live-consumer-failed');
      }
    },
    getStats: () => ({ ...counters, health: { ...health } }),
    getHealth: () => ({ ...health }),
  });
}
module.exports = { createNativeFileIngress };
