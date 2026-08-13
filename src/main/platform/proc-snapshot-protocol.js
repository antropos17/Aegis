/**
 * @file platform/proc-snapshot-protocol.js
 * @module main/platform/proc-snapshot-protocol
 * @description The wire codec for the process-snapshot sidecar: length-prefixed
 *   frames carrying UTF-8 JSON. Pure — no child process, no fs, no clock — so the
 *   framing can be proven on any platform, including the Linux CI runners that
 *   never execute the Windows binary.
 *
 *   THE WIRE IS THE STABLE CONTRACT, not the sidecar's implementation language.
 *   A frame is `uint32 LE payload length` followed by exactly that many bytes of
 *   UTF-8 JSON; the length does not count itself. The transport (stdio today, a
 *   named pipe if that ever becomes preferable) is deliberately not part of this
 *   module.
 *
 *   Messages, all of them JSON objects with a `t` discriminator:
 *     - `{t:'hello', proto, caps:{class, sequence, topology}, pid}` — sent once by
 *       the sidecar before any request, carrying the result of its runtime
 *       capability probe. A `proto` this client does not know is a hard stop.
 *     - `{t:'snap', id}` — the only request: give me every process.
 *     - `{t:'snap', id, source, procs:[{pid, ppid, name, ct, seq}]}` — the answer.
 *       `ct` (process creation time in 100 ns ticks) and `seq` (the kernel
 *       SequenceNumber, absent when the OS does not supply one) are DECIMAL
 *       STRINGS: both exceed what a JS number holds without losing precision, and
 *       a witness that silently lost its low digits would compare equal across
 *       generations.
 *     - `{t:'err', id, code, ntstatus}` — the sidecar could not answer.
 *
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */
'use strict';

/**
 * Wire protocol version. Bumped whenever a frame's meaning changes; the client
 * refuses to talk to a sidecar announcing anything else, because a half-understood
 * snapshot is worse than no snapshot.
 * @type {number}
 */
const PROTOCOL_VERSION = 1;

/** @type {number} Bytes of the little-endian length prefix. */
const FRAME_HEADER_BYTES = 4;

/**
 * Largest payload accepted from the sidecar. A full snapshot of a busy machine is
 * tens of kilobytes, so 8 MiB is far above any honest frame and exists to bound
 * what a desynchronised or hostile stream can make this process allocate.
 * @type {number}
 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * Encode one message as a frame.
 * @param {Object} message - JSON-serialisable object.
 * @returns {Buffer}
 * @throws {RangeError} when the encoded payload exceeds {@link MAX_FRAME_BYTES} —
 *   only reachable for a request this process built itself, so it is a bug here,
 *   not a peer failure.
 */
function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_FRAME_BYTES) {
    throw new RangeError(`proc-snapshot frame too large to send: ${payload.length}`);
  }
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Create a streaming decoder. Bytes arrive in whatever chunks the OS pipe hands
 * over — a frame split across three reads and three frames in one read are both
 * normal — so the decoder buffers and yields only complete frames.
 *
 * It never throws. Two error classes are reported instead, and they are not the
 * same kind of problem:
 *   - a payload that is not a JSON object is a BAD FRAME. Framing is still in
 *     sync (exactly `len` bytes were consumed), so the frame is dropped and
 *     decoding continues;
 *   - a length prefix of zero or above {@link MAX_FRAME_BYTES} means the stream is
 *     DESYNCHRONISED. Nothing after it can be trusted, so the decoder latches
 *     `fatal` and the caller must tear the child down rather than resynchronise
 *     by guesswork.
 * @returns {{push: function(Buffer): {frames: Object[], errors: string[], fatal: boolean},
 *   pendingBytes: function(): number, isFatal: function(): boolean}}
 */
function createFrameDecoder() {
  let buffered = Buffer.alloc(0);
  let fatal = false;

  return {
    push(chunk) {
      /** @type {Object[]} */
      const frames = [];
      /** @type {string[]} */
      const errors = [];
      if (fatal) return { frames, errors: ['decoder-desynchronised'], fatal: true };

      buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, chunk]);

      while (buffered.length >= FRAME_HEADER_BYTES) {
        const len = buffered.readUInt32LE(0);
        if (len === 0 || len > MAX_FRAME_BYTES) {
          errors.push(`frame-length-invalid: ${len}`);
          fatal = true;
          buffered = Buffer.alloc(0);
          break;
        }
        if (buffered.length < FRAME_HEADER_BYTES + len) break;

        const payload = buffered.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + len);
        buffered = buffered.subarray(FRAME_HEADER_BYTES + len);
        let parsed;
        try {
          parsed = JSON.parse(payload.toString('utf8'));
        } catch (err) {
          errors.push(`frame-parse-error: ${err.message}`);
          continue;
        }
        // A bare number, string, array or null is well-formed JSON and still not a
        // message. Rejecting it here keeps every consumer free of shape guards.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.push('frame-not-an-object');
          continue;
        }
        frames.push(parsed);
      }

      return { frames, errors, fatal };
    },
    pendingBytes() {
      return buffered.length;
    },
    isFatal() {
      return fatal;
    },
  };
}

module.exports = {
  PROTOCOL_VERSION,
  FRAME_HEADER_BYTES,
  MAX_FRAME_BYTES,
  encodeFrame,
  createFrameDecoder,
};
