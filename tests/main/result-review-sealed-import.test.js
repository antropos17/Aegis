import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSealedImportHarness } from '../fixtures/sealed-import/harness.mjs';
import { inspectSealedImportBundle } from '../../scripts/qualification/sealed-import-oracle.mjs';

const require = createRequire(import.meta.url);
const {
  copyResultReviewSnapshot,
  parseResultReviewBundle,
} = require('../../src/main/result-review-bundle');
const { handleResultReview } = require('../../src/main/result-review-ipc');
const file = (name, bytes) => ({
  path: name,
  kind: 'file',
  contentBase64: Buffer.from(bytes).toString('base64'),
});
const comparison = (bundle, files) => ({
  schemaVersion: 2,
  captureSource: 'external-result',
  beforeSealedImportBase64: bundle.toString('base64'),
  after: { complete: true, files },
  claims: { accepted: true, stopped: true, boundaryPassed: true },
});
const harness = createSealedImportHarness();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (manifest, payload, text = JSON.stringify(manifest)) => {
  const wire = Buffer.from(text);
  const header = Buffer.alloc(16);
  header.write('AEGSIM01');
  header.writeInt32LE(wire.length, 8);
  header.writeInt32LE(payload.length, 12);
  return Buffer.concat([header, wire, payload]);
};
function synthetic(entries = [['a.txt', Buffer.from('old')]], directories = ['']) {
  let offset = 0;
  const payload = Buffer.concat(entries.map(([, bytes]) => bytes));
  const manifest = {
    schemaVersion: 1,
    profile: 'windows-x64-ntfs-dummy-v1',
    developerOnly: true,
    launchAllowed: false,
    directories,
    files: entries.map(([relativePath, bytes]) => {
      const row = { relativePath, size: bytes.length, sha256: hash(bytes), offset };
      offset += bytes.length;
      return row;
    }),
  };
  return { manifest, payload, bundle: encode(manifest, payload) };
}
const parse = (value) => parseResultReviewBundle(Buffer.from(JSON.stringify(value)));

