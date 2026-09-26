'use strict';

const { randomBytes } = require('node:crypto');
const LIMITS = Object.freeze({
  reviewMs: 60000,
  drainMs: 1000,
  previewBytes: 16384,
  inputBytes: 128,
});
let testDeps = null;
const streams = () => ({
  input: testDeps?.input || process.stdin,
  output: testDeps?.output || process.stderr,
});

/** @returns {boolean} Whether private review can use local terminal input/output. @since v0.15.1 */
function isTerminalAvailable() {
  const { input, output } = streams();
  return (
    input.isTTY === true &&
    output.isTTY === true &&
    !input.destroyed &&
    !input.readableEnded &&
    !output.destroyed &&
    !output.writableEnded
  );
}

/**
 * Keep terminal closure/errors connected to the owner through child cleanup.
 * @param {() => void} abort Revoke the owning operation.
 * @returns {() => void} Release only this observer's listeners.
 * @since v0.15.1
 */
function watchTerminalLifetime(abort) {
  const { input, output } = streams();
  const entries = [
    [input, 'end'],
    [input, 'close'],
    [input, 'error'],
    [output, 'close'],
    [output, 'error'],
  ];
  for (const [stream, event] of entries) stream.on(event, abort);
  if (input.destroyed || input.readableEnded || output.destroyed || output.writableEnded) abort();
  return () => {
    for (const [stream, event] of entries) stream.removeListener(event, abort);
  };
}

/**
 * Continue reading after confirmation so EOF is observed during execution.
 * Further input cannot grant anything; a bounded extra-input flood aborts.
 * @param {() => void} abort Revoke the owning operation.
 * @returns {() => void} Stop only this reader when execution ends.
 * @since v0.15.1
 */
function monitorTerminalInput(abort) {
  const { input } = streams();
  let bytes = 0;
  const discard = (chunk) => {
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    if (bytes > LIMITS.inputBytes) {
      input.pause();
      abort();
    }
  };
  input.on('data', discard);
  input.resume();
  return () => {
    input.removeListener('data', discard);
    input.pause();
  };
}

/**
 * Display an exact private launch only on a terminal, then require a fresh literal
 * challenge response. A terminal is not proof of human identity. Never log preview.
 * @param {object} launch Private effective executable/cwd/args/env descriptor.
 * @param {{signal?: AbortSignal, kind?: 'launch'|'delete-file'}} [options] Owning cancellation and operation kind.
 * @returns {Promise<boolean>} True only for the exact response before expiry.
 * @since v0.15.1
 */
async function confirmInTerminal(launch, { signal, kind = 'launch' } = {}) {
  if (!isTerminalAvailable() || signal?.aborted) return false;
  const { input, output } = streams();
  const host = testDeps?.process || process;
  const started = performance.now();
  let challenge;
  let preview;
  const deletion = kind === 'delete-file';
  const verb = deletion ? 'DELETE' : 'RUN';
  try {
    challenge = (testDeps?.randomBytes || randomBytes)(4).toString('hex');
    if (!/^[a-f0-9]{8}$/.test(challenge)) return false;
    // All non-ASCII code units are visible, including bidi/zero-width controls.
    const rendered = JSON.stringify(launch, null, 2).replace(
      /[\u007f-\uffff]/g,
      (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    if (!deletion && kind !== 'launch') return false;
    preview = deletion
      ? 'AEGIS terminal confirmation - ONE file deletion\n' +
        'The exact file path is displayed below. Terminal history may retain it.\n' +
        'Exact operation (JSON escapes are literal):\n' +
        rendered +
        '\nType DELETE ' +
        challenge +
        ' to remove this file once within 60 seconds. Any other answer denies.\n> '
      : 'AEGIS terminal confirmation - ONE launch\n' +
        'Private arguments and environment are displayed below. Terminal history may retain them.\n' +
        'The program keeps your account privileges; descendants are not isolated.\n' +
        'Exact effective action (JSON escapes are literal; no shell reconstruction):\n' +
        rendered +
        '\nType RUN ' +
        challenge +
        ' to launch once within 60 seconds. Any other answer denies.\n> ';
    if (Buffer.byteLength(preview) > LIMITS.previewBytes) return false;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    let settled = false;
    let admitted = false;
    let answer = '';
    let bytes = 0;
    let drainTimer;
    let reviewTimer;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      clearTimeout(drainTimer);
      clearTimeout(reviewTimer);
      input.removeListener('data', onData);
      input.removeListener('end', reject);
      input.removeListener('close', reject);
      input.removeListener('error', reject);
      output.removeListener('error', reject);
      output.removeListener('close', reject);
      // Writable errors may follow their failed write callback in the same turn.
      // Retain a bounded sink until that native notification has been delivered.
      const ignoreLateError = () => {};
      input.on('error', ignoreLateError);
      output.on('error', ignoreLateError);
      setImmediate(() => {
        input.removeListener('error', ignoreLateError);
        output.removeListener('error', ignoreLateError);
      }).unref?.();
      host.removeListener('SIGINT', reject);
      host.removeListener('SIGTERM', reject);
      signal?.removeEventListener('abort', reject);
      input.pause();
      resolve(accepted === true);
    };
    const reject = () => finish(false);
    const onData = (chunk) => {
      if (!admitted || settled) return;
      if (performance.now() - started >= LIMITS.reviewMs) return reject();
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (bytes > LIMITS.inputBytes) return reject();
      answer += chunk.toString();
      if (answer.includes('\x03') || answer.includes('\x1b')) return reject();
      if (/[\r\n]/.test(answer)) {
        // Reject trailing commands, multiple lines and pasted batches.
        finish(
          answer === verb + ' ' + challenge + '\n' ||
            answer === verb + ' ' + challenge + '\r\n' ||
            answer === verb + ' ' + challenge + '\r',
        );
      }
    };
    input.on('end', reject);
    input.on('close', reject);
    input.on('error', reject);
    output.on('error', reject);
    output.on('close', reject);
    host.on('SIGINT', reject);
    host.on('SIGTERM', reject);
    signal?.addEventListener('abort', reject, { once: true });
    reviewTimer = setTimeout(reject, LIMITS.reviewMs);
    drainTimer = setTimeout(reject, LIMITS.drainMs);
    try {
      output.write(preview, (error) => {
        if (settled) return;
        clearTimeout(drainTimer);
        if (
          error ||
          signal?.aborted ||
          !isTerminalAvailable() ||
          performance.now() - started >= LIMITS.drainMs
        )
          return reject();
        admitted = true;
        input.on('data', onData);
        input.resume();
      });
    } catch {
      reject();
    }
    if (signal?.aborted) reject();
  });
}

/** @param {object} deps Trusted terminal/process/random seams. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = {
  watchTerminalLifetime,
  monitorTerminalInput,
  isTerminalAvailable,
  confirmInTerminal,
  LIMITS,
  _setDepsForTest,
  _resetForTest,
};
