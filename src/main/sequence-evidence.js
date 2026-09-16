'use strict';

const { isIP } = require('node:net');
const POLICY = 'credential-egress-v1';
const MAX_TUPLES = 2048;
const RETENTION_MS = 10 * 60 * 1000;
const levels = ['informational', 'low', 'medium', 'high', 'critical'];
const port = (value) => Number.isInteger(value) && value > 0 && value <= 65535;
const ip = (value) => typeof value === 'string' && value.length <= 80 && isIP(value) !== 0;

/** @typedef {{source: string, firstObservedAt: number|null, history: string,
 * localIp?: string, localPort?: number, remoteIp?: string, remotePort?: number,
 * domain?: string, verdict?: string}} NetworkEvidence */
/** @typedef {{policy: string, configuredLevel: string, confidence: string,
 * dataTransfer: string, ownershipComplete: boolean, reasons: string[], limitations: string[]}} Assessment */

/** Bounded history of observed TCP tuples, never an OS socket-lifetime registry.
 * @param {object} [options] Optional test bounds.
 * @returns Observation, expiry, exit cleanup and counters.
 * @since v0.15.1
 */
function createHistory({ maxEntries = MAX_TUPLES, retentionMs = RETENTION_MS } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('invalid-tuple-cap');
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) throw new Error('invalid-tuple-ttl');
  const tuples = new Map();
  const counters = { evicted: 0, expired: 0, unavailable: 0, clockResets: 0 };
  let lastClock = -Infinity;
  const clock = (at) => {
    if (at < lastClock) {
      tuples.clear();
      counters.clockResets++;
    }
    lastClock = at;
  };
  return {
    observe(carrier, at) {
      clock(at);
      if (typeof carrier.remoteIp !== 'string' || carrier.type !== undefined) return null;
      /** @type {NetworkEvidence} */
      const network = { source: 'tcp-table', firstObservedAt: null, history: 'unavailable' };
      for (const key of ['localIp', 'remoteIp']) if (ip(carrier[key])) network[key] = carrier[key];
      for (const key of ['localPort', 'remotePort'])
        if (port(carrier[key])) network[key] = carrier[key];
      if (typeof carrier.domain === 'string' && /^[a-z0-9.-]{1,253}$/i.test(carrier.domain))
        network.domain = carrier.domain;
      if (['allowlisted', 'flagged', 'unknown'].includes(carrier.verdict))
        network.verdict = carrier.verdict;
      if (
        !network.localIp ||
        !network.localPort ||
        !network.remoteIp ||
        !network.remotePort ||
        typeof carrier.instanceId !== 'string' ||
        !carrier.instanceId ||
        carrier.instanceId.length > 512
      ) {
        counters.unavailable++;
        return network;
      }
      const key = JSON.stringify([
        carrier.instanceId,
        network.localIp.toLowerCase(),
        network.localPort,
        network.remoteIp.toLowerCase(),
        network.remotePort,
      ]);
      let prior = tuples.get(key);
      if (prior && at - prior.lastSeen > retentionMs) {
        tuples.delete(key);
        prior = null;
        counters.expired++;
      }
      const firstSeen = prior?.firstSeen ?? at;
      if (!prior && tuples.size >= maxEntries) {
        tuples.delete(tuples.keys().next().value);
        counters.evicted++;
      }
      tuples.delete(key);
      tuples.set(key, { firstSeen, lastSeen: at, instanceId: carrier.instanceId });
      return {
        ...network,
        firstObservedAt: firstSeen,
        history: prior ? 'previously-observed' : 'first-observed',
      };
    },
    sweep(at) {
      clock(at);
      for (const [key, entry] of tuples)
        if (at - entry.lastSeen > retentionMs) {
          tuples.delete(key);
          counters.expired++;
        }
    },
    close(instanceId) {
      for (const [key, entry] of tuples) if (entry.instanceId === instanceId) tuples.delete(key);
    },
    stats() {
      return { ...counters, retained: tuples.size, maxEntries, retentionMs };
    },
  };
}

/** Calibrate an opted-in file/TCP correlation without inferring transmitted contents.
 * @param {object} rule Loaded rule. @param {object[]} steps Retained observations.
 * @returns {{level: string, assessment: Assessment}|null} Assessment and bounded severity.
 * @since v0.15.1
 */
function assess(rule, steps) {
  if (rule.evidencePolicy !== POLICY) return null;
  const [file, connection] = steps;
  const reasons = [];
  const readObserved = file.action === 'file-accessed';
  const ownershipComplete = steps.every(
    (step) =>
      ['confirmed', 'inferred'].includes(step.attribution?.status) &&
      step.attribution.evidence.length > 0,
  );
  const pidBacked =
    ownershipComplete && steps.every((step) => step.attribution.status === 'confirmed');
  const first = connection.network?.firstObservedAt;
  const before = Number.isFinite(first) && first <= file.at;
  if (before) reasons.push('connection-observed-before-file');
  else if (Number.isFinite(first)) reasons.push('first-tcp-observation-after-file');
  else reasons.push('tcp-history-unavailable');
  if (!readObserved) reasons.push('file-read-unobserved');
  if (!ownershipComplete) reasons.push('ownership-incomplete');
  else if (!pidBacked) reasons.push('ownership-inferred');
  const related = rule.relationship === 'direct-parent-child';
  if (related) reasons.push('process-relationship-only');
  const cap = before
    ? 'informational'
    : !related && readObserved && pidBacked && Number.isFinite(first)
      ? 'medium'
      : 'low';
  const level = levels[Math.min(Math.max(0, levels.indexOf(rule.level)), levels.indexOf(cap))];
  return {
    level,
    assessment: {
      policy: POLICY,
      configuredLevel: rule.level,
      confidence: 'temporal-correlation',
      dataTransfer: 'unobserved',
      ownershipComplete,
      reasons,
      limitations: [
        'tcp-payload-unobserved',
        'polling-order-only',
        'bounded-tuple-history',
        'existing-connection-transfer-unobserved',
        related ? 'direct-relation-only' : 'same-instance-only',
        'file-contents-unobserved',
      ],
    },
  };
}

module.exports = { POLICY, createHistory, assess };
