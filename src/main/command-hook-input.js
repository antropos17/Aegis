'use strict';

/**
 * Run one bounded command-hook input/evaluation lifecycle with one response.
 * Provider adapters retain their result validation, output schema and exit codes.
 * @param {object} options Stream, argv, limits, evaluator and response callback.
 * @param {NodeJS.ReadStream} options.input Provider input stream.
 * @param {string[]} options.args Provider argv, including the selected policy path.
 * @param {string} options.flag Expected hook flag.
 * @param {{inputBytes: number, deadlineMs: number}} options.limits Input/deadline caps.
 * @param {(policyPath: string, raw: Buffer) => unknown} options.evaluate Evaluator.
 * @param {(result: unknown) => unknown} options.normalize Validate the provider result.
 * @param {(result: unknown) => number} options.respond Emit one provider response.
 * @returns {Promise<number>} Provider exit status, or 2 if output fails.
 * @since v0.19.2
 */
function runCommandHookInput({ input, args, flag, limits, evaluate, normalize, respond }) {
  const started = performance.now();
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let ended = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      // Keep the error handler until close: destroy may have a queued error.
      // Release a pipe whose producer never sends EOF.
      if (!ended) input.destroy();
      let code;
      try {
        code = respond(result);
      } catch (_) {
        code = 2;
      }
      resolve(code);
    };
    function onError() {
      finish();
    }
    function onClose() {
      if (!ended) finish();
      input.removeListener('error', onError);
      input.removeListener('close', onClose);
    }
    function onData(chunk) {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limits.inputBytes || performance.now() - started >= limits.deadlineMs)
        return finish();
      chunks.push(buffer);
    }
    function onEnd() {
      ended = true;
      if (settled) return;
      let raw;
      try {
        raw = Buffer.concat(chunks, bytes);
      } catch (_) {
        return finish();
      }
      chunks.length = 0;
      Promise.resolve()
        .then(() => {
          if (settled || performance.now() - started >= limits.deadlineMs) return null;
          return evaluate(args[1], raw);
        })
        .then((result) => {
          if (settled) return;
          if (performance.now() - started >= limits.deadlineMs) return finish();
          finish(normalize(result));
        })
        .catch(() => finish())
        .finally(() => raw.fill(0));
    }
    timer = setTimeout(() => finish(), limits.deadlineMs);
    input.on('error', onError);
    input.on('close', onClose);
    if (args.length !== 2 || args[0] !== flag || typeof args[1] !== 'string' || !args[1].length)
      return finish();
    input.on('end', onEnd);
    input.on('data', onData);
  });
}

module.exports = { runCommandHookInput };
