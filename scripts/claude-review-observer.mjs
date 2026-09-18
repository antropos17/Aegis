const PREFIX = 'AEGIS terminal confirmation - ONE launch\n';
const SUFFIX =
  /\nType RUN [a-f0-9]{8} to launch once within 60 seconds\. Any other answer denies\.\n> $/;
const MAX_BYTES = 16384;

function isPreview(chunk, encoding) {
  try {
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') return false;
    const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
    if (size > MAX_BYTES) return false;
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString('utf8')
      : Buffer.from(chunk, encoding).toString('utf8');
    return text.startsWith(PREFIX) && SUFFIX.test(text);
  } catch {
    return false;
  }
}

/**
 * Passively observe the production terminal's single-write, complete review preview.
 * Retain only match/completion flags; never expose private preview text or challenge.
 * @param {object} output Terminal writable stream.
 * @param {() => void} onPreview Notification after its successful write callback returns.
 * @returns {() => void} Restore only this observer's wrapper and disable late notifications.
 * @since v0.15.1
 */
export function observeReviewPreview(output, onPreview) {
  const original = output.write;
  const own = Object.getOwnPropertyDescriptor(output, 'write');
  let active = true;
  function wrapper(...args) {
    const encoding = typeof args[1] === 'string' ? args[1] : undefined;
    if (!active || !isPreview(args[0], encoding)) return original.apply(this, args);
    const callbackIndex =
      typeof args[1] === 'function' ? 1 : typeof args[2] === 'function' ? 2 : -1;
    const callback = callbackIndex < 0 ? undefined : args[callbackIndex];
    let returned = false;
    let completed = false;
    let notified = false;
    let failed = false;
    const notify = () => {
      if (!active || !returned || !completed || notified || failed) return;
      notified = true;
      try {
        onPreview();
      } catch {
        /* An observer cannot change terminal write behavior. */
      }
    };
    function written(...callbackArgs) {
      if (callbackArgs[0]) failed = true;
      try {
        callback?.apply(this, callbackArgs);
      } catch (error) {
        failed = true;
        throw error;
      }
      completed = true;
      notify();
    }
    if (callbackIndex < 0) args.push(written);
    else args[callbackIndex] = written;
    // A synchronous callback followed by a throwing write must not notify.
    const result = original.apply(this, args);
    returned = true;
    notify();
    return result;
  }
  output.write = wrapper;
  return () => {
    active = false;
    if (output.write !== wrapper) return;
    if (own) Object.defineProperty(output, 'write', own);
    else delete output.write;
  };
}

/**
 * Observe an exact negative answer after a drained preview without changing input.
 * Keep only fixed-candidate membership and a bounded position, never user text.
 * Accept bytes only within 55 seconds, conservatively inside production's 60 seconds.
 * @param {object} input Readable terminal input already owned by confirmation.
 * @returns {{stop: () => boolean}} Detach and report exact lowercase no plus line ending.
 * @since v0.15.1
 */
export function observeNegativeAnswer(input) {
  const candidates = ['no\n', 'no\r', 'no\r\n'];
  const started = performance.now();
  let mask = 7;
  let position = 0;
  let stopped = false;
  const observe = (chunk) => {
    if (stopped || mask === 0) return;
    if (performance.now() - started >= 55000) {
      mask = 0;
      return;
    }
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') {
      mask = 0;
      return;
    }
    const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    if (size + position > 128) {
      mask = 0;
      return;
    }
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const byte of bytes) {
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].charCodeAt(position) !== byte) mask &= ~(1 << i);
      }
      position++;
      if (mask === 0) return;
    }
  };
  input.on('data', observe);
  return {
    stop() {
      stopped = true;
      input.removeListener('data', observe);
      return candidates.some(
        (candidate, i) => (mask & (1 << i)) !== 0 && position === candidate.length,
      );
    },
  };
}
