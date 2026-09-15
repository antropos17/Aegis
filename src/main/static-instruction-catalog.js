'use strict';

const { readSnapshotJson } = require('./inventory-snapshot-files');
const { summarizeToolCatalog } = require('./inventory-tool-catalog');
const { analyzeInstructions } = require('./static-instruction-analysis');
const { staticRule } = require('./static-analysis-rules');

const INSTRUCTION_CATALOG_LIMITS = Object.freeze({
  mcpCatalogBytes: 1048576,
  mcpCatalogTools: 256,
  mcpCatalogFindings: 256,
  mcpCatalogIssues: 1024,
});

/**
 * Review descriptions from one explicitly selected offline tools/list artifact.
 * Lines refer to decoded descriptions; tool indices retain the original array order.
 * No descriptor value can select another read, process, network request or report text.
 * @param {string} toolsFile Caller-selected JSON file; no implicit discovery.
 * @returns {Promise<object>} Fixed findings with source/descriptor hashes and coverage gaps.
 * @since v0.15.1
 */
async function analyzeInstructionCatalog(toolsFile) {
  try {
    const file = await readSnapshotJson(toolsFile);
    const catalog = summarizeToolCatalog(file);
    const tools = Object.hasOwn(file.value, 'result') ? file.value.result.tools : file.value.tools;
    const findings = [];
    const issues = [];
    const issueKeys = new Set();
    let issueOverflow = false;
    let descriptions = 0;
    function issue(toolIndex, reason) {
      const key = JSON.stringify([toolIndex, reason]);
      if (issueKeys.has(key)) return;
      if (issues.length >= INSTRUCTION_CATALOG_LIMITS.mcpCatalogIssues - 1) {
        issueOverflow = true;
        return;
      }
      issueKeys.add(key);
      issues.push({ toolIndex, reason });
    }
    issue(null, 'mcp-tool-fields-not-analyzed');
    if (!catalog.complete) issue(null, 'catalog-not-complete');
    for (const [toolIndex, tool] of tools.entries()) {
      if (!Object.hasOwn(tool, 'description')) continue;
      descriptions++;
      const analysis = analyzeInstructions(tool.description);
      analysis.issues.forEach((reason) => issue(toolIndex, reason));
      for (const finding of analysis.findings) {
        if (findings.length >= INSTRUCTION_CATALOG_LIMITS.mcpCatalogFindings) {
          issue(null, 'mcp-catalog-finding-limit');
          break;
        }
        findings.push({
          ...staticRule(finding.ruleId),
          toolIndex,
          toolId: catalog.tools[toolIndex].id,
          toolSha256: catalog.tools[toolIndex].sha256,
          line: finding.line,
          context: 'mcp-tool-description',
          instruction: { signal: finding.instruction.signal },
        });
      }
    }
    if (issueOverflow) issues.push({ toolIndex: null, reason: 'mcp-catalog-issue-limit' });
    return {
      sourceSha256: catalog.sourceSha256,
      sha256: catalog.sha256,
      assessment: 'instruction-patterns',
      provenance: 'unverified',
      complete: false,
      findings,
      issues,
      summary: {
        tools: tools.length,
        descriptions,
        findings: findings.length,
        issues: issues.length,
      },
    };
  } catch (error) {
    // Parser, filesystem and analyzer failures can contain private source material.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(
      ['snapshot-invalid', 'tool-catalog-invalid'].includes(error.message)
        ? 'tool-catalog-invalid'
        : 'tool-catalog-unavailable',
    );
  }
}

module.exports = { analyzeInstructionCatalog, INSTRUCTION_CATALOG_LIMITS };
