'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_OUTPUT = 4096;
const DEFAULTS = {
  spawn,
  platform: process.platform,
  timeoutMs: 30000,
  drainMs: 2000,
  now: () => process.hrtime.bigint(),
  executable: path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  ),
};
let deps = DEFAULTS;
const HEX = /^[a-f0-9]{64}$/;
const STATUSES = [
  'Valid',
  'UnknownError',
  'NotSigned',
  'HashMismatch',
  'NotTrusted',
  'NotSupportedFileFormat',
  'Incompatible',
];
const TYPES = ['None', 'Authenticode', 'Catalog'];

function fail(code) {
  const error = new Error(code);
  error.gateCode = code;
  throw error;
}

function ordinaryPath(value) {
  if (typeof value !== 'string' || value.length > 240 || !path.isAbsolute(value))
    fail('INVALID_PATH');
  const normalized = path.normalize(value);
  const root = path.parse(normalized).root;
  if (path.sep === '\\' && !/^[a-z]:\\$/i.test(root)) fail('INVALID_PATH');
  const pieces = value.slice(root.length).split(/[/\\]/);
  if (
    pieces.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$|[:*?"<>|\x00-\x1f\x7f]/.test(part) ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    )
  )
    fail('INVALID_PATH');
  return normalized;
}

function plainEntry(target, directory = false, allowHardlinks = false) {
  let current = target;
  const entry = fs.lstatSync(target, { bigint: true });
  if (directory ? !entry.isDirectory() : !entry.isFile() || (!allowHardlinks && entry.nlink !== 1n))
    fail('UNSAFE_PATH');
  for (;;) {
    if (fs.lstatSync(current).isSymbolicLink()) fail('UNSAFE_PATH');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fs.realpathSync(target).toLowerCase() !== target.toLowerCase()) fail('UNSAFE_PATH');
  return entry;
}

function same(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].every((key) => a[key] === b[key]);
}

