const keys = [
  'schemaVersion',
  'profile',
  'directoryStreamProfile',
  'sealed',
  'code',
  'developerOnly',
  'launchAllowed',
  'vmEffectsRun',
  'guestImportQualified',
  'nativeContainmentQualified',
  'productionCaller',
  'fileCount',
  'totalBytes',
  'manifestSha256',
  'bundleSha256',
  'bundleBytes',
  'cleanup',
].sort();
const codes = new Set([
  'sealed',
  'fixture-options-invalid',
  'fixture-hardlink-failed',
  'fixture-retention-control-failed',
  'import-unavailable',
  'import-open-failed',
  'import-metadata-unavailable',
  'import-reparse',
  'import-type-unsupported',
  'import-type-changed',
  'import-delete-pending',
  'import-hardlink',
  'import-file-id-unavailable',
  'import-stream-query-failed',
  'import-stream-buffer-invalid',
  'import-stream',
  'import-enumeration-budget',
  'import-enumeration-unavailable',
  'import-directory-buffer-invalid',
  'import-entry-budget',
  'import-case-duplicate',
  'import-path-invalid',
  'import-ancestor-budget',
  'import-component-budget',
  'import-filesystem-unsupported',
  'import-time-budget',
  'import-excluded',
  'import-relative-path-budget',
  'import-depth-budget',
  'import-directory-budget',
  'import-file-budget',
  'import-file-size-budget',
  'import-byte-budget',
  'import-identity-changed',
  'import-size-changed',
  'import-duplicate-identity',
  'import-short-read',
  'import-directory-changed',
  'import-staged-content-changed',
  'import-manifest-budget',
  'import-content-changed',
  'import-output-overlap',
  'import-output-exists',
  'import-flush-failed',
  'import-staged-identity-changed',
  'import-publication-failed',
  'import-publication-identity-changed',
  'import-cleanup-identity-changed',
  'import-staged-size-changed',
  'import-staged-short-read',
  'import-staged-header-changed',
  'import-staged-manifest-changed',
  'import-publication-pending',
  'import-native-layout-unavailable',
]);
const cleanups = new Set([
  'not-created',
  'directory-retained',
  'stage-removed',
  'stage-retained-uncertain',
  'published-retained',
]);
const fail = () => {
  throw new Error('sealed-import-report-invalid');
};

/**
 * Validate the exact redacted native protocol, retaining all fail-closed scope flags.
 * @param {string} text Bounded stdout from the fixed native fixture.
 * @returns {object} Validated native result, never an authorization.
 * @since v0.17.0
 */
export function validateSealedImportReport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 65536) fail();
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    fail();
  }
  if (
    !report ||
    Array.isArray(report) ||
    Object.keys(report).sort().join() !== keys.join() ||
    report.schemaVersion !== 1 ||
    report.profile !== 'windows-x64-ntfs-dummy-v1' ||
    typeof report.sealed !== 'boolean' ||
    report.developerOnly !== true ||
    ![
      'unobserved',
      'directory-handle-eof',
      'directory-empty-record',
      'directory-unnamed-stream',
    ].includes(report.directoryStreamProfile) ||
    !codes.has(report.code) ||
    !cleanups.has(report.cleanup)
  )
    fail();
  for (const key of [
    'launchAllowed',
    'vmEffectsRun',
    'guestImportQualified',
    'nativeContainmentQualified',
    'productionCaller',
  ])
    if (report[key] !== false) fail();
  for (const [key, limit] of [
    ['fileCount', 128],
    ['totalBytes', 1048576],
    ['bundleBytes', 16 + 65536 + 1048576],
  ]) {
    if (!Number.isSafeInteger(report[key]) || report[key] < 0 || report[key] > limit) fail();
  }
  if (report.sealed) {
    if (
      report.code !== 'sealed' ||
      report.cleanup !== 'published-retained' ||
      report.bundleBytes < 16 + report.totalBytes
    )
      fail();
    for (const key of ['manifestSha256', 'bundleSha256'])
      if (!/^[a-f0-9]{64}$/.test(report[key])) fail();
  } else if (
    report.code === 'sealed' ||
    report.fileCount !== 0 ||
    report.totalBytes !== 0 ||
    report.bundleBytes !== 0 ||
    report.manifestSha256 !== null ||
    report.bundleSha256 !== null ||
    report.cleanup === 'published-retained'
  )
    fail();
  return report;
}
