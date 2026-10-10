import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { inspectSealedImportBundle } from '../../scripts/qualification/sealed-import-oracle.mjs';
import { validateSealedImportReport } from '../../scripts/qualification/sealed-import-report.mjs';
import { parseSealedImportArguments } from '../../scripts/qualification/qualify-sealed-import.mjs';
import { createSealedImportHarness } from '../fixtures/sealed-import/harness.mjs';

const require = createRequire(import.meta.url);
const {
  fixedCorpus,
  consumeFixedCopy,
} = require('../../scripts/qualification/cloud-sealed-copy.cjs');
const corpora = createSealedImportHarness();
afterAll(corpora.finish);

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

function bundleFixture(files = { 'sample.bin': Buffer.from([0, 255, 42]) }) {
  const { root, source } = corpora.corpus('oracle');
  fs.unlinkSync(path.join(source, 'readme.txt'));
  const payload = [];
  let offset = 0;
  const rows = Object.entries(files).map(([relativePath, content]) => {
    const bytes = Buffer.from(content);
    fs.writeFileSync(path.join(source, relativePath), bytes);
    payload.push(bytes);
    const row = { relativePath, size: bytes.length, sha256: hash(bytes), offset };
    offset += bytes.length;
    return row;
  });
  const bytes = Buffer.concat(payload);
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      profile: 'windows-x64-ntfs-dummy-v1',
      developerOnly: true,
      launchAllowed: false,
      directories: [''],
      files: rows,
    }),
  );
  const header = Buffer.alloc(16);
  header.write('AEGSIM01');
  header.writeInt32LE(manifest.length, 8);
  header.writeInt32LE(bytes.length, 12);
  const bundle = path.join(root, 'bundle.aegis');
  const complete = Buffer.concat([header, manifest, bytes]);
  fs.writeFileSync(bundle, complete);
  return { root, source, bundle, complete };
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

  it('accepts the canonical magic header in the oracle and fixed guest consumer', () => {
    const fixture = bundleFixture(fixedCorpus);
    const destination = path.join(fixture.root, 'canonical-copy');
    expect(inspectSealedImportBundle(fixture.bundle, fixture.source)).toMatchObject({
      fileCount: 4,
    });
    expect(consumeFixedCopy(fixture.complete, hash(fixture.complete), destination)).toMatchObject({
      passed: true,
      fileCount: 4,
      initialTestExitCode: 1,
      testExitCode: 0,
      e2Qualified: false,
      launchAllowed: false,
    });
    expect(fs.existsSync(destination)).toBe(true);
  });

  it('rejects high-bit magic aliases in both readers before creating a guest destination', () => {
    const fixture = bundleFixture(fixedCorpus);
    const singleBytes = Array.from({ length: 8 }, (_, index) => [index]);
    for (const indexes of [...singleBytes, [0, 1, 2, 3, 4, 5, 6, 7]]) {
      const bytes = Buffer.from(fixture.complete);
      for (const index of indexes) bytes[index] |= 0x80;
      fs.writeFileSync(fixture.bundle, bytes);
      const destination = path.join(fixture.root, `aliased-copy-${indexes.join('-')}`);
      expect(() => inspectSealedImportBundle(fixture.bundle, fixture.source)).toThrow(
        'sealed-import-oracle-mismatch',
      );
      expect(() => consumeFixedCopy(bytes, hash(bytes), destination)).toThrow(
        'fixed-sealed-copy-refused',
      );
      expect(fs.existsSync(destination)).toBe(false);
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
