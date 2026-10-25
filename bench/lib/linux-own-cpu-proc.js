'use strict';
const fs = require('node:fs');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const STAT_CAP = 16384;
const fail = () => {
  throw Error('linux-own-cpu-proc-unavailable');
};
/** @param {unknown} v Candidate. @returns {boolean} Canonical uint64 decimal. @since unreleased */
const unsigned = (v) =>
  typeof v === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
/** Parse only SELF CPU/start ticks; PID/comm never leave this function. @param {Buffer} bytes Bounded stat bytes. @param {number} expectedPid Internal own PID. @returns {object} Decimal tick strings and input digest. @since unreleased */
function parseSelfStat(bytes, expectedPid) {
  try {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > STAT_CAP ||
      bytes.includes(0) ||
      !Number.isSafeInteger(expectedPid) ||
      expectedPid < 1
    )
      fail();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const first = text.indexOf(' ('),
      last = text.lastIndexOf(')');
    if (first < 1 || last <= first + 1 || text.slice(0, first) !== String(expectedPid)) fail();
    const tail = text.slice(last + 1);
    if (!/^ [RSDZTWtXxKPI] /.test(tail)) fail();
    const fields = tail.trim().split(/\s+/);
    if (
      fields.length < 20 ||
      fields.length > 64 ||
      ![fields[11], fields[12], fields[19]].every(unsigned)
    )
      fail();
    return {
      userTicks: fields[11],
      systemTicks: fields[12],
      startTicks: fields[19],
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch {
    fail();
  }
}
/** Read only fixed /proc/self/stat; st_size zero and changing metadata are normal. @returns {Buffer} Bounded bytes after confirmed close. @since unreleased */
function readSelfStat() {
  const fd = fs.openSync('/proc/self/stat', fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(fd).isFile()) fail();
    const bytes = Buffer.alloc(STAT_CAP + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = fs.readSync(fd, bytes, used, bytes.length - used, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - used) fail();
      used += count;
      if (!count) break;
    }
    if (!used || used > STAT_CAP) fail();
    return bytes.subarray(0, used);
  } finally {
    fs.closeSync(fd);
  }
}
/** Run only the fixed native CLK_TCK preflight with bounded output/time and no inherited preload environment. @returns {Buffer} Raw result for strict parsing. @since unreleased */
function getClockTicks() {
  return childProcess.execFileSync('/usr/bin/getconf', ['CLK_TCK'], {
    timeout: 1000,
    maxBuffer: 128,
    env: { LC_ALL: 'C' },
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
/** Parse discovered clock ticks; no guessed fallback or approximate conversion model. @param {Buffer} bytes Bounded preflight result. @returns {string} Supported decimal HZ. @since unreleased */
function parseClockTicks(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 128) fail();
  if (bytes.some((byte) => byte > 127)) fail();
  const text = bytes.toString('ascii');
  if (!/^[1-9][0-9]{0,9}\n?$/.test(text)) fail();
  const hz = BigInt(text.trim());
  if (hz > 1000000000n || 1000000000n % hz !== 0n) fail();
  return hz.toString();
}
module.exports = {
  parseSelfStat,
  readSelfStat,
  getClockTicks,
  parseClockTicks,
  STAT_CAP,
  unsigned,
};
