'use strict';

const { record, bounded, LIMITS } = require('./static-import-values');

/**
 * Project a single Cisco Skill Scanner JSON result into an internal collector.
 * Upstream descriptions, snippets, names and arbitrary metadata never leave it.
 * @param {object} value Untrusted parsed JSON.
 * @param {object} collector Bounded normalization sink.
 * @returns {void}
 * @since v0.15.1
 */
function importSkillJson(value, collector) {
  if (
    !Array.isArray(value.findings) ||
    typeof value.skill_path !== 'string' ||
    !Array.isArray(value.analyzers_used)
  )
    throw new Error('external-report-unsupported-shape');
  if (value.findings_count !== value.findings.length) collector.issue('reported-count-mismatch');
  const analyzers = bounded(value.analyzers_used, LIMITS.analyzers, collector);
  if (!analyzers.length) collector.issue('analyzers-not-reported');
  analyzers.forEach((name) => collector.analyzer(name));
  if (Object.hasOwn(value, 'analyzers_failed')) {
    if (!Array.isArray(value.analyzers_failed)) collector.issue('invalid-analyzer-status');
    else if (value.analyzers_failed.length) collector.issue('external-analyzer-failed');
  }
  if (Object.hasOwn(value, 'cross_skill_findings'))
    collector.issue('cross-skill-results-not-imported');
  for (const [recordIndex, finding] of bounded(
    value.findings,
    LIMITS.entries,
    collector,
  ).entries()) {
    if (!record(finding)) {
      collector.finding({ recordIndex });
      continue;
    }
    collector.finding({
      recordIndex,
      rule: finding.rule_id,
      severity: finding.severity,
      category: finding.category,
      analyzer: finding.analyzer,
      locations:
        finding.file_path == null ? [] : [{ path: finding.file_path, line: finding.line_number }],
    });
  }
  // There is no per-file digest or authenticated execution receipt in this format.
  collector.issue('external-execution-coverage-unverified');
}

module.exports = { importSkillJson };
