'use strict';

const { createHash } = require('node:crypto');
const { copyResultReviewSnapshot } = require('./result-review-bundle');
const plans = new WeakMap();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) =>
  value &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Hash one exact canonical selected change set and its explicit deletion acknowledgment.
 * @param {string[]} ids Actual displayed change IDs. @param {boolean} acknowledgeDeletion Explicit acknowledgment.
 * @returns {string} Exact selection digest. @since v0.17.0 */
function resultReviewSelectionDigest(ids, acknowledgeDeletion) {
  if (
    !Array.isArray(ids) ||
    ids.length > 128 ||
    !ids.every(hex) ||
    new Set(ids).size !== ids.length ||
    typeof acknowledgeDeletion !== 'boolean'
  )
    throw Error('result-selection-invalid');
  return sha(Buffer.from(JSON.stringify({ ids: [...ids].sort(), acknowledgeDeletion })));
}

/** Accept a developer comparison plan; this creates no launch or project-write authority.
 * @param {object} review Actual process-private retained review.
 * @param {{reviewId:string,revision:number}} owner Trusted review owner, separate from imported input.
 * @param {object} selection Exact displayed digests/change IDs and deletion acknowledgment.
 * @returns {object} Frozen process-private one-attempt developer plan. @since v0.17.0 */
function createResultReviewPlan(review, owner, selection) {
  if (
    !exact(owner, ['reviewId', 'revision']) ||
    typeof owner.reviewId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(owner.reviewId) ||
    !Number.isSafeInteger(owner.revision) ||
    owner.revision < 0 ||
    !exact(selection, [
      'ids',
      'acknowledgeDeletion',
      'baselineDigest',
      'snapshotDigest',
      'selectionDigest',
    ]) ||
    review?.complete !== true
  )
    throw Error('result-selection-invalid');
  const before = copyResultReviewSnapshot(review, 'before');
  const after = copyResultReviewSnapshot(review, 'after');
  const selectionDigest = resultReviewSelectionDigest(selection.ids, selection.acknowledgeDeletion);
  if (
    selection.baselineDigest !== review.baselineDigest ||
    selection.snapshotDigest !== review.snapshotDigest ||
    selection.selectionDigest !== selectionDigest ||
    !selection.ids.length
  )
    throw Error('result-selection-stale');
  const ids = new Set(selection.ids);
  const changes = review.changes.filter((change) => ids.has(change.id));
  if (
    changes.length !== ids.size ||
    changes.some((change) => change.type === 'unknown') ||
    (changes.some((change) => change.type === 'deletion') && !selection.acknowledgeDeletion)
  )
    throw Error('result-selection-invalid');
  const plan = Object.freeze({
    schemaVersion: 1,
    ...owner,
    baselineDigest: review.baselineDigest,
    snapshotDigest: review.snapshotDigest,
    selectionDigest,
    selectedChanges: changes.length,
    acceptance: 'developer-plan',
    writerState: 'stop-unconfirmed',
    launchAllowed: false,
    projectExportAllowed: false,
  });
  plans.set(plan, { before, after, changes, consumed: false });
  return plan;
}

function originalsEqual(expected, observed) {
  if (!(observed instanceof Map) || observed.size !== expected.size || observed.size > 128)
    return false;
  for (const [name, bytes] of expected) {
    const actual = observed.get(name);
    if (!Buffer.isBuffer(actual) || actual.length > 65536 || !bytes.equals(actual)) return false;
  }
  return true;
}

/** Prepare one self-contained copied developer bundle after the owner reobserves exact originals.
 * No filesystem writes occur here. The fixed qualification caller alone owns disposable publication.
 * @param {object} plan Actual nonserializable developer plan.
 * @param {{reviewId:string,revision:number,originals:Map<string,Buffer>}} current Trusted immediate observations.
 * @returns {Buffer} Canonical selected change bundle; no project paths or scripts. @since v0.17.0 */
function prepareResultReviewPublication(plan, current) {
  const retained = plans.get(plan);
  if (!retained || retained.consumed) throw Error('result-plan-expired');
  retained.consumed = true;
  if (
    !exact(current, ['reviewId', 'revision', 'originals']) ||
    current.reviewId !== plan.reviewId ||
    current.revision !== plan.revision
  )
    throw Error('result-selection-stale');
  if (!originalsEqual(retained.before, current.originals)) throw Error('result-original-conflict');
  const changes = retained.changes.map((change) => ({
    ...change,
    contentBase64:
      change.type === 'deletion' ? null : retained.after.get(change.path).toString('base64'),
  }));
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: 'selected-result-changes',
      reviewId: plan.reviewId,
      revision: plan.revision,
      baselineDigest: plan.baselineDigest,
      snapshotDigest: plan.snapshotDigest,
      selectionDigest: plan.selectionDigest,
      writerState: 'stop-unconfirmed',
      launchAllowed: false,
      projectExportAllowed: false,
      changes,
    }),
  );
  if (bytes.length > 2097152) throw Error('result-publication-budget');
  return bytes;
}
module.exports = {
  resultReviewSelectionDigest,
  createResultReviewPlan,
  prepareResultReviewPublication,
};
