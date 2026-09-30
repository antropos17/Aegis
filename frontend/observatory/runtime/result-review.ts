import { record } from './host';
import type {
  ImportedResultReview,
  ResultReviewChange,
  ResultReviewPreview,
} from '../../../src/shared/types';
export type { ImportedResultReview, ResultReviewChange } from '../../../src/shared/types';
/** Label imported change metadata without implying verified original files.
 * @param type Captured change type. @returns Visible label. @since 0.17.0 */
export function resultChangeLabel(type: string): string {
  return type === 'addition'
    ? 'Addition'
    : type === 'deletion'
      ? 'Deletion'
      : type === 'edit'
        ? 'Edit'
        : 'Unknown change';
}
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const size = (value: unknown): boolean =>
  value === null ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 65536);
const safePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 240 &&
  // eslint-disable-next-line no-control-regex -- Reject invisible filename controls.
  !/[\\\x00-\x1f\x7f-\x9f<>:"|?*]|\p{Cf}/u.test(value) &&
  value.split('/').every((part) => !!part && !['.', '..'].includes(part));

const preview = (value: unknown): ResultReviewPreview | null => {
  const row = record(value);
  if (
    !exact(row, ['state', 'text']) ||
    !['absent', 'incomplete', 'binary', 'text', 'truncated'].includes(String(row.state))
  )
    return null;
  if (row.state === 'text' || row.state === 'truncated') {
    if (
      typeof row.text !== 'string' ||
      new TextEncoder().encode(row.text).length > 2048 ||
      // eslint-disable-next-line no-control-regex -- Display text contains visible control labels only.
      /[\x00-\x08\x0b-\x1f\x7f-\x9f]|\p{Cf}/u.test(row.text)
    )
      return null;
  } else if (row.text !== null) return null;
  return { state: row.state as ResultReviewPreview['state'], text: row.text as string | null };
};

/** Narrow exact non-authorizing comparison metadata; imported approval flags and raw payload are refused.
 * @param value Structured host metadata. @returns Typed comparison or null. @since 0.17.0 */
export function importedResultReview(value: unknown): ImportedResultReview | null {
  const row = record(value),
    comparison = record(row.comparison);
  if (
    !exact(row, ['id', 'revision', 'createdAt', 'comparison']) ||
    typeof row.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(row.id) ||
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    typeof row.createdAt !== 'string' ||
    row.createdAt.length !== 24 ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    !exact(comparison, [
      'schemaVersion',
      'captureSource',
      'originalState',
      'retained',
      'writerState',
      'acceptance',
      'baselineDigest',
      'snapshotDigest',
      'bundleDigest',
      'complete',
      'changes',
      'launchAllowed',
      'projectExportAllowed',
    ]) ||
    comparison.schemaVersion !== 1 ||
    comparison.captureSource !== 'imported-artifact' ||
    comparison.retained !== true ||
    comparison.writerState !== 'stop-unconfirmed' ||
    comparison.acceptance !== 'unreviewed' ||
    comparison.launchAllowed !== false ||
    comparison.projectExportAllowed !== false ||
    typeof comparison.complete !== 'boolean' ||
    ![comparison.baselineDigest, comparison.snapshotDigest, comparison.bundleDigest].every(hash) ||
    comparison.originalState !==
      (comparison.complete ? 'complete-imported-baseline-unverified' : 'incomplete-unknown') ||
    !Array.isArray(comparison.changes) ||
    comparison.changes.length > 128
  )
    return null;
  const ids = new Set<string>();
  const changes: ResultReviewChange[] = [];
  let previewBytes = 0;
  for (const item of comparison.changes) {
    const change = record(item);
    if (
      !exact(change, [
        'id',
        'path',
        'type',
        'beforeSha256',
        'afterSha256',
        'beforeBytes',
        'afterBytes',
        'beforePreview',
        'afterPreview',
      ]) ||
      !hash(change.id) ||
      ids.has(change.id) ||
      !safePath(change.path) ||
      !['addition', 'edit', 'deletion', 'unknown'].includes(String(change.type)) ||
      (!comparison.complete && change.type !== 'unknown') ||
      ![change.beforeSha256, change.afterSha256].every(
        (digest) => digest === null || hash(digest),
      ) ||
      !size(change.beforeBytes) ||
      !size(change.afterBytes)
    )
      return null;
    const beforePreview = preview(change.beforePreview),
      afterPreview = preview(change.afterPreview);
    if (!beforePreview || !afterPreview) return null;
    previewBytes += new TextEncoder().encode(
      (beforePreview.text ?? '') + (afterPreview.text ?? ''),
    ).length;
    if (previewBytes > 32768) return null;
    ids.add(change.id);
    changes.push({
      id: change.id,
      path: change.path,
      type: change.type as ResultReviewChange['type'],
      beforeSha256: change.beforeSha256 as string | null,
      afterSha256: change.afterSha256 as string | null,
      beforeBytes: change.beforeBytes as number | null,
      afterBytes: change.afterBytes as number | null,
      beforePreview,
      afterPreview,
    });
  }
  return {
    id: row.id,
    revision: row.revision,
    createdAt: row.createdAt,
    comparison: {
      schemaVersion: 1,
      captureSource: 'imported-artifact',
      originalState: comparison.complete
        ? 'complete-imported-baseline-unverified'
        : 'incomplete-unknown',
      retained: true,
      writerState: 'stop-unconfirmed',
      acceptance: 'unreviewed',
      complete: comparison.complete,
      baselineDigest: comparison.baselineDigest as string,
      snapshotDigest: comparison.snapshotDigest as string,
      bundleDigest: comparison.bundleDigest as string,
      changes,
      launchAllowed: false,
      projectExportAllowed: false,
    },
  };
}

/** Fixed result errors; upstream paths, payload and parser exceptions are never displayed.
 * @param code Host error code. @returns User-facing explanation. @since 0.17.0 */
export function resultReviewError(code: unknown): string {
  if (code === 'result-review-expired')
    return 'This retained comparison expired. Choose the result again.';
  if (code === 'review-busy') return 'A local review is already running. Wait for it to finish.';
  if (code === 'result-bundle-invalid' || code === 'result-bundle-unavailable')
    return 'The selected result is unavailable or does not match the bounded comparison format.';
  return 'The result comparison could not complete. Previous results are retained.';
}
