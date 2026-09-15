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
  if (
    (artifact.uriBaseId && artifact.uriBaseId !== '%SRCROOT%') ||
    bases ||
    Object.hasOwn(artifact, 'index')
  ) {
    collector.issue('external-location-base-unresolved');
    return { path: null };
  }
  return { path: artifact.uri, line: physical.region?.startLine, uri: true };
}

/** Import the bounded Cisco SARIF subset without dereferencing resources or applying suppressions. @param {object} value @param {object} collector @returns {void} @since v0.15.1 */
function importSkillSarif(value, collector) {
  if (value.version !== '2.1.0' || !Array.isArray(value.runs) || !value.runs.length)
    throw new Error('external-report-unsupported-shape');
  if (Object.hasOwn(value, 'inlineExternalProperties'))
    collector.issue('external-properties-not-imported');
  for (const [runIndex, run] of bounded(value.runs, LIMITS.runs, collector).entries()) {
    if (!record(run) || run.tool?.driver?.name !== 'skill-scanner' || !Array.isArray(run.results))
      throw new Error('external-report-unsupported-shape');
    collector.version(run.tool.driver.version);
    if (run.externalPropertyFileReferences || run.tool.extensions)
      collector.issue('external-properties-not-imported');
    const rules = new Map();
    for (const rule of bounded(run.tool.driver.rules ?? [], LIMITS.entries, collector)) {
      if (!record(rule) || typeof rule.id !== 'string' || rules.has(rule.id)) {
        collector.issue('external-rule-unresolved');
        continue;
      }
      rules.set(rule.id, rule);
    }
    const invocations = bounded(run.invocations ?? [], LIMITS.runs, collector);
    if (!invocations.length) collector.issue('external-execution-status-not-reported');
    for (const invocation of invocations) {
      if (!record(invocation) || invocation.executionSuccessful !== true)
        collector.issue('external-execution-incomplete');
      if (
        invocation?.toolExecutionNotifications?.length ||
        invocation?.toolConfigurationNotifications?.length
      )
        collector.issue('external-tool-notifications');
    }
    for (const [recordIndex, result] of bounded(run.results, LIMITS.entries, collector).entries()) {
      if (!record(result)) {
        collector.finding({ runIndex, recordIndex });
        continue;
      }
      const rule = rules.get(result.ruleId);
      if (result.ruleIndex !== undefined || result.rule)
        collector.issue('external-rule-reference-not-resolved');
      if (result.suppressions?.length) collector.issue('external-result-suppressed');
      if (result.baselineState === 'absent') collector.issue('external-baseline-only-result');
      if (result.kind && result.kind !== 'fail')
        collector.issue('external-result-kind-not-failure');
      if (result.codeFlows || result.stacks || result.graphs)
        collector.issue('external-flow-details-not-imported');
      if (result.relatedLocations) collector.issue('external-related-locations-not-imported');
      collector.finding({
        runIndex,
        recordIndex,
        rule: result.ruleId,
        severity: result.properties?.severity ?? rule?.properties?.severity ?? LEVELS[result.level],
        category: result.properties?.category ?? rule?.properties?.category,
        analyzer: null,
        locations: bounded(result.locations ?? [], LIMITS.locations, collector).map((entry) =>
          location(entry, collector, run.originalUriBaseIds),
        ),
      });
    }
  }
  collector.issue('analyzers-not-reported');
  collector.issue('external-execution-coverage-unverified');
}

module.exports = { importSkillSarif };
