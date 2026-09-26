/** TEST ONLY: passive terminal evidence without retaining paths or challenges. */
const PREFIX =
  'AEGIS terminal confirmation - ONE file deletion\n' +
  'The exact file path is displayed below. Terminal history may retain it.\n' +
  'Exact operation (JSON escapes are literal):\n';
const SUFFIX =
  /^\nType DELETE ([a-f0-9]{8}) to remove this file once within 60 seconds\. Any other answer denies\.\n> $/;

function previewChallenge(chunk, encoding, expected) {
  try {
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') return null;
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString('utf8')
      : Buffer.from(chunk, encoding).toString('utf8');
    if (Buffer.byteLength(text) > 16384 || !text.startsWith(expected)) return null;
    return SUFFIX.exec(text.slice(expected.length))?.[1] || null;
  } catch {
    return null;
  }
}

/** Passively observe only the drained terminal deletion challenge for the owned target.
 * @param {object} output Terminal writable. @param {string} target Owned exact file.
 * @param {(challenge:string) => void} onPreview Fixed-state observer.
 * @returns {() => void} Restore the original writer. @since v0.16.0 */
export function observeDeletePreview(output, target, onPreview) {
  const original = output.write;
  const own = Object.getOwnPropertyDescriptor(output, 'write');
  const expected =
    PREFIX +
    JSON.stringify({ kind: 'delete-file', path: target }, null, 2).replace(
      /[\u007f-\uffff]/g,
      (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
    );
  let active = true;
  function wrapper(...args) {
    const encoding = typeof args[1] === 'string' ? args[1] : undefined;
    const challenge = active && previewChallenge(args[0], encoding, expected);
    if (!challenge) return original.apply(this, args);
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
        onPreview(challenge);
      } catch {
        /* Observation cannot change the production terminal review. */
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

/** Compare one bounded terminal answer to the private challenge without saving it.
 * @param {object} input Terminal readable. @param {string} challenge Private token.
 * @returns {{stop: () => boolean}} Exact-answer observer. @since v0.16.0 */
export function observeAffirmativeAnswer(input, challenge) {
  const expected = [`DELETE ${challenge}\n`, `DELETE ${challenge}\r`, `DELETE ${challenge}\r\n`];
  const started = performance.now();
  let answer = '';
  let valid = true;
  const observe = (chunk) => {
    if (!valid || performance.now() - started >= 55000) return (valid = false);
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') return (valid = false);
    answer += chunk.toString();
    if (Buffer.byteLength(answer) > 128) valid = false;
  };
  input.on('data', observe);
  return {
    stop() {
      input.removeListener('data', observe);
      return valid && expected.includes(answer);
    },
  };
}
