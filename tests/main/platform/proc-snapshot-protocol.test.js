import { describe, it, expect } from 'vitest';
import protocol from '../../../src/main/platform/proc-snapshot-protocol.js';

const { encodeFrame, createFrameDecoder, MAX_FRAME_BYTES, PROTOCOL_VERSION } = protocol;

/**
 * Build a frame by hand so the decoder is tested against BYTES, not against
 * whatever encodeFrame happens to produce.
 * @param {number} len - the length prefix to write (may deliberately lie).
 * @param {string} payload
 * @returns {Buffer}
 */
function rawFrame(len, payload) {
  const body = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(len, 0);
  return Buffer.concat([header, body]);
}

describe('platform/proc-snapshot-protocol', () => {
  it('exposes the protocol version the client negotiates on', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  describe('encodeFrame', () => {
    it('round-trips a message through the decoder', () => {
      const decoder = createFrameDecoder();
      const { frames, errors, fatal } = decoder.push(encodeFrame({ t: 'snap', id: 3 }));
      expect(frames).toEqual([{ t: 'snap', id: 3 }]);
      expect(errors).toEqual([]);
      expect(fatal).toBe(false);
    });

    it('writes the payload length, not counting the header', () => {
      const frame = encodeFrame({ t: 'snap', id: 1 });
      expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    });

    it('refuses to send a payload above the frame ceiling', () => {
      const huge = { t: 'snap', pad: 'x'.repeat(MAX_FRAME_BYTES + 1) };
      expect(() => encodeFrame(huge)).toThrow(RangeError);
    });
  });

  describe('createFrameDecoder', () => {
    it('reassembles a frame split across three chunks', () => {
      const frame = encodeFrame({ t: 'hello', proto: 1 });
      const decoder = createFrameDecoder();

      expect(decoder.push(frame.subarray(0, 2)).frames).toEqual([]);
      expect(decoder.pendingBytes()).toBe(2);
      expect(decoder.push(frame.subarray(2, 7)).frames).toEqual([]);
      const last = decoder.push(frame.subarray(7));

      expect(last.frames).toEqual([{ t: 'hello', proto: 1 }]);
      expect(decoder.pendingBytes()).toBe(0);
    });

    it('decodes two frames delivered in one chunk', () => {
      const decoder = createFrameDecoder();
      const chunk = Buffer.concat([encodeFrame({ t: 'a' }), encodeFrame({ t: 'b' })]);
      expect(decoder.push(chunk).frames).toEqual([{ t: 'a' }, { t: 'b' }]);
    });

    it('keeps the tail of an incomplete second frame buffered', () => {
      const decoder = createFrameDecoder();
      const second = encodeFrame({ t: 'b' });
      const chunk = Buffer.concat([encodeFrame({ t: 'a' }), second.subarray(0, 3)]);
      const result = decoder.push(chunk);
      expect(result.frames).toEqual([{ t: 'a' }]);
      expect(decoder.pendingBytes()).toBe(3);
      expect(decoder.push(second.subarray(3)).frames).toEqual([{ t: 'b' }]);
    });

    it('reports a bad payload and keeps decoding — framing is still in sync', () => {
      const decoder = createFrameDecoder();
      const chunk = Buffer.concat([rawFrame(7, 'not-json'.slice(0, 7)), encodeFrame({ t: 'b' })]);
      const result = decoder.push(chunk);
      expect(result.errors[0]).toMatch(/frame-parse-error/);
      expect(result.fatal).toBe(false);
      expect(result.frames).toEqual([{ t: 'b' }]);
    });

    it('rejects well-formed JSON that is not a message object', () => {
      const decoder = createFrameDecoder();
      const payload = '[1,2]';
      const result = decoder.push(rawFrame(payload.length, payload));
      expect(result.errors).toEqual(['frame-not-an-object']);
      expect(result.frames).toEqual([]);
      expect(result.fatal).toBe(false);
    });

    it('treats an oversized length prefix as desynchronisation, not as a big frame', () => {
      const decoder = createFrameDecoder();
      const result = decoder.push(rawFrame(MAX_FRAME_BYTES + 1, 'x'));
      expect(result.fatal).toBe(true);
      expect(result.frames).toEqual([]);
      expect(result.errors[0]).toMatch(/frame-length-invalid/);
    });

    it('treats a zero length prefix as desynchronisation', () => {
      const decoder = createFrameDecoder();
      expect(decoder.push(rawFrame(0, '')).fatal).toBe(true);
    });

    it('stays fatal once desynchronised — a resynchronised guess is not offered', () => {
      const decoder = createFrameDecoder();
      decoder.push(rawFrame(0, ''));
      const after = decoder.push(encodeFrame({ t: 'snap', id: 1 }));
      expect(after.fatal).toBe(true);
      expect(after.frames).toEqual([]);
      expect(decoder.isFatal()).toBe(true);
    });
  });
});
