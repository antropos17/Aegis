'use strict';

const { record, bounded, LIMITS } = require('./static-import-values');
const LEVELS = { error: 'HIGH', warning: 'MEDIUM', note: 'LOW', none: 'INFO' };

function location(value, collector, bases) {
  const physical = value?.physicalLocation;
  const artifact = physical?.artifactLocation;
  if (!record(artifact) || typeof artifact.uri !== 'string') {
    collector.issue('external-location-unresolved');
    return { path: null };
  }
  if (bases || artifact.uriBaseId || Object.hasOwn(artifact, 'index')) {
    collector.issue('external-location-base-unresolved');
    return { path: null };
  }
  return { path: artifact.uri, line: physical.region?.startLine, uri: true };
}

/**
 * Import cfgaudit's one-run SARIF subset as unverified configuration findings.
 * @param {object} value Parsed, caller-selected report.
 * @param {object} collector Bounded redacting projection.
 * @returns {void}
 * @since v0.16.0-alpha
 */
function importCfgauditSarif(value, collector) {
  if (value.version !== '2.1.0' || !Array.isArray(value.runs) || value.runs.length !== 1)
    throw new Error('external-report-unsupported-shape');
  const run = value.runs[0];
  if (
    !record(run) ||
    run.tool?.driver?.name !== 'cfgaudit' ||
    !Array.isArray(run.tool.driver.rules) ||
    !Array.isArray(run.results)
  )
    throw new Error('external-report-unsupported-shape');
  collector.version(run.tool.driver.version);
  collector.issue('external-reported-root-not-reported');
  collector.issue('external-execution-status-not-reported');
  collector.issue('external-execution-coverage-unverified');
  if (run.originalUriBaseIds) collector.issue('external-location-base-unresolved');
  if (Object.hasOwn(value, 'inlineExternalProperties') || run.externalPropertyFileReferences)
    collector.issue('external-properties-not-imported');
  if (run.tool.extensions) collector.issue('external-properties-not-imported');
  const rules = new Set();
  for (const rule of bounded(run.tool.driver.rules, LIMITS.entries, collector)) {
    if (
      !record(rule) ||
      typeof rule.id !== 'string' ||
      !/^CFG\d{3,}$/.test(rule.id) ||
      rules.has(rule.id)
    ) {
      collector.issue('external-rule-unresolved');
      continue;
    }
    rules.add(rule.id);
  }
  for (const [recordIndex, result] of bounded(run.results, LIMITS.entries, collector).entries()) {
    if (!record(result)) {
      collector.finding({ runIndex: 0, recordIndex });
      continue;
    }
    const knownRule = rules.has(result.ruleId);
    if (!knownRule || result.ruleIndex !== undefined || result.rule)
      collector.issue('external-rule-unresolved');
    if (result.suppressions?.length) collector.issue('external-result-suppressed');
    if (result.baselineState === 'absent') collector.issue('external-baseline-only-result');
    if (result.kind && result.kind !== 'fail') collector.issue('external-result-kind-not-failure');
    if (result.codeFlows || result.stacks || result.graphs)
      collector.issue('external-flow-details-not-imported');
    if (result.relatedLocations) collector.issue('external-related-locations-not-imported');
    collector.finding({
      runIndex: 0,
      recordIndex,
      rule: result.ruleId,
      severity: Object.hasOwn(LEVELS, result.level) ? LEVELS[result.level] : null,
      category: knownRule ? 'policy_violation' : null,
      analyzer: 'static',
      locations: bounded(result.locations ?? [], LIMITS.locations, collector).map((entry) =>
        location(entry, collector, run.originalUriBaseIds),
      ),
    });
  }
}

module.exports = { importCfgauditSarif };
