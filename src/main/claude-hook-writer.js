// @ts-check
'use strict';

const { createHash } = require('node:crypto');
const { planInstall, planRemoval } = require('./claude-hook-plan');

/** @typedef {{ identity: string, bytes: Buffer }} Snapshot */
/** @typedef {{ bytes: Buffer, manifest: string }} PrivateRecord */
/** @typedef {{ ref: object, beforeSha256: string, manifestSha256: string }} Retained */
/** @typedef {{ contract: string, readTarget: () => Promise<Snapshot>, retainPrivate: (record: PrivateRecord) => Promise<object>, readPrivate: (ref: object) => Promise<PrivateRecord>, compareAndWrite: (input: { identity: string, beforeBytes: Buffer, afterBytes: Buffer }) => Promise<'written'|'stale'> }} OwnedIO */
/** @typedef {{ command: string, contract: string, timeoutSeconds: number }} Selection */
/** @typedef {{ startByte: number, endByte: number, replacementUtf8: string }} Edit */
/** @typedef {{ beforeSha256: string, afterSha256: string, edits: Edit[], manifest?: string, manifestSha256?: string }} Plan */
/** @typedef {{ kind: 'install'|'removal', snapshot: Snapshot, after: Buffer, plan: Plan, manifest: string }} Transaction */
/** @typedef {{ identity: string, retained: Retained }} Ownership */
const IO_CONTRACT = 'trusted-owned-target-compare-write-v1';
const MAX_BACKUPS = 8;
/** @param {string|Buffer} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {boolean} ok @param {string} code @param {string} [presence] */
const status = (ok, code, presence = 'Unknown') => Object.freeze({ ok, code, presence });
/** @param {Snapshot} value @returns {Snapshot} */
function snapshot(value) {
  if (
    !value ||
    typeof value.identity !== 'string' ||
    !value.identity.length ||
    value.identity.length > 256 ||
    !Buffer.isBuffer(value.bytes) ||
    value.bytes.length > 262144
  )
    throw Error();
  return { identity: value.identity, bytes: Buffer.from(value.bytes) };
}
/** @param {object} value */
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
/** @param {Buffer} before @param {Plan} plan */
function edited(before, plan) {
  let after = Buffer.from(before);
  for (const edit of [...plan.edits].reverse()) {
    after = Buffer.concat([
      after.subarray(0, edit.startByte),
      Buffer.from(edit.replacementUtf8),
      after.subarray(edit.endByte),
    ]);
  }
  if (hash(before) !== plan.beforeSha256 || hash(after) !== plan.afterSha256) throw Error();
  return after;
}

/**
 * Create a PRIVATE transaction session over an explicitly supplied owned target.
 * The IO contract requires a separately qualified handle/identity and guarded
 * comparison/write provider. Its version marker is not qualification evidence.
 * No filesystem/profile discovery, default IO, IPC or provider command exists.
 * @param {{ configPath: string, io: OwnedIO }} options Trusted main-process capability.
 * @returns Private review/apply methods or a fixed sanitized capability failure.
 * @since v0.19.3
 */
