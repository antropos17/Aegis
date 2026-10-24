'use strict';
const { createHash } = require('node:crypto');
const CAP = 16384;
/** Incrementally retain only a bounded byte-prefix digest, never stream text. @returns {object} Internal bounded stream observer. @since unreleased */
function streamObserver() {
  const hash = createHash('sha256');
  const state = {
    observedBytes: 0,
    observedBytesExact: true,
    hashBytes: 0,
    overflow: false,
    ended: false,
    closed: false,
    errorObserved: false,
    destroyRequested: false,
  };
  return {
    state,
    data(chunk) {
      if (!Buffer.isBuffer(chunk)) {
        state.errorObserved = true;
        return 'stream-error';
      }
      if (state.observedBytes > Number.MAX_SAFE_INTEGER - chunk.length) {
        state.observedBytes = Number.MAX_SAFE_INTEGER;
        state.observedBytesExact = false;
      } else state.observedBytes += chunk.length;
      const count = Math.min(CAP - state.hashBytes, chunk.length);
      if (count) {
        hash.update(chunk.subarray(0, count));
        state.hashBytes += count;
      }
      state.overflow ||= state.observedBytes > CAP || !state.observedBytesExact;
      return state.overflow ? 'output-overflow' : null;
    },
    result() {
      return {
        capBytes: CAP,
        ...state,
        sha256: hash.digest('hex'),
        complete: state.ended && !state.errorObserved && !state.overflow && !state.destroyRequested,
      };
    },
  };
}
module.exports = { streamObserver, CAP };
