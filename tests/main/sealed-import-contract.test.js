import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectSealedImportBundle } from '../../scripts/qualification/sealed-import-oracle.mjs';
import { validateSealedImportReport } from '../../scripts/qualification/sealed-import-report.mjs';
import { parseSealedImportArguments } from '../../scripts/qualification/qualify-sealed-import.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refused = {
  schemaVersion: 1,
  profile: 'windows-x64-ntfs-dummy-v1',
  sealed: false,
  directoryStreamProfile: 'unobserved',
  code: 'import-reparse',
  developerOnly: true,
  launchAllowed: false,
  vmEffectsRun: false,
  guestImportQualified: false,
  nativeContainmentQualified: false,
  productionCaller: false,
  fileCount: 0,
  totalBytes: 0,
  manifestSha256: null,
  bundleSha256: null,
  bundleBytes: 0,
  cleanup: 'not-created',
};

function bundleFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sealed-oracle-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const bytes = Buffer.from([0, 255, 42]);
  fs.writeFileSync(path.join(source, 'sample.bin'), bytes);
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      profile: 'windows-x64-ntfs-dummy-v1',
      developerOnly: true,
      launchAllowed: false,
      directories: [''],
      files: [{ relativePath: 'sample.bin', size: bytes.length, sha256: hash(bytes), offset: 0 }],
    }),
  );
  const header = Buffer.alloc(16);
  header.write('AEGSIM01');
  header.writeInt32LE(manifest.length, 8);
  header.writeInt32LE(bytes.length, 12);
  const bundle = path.join(root, 'bundle.aegis');
  const complete = Buffer.concat([header, manifest, bytes]);
  fs.writeFileSync(bundle, complete);
  return { source, bundle, complete };
}

describe('sealed import redacted contract and independent binary oracle', () => {
  it('accepts exact redacted refusal data with every scope flag false', () => {
    expect(validateSealedImportReport(JSON.stringify(refused))).toEqual(refused);
  });

  it('rejects extra path/content/identity keys, unexpected reasons, and authorizing scope', () => {
    for (const change of [
      { sourcePath: 'C:\\private' },
      { contents: 'secret' },
      { fileId: '00' },
      { code: 'arbitrary message' },
      { launchAllowed: true },
      { guestImportQualified: true },
      { productionCaller: true },
      { nativeContainmentQualified: true },
      { vmEffectsRun: true },
      { fileCount: 129 },
      { totalBytes: 1048577 },
      { cleanup: 'unknown' },
    ]) {
      expect(() => validateSealedImportReport(JSON.stringify({ ...refused, ...change }))).toThrow();
    }
    expect(() => validateSealedImportReport(' '.repeat(65537))).toThrow();
  });

  it('rejects fabricated success without hashes and native publication retention', () => {
    expect(() =>
      validateSealedImportReport(JSON.stringify({ ...refused, sealed: true, code: 'sealed' })),
    ).toThrow();
  });

  it('rejects arbitrary project selections, commands, unknown modes and existing receipts', () => {
    const destination = path.join(os.tmpdir(), 'sealed-import-not-created.json');
    for (const args of [
      ['--source', 'project', '--receipt', destination],
      ['--command', 'node', '--receipt', destination],
      ['--mode', 'unknown', '--receipt', destination],
      ['--mode', 'positive', '--receipt', destination, '--source', 'project'],
    ]) {
      expect(() => parseSealedImportArguments(args)).toThrow();
    }
    const existing = bundleFixture().bundle;
    expect(() =>
      parseSealedImportArguments(['--mode', 'positive', '--receipt', existing]),
    ).toThrow();
  });

  it('parses independently constructed bytes and refuses extra/truncated/corrupted payload', () => {
    const fixture = bundleFixture();
    expect(inspectSealedImportBundle(fixture.bundle, fixture.source)).toMatchObject({
      fileCount: 1,
      totalBytes: 3,
    });
    for (const bytes of [
      Buffer.concat([fixture.complete, Buffer.from([0])]),
      fixture.complete.subarray(0, fixture.complete.length - 1),
      Buffer.concat([
        fixture.complete.subarray(0, fixture.complete.length - 1),
        Buffer.from([255]),
      ]),
    ]) {
      fs.writeFileSync(fixture.bundle, bytes);
      expect(() => inspectSealedImportBundle(fixture.bundle, fixture.source)).toThrow();
    }
  });

  it('rejects an oversized bundle before payload allocation or reads', () => {
    const fixture = bundleFixture();
    fs.truncateSync(fixture.bundle, 16 + 65536 + 1048576 + 1);
    const read = vi.spyOn(fs, 'readSync');
    try {
      expect(() => inspectSealedImportBundle(fixture.bundle, fixture.source)).toThrow();
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it('bounds oracle corpus reads and refuses corrupted or oversized source bytes', () => {
    const fixture = bundleFixture();
    fs.writeFileSync(path.join(fixture.source, 'sample.bin'), Buffer.from([0, 254, 42]));
    expect(() => inspectSealedImportBundle(fixture.bundle, fixture.source)).toThrow();
    fs.truncateSync(path.join(fixture.source, 'sample.bin'), 65537);
    expect(() => inspectSealedImportBundle(fixture.bundle, fixture.source)).toThrow();
  });
});
