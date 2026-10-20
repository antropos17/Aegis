import fs from 'node:fs';
import { createRequire } from 'node:module';

const asarFs = createRequire(import.meta.url)('@electron/asar/lib/wrapped-fs.js').default;

/** Hold one identifiable payload in the real ASAR writer until explicitly released.
 * @param {string} archive Target archive. @param {Buffer} payload Final source bytes.
 * @returns {object} Held/closed signals, stream, release and restoration controls.
 * @since v0.19.2
 */
export function holdAsarPayload(archive, payload) {
  const original = asarFs.createWriteStream;
  const held = Promise.withResolvers();
  const ended = Promise.withResolvers();
  const closed = Promise.withResolvers();
  let stream, pending;
  asarFs.createWriteStream = (file, options) => {
    if (file !== archive) return original(file, options);
    stream = original(file, {
      ...options,
      fs: {
        open: fs.open,
        close: fs.close,
        write(fd, buffer, offset, length, position, callback) {
          const write = () => fs.write(fd, buffer, offset, length, position, callback);
          if (!buffer.subarray(offset, offset + length).equals(payload)) return write();
          pending = (error) => (error ? callback(error) : write());
          held.resolve();
        },
      },
    });
    const end = stream.end;
    stream.end = function (...args) {
      const result = end.apply(this, args);
      ended.resolve();
      return result;
    };
    stream.once('close', () => closed.resolve());
    return stream;
  };
  return {
    held: held.promise,
    ended: ended.promise,
    closed: closed.promise,
    get stream() {
      return stream;
    },
    release(error) {
      const write = pending;
      pending = null;
      write?.(error);
    },
    restore() {
      asarFs.createWriteStream = original;
    },
  };
}
