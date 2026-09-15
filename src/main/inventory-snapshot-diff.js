'use strict';

const { validateSnapshot, hashSnapshotValue } = require('./inventory-snapshot');

function changes(before, after, key, complete) {
  const previous = new Map(before.map((item) => [item[key], item]));
  const current = new Map(after.map((item) => [item[key], item]));
  const delta = { added: [], removed: [], changed: [], newlyObserved: [], unobserved: [] };
  for (const item of after) {
    const old = previous.get(item[key]);
    if (!old) delta[complete ? 'added' : 'newlyObserved'].push(item[key]);
    else {
      const fields = [];
      if (old.sha256 !== item.sha256) fields.push('content');
      if (old.metadataSha256 !== item.metadataSha256) fields.push('metadata');
      if (fields.length) delta.changed.push({ [key]: item[key], fields });
    }
  }
  for (const item of before) {
    if (!current.has(item[key])) delta[complete ? 'removed' : 'unobserved'].push(item[key]);
  }
  return delta;
}

/**
 * Compare complete contracts and contents. Missing data can never retain acceptance.
 * @param {object} baseline Saved observed or accepted snapshot.
 * @param {object} current Fresh observed snapshot.
 * @returns {object} JSON-safe differences and an explicit review requirement.
 * @since v0.15.1
 */
function compareSnapshots(baseline, current) {
  validateSnapshot(baseline);
  validateSnapshot(current);
  const result = {
    schemaVersion: 1,
    mode: 'inventory-comparison',
    assessment: 'not-performed',
    baselineDigest: baseline.digest,
    currentDigest: current.digest,
    baselineState: baseline.state,
    reviewRequired: true,
    complete: baseline.body.complete && current.body.complete,
    baselineIssueCount: baseline.body.issueCount,
    currentIssueCount: current.body.issueCount,
  };
  if (hashSnapshotValue(baseline.body.subject) !== hashSnapshotValue(current.body.subject)) {
    return {
      ...result,
      status: 'incompatible',
      reason: 'root-scope-or-tool-source-changed',
      changes: null,
    };
  }
  const delta = {
    components: changes(baseline.body.components, current.body.components, 'path', result.complete),
    packages: changes(baseline.body.packages, current.body.packages, 'path', result.complete),
    tools: changes(baseline.body.tools, current.body.tools, 'id', result.complete),
    catalogBytesChanged: baseline.body.catalogSha256 !== current.body.catalogSha256,
  };
  if (!result.complete) return { ...result, status: 'incomplete', changes: delta };
  const same = hashSnapshotValue(baseline.body) === hashSnapshotValue(current.body);
  const accepted = same && baseline.state === 'accepted';
  return {
    ...result,
    status: accepted ? 'accepted-content-unchanged' : 'review-required',
    reviewRequired: !accepted,
    contentUnchanged: same,
    changes: delta,
  };
}

module.exports = { compareSnapshots };
