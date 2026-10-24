'use strict';
const { invalid, LIMITS } = require('./corpus-input');

function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function bytes(value) {
  if (
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > LIMITS.artifactBytes
  )
    invalid();
}
/**
 * Project an optional versioned producer declaration without authenticating it.
 * @param {object|null|undefined} value Recorded manifest field.
 * @returns {object|null} Validated safe loaded/final observations, or legacy absence.
 * @since unreleased
 */
function recordedProvenance(value) {
  if (value === undefined || value === null) return null;
  exact(value, ['version', 'loaded', 'final', 'sourceAuthenticated', 'measurementAccepted']);
  if (
    value.version !== 1 ||
    value.sourceAuthenticated !== false ||
    value.measurementAccepted !== false
  )
    invalid();
  exact(value.loaded, ['sha256', 'byteLength']);
  bytes(value.loaded);
  exact(value.final, ['state', 'sha256', 'byteLength']);
  if (!['pending', 'unchanged', 'changed', 'unavailable'].includes(value.final.state)) invalid();
  if (['pending', 'unavailable'].includes(value.final.state)) {
    if (value.final.sha256 !== null || value.final.byteLength !== null) invalid();
  } else {
    bytes(value.final);
    const equal =
      value.loaded.sha256 === value.final.sha256 &&
      value.loaded.byteLength === value.final.byteLength;
    if (equal !== (value.final.state === 'unchanged')) invalid();
  }
  return {
    version: 1,
    loaded: { sha256: value.loaded.sha256, byteLength: value.loaded.byteLength },
    final: {
      state: value.final.state,
      sha256: value.final.sha256,
      byteLength: value.final.byteLength,
    },
    sourceAuthenticated: false,
    measurementAccepted: false,
  };
}

module.exports = { recordedProvenance };
