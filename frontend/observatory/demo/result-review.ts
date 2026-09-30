import type { ImportedResultReview, ResultReviewChange } from '../../../src/shared/types';

/** Explicit harmless UI fixtures; no files are selected or read in the preview.
 * @returns Comparison example. @since 0.17.0 */
export function previewResultReview(): ImportedResultReview {
  const hash = 'a'.repeat(64);
  const changes: ResultReviewChange[] = [
    {
      id: '1'.repeat(64),
      path: 'README.md',
      type: 'edit',
      beforeBytes: 17,
      afterBytes: 40,
      beforeSha256: hash,
      afterSha256: hash,
      beforePreview: { state: 'text', text: 'Existing example\n' },
      afterPreview: { state: 'text', text: '<script>example</script>\n[U+001B] [U+202E]' },
    },
    {
      id: '2'.repeat(64),
      path: 'obsolete.txt',
      type: 'deletion',
      beforeBytes: 8,
      afterBytes: null,
      beforeSha256: hash,
      afterSha256: null,
      beforePreview: { state: 'text', text: 'Old text' },
      afterPreview: { state: 'absent', text: null },
    },
    {
      id: '3'.repeat(64),
      path: 'new.txt',
      type: 'addition',
      beforeBytes: null,
      afterBytes: 8,
      beforeSha256: null,
      afterSha256: hash,
      beforePreview: { state: 'absent', text: null },
      afterPreview: { state: 'text', text: 'New text' },
    },
    {
      id: '4'.repeat(64),
      path: 'asset.bin',
      type: 'addition',
      beforeBytes: null,
      afterBytes: 2,
      beforeSha256: null,
      afterSha256: hash,
      beforePreview: { state: 'absent', text: null },
      afterPreview: { state: 'binary', text: null },
    },
    {
      id: '5'.repeat(64),
      path: 'long.txt',
      type: 'addition',
      beforeBytes: null,
      afterBytes: 8192,
      beforeSha256: null,
      afterSha256: hash,
      beforePreview: { state: 'absent', text: null },
      afterPreview: { state: 'truncated', text: 'Bounded example…' },
    },
  ];
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    revision: 0,
    createdAt: '2026-09-30T00:00:00.000Z',
    comparison: {
      schemaVersion: 1,
      captureSource: 'imported-artifact',
      originalState: 'complete-imported-baseline-unverified',
      retained: true,
      writerState: 'stop-unconfirmed',
      acceptance: 'unreviewed',
      complete: true,
      baselineDigest: hash,
      snapshotDigest: hash,
      bundleDigest: hash,
      changes,
      launchAllowed: false,
      projectExportAllowed: false,
    },
  };
}