describe('adversarial synthetic sealed-format comparison inputs', () => {
  it('uses the same baseline/selection digests as schema 1 without acquiring provenance', () => {
    const { bundle } = synthetic();
    const after = [file('a.txt', 'new')];
    const review = parse(comparison(bundle, after));
    const legacy = parse({
      schemaVersion: 1,
      captureSource: 'external-result',
      before: { complete: true, files: [file('a.txt', 'old')] },
      after: { complete: true, files: after },
      claims: { accepted: false, stopped: false, boundaryPassed: false },
    });
    expect(review.baselineDigest).toBe(legacy.baselineDigest);
    expect(review.snapshotDigest).toBe(legacy.snapshotDigest);
    expect(review.changes).toEqual(legacy.changes);
    expect(review).toMatchObject({
      originalState: 'complete-imported-baseline-unverified',
      acceptance: 'unreviewed',
      writerState: 'stop-unconfirmed',
      launchAllowed: false,
      projectExportAllowed: false,
    });
    const incomplete = comparison(bundle, []);
    incomplete.after.complete = false;
    expect(parse(incomplete).changes[0].type).toBe('unknown');
  });

  it.each([
    'root',
    'unknown',
    'profile',
    'launch',
    'producer',
    'row-extra',
    'hash',
    'offset',
    'size',
    'negative',
    'fraction',
  ])('refuses exact manifest/hash/offset violation: %s', (mode) => {
    const { manifest, payload } = synthetic();
    if (mode === 'root') manifest.directories = [];
    if (mode === 'unknown') manifest.authority = true;
    if (mode === 'profile') manifest.profile = 'other';
    if (mode === 'launch') manifest.launchAllowed = true;
    if (mode === 'producer') manifest.developerOnly = false;
    if (mode === 'row-extra') manifest.files[0].kind = 'link';
    if (mode === 'hash') manifest.files[0].sha256 = '0'.repeat(64);
    if (mode === 'offset') manifest.files[0].offset = 1;
    if (mode === 'size') manifest.files[0].size++;
    if (mode === 'negative') manifest.files[0].size = -1;
    if (mode === 'fraction') manifest.files[0].size = 0.5;
    expect(() => parse(comparison(encode(manifest, payload), []))).toThrow('result-bundle-invalid');
  });

  it.each([
    ['../a', ['']],
    ['a:stream', ['']],
    ['a\\b', ['']],
    ['CON.txt', ['']],
    ['a.', ['']],
    ['a/b.txt', ['']],
    ['a/b.txt', ['', 'A']],
    ['a/b.txt', ['', 'a/b']],
    ['a.txt', ['', 'a.txt']],
    ['a.txt', ['', 'a', 'Z']],
    ['a.txt', ['', 'x', 'X']],
    ['a.txt', ['', 'missing/child']],
    ['é.txt', ['']],
    [Array(9).fill('a').join('/'), ['']],
    ['a'.repeat(65), ['']],
  ])('refuses unsafe path or directory topology %s %j', (name, directories) => {
    const { bundle } = synthetic([[name, Buffer.from('x')]], directories);
    expect(() => parse(comparison(bundle, []))).toThrow('result-bundle-invalid');
  });

  it('rejects binary truncation, extra bytes, high-bit magic, oversized manifest, payload edits and alternate encodings', () => {
    const { bundle, manifest, payload } = synthetic();
    const magic = Buffer.from(bundle);
    magic[0] |= 128;
    const altered = Buffer.from(bundle);
    altered[altered.length - 1] ^= 1;
    const oversized = encode(manifest, payload, ' '.repeat(65537));
    for (const bytes of [
      bundle.subarray(0, 15),
      bundle.subarray(0, -1),
      Buffer.concat([bundle, Buffer.from('x')]),
      magic,
      altered,
      oversized,
    ])
      expect(() => parse(comparison(bytes, []))).toThrow('result-bundle-invalid');
    for (const text of [
      JSON.stringify(manifest).replace('"size":3', '"size":3,"size":3'),
      JSON.stringify(manifest).replace('"size":3', '"size":3.0'),
      JSON.stringify(manifest).replace('"size":3', '"size":3e0'),
      ' ' + JSON.stringify(manifest),
      JSON.stringify(manifest).replace(
        '"schemaVersion":1',
        '"schemaVersion":1,"schema\\u0056ersion":1',
      ),
    ])
      expect(() => parse(comparison(encode(manifest, payload, text), []))).toThrow(
        'result-bundle-invalid',
      );
    const value = comparison(bundle, []);
    value.beforeSealedImportBase64 += '\n';
    expect(() => parse(value)).toThrow('result-bundle-invalid');
    const mixed = { ...comparison(bundle, []), before: { complete: true, files: [] } };
    expect(() => parse(mixed)).toThrow('result-bundle-invalid');
  });

  it('rejects uncovered/overlapping payload, duplicate/case-colliding and unsorted files', () => {
    for (const names of [
      ['a', 'a'],
      ['A', 'a'],
      ['b', 'a'],
    ]) {
      const { bundle } = synthetic(names.map((name) => [name, Buffer.from('x')]));
      expect(() => parse(comparison(bundle, []))).toThrow('result-bundle-invalid');
    }
    const { manifest, payload } = synthetic([
      ['a', Buffer.from('x')],
      ['b', Buffer.from('y')],
    ]);
    manifest.files[1].offset = 0;
    expect(() => parse(comparison(encode(manifest, payload), []))).toThrow('result-bundle-invalid');
    const gap = synthetic();
    expect(() =>
      parse(comparison(encode(gap.manifest, Buffer.concat([gap.payload, Buffer.from('z')])), [])),
    ).toThrow('result-bundle-invalid');
  });

  it('enforces decoded combined quota, union count, individual file and directory bounds', () => {
    const entries = Array.from({ length: 9 }, (_, i) => [`f${i}`, Buffer.alloc(65536)]);
    const { bundle } = synthetic(entries);
    const input = comparison(
      bundle,
      entries.map(([name, bytes]) => file(name, bytes)),
    );
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(2097152);
    expect(() => parse(input)).toThrow('result-bundle-invalid');
    const many = synthetic(
      Array.from({ length: 128 }, (_, i) => [`f${String(i).padStart(3, '0')}`, Buffer.alloc(0)]),
    );
    expect(() => parse(comparison(many.bundle, [file('extra', '')]))).toThrow(
      'result-bundle-invalid',
    );
    const large = synthetic([['large', Buffer.alloc(65537)]]);
    expect(() => parse(comparison(large.bundle, []))).toThrow('result-bundle-invalid');
    const directories = [
      '',
      ...Array.from({ length: 32 }, (_, i) => `d${String(i).padStart(2, '0')}`),
    ];
    expect(() => parse(comparison(synthetic([], directories).bundle, []))).toThrow(
      'result-bundle-invalid',
    );
  });
});

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'native ImportSeal baseline in production result review',
  () => {
    beforeAll(harness.setup, 40000);
    afterAll(harness.finish);
    it('retains actual native binary baseline through the existing selected-file owner', async () => {
      const fixture = harness.corpus('review');
      fs.mkdirSync(path.join(fixture.source, 'lib'));
      fs.mkdirSync(path.join(fixture.source, 'empty-dir'));
      const binary = Buffer.from([0, 255, 42, 10]);
      fs.writeFileSync(path.join(fixture.source, 'lib', 'binary.bin'), binary);
      fs.writeFileSync(path.join(fixture.source, 'empty.txt'), '');
      const result = harness.run(fixture);
      expect(result.status).toBe(0);
      const artifact = path.join(fixture.output, 'bundle.aegis');
      expect(inspectSealedImportBundle(artifact, fixture.source)).toMatchObject({ fileCount: 3 });
      const selected = path.join(fixture.root, 'comparison.json');
      const input = Buffer.from(
        JSON.stringify(
          comparison(fs.readFileSync(artifact), [
            file('readme.txt', 'changed'),
            file('lib/binary.bin', binary),
            file('added.txt', 'new'),
          ]),
        ),
      );
      fs.writeFileSync(selected, input);
      const session = {};
      const report = await handleResultReview({
        session,
        request: { action: 'review-result' },
        revision: 0,
        pick: async () => selected,
        assertOwned() {},
      });
      expect(report.result.comparison).toMatchObject({
        schemaVersion: 1,
        originalState: 'complete-imported-baseline-unverified',
        writerState: 'stop-unconfirmed',
        acceptance: 'unreviewed',
        launchAllowed: false,
        projectExportAllowed: false,
      });
      expect(report.result.comparison.changes.map((row) => [row.path, row.type])).toEqual([
        ['added.txt', 'addition'],
        ['empty.txt', 'deletion'],
        ['readme.txt', 'edit'],
      ]);
      const retained = session.resultRetained.review;
      input.fill(0);
      fs.writeFileSync(selected, '{}');
      fs.writeFileSync(artifact, 'replaced artifact');
      const baseline = copyResultReviewSnapshot(retained, 'before');
      expect(baseline.get('readme.txt')).toEqual(Buffer.from('DISPOSABLE_CLEAN_CORPUS\n'));
      expect(baseline.get('lib/binary.bin')).toEqual(binary);
      expect(baseline.get('empty.txt')).toEqual(Buffer.alloc(0));
      for (const [name, bytes] of baseline)
        expect(fs.readFileSync(path.join(fixture.source, name))).toEqual(bytes);
      baseline.get('readme.txt').fill(0);
      expect(copyResultReviewSnapshot(retained, 'before').get('readme.txt')).toEqual(
        Buffer.from('DISPOSABLE_CLEAN_CORPUS\n'),
      );
      expect(JSON.stringify(report)).not.toContain(fixture.root);
    });
  },
);
