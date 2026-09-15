'use strict';

const { record, digest, bounded, LIMITS } = require('./static-import-values');

/** Import MCP Scanner's raw envelope as aggregates, never as individual source findings. @param {object} value @param {object} collector @returns {void} @since v0.15.1 */
function importMcpJson(value, collector) {
  if (
    !Array.isArray(value.scan_results) ||
    !Array.isArray(value.requested_analyzers) ||
    typeof value.server_url !== 'string'
  )
    throw new Error('external-report-unsupported-shape');
  const requested = bounded(value.requested_analyzers, LIMITS.analyzers, collector);
  if (!requested.length) collector.issue('analyzers-not-reported');
  requested.forEach((name) => collector.analyzer(name));
  if (!value.scan_results.length) collector.issue('external-items-not-reported');
  for (const [recordIndex, item] of bounded(
    value.scan_results,
    LIMITS.entries,
    collector,
  ).entries()) {
    if (!record(item) || !record(item.findings)) {
      collector.issue('invalid-mcp-result');
      continue;
    }
    if (item.status !== 'completed') collector.issue('external-execution-incomplete');
    const type = ['tool', 'prompt', 'resource'].includes(item.item_type)
      ? item.item_type
      : 'unknown';
    if (type === 'unknown') collector.issue('external-item-type-unknown');
    const name = type === 'resource' ? item.resource_uri : item[`${type}_name`];
    const itemId = typeof name === 'string' ? digest(JSON.stringify([type, name])) : null;
    if (!itemId) collector.issue('external-item-identity-not-reported');
    for (const requestedName of requested) {
      if (
        typeof requestedName !== 'string' ||
        !Object.hasOwn(item.findings, `${requestedName}_analyzer`)
      )
        collector.issue('requested-analyzer-result-missing');
    }
    if (item.meta_analysis) collector.issue('external-meta-filtering-reported');
    const entries = Object.entries(item.findings);
    if (entries.length > LIMITS.analyzers) collector.issue('report-entry-limit');
    for (const [engine, result] of entries.slice(0, LIMITS.analyzers)) {
      collector.analyzer(engine);
      if (!record(result)) {
        collector.issue('invalid-mcp-analyzer-result');
        continue;
      }
      const count = result.total_findings;
      const validCount = Number.isSafeInteger(count) && count >= 0 && count <= 1000000;
      if (!validCount) collector.issue('invalid-reported-count');
      const categories = bounded(result.threat_names, LIMITS.analyzers, collector);
      if (
        count === 0 &&
        result.severity === 'SAFE' &&
        Array.isArray(result.threat_names) &&
        !categories.length
      )
        continue;
      if (count === 0 || result.severity === 'SAFE')
        collector.issue('reported-count-severity-mismatch');
      collector.finding({
        recordIndex,
        rule: `mcp-aggregate:${engine}`,
        category: 'aggregate',
        severity: result.severity,
        analyzer: engine,
        kind: 'aggregate',
        reportedCount: validCount ? count : null,
        itemType: type,
        itemIdSha256: itemId,
        categories,
        locations: [],
      });
    }
  }
  collector.issue('mcp-source-binding-unavailable');
  collector.issue('external-execution-coverage-unverified');
}

module.exports = { importMcpJson };
