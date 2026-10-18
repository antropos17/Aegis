'use strict';
const wire = require('./etw-file-protocol');

/** Bind one owned child, ignoring all events from superseded transports.
 * @param {Object} options Owned target, identity binding and lifecycle callbacks.
 * @returns {Object} Bounded frame decoder. @since v0.19.2
 */
function bindTransport({
  target,
  launchId,
  sessionId,
  isCurrent,
  measure,
  onMessage,
  onEnd,
  onFailure,
  onClose,
  stopped,
}) {
  const reader = wire.createFrameDecoder({ launchId, sessionId, onMessage });
  target.on('error', () => {
    if (isCurrent()) onFailure('launch-failed');
  });
  target.on('close', (code) => {
    if (isCurrent()) onClose(code);
  });
  if (!target.stdout || !target.stdin) {
    onFailure('launch-failed');
    return reader;
  }
  target.stdout.on('data', (bytes) => {
    if (!isCurrent()) return;
    try {
      measure('decodeChunk', () => reader.push(bytes));
    } catch {
      onFailure('protocol-failed');
    }
  });
  target.stdout.on('end', () => {
    if (!isCurrent()) return;
    try {
      reader.end();
    } catch {
      onFailure('protocol-failed');
    }
    onEnd();
  });
  target.stdout.on('error', () => {
    if (isCurrent()) onFailure('stream-ended');
  });
  target.stdin.on('error', () => {
    if (isCurrent() && !stopped()) onFailure('stream-ended');
  });
  // close follows stdout drain; exit alone can race a valid terminal receipt.
  return reader;
}
module.exports = { bindTransport };
