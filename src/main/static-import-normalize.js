'use strict';

const semver = require('semver');
const {
  FORMATS,
  LIMITS,
  record,
  digest,
  relativeReference,
  severity,
  category,
  analyzer,
  bounded,
} = require('./static-import-values');
const { importSkillJson } = require('./static-import-skill');
const { importSkillSarif } = require('./static-import-sarif');
const { importMcpJson } = require('./static-import-mcp');

/**
 * Normalize untrusted report fields against an already-read file map. No disk or network access.
 * @param {string} format Explicit provider format; never auto-detected.
 * @param {object} value Internal parsed report.
 * @param {{root: string, files: Map, baseline: Map|null}} context Locally observed paths and optional prior hashes.
 * @returns {object} Bounded, redacted external claims and coverage issues.
 * @since v0.15.1
 */
function normalizeExternalReport(format, value, context) {
  if (!Object.hasOwn(FORMATS, format)) throw new Error('external-format-unsupported');
  if (!record(value)) throw new Error('external-report-unsupported-shape');
  const findings = [];
  const issues = new Set();
  const analyzers = new Set();
  const versions = new Map();
  let locationMapping = true;
  const issue = (reason) => {
    if (issues.size < LIMITS.issues - 1) issues.add(reason);
    else issues.add('external-issue-limit');
  };
  function locate(input) {
    const raw = record(input) ? input : {};
    const name = relativeReference(raw.path, raw.uri === true);
    const file = locationMapping && name ? context.files.get(name) : null;
    let line = raw.line ?? null;
    if (line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 10000000)) {
      line = null;
      issue('external-line-invalid');
    }
    if (!file) issue('external-location-unbound');
    const before = file && context.baseline?.get(file.path);
    return {
      path: file?.path ?? null,
      currentSha256: file?.sha256 ?? null,
      baselineSha256: before?.sha256 ?? null,
      referenceSha256: typeof raw.path === 'string' ? digest(raw.path) : null,
      reportedLine: line,
      binding: !file
        ? 'unbound'
        : !context.baseline
          ? 'current-path-only'
          : !before
            ? 'not-in-baseline'
            : before.sha256 === file.sha256
              ? 'matched-baseline-file'
              : 'changed-since-baseline',
    };
  }
  const collector = {
    issue,
    root(reported) {
      // Compare declarations only. Never realpath/stat a path supplied by a report.
      const normalized = (name) => name.replaceAll('\\', '/').replace(/\/$/, '');
      if (normalized(reported) !== normalized(context.root)) {
        locationMapping = false;
        issue('external-reported-root-mismatch');
      }
    },
    analyzer(value) {
      const name = analyzer(value);
      if (name === 'unknown') issue('external-analyzer-unknown');
      analyzers.add(name);
    },
    version(value) {
      const parsed = typeof value === 'string' && value.length <= 256 ? semver.parse(value) : null;
      if (!parsed) {
        issue('external-producer-version-unknown');
        return;
      }
      const hash = digest(value);
      if (versions.size < LIMITS.runs)
        versions.set(hash, {
          core: `${parsed.major}.${parsed.minor}.${parsed.patch}`,
          sha256: hash,
        });
    },
    finding(raw) {
      if (findings.length >= LIMITS.findings) {
        issue('external-finding-limit');
        return;
      }
      const level = severity(raw.severity);
      const group = raw.kind === 'aggregate' ? 'aggregate' : category(raw.category);
      const engine = analyzer(raw.analyzer);
      if (level === 'unknown') issue('external-severity-unknown');
      if (group === 'unknown') issue('external-category-unknown');
      if (engine === 'unknown') issue('external-analyzer-unknown');
      const rule = typeof raw.rule === 'string' && raw.rule.length ? digest(raw.rule) : null;
      if (!rule) issue('external-rule-unresolved');
      const locations = bounded(raw.locations ?? [], LIMITS.locations, collector).map(locate);
      const categories =
        raw.kind === 'aggregate'
          ? [
              ...new Set(
                raw.categories.map((value) => {
                  const name = category(
                    typeof value === 'string' ? value.toLowerCase().replaceAll(' ', '_') : null,
                  );
                  if (name === 'unknown') issue('external-category-unknown');
                  return name;
                }),
              ),
            ].sort()
          : [];
      if (!locations.length && raw.kind !== 'aggregate') issue('external-location-not-reported');
      findings.push({
        sourceIndex: findings.length,
        origin: { recordIndex: raw.recordIndex, runIndex: raw.runIndex ?? null },
        kind: raw.kind === 'aggregate' ? 'aggregate' : 'finding',
        title:
          raw.kind === 'aggregate'
            ? 'External analyzer reported an aggregate requiring review'
            : 'External analyzer reported a finding requiring review',
        confidence: 'external-unverified',
        severity: level,
        category: group,
        analyzer: engine,
        analyzerIdSha256: typeof raw.analyzer === 'string' ? digest(raw.analyzer) : null,
        ruleIdSha256: rule,
        locations,
        ...(raw.kind === 'aggregate'
          ? {
              reportedCount: raw.reportedCount,
              itemType: raw.itemType,
              itemIdSha256: raw.itemIdSha256,
              categories,
            }
          : {}),
      });
    },
  };
  if (format === 'cisco-skill-json') {
    if (typeof value.skill_path === 'string') collector.root(value.skill_path);
    importSkillJson(value, collector);
  } else if (format === 'cisco-skill-sarif') importSkillSarif(value, collector);
  else importMcpJson(value, collector);
  return {
    findings,
    issues: [...issues].sort(),
    analyzersClaimed: [...analyzers].sort(),
    producerVersionsClaimed: [...versions.values()],
    coverage: 'not-verified',
    locationMapping: locationMapping ? 'caller-selected-root' : 'disabled-root-mismatch',
    limits: { ...LIMITS },
  };
}

module.exports = { normalizeExternalReport };
