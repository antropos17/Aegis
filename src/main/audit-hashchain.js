/**
 * @file audit-hashchain.js
 * @module main/audit-hashchain
 * @description Tamper-evident (hash-chained) audit-log helpers. Each daily audit
 *   file is an INDEPENDENT SHA-256 hash chain: every record's hash binds the
 *   canonical form of the event to the previous record's hash, starting from a
 *   fixed GENESIS constant. Verification recomputes the chain in place — there is
 *   no stored prevHash field; linkage is proven by re-derivation.
 *
 *   Scope: the chain lives WITHIN a single daily file. A new day starts a fresh
 *   chain (seq 0, prevHash = GENESIS), so retention deletion of old day-files
 *   never invalidates a surviving file.
 * @requires crypto
 * @requires fs
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

/** Fixed seed for the first record of every daily file. */
const GENESIS = 'AEGIS-AUDIT-GENESIS-v1';

/**
 * Deterministic, insertion-order-independent serialization of a JSON value.
 * Object keys are sorted recursively so the output depends only on content,
 * never on key insertion order.
 * @param {*} value - Any JSON-serializable value.
 * @returns {string} Canonical string form.
 * @since v0.1.0
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

/**
 * Compute a record's chain hash: sha256(prevHash + canonical(event)).
 *
 * The event is normalized through a JSON round-trip BEFORE hashing so the hashed
 * form is byte-identical to what JSON.stringify writes to disk: JSON drops
 * undefined-valued object keys and maps undefined array elements to null. Without
 * this, a clean record carrying an undefined-valued detail would hash differently
 * at write vs verify time and produce a FALSE tamper verdict.
 * @param {string} prevHash - Previous record's hash, or GENESIS for the first record.
 * @param {Object} event - The audit event WITHOUT its seq/hash fields.
 * @returns {string} Hex-encoded SHA-256 hash.
 * @since v0.1.0
 */
function computeHash(prevHash, event) {
  const normalized = JSON.parse(JSON.stringify(event));
  return crypto
    .createHash('sha256')
    .update(prevHash + canonical(normalized))
    .digest('hex');
}

/**
 * Verify the hash chain of a single daily audit file.
 *
 * Detects in-place edits, insertions, and deletions of interior lines; does NOT
 * detect truncation of trailing lines (valid prefix remains a valid chain).
 * @param {string} filePath - Path to an aegis-audit-YYYY-MM-DD.json file.
 * @returns {{valid: boolean, brokenAtSeq: number|null, reason: string}}
 *   On failure, brokenAtSeq is the 0-based line position where the chain breaks.
 * @since v0.1.0
 */
function verifyChain(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { valid: false, brokenAtSeq: null, reason: `read-failed: ${err.message}` };
  }
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  let prevHash = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (_) {
      return { valid: false, brokenAtSeq: i, reason: `malformed JSON at line ${i}` };
    }
    if (entry.seq !== i) {
      return {
        valid: false,
        brokenAtSeq: i,
        reason: `seq discontinuity at line ${i}: got ${entry.seq}`,
      };
    }
    const event = { ...entry };
    delete event.seq;
    delete event.hash;
    if (computeHash(prevHash, event) !== entry.hash) {
      return { valid: false, brokenAtSeq: i, reason: `hash mismatch at seq ${i}` };
    }
    prevHash = entry.hash;
  }
  return { valid: true, brokenAtSeq: null, reason: 'ok' };
}

/**
 * Read the tail of a daily file to resume its chain after a process restart or a
 * day rollover. Returns the seed for the NEXT record to append.
 * @param {string} filePath - Path to today's audit file (may not exist yet).
 * @returns {{prevHash: string, seq: number}} GENESIS/0 if the file is absent,
 *   empty, or its last line predates hash-chaining.
 * @since v0.1.0
 */
function seedFromTail(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    return { prevHash: GENESIS, seq: 0 };
  }
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { prevHash: GENESIS, seq: 0 };
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    if (typeof last.hash === 'string' && typeof last.seq === 'number') {
      return { prevHash: last.hash, seq: last.seq + 1 };
    }
  } catch (_) {
    /* fall through to GENESIS */
  }
  return { prevHash: GENESIS, seq: 0 };
}

module.exports = { GENESIS, canonical, computeHash, verifyChain, seedFromTail };
