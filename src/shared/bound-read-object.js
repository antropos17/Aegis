'use strict';

const CLASSIFICATIONS = new Set(['ssh-aws', 'agent-config', 'sensitive', 'ordinary']);
const TOKEN = /^[a-zA-Z0-9:_-]{1,128}$/;

/** Copy the closed public object-read evidence. Raw kernel/file identifiers and
 * unknown producer fields never cross this projection.
 * @param {unknown} value Untrusted object metadata.
 * @returns {Object|null} Detached metadata, or null for invalid evidence.
 * @since v0.20.1
 */
function projectBoundReadObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = /** @type {any} */ (value);
  if (
    !['objectKey', 'bindingId', 'scopeGeneration', 'policyGeneration'].every(
      (key) => typeof v[key] === 'string' && TOKEN.test(v[key]),
    ) ||
    v.provenance !== 'issuer-handle-file-id' ||
    typeof v.label !== 'string' ||
    v.label.length === 0 ||
    v.label.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(v.label) ||
    !v.policy ||
    typeof v.policy.sensitive !== 'boolean' ||
    typeof v.policy.reason !== 'string' ||
    v.policy.reason.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(v.policy.reason) ||
    !CLASSIFICATIONS.has(v.policy.classification) ||
    (v.policy.classification === 'ordinary') !== !v.policy.sensitive ||
    (v.policy.sensitive && v.policy.reason.length === 0)
  )
    return null;
  return {
    objectKey: v.objectKey,
    bindingId: v.bindingId,
    label: v.label,
    scopeGeneration: v.scopeGeneration,
    policyGeneration: v.policyGeneration,
    provenance: 'issuer-handle-file-id',
    policy: {
      sensitive: v.policy.sensitive,
      reason: v.policy.reason,
      classification: v.policy.classification,
    },
  };
}

/** Source-aware coalescing identity; a display label cannot define an object.
 * @param {Object} object Closed public object projection.
 * @returns {string} Stable identity inside its scope and frozen policy.
 * @since v0.20.1
 */
function boundReadObjectKey(object) {
  return JSON.stringify([object.scopeGeneration, object.policyGeneration, object.objectKey]);
}

module.exports = { projectBoundReadObject, boundReadObjectKey };
