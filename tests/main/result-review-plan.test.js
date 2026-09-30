import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  parseResultReviewBundle,
  copyResultReviewSnapshot,
} = require('../../src/main/result-review-bundle');
const {
  resultReviewSelectionDigest,
  createResultReviewPlan,
  prepareResultReviewPublication,
} = require('../../src/main/result-review-plan');
const owner = { reviewId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', revision: 4 };
const file = (path, content) => ({
  path,
  kind: 'file',
  contentBase64: Buffer.from(content).toString('base64'),
});
function fixture() {
  const raw = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      captureSource: 'external-result',
      before: {
        complete: true,
        files: [file('edit.txt', 'old'), file('keep.txt', 'keep'), file('delete.txt', 'remove')],
      },
      after: {
        complete: true,
        files: [file('edit.txt', 'new'), file('keep.txt', 'keep'), file('add.txt', 'added')],
      },
      claims: { accepted: true, stopped: true, boundaryPassed: true },
    }),
  );
  return { raw, review: parseResultReviewBundle(raw) };
}
function selection(review, ids = review.changes.map((change) => change.id), ack = true) {
  return {
    ids,
    acknowledgeDeletion: ack,
    baselineDigest: review.baselineDigest,
    snapshotDigest: review.snapshotDigest,
    selectionDigest: resultReviewSelectionDigest(ids, ack),
  };
}

it('publishes only exact selected copied bytes and never applies omitted changes or claims', () => {
  const { raw, review } = fixture();
  const edit = review.changes.find((change) => change.path === 'edit.txt');
  const plan = createResultReviewPlan(review, owner, selection(review, [edit.id], false));
  raw.fill(0);
  const swapped = copyResultReviewSnapshot(review, 'after');
  swapped.get('edit.txt').fill(0);
  const result = JSON.parse(
    prepareResultReviewPublication(plan, {
      ...owner,
      originals: copyResultReviewSnapshot(review, 'before'),
    }),
  );
  expect(result.changes).toHaveLength(1);
  expect(Buffer.from(result.changes[0].contentBase64, 'base64').toString()).toBe('new');
  expect(result).toMatchObject({
    writerState: 'stop-unconfirmed',
    launchAllowed: false,
    projectExportAllowed: false,
  });
  expect(result.changes[0].path).toBe('edit.txt');
  expect(JSON.stringify(result)).not.toContain('added');
  expect(() =>
    prepareResultReviewPublication(plan, {
      ...owner,
      originals: copyResultReviewSnapshot(review, 'before'),
    }),
  ).toThrow('result-plan-expired');
});

it('requires exact change IDs, displayed digests and explicit deletion acknowledgment', () => {
  const { review } = fixture();
  const deletion = review.changes.find((change) => change.type === 'deletion');
  expect(() =>
    createResultReviewPlan(review, owner, selection(review, [deletion.id], false)),
  ).toThrow('result-selection-invalid');
  const plan = createResultReviewPlan(review, owner, selection(review, [deletion.id], true));
  const result = JSON.parse(
    prepareResultReviewPublication(plan, {
      ...owner,
      originals: copyResultReviewSnapshot(review, 'before'),
    }),
  );
  expect(result.changes[0]).toMatchObject({ type: 'deletion', contentBase64: null });
  for (const key of ['baselineDigest', 'snapshotDigest', 'selectionDigest'])
    expect(() =>
      createResultReviewPlan(review, owner, { ...selection(review), [key]: '0'.repeat(64) }),
    ).toThrow('result-selection-stale');
  expect(() => createResultReviewPlan(review, owner, selection(review, ['0'.repeat(64)]))).toThrow(
    'result-selection-invalid',
  );
  expect(() =>
    createResultReviewPlan(review, owner, selection(review, [deletion.id, deletion.id])),
  ).toThrow('result-selection-invalid');
});

it('refuses changed original bytes or population immediately before publication', () => {
  const { review } = fixture();
  for (const alter of [
    (files) => files.get('edit.txt').fill(0),
    (files) => files.delete('keep.txt'),
    (files) => files.set('other.txt', Buffer.from('new')),
  ]) {
    const plan = createResultReviewPlan(review, owner, selection(review));
    const originals = copyResultReviewSnapshot(review, 'before');
    alter(originals);
    expect(() => prepareResultReviewPublication(plan, { ...owner, originals })).toThrow(
      'result-original-conflict',
    );
  }
});

it('consumes an attempted plan on original conflict, so restoring bytes requires fresh acceptance', () => {
  const { review } = fixture();
  const plan = createResultReviewPlan(review, owner, selection(review));
  const changed = copyResultReviewSnapshot(review, 'before');
  changed.get('edit.txt').fill(0);
  expect(() => prepareResultReviewPublication(plan, { ...owner, originals: changed })).toThrow(
    'result-original-conflict',
  );
  expect(() =>
    prepareResultReviewPublication(plan, {
      ...owner,
      originals: copyResultReviewSnapshot(review, 'before'),
    }),
  ).toThrow('result-plan-expired');
});

it('refuses stale revision, another review, serialized plans and forged review buffers', () => {
  const { review } = fixture();
  for (const current of [
    { ...owner, revision: 5 },
    { ...owner, reviewId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
  ]) {
    const plan = createResultReviewPlan(review, owner, selection(review));
    expect(() =>
      prepareResultReviewPublication(plan, {
        ...current,
        originals: copyResultReviewSnapshot(review, 'before'),
      }),
    ).toThrow('result-selection-stale');
  }
  const plan = createResultReviewPlan(review, owner, selection(review));
  expect(() =>
    prepareResultReviewPublication(JSON.parse(JSON.stringify(plan)), {
      ...owner,
      originals: copyResultReviewSnapshot(review, 'before'),
    }),
  ).toThrow('result-plan-expired');
  expect(() =>
    createResultReviewPlan(JSON.parse(JSON.stringify(review)), owner, selection(review)),
  ).toThrow('result-review-expired');
});
