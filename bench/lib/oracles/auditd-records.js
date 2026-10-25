'use strict';

// Raw audit records only. Interpreted ausearch output is a different format.
// Event keys and interleaving: https://github.com/linux-audit/audit-userspace#events
const LIMITS = Object.freeze({
  bytes: 1048576,
  lines: 4096,
  lineBytes: 16384,
  events: 512,
  recordsPerEvent: 128,
  outputBytes: 2097152,
});
const HEADER =
  /^(?:node=([^ ]{1,255}) )?type=([A-Z][A-Z0-9_]{0,63}|[0-9]{1,10}) msg=audit\(((?:0|[1-9][0-9]{0,12}))\.([0-9]{3}):((?:0|[1-9][0-9]{0,19}))\):(?: (.*))?$/;

/**
 * Parse bounded raw audit records without interpreting syscall or encoded fields.
 * @param {Buffer} bytes Raw audit log bytes from one caller-selected source.
 * @returns {object[]} Records carrying exact event keys and opaque payloads.
 * @since v0.20.1
 */
function parseRecords(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes)
    throw new Error('auditd-input-byte-limit');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('auditd-nul-refused');
  if (text && !text.endsWith('\n')) throw new Error('auditd-unterminated-record');
  const lines = text ? text.slice(0, -1).split('\n') : [];
  if (lines.length > LIMITS.lines) throw new Error('auditd-record-limit');
  return lines.map((line, index) => {
    if (Buffer.byteLength(line) > LIMITS.lineBytes) throw new Error('auditd-line-byte-limit');
    const match = HEADER.exec(line);
    const hasControl = Array.from(line).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
    if (!match || hasControl) throw new Error('auditd-raw-record-invalid');
    const [, node = null, type, seconds, milliseconds, serial, payload = ''] = match;
    return { line: index + 1, node, type, seconds, milliseconds, serial, payload };
  });
}

module.exports = { LIMITS, parseRecords };
