import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUBJECT =
  process.env.AEGIS_AUTHENTICODE_TEST_SUBJECT || path.join(ROOT, 'scripts/lib/authenticode.js');
const CLI = path.join(ROOT, 'scripts/verify-authenticode.cjs');
const gate = require(SUBJECT);
const { parse } = require(CLI);
const signer = 'b'.repeat(64);
const otherSigner = 'c'.repeat(64);
let root;
let options;
let observed;
let child;
let spawn;

function payload() {
  const value = Buffer.alloc(128);
  value.write('MZ');
  value.writeUInt32LE(64, 60);
  value.write('PE\0\0', 64);
  return value;
}

function model(
  action = (process) => {
    process.stdout.write(JSON.stringify(observed));
    process.emit('exit', 0, null);
    process.emit('close', 0, null);
  },
  overrides = {},
) {
  spawn = vi.fn(() => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return true;
    });
    child.unref = vi.fn();
    child.stdin.on('finish', () => queueMicrotask(() => action(child)));
    return child;
  });
  gate._setDepsForTest({
    spawn,
    platform: 'win32',
    executable: process.execPath,
    timeoutMs: 30,
    drainMs: 15,
    ...overrides,
  });
}

async function refusal(code) {
  const result = await gate.verify(options);
  expect(result).toMatchObject({ verdict: 'refused', code });
  expect(JSON.stringify(result)).not.toContain(root);
  return result;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-authenticode-'));
  const bytes = payload();
  options = {
    artifact: path.join(root, 'owned.exe'),
    artifactSha256: createHash('sha256').update(bytes).digest('hex'),
    signerSha256: signer,
    output: path.join(root, 'receipt.json'),
  };
  fs.writeFileSync(options.artifact, bytes);
  observed = {
    schemaVersion: 1,
    code: 'OBSERVED',
    artifactSha256: options.artifactSha256,
    bytes: bytes.length,
    status: 'Valid',
    signatureType: 'Authenticode',
    signerCertificateSha256: signer,
    timestampPresent: true,
  };
  model();
});

afterEach(() => {
  gate._resetForTest();
  vi.restoreAllMocks();
  if (
    root &&
    path.dirname(root) === os.tmpdir() &&
    path.basename(root).startsWith('aegis-authenticode-')
  )
    fs.rmSync(root, { recursive: true, force: true });
});

