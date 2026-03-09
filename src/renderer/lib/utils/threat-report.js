/**
 * @file threat-report.js — Send structured data for threat report generation
 * @module renderer/utils/threat-report
 * @since 0.2.0
 */

/**
 * Request main process to generate and open a printable HTML threat report.
 * Sends structured data — HTML generation and escaping happens in main process.
 * @param {Object} result - Analysis result (riskRating, summary, findings, recommendations)
 * @param {Object} counts - { totalFiles, totalSensitive, totalAgents, totalNet }
 */
export function openThreatReport(result, counts) {
  window.aegis.openThreatReport({
    riskRating: result.riskRating,
    summary: result.summary,
    findings: result.findings,
    recommendations: result.recommendations,
    counts,
  });
}