function snapshot(target) {
  const before = plainEntry(target);
  if (before.size < 68n || before.size > BigInt(MAX_BYTES)) fail('ARTIFACT_SIZE');
  const fd = fs.openSync(target, 'r');
  try {
    if (!same(before, fs.fstatSync(fd, { bigint: true }))) fail('ARTIFACT_CHANGED');
    const header = Buffer.alloc(64);
    if (fs.readSync(fd, header, 0, 64, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ')
      fail('NOT_PE');
    const pe = header.readUInt32LE(60);
    if (pe < 64 || pe + 4 > Number(before.size)) fail('NOT_PE');
    const magic = Buffer.alloc(4);
    if (fs.readSync(fd, magic, 0, 4, pe) !== 4 || !magic.equals(Buffer.from([80, 69, 0, 0])))
      fail('NOT_PE');
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(65536);
    let offset = 0;
    while (offset < Number(before.size)) {
      const count = fs.readSync(
        fd,
        chunk,
        0,
        Math.min(chunk.length, Number(before.size) - offset),
        offset,
      );
      if (!count) fail('ARTIFACT_CHANGED');
      hash.update(chunk.subarray(0, count));
      offset += count;
    }
    if (!same(before, fs.fstatSync(fd, { bigint: true })) || !same(before, plainEntry(target)))
      fail('ARTIFACT_CHANGED');
    return { stat: before, sha256: hash.digest('hex'), bytes: offset };
  } finally {
    fs.closeSync(fd);
  }
}

function observe(artifact, expectedSha256) {
  return new Promise((resolve) => {
    let child;
    let deadline;
    let drain;
    let reason = null;
    let finished = false;
    let bytes = 0;
    const chunks = [];
    let stderr = false;
    let launchDeadline;
    let drainDeadline = null;
    let lastTime;
    let clockFailed = false;
    const drainNs = BigInt(deps.drainMs) * 1000000n;
    function clock() {
      if (clockFailed) return null;
      try {
        const stamp = deps.now();
        if (typeof stamp !== 'bigint' || stamp < 0n || (lastTime !== undefined && stamp < lastTime))
          throw Error('clock');
        lastTime = stamp;
        return stamp;
      } catch {
        clockFailed = true;
        return null;
      }
    }
    function remaining(target, stamp) {
      return target > stamp ? Number((target - stamp + 999999n) / 1000000n) : 0;
    }
    function finish(code, cleanup) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(drain);
      if (cleanup === 'unconfirmed') {
        child?.stdin?.destroy();
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.unref();
      }
      resolve({ code, cleanup, text: code ? '' : Buffer.concat(chunks).toString('utf8') });
    }
    function stop(code, anchor, stamp = clock()) {
      if (reason || finished) return;
      reason = stamp === null ? 'HELPER_CLOCK' : code;
      clearTimeout(deadline);
      if (stamp !== null) {
        const end = (anchor ?? (stamp < launchDeadline ? stamp : launchDeadline)) + drainNs;
        if (drainDeadline === null || end < drainDeadline) drainDeadline = end;
      }
      clearTimeout(drain);
      drain = setTimeout(onDrain, stamp === null ? deps.drainMs : remaining(drainDeadline, stamp));
      try {
        child.kill();
      } catch {
        /* close is the cleanup evidence */
      }
    }
    function checkTime() {
      const stamp = clock();
      if (stamp === null) {
        stop('HELPER_CLOCK', undefined, null);
        return false;
      }
      if (drainDeadline !== null && stamp >= drainDeadline) {
        reason ||= drainDeadline > launchDeadline ? 'HELPER_TIMEOUT' : 'HELPER_DRAIN_TIMEOUT';
        finish(reason, 'unconfirmed');
        return false;
      }
      if (stamp >= launchDeadline && !reason) stop('HELPER_TIMEOUT', launchDeadline, stamp);
      if (drainDeadline !== null && stamp >= drainDeadline) {
        finish(reason, 'unconfirmed');
        return false;
      }
      return !finished;
    }
    function onDeadline() {
      if (checkTime() && !reason)
        deadline = setTimeout(onDeadline, remaining(launchDeadline, lastTime));
    }
    function onDrain() {
      if (clockFailed || (!checkTime() && clockFailed)) {
        finish(reason || 'HELPER_CLOCK', 'unconfirmed');
      } else if (!finished) {
        drain = setTimeout(onDrain, remaining(drainDeadline, lastTime));
      }
    }
    try {
      const executable = ordinaryPath(deps.executable);
      const script = ordinaryPath(path.join(__dirname, '../windows/read-authenticode.ps1'));
      // Windows services its inbox executable through WinSxS hardlinks.
      plainEntry(executable, false, true);
      plainEntry(script);
      const started = clock();
      if (started === null) return finish('HELPER_CLOCK', 'not-started');
      launchDeadline = started + BigInt(deps.timeoutMs) * 1000000n;
      child = deps.spawn(
        executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script],
        {
          windowsHide: true,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PSModulePath: path.join(path.dirname(executable), 'Modules') },
        },
      );
      for (const [stream, isError] of [
        [child.stdout, false],
        [child.stderr, true],
      ]) {
        stream.on('data', (data) => {
          if (!checkTime() || reason) return;
          bytes += data.length;
          if (bytes > MAX_OUTPUT) return stop('HELPER_OUTPUT_LIMIT');
          if (isError) stderr = true;
          else if (!reason) chunks.push(Buffer.from(data));
        });
        stream.on('error', () => stop('HELPER_IO'));
      }
      child.stdin.on('error', () => stop('HELPER_IO'));
      child.on('error', () => stop('HELPER_UNAVAILABLE'));
      child.on('exit', () => {
        if (!checkTime()) return;
        if (drainDeadline === null) {
          drainDeadline = lastTime + drainNs;
          drain = setTimeout(onDrain, deps.drainMs);
        }
      });
      child.on('close', (code, signal) => {
        if (!checkTime()) {
          if (clockFailed) finish(reason || 'HELPER_CLOCK', 'unconfirmed');
          return;
        }
        finish(reason || (code !== 0 || signal || stderr ? 'HELPER_UNAVAILABLE' : null), 'closed');
      });
      if (checkTime() && !reason) {
        deadline = setTimeout(onDeadline, remaining(launchDeadline, lastTime));
        child.stdin.end(JSON.stringify({ artifact, expectedSha256 }));
      }
    } catch {
      if (child) stop('HELPER_UNAVAILABLE');
      else finish('HELPER_UNAVAILABLE', 'not-started');
    }
  });
}

function observation(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('HELPER_PROTOCOL');
  }
  if (
    value &&
    Object.keys(value).sort().join(',') === 'code,schemaVersion' &&
    value.schemaVersion === 1 &&
    value.code === 'HELPER_REFUSED'
  )
    fail('HELPER_REFUSED');
  const keys =
    'artifactSha256,bytes,code,schemaVersion,signatureType,signerCertificateSha256,status,timestampPresent';
  if (
    !value ||
    Object.keys(value).sort().join(',') !== keys ||
    value.schemaVersion !== 1 ||
    value.code !== 'OBSERVED' ||
    !HEX.test(value.artifactSha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 68 ||
    value.bytes > MAX_BYTES ||
    !STATUSES.includes(value.status) ||
    !TYPES.includes(value.signatureType) ||
    !(
      value.signerCertificateSha256 === null ||
      (typeof value.signerCertificateSha256 === 'string' && HEX.test(value.signerCertificateSha256))
    ) ||
    typeof value.timestampPresent !== 'boolean'
  )
    fail('HELPER_PROTOCOL');
  return value;
}

