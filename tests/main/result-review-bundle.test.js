import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  parseResultReviewBundle,
  describeResultReviewBundle,
} = require('../../src/main/result-review-bundle');
const file = (path, content = 'x') => ({
  path,
  kind: 'file',
  contentBase64: Buffer.from(content).toString('base64'),
});
const body = (before = [], after = [], complete = true) => ({
  schemaVersion: 1,
  captureSource: 'external-result',
  before: { complete, files: before },
  after: { complete, files: after },
  claims: { accepted: false, stopped: false, boundaryPassed: false },
});
const parse = (value) => parseResultReviewBundle(Buffer.from(JSON.stringify(value)));

it('does not turn dishonest imported stop or boundary claims into protection', () => {
  const body = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      captureSource: 'external-result',
      before: { complete: true, files: [] },
      after: { complete: true, files: [] },
      claims: { accepted: true, stopped: true, boundaryPassed: true },
    }),
  );
  expect(parseResultReviewBundle(body)).toMatchObject({
    writerState: 'stop-unconfirmed',
    launchAllowed: false,
  });
});

it('derives deterministic complete additions edits and deletions but no deletion from incomplete input', () => {
  const prior = [file('z.txt'), file('edit.txt', 'old'), file('gone.txt')];
  const next = [file('added.txt'), file('edit.txt', 'new'), file('z.txt')];
  const review = parse(body(prior, next));
  expect(review.changes.map((change) => [change.path, change.type])).toEqual([
    ['added.txt', 'addition'],
    ['edit.txt', 'edit'],
    ['gone.txt', 'deletion'],
  ]);
  const reordered = parse(body([...prior].reverse(), [...next].reverse()));
  expect(reordered.baselineDigest).toBe(review.baselineDigest);
  expect(reordered.snapshotDigest).toBe(review.snapshotDigest);
  const incomplete = parse(body(prior, next, false));
  expect(incomplete.changes.every((change) => change.type === 'unknown')).toBe(true);
  expect(incomplete.originalState).toBe('incomplete-unknown');
});

it.each([
  '/root/a',
  '\\\\host\\share',
  'C:/file',
  '../a',
  'a/../b',
  'a//b',
  'a:stream',
  'con.txt',
  'COM¹.log',
  'a.',
  'a ',
  'a/./b',
  'a\u001b[31m',
  '<img>.txt',
  Array(9).fill('a').join('/'),
])('rejects unsafe relative path %s', (name) => {
  expect(() => parse(body([], [file(name)]))).toThrow('result-bundle-invalid');
});

it('rejects links, duplicate decoded keys, case collisions, file ancestors and malformed bytes', () => {
  expect(() => parse(body([], [{ ...file('a'), kind: 'link' }]))).toThrow();
  expect(() => parse(body([file('a'), file('A')], []))).toThrow();
  expect(() => parse(body([file('a')], [file('A')]))).toThrow();
  expect(() => parse(body([], [file('a'), file('a/b')]))).toThrow();
  const value = JSON.stringify(body());
  expect(() =>
    parseResultReviewBundle(
      Buffer.from(value.replace('"schemaVersion":1', '"schemaVersion":2,"schemaVersion":1')),
    ),
  ).toThrow();
  expect(() => parseResultReviewBundle(Buffer.from([0xff]))).toThrow();
  expect(() => parse(body([], [{ ...file('a'), contentBase64: 'eA' }]))).toThrow();
});

it('enforces entry, population and total copied payload bounds', () => {
  expect(() => parse(body([], [file('huge', Buffer.alloc(65537))]))).toThrow();
  expect(() =>
    parse(
      body(
        [],
        Array.from({ length: 129 }, (_, i) => file(String(i))),
      ),
    ),
  ).toThrow();
  expect(() =>
    parse(
      body(
        [],
        Array.from({ length: 17 }, (_, i) => file(String(i), Buffer.alloc(65536))),
      ),
    ),
  ).toThrow();
});

it.each(['report\u202egpj.exe', 'report\u2066text.txt', 'report\u200f.txt'])(
  'refuses filename directional spoofing %s',
  (name) => {
    expect(() => parse(body([], [file(name)]))).toThrow('result-bundle-invalid');
  },
);

it('copies bounded previews, exposes full hashes/counts and visibly neutralizes terminal and bidi content', () => {
  const raw = Buffer.from(
    JSON.stringify(
      body(
        [],
        [
          file('text.txt', '<img src=x>\u001b[31m\u202e'),
          file('binary.bin', Buffer.from([0, 255])),
          file('long.txt', 'a'.repeat(4096)),
        ],
      ),
    ),
  );
  const review = parseResultReviewBundle(raw);
  raw.fill(0);
  const metadata = describeResultReviewBundle(review);
  const text = metadata.changes.find((change) => change.path === 'text.txt');
  expect(text.afterPreview).toEqual({ state: 'text', text: '<img src=x>[U+001B][31m[U+202E]' });
  expect(text.beforePreview.state).toBe('absent');
  expect(metadata.changes.find((change) => change.path === 'binary.bin').afterPreview.state).toBe(
    'binary',
  );
  const long = metadata.changes.find((change) => change.path === 'long.txt');
  expect(long.afterBytes).toBe(4096);
  expect(long.afterPreview.state).toBe('truncated');
  expect(Buffer.byteLength(long.afterPreview.text)).toBe(2048);
  expect(parse(body([], [file('new.txt')], false)).complete).toBe(false);
  expect(
    describeResultReviewBundle(parse(body([], [file('new.txt')], false))).changes[0].beforePreview
      .state,
  ).toBe('incomplete');
});

it('caps total preview text without losing any retained change metadata', () => {
  const review = parse(
    body(
      [],
      Array.from({ length: 32 }, (_, i) => file(`f${i}.txt`, 'x'.repeat(2048))),
    ),
  );
  const metadata = describeResultReviewBundle(review);
  expect(metadata.changes).toHaveLength(32);
  expect(
    metadata.changes.reduce((bytes, row) => bytes + Buffer.byteLength(row.afterPreview.text), 0),
  ).toBe(32768);
  expect(metadata.changes.some((row) => row.afterPreview.state === 'truncated')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(262144);
});