function createOwnedHookWriter(options) {
  /** @type {string} */
  let configPath;
  /** @type {OwnedIO} */
  let io;
  try {
    ({ configPath, io } = options);
    if (
      typeof configPath !== 'string' ||
      configPath.length > 4096 ||
      [...configPath].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      !/^(?:[A-Za-z]:[/\\]|\/|\\\\[^\\]+\\)/.test(configPath) ||
      io?.contract !== IO_CONTRACT ||
      ['readTarget', 'retainPrivate', 'readPrivate', 'compareAndWrite'].some(
        (key) => typeof Reflect.get(io, key) !== 'function',
      )
    )
      return status(false, 'INVALID_CAPABILITY');
  } catch {
    return status(false, 'INVALID_CAPABILITY');
  }
  let busy = false;
  let uncertain = false;
  let backupAttempts = 0;
  let last = status(true, 'IDLE');
  /** @type {{ ticket: object, transaction: Transaction }|null} */
  let pending = null;
  /** @type {Ownership|null} */
  let owned = null;
  /** @type {Retained[]} */
  const retained = [];
  /** @param {boolean} ok @param {string} code @param {string} [presence] */
  const finish = (ok, code, presence) => (last = status(ok, code, presence));
  /** @template T @param {() => Promise<T>} action @returns {Promise<T|ReturnType<typeof status>>} */
  async function exclusive(action) {
    if (busy) return status(false, 'BUSY');
    if (uncertain) return finish(false, 'RETAINED_UNKNOWN');
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }
  /** @param {Retained} record @returns {Promise<{data: PrivateRecord}|{code: string}>} */
  async function checkedPrivate(record) {
    try {
      const data = await io.readPrivate(record.ref);
      if (
        !data ||
        !Buffer.isBuffer(data.bytes) ||
        data.bytes.length > 262144 ||
        typeof data.manifest !== 'string' ||
        Buffer.byteLength(data.manifest) > 16384 ||
        hash(data.bytes) !== record.beforeSha256 ||
        hash(data.manifest) !== record.manifestSha256
      )
        return { code: 'BACKUP_TAMPERED' };
      return { data: { bytes: Buffer.from(data.bytes), manifest: data.manifest } };
    } catch {
      return { code: 'BACKUP_FAILED' };
    }
  }
  /** @param {Transaction} transaction @param {object} review */
  function prepared(transaction, review) {
    const ticket = Object.freeze({});
    pending = { ticket, transaction };
    finish(true, 'REVIEW_REQUIRED');
    return Object.freeze({ ...last, ticket, review: freeze(review) });
  }
  /**
   * Prepare a private exact-byte review; this supplies no write authorization.
   * @param {Selection} selection Explicit command and planner contract.
   * @returns Private review and process-local ticket, or a fixed failure.
   * @since v0.19.3
   */
  async function prepareInstall(selection) {
    return exclusive(async () => {
      pending = null;
      if (owned) return finish(false, 'OWNED_INSTALL_EXISTS');
      let current;
      try {
        current = snapshot(await io.readTarget());
      } catch {
        return finish(false, 'TARGET_READ_FAILED');
      }
      try {
        const plan = planInstall({ ...selection, configPath, configBytes: current.bytes });
        if ('reason' in plan) return finish(false, 'PLAN_REFUSED');
        if (!('manifest' in plan)) return finish(true, 'CONFIGURED_UNOWNED', 'Configured');
        return prepared(
          {
            kind: 'install',
            snapshot: current,
            after: edited(current.bytes, plan),
            plan,
            manifest: plan.manifest,
          },
          plan,
        );
      } catch {
        return finish(false, 'PLAN_REFUSED');
      }
    });
  }
  /**
   * Review removal using only this session's verified retained ownership record.
   * @returns Private exact rollback or targeted removal review, or fixed failure.
   * @since v0.19.3
   */
  async function prepareRemoval() {
    return exclusive(async () => {
      pending = null;
      if (!owned) return finish(false, 'NO_OWNED_INSTALL');
      const backup = await checkedPrivate(owned.retained);
      if ('code' in backup) return finish(false, backup.code);
      let current;
      try {
        current = snapshot(await io.readTarget());
      } catch {
        return finish(false, 'TARGET_READ_FAILED');
      }
      if (current.identity !== owned.identity) return finish(false, 'TARGET_IDENTITY_CHANGED');
      const plan = planRemoval({
        configPath,
        configBytes: current.bytes,
        manifest: backup.data.manifest,
        manifestSha256: owned.retained.manifestSha256,
      });
      if ('reason' in plan) return finish(false, 'OWNED_ENTRY_REFUSED');
      try {
        return prepared(
          {
            kind: 'removal',
            snapshot: current,
            after: edited(current.bytes, plan),
            plan,
            manifest: backup.data.manifest,
          },
          plan,
        );
      } catch {
        return finish(false, 'OWNED_ENTRY_REFUSED');
      }
    });
  }
  /**
   * Apply only the exact ticket after a later trusted caller owner confirmation.
   * A caller boolean cannot prove a human decision; no renderer may call this API.
   * Mutation uncertainty locks this session and retains private backups for review.
   * @param {object} ticket Exact process-local ticket from the latest private review.
   * @param {boolean} ownerConfirmed Trusted caller confirms this exact plan/target.
   * @returns Fixed sanitized installation/removal status; no private artifacts.
   * @since v0.19.3
   */
  async function apply(ticket, ownerConfirmed) {
    return exclusive(async () => {
      if (!pending || pending.ticket !== ticket || ownerConfirmed !== true)
        return finish(false, 'INVALID_APPROVAL');
      const tx = pending.transaction;
      pending = null;
      if (tx.kind === 'removal' && owned) {
        const originalBackup = await checkedPrivate(owned.retained);
        if ('code' in originalBackup) return finish(false, originalBackup.code);
      }
      if (backupAttempts >= MAX_BACKUPS) return finish(false, 'RETENTION_LIMIT');
      backupAttempts += 1;
      let record;
      try {
        const ref = await io.retainPrivate({
          bytes: Buffer.from(tx.snapshot.bytes),
          manifest: tx.manifest,
        });
        if (!ref || typeof ref !== 'object') return finish(false, 'BACKUP_FAILED');
        record = { ref, beforeSha256: tx.plan.beforeSha256, manifestSha256: hash(tx.manifest) };
        retained.push(record);
      } catch {
        return finish(false, 'BACKUP_FAILED');
      }
      const backup = await checkedPrivate(record);
      if ('code' in backup) return finish(false, backup.code);
      let current;
      try {
        current = snapshot(await io.readTarget());
      } catch {
        return finish(false, 'TARGET_READ_FAILED');
      }
      if (current.identity !== tx.snapshot.identity)
        return finish(false, 'TARGET_IDENTITY_CHANGED');
      if (!current.bytes.equals(tx.snapshot.bytes)) return finish(false, 'TARGET_CHANGED');
      // The provider must guard this compare/write on the same qualified target.
      // A read immediately before a plain path-based write cannot supply that guarantee.
      let outcome;
      try {
        outcome = await io.compareAndWrite({
          identity: current.identity,
          beforeBytes: Buffer.from(current.bytes),
          afterBytes: Buffer.from(tx.after),
        });
      } catch {
        uncertain = true;
        return finish(false, 'WRITE_UNCERTAIN');
      }
      if (outcome === 'stale') return finish(false, 'TARGET_CHANGED');
      if (outcome !== 'written') {
        uncertain = true;
        return finish(false, 'WRITE_UNCERTAIN');
      }
      try {
        const after = snapshot(await io.readTarget());
        if (after.identity !== current.identity || !after.bytes.equals(tx.after)) throw Error();
      } catch {
        uncertain = true;
        return finish(false, 'READBACK_FAILED');
      }
      owned = tx.kind === 'install' ? { identity: current.identity, retained: record } : null;
      return finish(
        true,
        tx.kind === 'install' ? 'INSTALLED' : 'REMOVED',
        tx.kind === 'install' ? 'Configured' : 'Unknown',
      );
    });
  }
  /**
   * Read the last sanitized local transaction status; supplies no Observed/Blocking proof.
   * @returns Fixed status with no path, hashes, configuration, manifest or exception.
   * @since v0.19.3
   */
  function readStatus() {
    return { ...last };
  }
  return { ok: true, prepareInstall, prepareRemoval, apply, status: readStatus };
}

module.exports = { IO_CONTRACT, createOwnedHookWriter };