describe('bounded Authenticode prerequisite (modeled Windows observations)', () => {
  it('binds both pins to stable bytes and writes an exclusive, path-free receipt', async () => {
    const result = await gate.verify(options);
    expect(result).toMatchObject({
      verdict: 'pass',
      code: 'VERIFIED',
      childCleanup: 'closed',
      artifactSha256: options.artifactSha256,
      expectedSignerCertificateSha256: signer,
      signerCertificateSha256: signer,
      status: 'Valid',
      signatureType: 'Authenticode',
    });
    expect(JSON.parse(fs.readFileSync(options.output, 'utf8'))).toEqual(result);
    const [exe, args, settings] = spawn.mock.calls[0];
    expect(exe).toBe(process.execPath);
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-File']);
    expect(args).toHaveLength(5);
    expect(settings).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(settings.env.PSModulePath).toBe(path.join(path.dirname(process.execPath), 'Modules'));
    expect(JSON.parse(child.stdin.read().toString())).toEqual({
      artifact: options.artifact,
      expectedSha256: options.artifactSha256,
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it.each([
    'NotSigned',
    'NotTrusted',
    'HashMismatch',
    'UnknownError',
    'NotSupportedFileFormat',
    'Incompatible',
  ])('refuses OS status %s', async (status) => {
    observed.status = status;
    await refusal('SIGNATURE_NOT_VALID');
  });

  it.each(['Catalog', 'None'])('refuses %s instead of an embedded signature', async (type) => {
    observed.signatureType = type;
    await refusal('EMBEDDED_SIGNATURE_REQUIRED');
  });

  it.each([null, otherSigner])(
    'refuses absent or mismatched certificate DER pin %s',
    async (pin) => {
      observed.signerCertificateSha256 = pin;
      await refusal('SIGNER_PIN_MISMATCH');
    },
  );

  it('does not treat absence of a timestamp as timestamp qualification', async () => {
    observed.timestampPresent = false;
    expect(await gate.verify(options)).toMatchObject({ verdict: 'pass', timestampPresent: false });
  });

  it('refuses a wrong artifact pin before starting the helper', async () => {
    options.artifactSha256 = 'a'.repeat(64);
    await refusal('ARTIFACT_PIN_MISMATCH');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['artifactSha256', 'bytes'])(
    'refuses helper artifact binding mismatch: %s',
    async (field) => {
      observed[field] = field === 'bytes' ? 129 : 'd'.repeat(64);
      await refusal('ARTIFACT_CHANGED');
    },
  );

  it('detects replacement of the path even when its bytes are identical', async () => {
    model((process) => {
      fs.renameSync(options.artifact, path.join(root, 'old.exe'));
      fs.writeFileSync(options.artifact, payload());
      process.stdout.write(JSON.stringify(observed));
      process.emit('close', 0, null);
    });
    await refusal('ARTIFACT_CHANGED');
  });

  it('detects changed bytes between the observation and final binding', async () => {
    model((process) => {
      const bytes = payload();
      bytes[127] = 1;
      fs.writeFileSync(options.artifact, bytes);
      process.stdout.write(JSON.stringify(observed));
      process.emit('close', 0, null);
    });
    await refusal('ARTIFACT_CHANGED');
  });

  it.each([undefined, null, {}])('rejects malformed helper schema %j', async (value) => {
    model((process) => {
      process.stdout.write(value === undefined ? '{"schemaVersion":' : JSON.stringify(value));
      process.emit('close', 0, null);
    });
    await refusal('HELPER_PROTOCOL');
  });

  it.each([
    { status: 'unexpected' },
    { signatureType: 'Unknown' },
    { extra: '/private/path' },
    { timestampPresent: 1 },
    { signerCertificateSha256: [] },
  ])('rejects an open or invalid observation %j', async (patch) => {
    Object.assign(observed, patch);
    await refusal('HELPER_PROTOCOL');
  });

  it('preserves a fixed helper refusal without exposing details', async () => {
    model((process) => {
      process.stdout.write('{"schemaVersion":1,"code":"HELPER_REFUSED"}');
      process.emit('close', 0, null);
    });
    await refusal('HELPER_REFUSED');
  });

  it.each(['stdout', 'stderr'])('kills an overflowing %s and observes close', async (stream) => {
    model((process) => process[stream].write(Buffer.alloc(4097)));
    expect(await refusal('HELPER_OUTPUT_LIMIT')).toMatchObject({ childCleanup: 'closed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('times out and records unconfirmed cleanup when close never arrives', async () => {
    model((process) => {
      process.kill.mockImplementation(() => false);
    });
    expect(await refusal('HELPER_TIMEOUT')).toMatchObject({ childCleanup: 'unconfirmed' });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(child.stdout.destroyed).toBe(true);
  });

  it('accepts a valid close before its absolute launch deadline', async () => {
    let clock = 0n;
    model(
      (process) => {
        clock = 29000000n;
        process.stdout.write(JSON.stringify(observed));
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await gate.verify(options)).toMatchObject({ verdict: 'pass', childCleanup: 'closed' });
  });

  it('refuses an absolute late close before the overdue timer runs', async () => {
    let clock = 0n;
    model(
      (process) => {
        process.stdout.write(JSON.stringify(observed));
        clock = 31000000n;
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_TIMEOUT')).toMatchObject({ childCleanup: 'closed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('refuses absolute late valid output and close in the same delayed turn', async () => {
    let clock = 0n;
    model(
      (process) => {
        clock = 30000000n;
        process.stdout.write(JSON.stringify(observed));
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_TIMEOUT')).toMatchObject({ childCleanup: 'closed' });
  });

  it('retains uncertainty after the absolute timeout grace in the same delayed turn', async () => {
    let clock = 0n;
    model(
      (process) => {
        clock = 46000000n;
        process.stdout.write(JSON.stringify(observed));
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_TIMEOUT')).toMatchObject({ childCleanup: 'unconfirmed' });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('refuses close after the absolute exit drain cutoff before its timer runs', async () => {
    let clock = 0n;
    model(
      (process) => {
        process.stdout.write(JSON.stringify(observed));
        process.emit('exit', 0, null);
        clock = 16000000n;
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_DRAIN_TIMEOUT')).toMatchObject({ childCleanup: 'unconfirmed' });
  });

  it('keeps a late helper error within the absolute launch grace', async () => {
    let clock = 0n;
    model(
      (process) => {
        clock = 40000000n;
        process.emit('error', Error(root));
        clock = 46000000n;
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_UNAVAILABLE')).toMatchObject({ childCleanup: 'unconfirmed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it.each([undefined, NaN, -1n])(
    'refuses an unavailable monotonic launch clock %s',
    async (value) => {
      model(undefined, { now: () => value });
      await refusal('HELPER_CLOCK');
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('refuses a throwing monotonic launch clock', async () => {
    model(undefined, {
      now: () => {
        throw Error(root);
      },
    });
    await refusal('HELPER_CLOCK');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a regressing monotonic clock and preserves cleanup uncertainty', async () => {
    let clock = 1n;
    model(
      (process) => {
        clock = 0n;
        process.stdout.write(JSON.stringify(observed));
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_CLOCK')).toMatchObject({ childCleanup: 'unconfirmed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('refuses an unavailable monotonic clock at close after valid output', async () => {
    let clock = 0n;
    model(
      (process) => {
        process.stdout.write(JSON.stringify(observed));
        clock = undefined;
        process.emit('close', 0, null);
      },
      { now: () => clock },
    );
    expect(await refusal('HELPER_CLOCK')).toMatchObject({ childCleanup: 'unconfirmed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('bounds drain even after process exit without stream close', async () => {
    model((process) => process.emit('exit', 0, null));
    expect(await refusal('HELPER_DRAIN_TIMEOUT')).toMatchObject({ childCleanup: 'unconfirmed' });
  });

  it.each(['stderr', 'nonzero', 'signal', 'error'])(
    'refuses helper %s without echoing its data',
    async (mode) => {
      model((process) => {
        if (mode === 'stderr') process.stderr.write(root);
        if (mode === 'error') process.emit('error', new Error(root));
        else
          process.emit('close', mode === 'nonzero' ? 1 : 0, mode === 'signal' ? 'SIGTERM' : null);
      });
      await refusal('HELPER_UNAVAILABLE');
    },
  );

  it('never overwrites an existing output or starts its helper', async () => {
    fs.writeFileSync(options.output, 'keep');
    await refusal('OUTPUT_UNAVAILABLE');
    expect(fs.readFileSync(options.output, 'utf8')).toBe('keep');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('preserves a foreign output replacement and refuses its receipt', async () => {
    model((process) => {
      fs.renameSync(options.output, path.join(root, 'reserved.json'));
      fs.writeFileSync(options.output, 'foreign');
      process.stdout.write(JSON.stringify(observed));
      process.emit('close', 0, null);
    });
    await refusal('OUTPUT_WRITE_FAILED');
    expect(fs.readFileSync(options.output, 'utf8')).toBe('foreign');
  });

  it('does not report a pass when receipt flush fails', async () => {
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw new Error(root);
    });
    await refusal('OUTPUT_WRITE_FAILED');
    expect(JSON.parse(fs.readFileSync(options.output, 'utf8'))).toMatchObject({
      verdict: 'pass',
      code: 'VERIFIED',
    });
  });

  it('refuses an artifact/output alias', async () => {
    options.output = options.artifact;
    await refusal('OUTPUT_COLLISION');
    expect(fs.readFileSync(options.artifact)).toEqual(payload());
  });

  it.each(['relative.exe', 'X:\\owned.exe:alternate', '\\\\server\\share\\owned.exe'])(
    'refuses an unsafe path %s',
    async (artifact) => {
      options.artifact = artifact;
      await refusal('INVALID_PATH');
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('refuses hardlink artifact aliases', async () => {
    fs.linkSync(options.artifact, path.join(root, 'alias.exe'));
    await refusal('UNSAFE_PATH');
  });

  it('refuses directory reparse aliases before starting a helper', async () => {
    const alias = path.join(root, 'alias');
    fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    options.artifact = path.join(alias, 'owned.exe');
    await refusal('UNSAFE_PATH');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses non-PE bytes and files beyond the explicit size cap', async () => {
    fs.writeFileSync(options.artifact, Buffer.alloc(128));
    await refusal('NOT_PE');
    fs.unlinkSync(options.output);
    fs.truncateSync(options.artifact, 512 * 1024 * 1024 + 1);
    await refusal('ARTIFACT_SIZE');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails closed on another platform without creating a receipt', async () => {
    gate._setDepsForTest({ platform: 'linux' });
    await refusal('WINDOWS_REQUIRED');
    expect(fs.existsSync(options.output)).toBe(false);
  });

  it.each([undefined, 'B'.repeat(64), 'short', [signer]])(
    'requires an explicit lowercase certificate pin %j',
    async (pin) => {
      options.signerSha256 = pin;
      await refusal('INVALID_INPUT');
      expect(spawn).not.toHaveBeenCalled();
      expect(fs.existsSync(options.output)).toBe(false);
    },
  );

  it('requires a closed argument set', () => {
    const args = [
      '--artifact',
      options.artifact,
      '--artifact-sha256',
      options.artifactSha256,
      '--signer-sha256',
      signer,
      '--output',
      options.output,
    ];
    expect(parse(args)).toEqual(options);
    expect(parse([...args, '--unknown', 'value'])).toBeNull();
    expect(parse(['toString', 'bad', ...args.slice(2)])).toBeNull();
    expect(parse(['--help'])).toBeNull();
  });

  it('provides readable help and fixed argument errors without exposing caller data', () => {
    const run = (args) =>
      spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 16384,
      });
    const help = run(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--signer-sha256');
    expect(help.stdout).toContain('30 s');
    expect(help.stderr).toBe('');
    const invalid = run(['--unexpected', root]);
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toEqual({
      schemaVersion: 1,
      verdict: 'refused',
      code: 'INVALID_ARGUMENTS',
    });
    expect(invalid.stdout).not.toContain(root);
    expect(invalid.stderr).toBe('');
  });
});
