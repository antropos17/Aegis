'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { readAuditIdentity, auditOrigin } = require('./audit-observation-identity');

const MAX_ROWS = 100;
const DEADLINE_MS = 3000;
const RESPONSE_BYTES = 32 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const keys = (value, expected) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

function createProofTargets(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return null;
  const targets = new Map();
  try {
    for (const row of rows) {
      const identity = readAuditIdentity(row?.details);
      if (!identity || !auditOrigin(row)) continue;
      const key = hash(JSON.stringify(identity));
      targets.set(key, { key, pair: hash(JSON.stringify([identity.epoch, identity.eventId])) });
    }
    return [...targets.values()];
  } catch {
    return null;
  }
}

function proofFrom(value, allowed) {
  if (
    !keys(value, ['schemaVersion', 'rows']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.rows) ||
    value.rows.length > MAX_ROWS
  )
    return null;
  const rows = new Map();
  for (const item of value.rows) {
    if (
      !keys(item, ['key', 'origin', 'content', 'count']) ||
      !['key', 'origin', 'content'].every(
        (field) => typeof item[field] === 'string' && /^[a-f0-9]{64}$/.test(item[field]),
      ) ||
      !Number.isSafeInteger(item.count) ||
      item.count < 1 ||
      item.count > 2 ||
      !allowed.has(item.key) ||
      rows.has(item.key)
    )
      return null;
    rows.set(item.key, { origin: item.origin, content: item.content, count: item.count });
  }
  return Object.freeze({
    unique(row) {
      try {
        const origin = auditOrigin(row);
        const identity = readAuditIdentity(row?.details);
        if (!origin || !identity) return false;
        const match = rows.get(hash(JSON.stringify(identity)));
        return (
          !!match &&
          match.count === 1 &&
          match.origin === origin &&
          match.content === hash(JSON.stringify(row))
        );
      } catch {
        return false;
      }
    },
  });
}

/** Build a single-flight worker owner; a timed-out worker remains locked until exit.
 * @param {object} [options] Private test seams.
 * @returns {object} Bounded capture and cancellation operations.
 * @since 0.21.0-beta
 */
function createProofRunner(options = {}) {
  const factory =
    options.workerFactory ||
    ((workerData) =>
      new Worker(path.join(__dirname, 'audit-observation-proof-worker.js'), {
        workerData,
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      }));
  const deadline = options.deadlineMs ?? DEADLINE_MS;
  let active = null,
    cancelCurrent = null;
  return Object.freeze({
    capture(workerData) {
      if (active) return Promise.resolve(null);
      if (!Array.isArray(workerData.targets) || workerData.targets.length > MAX_ROWS)
        return Promise.resolve(null);
      const allowed = new Set(workerData.targets.map((target) => target.key));
      let worker;
      const response = new SharedArrayBuffer(RESPONSE_BYTES);
      try {
        worker = factory({ ...workerData, resultBuffer: response });
      } catch {
        return Promise.resolve(null);
      }
      active = worker;
      return new Promise((resolve) => {
        let settled = false,
          received = false,
          value,
          invalid = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const stop = () => {
          finish(null);
          worker.unref?.();
          try {
            Promise.resolve(worker.terminate()).catch(() => {});
          } catch {
            /* unavailable */
          }
        };
        const timer = setTimeout(stop, deadline);
        timer.unref?.();
        cancelCurrent = stop;
        worker.on('message', (message) => {
          if (received) invalid = true;
          received = true;
          if (!Number.isSafeInteger(message) || message <= 0 || message > RESPONSE_BYTES)
            invalid = true;
          else value = message;
        });
        worker.once('error', () => {
          invalid = true;
          stop();
        });
        worker.once('exit', (code) => {
          if (active === worker) {
            active = null;
            cancelCurrent = null;
          }
          let proof = null;
          if (!settled && !invalid && received && code === 0) {
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(
                new Uint8Array(response, 0, value),
              );
              proof = proofFrom(JSON.parse(text), allowed);
            } catch {
              /* unavailable */
            }
          }
          new Uint8Array(response).fill(0);
          finish(proof);
        });
      });
    },
    cancel() {
      cancelCurrent?.();
    },
  });
}

module.exports = { createProofRunner, createProofTargets, DEADLINE_MS };
