'use strict';

/** Bound a diagnostic stream without buffering excess output. @since 0.20.1 */
function boundedWriter(write, limit = 256 * 1024) {
  let remaining = limit;
  return (chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    const accepted = bytes.subarray(0, remaining);
    remaining -= accepted.length;
    if (accepted.length) return write(accepted, done);
    if (done) process.nextTick(done);
    return true;
  };
}

/** Enable Playwright launch logs in the disposable driver only. @since 0.20.1 */
function enableLaunchDiagnostics() {
  process.stderr.write = boundedWriter(process.stderr.write.bind(process.stderr));
  process.env.DEBUG = 'pw:browser';
}

module.exports = { boundedWriter, enableLaunchDiagnostics };
