'use strict';

const { scanStaticDirectory } = require('./static-analysis');
const { hashSnapshotValue } = require('./inventory-snapshot');
const {
  readSnapshotJson,
  resolveSnapshotSubject,
  checkSnapshotSubject,
} = require('./inventory-snapshot-files');
const { FORMATS, LIMITS, record, isHash, relativeReference } = require('./static-import-values');
const { normalizeExternalReport } = require('./static-import-normalize');

function compareBaseline(source, current) {
  const value = source.value;
  if (
    value.schemaVersion !== 1 ||
    value.mode !== 'static-analysis' ||
    typeof value.complete !== 'boolean' ||
    !isHash(value.subjectSha256) ||
    !record(value.adapter) ||
    !record(value.scope) ||
    !record(value.limits) ||
    !Array.isArray(value.files) ||
    value.files.length > LIMITS.entries
  )
    throw new Error('external-baseline-invalid');
  const files = new Map();
  for (const file of value.files) {
    if (
      !record(file) ||
      typeof file.path !== 'string' ||
      relativeReference(file.path) !== file.path ||
      !isHash(file.sha256) ||
      files.has(file.path)
    )
      throw new Error('external-baseline-invalid');
    files.set(file.path, { path: file.path, sha256: file.sha256 });
  }
  const contract = (report) => ({
    adapter: report.adapter,
    scope: report.scope,
    limits: report.limits,
  });
  const compatible =
    value.subjectSha256 === current.subjectSha256 &&
    hashSnapshotValue(contract(value)) === hashSnapshotValue(contract(current));
  const summary = {
    sha256: source.sha256,
    authenticity: 'unverified',
    status: compatible ? 'matching-observed-files' : 'incompatible',
    baselineComplete: value.complete,
    currentComplete: current.complete,
    filesMatched: 0,
    filesChanged: 0,
    filesUnobserved: 0,
    filesAdded: 0,
  };
  if (!compatible) return { files: null, summary };
  const observed = new Map(current.files.map((file) => [file.path, file.sha256]));
  for (const file of files.values()) {
    if (!observed.has(file.path)) summary.filesUnobserved++;
    else if (observed.get(file.path) !== file.sha256) summary.filesChanged++;
    else summary.filesMatched++;
  }
  for (const name of observed.keys()) if (!files.has(name)) summary.filesAdded++;
  if (summary.filesChanged || summary.filesUnobserved || summary.filesAdded)
    summary.status = 'changed';
  return { files, summary };
}

/**
 * Import one explicitly selected offline result alongside a fresh local review.
 * Existing files are read only; no report reference can select an additional read.
 * @param {{adapter:string, directory:string, format:string, reportFile:string, baselineFile?:string}} options Explicit inputs.
 * @returns {Promise<object>} Redacted claims and byte comparisons; never a safety decision.
 * @since v0.15.1
 */
async function importStaticReport(options) {
  if (!Object.hasOwn(FORMATS, options.format)) throw new Error('external-format-unsupported');
  const subject = await resolveSnapshotSubject(options.directory);
  const source = await readSnapshotJson(options.reportFile, subject);
  const prior = options.baselineFile ? await readSnapshotJson(options.baselineFile, subject) : null;
  const local = await scanStaticDirectory(options.adapter, subject.root);
  const baseline = prior ? compareBaseline(prior, local) : { files: null, summary: null };
  const normalized = normalizeExternalReport(options.format, source.value, {
    root: subject.root,
    files: new Map(local.files.map((file) => [file.path, file])),
    baseline: baseline.files,
  });
  if (baseline.summary?.status === 'incompatible')
    normalized.issues.push('external-baseline-incompatible');
  if (baseline.summary?.status === 'changed') normalized.issues.push('external-baseline-changed');
  if (!prior) normalized.issues.push('external-baseline-not-provided');
  normalized.issues.sort();
  if (normalized.issues.length > LIMITS.issues)
    normalized.issues = [...normalized.issues.slice(0, LIMITS.issues - 1), 'external-issue-limit'];
  await checkSnapshotSubject(subject);
  return {
    schemaVersion: 1,
    mode: 'static-analysis-import',
    assessment: 'local-patterns-and-external-claims',
    safety: 'not-determined',
    reviewRequired: true,
    complete: false,
    status: local.findings.length || normalized.findings.length ? 'findings' : 'incomplete',
    local,
    external: {
      contract: { id: options.format, version: 1 },
      source: {
        ...FORMATS[options.format],
        sha256: source.sha256,
        sourceSha256: source.sourceSha256,
        authenticity: 'unverified',
        execution: 'not-observed',
      },
      ...normalized,
      baseline: baseline.summary,
    },
  };
}

module.exports = { importStaticReport };
