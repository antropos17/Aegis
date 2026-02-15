/**
 * @file risk-scoring.js - Risk score engine with time-decay weighting, trust scoring,
 * and grade/color classification.
 * Depends on: state.js (eventLog, isProjectFile, getDefaultTrust, netConnectionCounts,
 * netUnknownDomainCounts), helpers.js (isConfigFile).
 * @since 0.1.0
 */

// ═══ RISK SCORE ENGINE (Step 5) ═══

/**
 * Calculate a time-decay weight for an event based on its age.
 * Events older than 1 hour contribute 50%, older than 24 hours contribute 10%.
 * @param {number} timestampMs - Event timestamp in milliseconds since epoch.
 * @returns {number} Weight multiplier: 1.0 (recent), 0.50 (>1hr), or 0.10 (>24hr).
 * @since 0.1.0
 */
function getTimeDecayWeight(timestampMs) {
  const ageMs = Date.now() - timestampMs;
  const oneHour = 3600000;
  const oneDay = 86400000;
  if (ageMs > oneDay) return 0.10;
  if (ageMs > oneHour) return 0.50;
  return 1.0;
}

/**
 * Count sensitive, config, and total file events for an agent with time-decay applied.
 * Files inside the project working directory are skipped for risk scoring.
 * @param {string} agentName - Agent display name.
 * @returns {{ sensitive: number, config: number, files: number }} Decayed event counts.
 * @since 0.1.0
 */
function getDecayedCounts(agentName) {
  let sensitive = 0, config = 0, files = 0;
  for (const ev of eventLog) {
    if (ev.agent !== agentName) continue;
    // Files inside the project working directory are expected — skip for risk
    if (ev.file && isProjectFile(ev.file)) continue;
    const w = getTimeDecayWeight(ev.timestamp);
    if (ev.type === 'sensitive') sensitive += w;
    else if (ev.type === 'config')  config += w;
    files += w; // all events count toward total
  }
  return { sensitive, config, files };
}

/**
 * Get the status multiplier for risk scoring based on agent trust level.
 * Trusted agents (default trust >= 70) get a 0.5 multiplier.
 * @param {string} agentName - Agent display name.
 * @returns {number} Multiplier: 0.5 for trusted, 1.0 for unknown/new.
 * @since 0.1.0
 */
function getStatusMultiplier(agentName) {
  const trust = getDefaultTrust(agentName);
  if (trust >= 70) return 0.5;
  return 1.0;
}

/**
 * Compute the overall risk score for an agent (0-100).
 * Weighted formula: sensitive*10 + config*5 + network*3 + unknownDomain*15 + files*0.1 (capped).
 * @param {string} agentName - Agent display name.
 * @param {Object} fileCounts - Map of agent -> total file access count.
 * @param {Object} sensitiveCounts - Map of agent -> sensitive file count.
 * @param {Object} sshAwsCounts - Map of agent -> SSH/AWS access count.
 * @param {Object} configCounts - Map of agent -> config file access count.
 * @returns {number} Risk score clamped to 0-100.
 * @since 0.1.0
 */
function getRiskScore(agentName, fileCounts, sensitiveCounts, sshAwsCounts, configCounts) {
  const decayed = getDecayedCounts(agentName);
  const netConns = netConnectionCounts[agentName] || 0;
  const unknownDomains = netUnknownDomainCounts[agentName] || 0;

  // File access contributes minimally — cap at 10 points to avoid bulk temp files inflating risk
  const fileContrib = Math.min(10, decayed.files * 0.1);
  const rawScore =
    decayed.sensitive * 10 +
    decayed.config * 5 +
    netConns * 3 +
    unknownDomains * 15 +
    fileContrib;

  const multiplier = getStatusMultiplier(agentName);
  return Math.min(100, Math.round(rawScore * multiplier));
}

/**
 * Map a risk score to a color keyword for CSS class binding.
 * @param {number} score - Risk score (0-100).
 * @returns {string} Color keyword: 'red', 'orange', 'yellow', or 'green'.
 * @since 0.1.0
 */
function getRiskColor(score) {
  if (score >= 76) return 'red';
  if (score >= 51) return 'orange';
  if (score >= 26) return 'yellow';
  return 'green';
}

/**
 * Map a risk score to a severity label.
 * @param {number} score - Risk score (0-100).
 * @returns {string} Label: 'CRITICAL', 'HIGH', 'MEDIUM', or 'LOW'.
 * @since 0.1.0
 */
function getRiskLabel(score) {
  if (score >= 76) return 'CRITICAL';
  if (score >= 51) return 'HIGH';
  if (score >= 26) return 'MEDIUM';
  return 'LOW';
}

// ── Trust score: starts from default, decreases with risk activity ──

/**
 * Compute the trust score for an agent given its risk score.
 * Trust erodes: baseTrust - riskScore * 0.8 (clamped to 0-100).
 * @param {string} agentName - Agent display name.
 * @param {number} riskScore - Computed risk score (0-100).
 * @returns {number} Trust score clamped to 0-100.
 * @since 0.1.0
 */
function getTrustScore(agentName, riskScore) {
  const baseTrust = getDefaultTrust(agentName);
  return Math.max(0, Math.min(100, Math.round(baseTrust - riskScore * 0.8)));
}

/**
 * Map a trust score to a letter grade.
 * @param {number} trustScore - Trust score (0-100).
 * @returns {string} Letter grade: 'A+', 'A', 'B', 'C', 'D', or 'F'.
 * @since 0.1.0
 */
function getTrustGrade(trustScore) {
  if (trustScore >= 95) return 'A+';
  if (trustScore >= 85) return 'A';
  if (trustScore >= 70) return 'B';
  if (trustScore >= 50) return 'C';
  if (trustScore >= 30) return 'D';
  return 'F';
}

/**
 * Map a trust score to a color keyword for CSS class binding.
 * @param {number} trustScore - Trust score (0-100).
 * @returns {string} Color keyword: 'green', 'yellow', or 'red'.
 * @since 0.1.0
 */
function getTrustColor(trustScore) {
  if (trustScore >= 70) return 'green';
  if (trustScore >= 40) return 'yellow';
  return 'red';
}