/** Verify one explicit local EXE and create an exclusive, path-free receipt.
 * @param {object} options Explicit artifact, artifactSha256, signerSha256 and output paths/pins.
 * @returns {Promise<object>} Closed verification result; pass requires a closed helper.
 * @since 0.19.2-beta
 */
async function verify(options) {
  const result = {
    schemaVersion: 1,
    verdict: 'refused',
    code: 'INVALID_INPUT',
    checkedAt: new Date().toISOString(),
    expectedArtifactSha256: null,
    expectedSignerCertificateSha256: null,
    artifactSha256: null,
    bytes: null,
    status: null,
    signatureType: null,
    signerCertificateSha256: null,
    timestampPresent: null,
    childCleanup: 'not-started',
  };
  let output;
  let outputPath;
  let outputStat;
  try {
    if (
      !options ||
      typeof options.artifactSha256 !== 'string' ||
      typeof options.signerSha256 !== 'string' ||
      !HEX.test(options.artifactSha256) ||
      !HEX.test(options.signerSha256)
    )
      fail('INVALID_INPUT');
    result.expectedArtifactSha256 = options.artifactSha256;
    result.expectedSignerCertificateSha256 = options.signerSha256;
    if (deps.platform !== 'win32') fail('WINDOWS_REQUIRED');
    const artifact = ordinaryPath(options.artifact);
    if (path.extname(artifact).toLowerCase() !== '.exe') fail('INVALID_PATH');
    outputPath = ordinaryPath(options.output);
    if (artifact.toLowerCase() === outputPath.toLowerCase()) fail('OUTPUT_COLLISION');
    plainEntry(path.dirname(outputPath), true);
    try {
      output = fs.openSync(outputPath, 'wx', 0o600);
    } catch {
      fail('OUTPUT_UNAVAILABLE');
    }
    outputStat = fs.fstatSync(output, { bigint: true });
    const before = snapshot(artifact);
    result.artifactSha256 = before.sha256;
    result.bytes = before.bytes;
    if (before.sha256 !== options.artifactSha256) fail('ARTIFACT_PIN_MISMATCH');
    const child = await observe(artifact, options.artifactSha256);
    result.childCleanup = child.cleanup;
    if (child.code) fail(child.code);
    const observed = observation(child.text);
    const after = snapshot(artifact);
    if (
      !same(before.stat, after.stat) ||
      before.sha256 !== after.sha256 ||
      observed.artifactSha256 !== before.sha256 ||
      observed.bytes !== before.bytes
    )
      fail('ARTIFACT_CHANGED');
    for (const key of ['status', 'signatureType', 'signerCertificateSha256', 'timestampPresent'])
      result[key] = observed[key];
    if (observed.status !== 'Valid') fail('SIGNATURE_NOT_VALID');
    if (observed.signatureType !== 'Authenticode') fail('EMBEDDED_SIGNATURE_REQUIRED');
    if (observed.signerCertificateSha256 !== options.signerSha256) fail('SIGNER_PIN_MISMATCH');
    result.verdict = 'pass';
    result.code = 'VERIFIED';
  } catch (error) {
    result.code = error.gateCode || 'VERIFICATION_FAILED';
  }
  if (output !== undefined) {
    try {
      const entry = plainEntry(outputPath);
      if (entry.dev !== outputStat.dev || entry.ino !== outputStat.ino) fail('OUTPUT_CHANGED');
      fs.writeFileSync(output, JSON.stringify(result) + '\n');
      fs.fsyncSync(output);
    } catch {
      result.verdict = 'refused';
      result.code = 'OUTPUT_WRITE_FAILED';
    } finally {
      try {
        fs.closeSync(output);
      } catch {
        result.verdict = 'refused';
        result.code = 'OUTPUT_WRITE_FAILED';
      }
    }
  }
  return result;
}

/** Replace process dependencies for isolated modeled tests.
 * @param {object} overrides Process dependencies, never exposed by the CLI.
 * @returns {void}
 * @since 0.19.2-beta
 */
function _setDepsForTest(overrides) {
  deps = { ...DEFAULTS, ...overrides };
}
/** Restore production process dependencies.
 * @returns {void}
 * @since 0.19.2-beta
 */
function _resetForTest() {
  deps = DEFAULTS;
}

module.exports = { verify, _setDepsForTest, _resetForTest };
