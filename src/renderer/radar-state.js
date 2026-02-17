/**
 * @file radar-state.js - Radar visualization constants, state objects, and glow update.
 * Depends on: state.js (radarThreatVal, currentThreatLevel, radarState reference),
 * risk-scoring.js (getRiskColor, getRiskLabel).
 * @since 0.1.0
 */

// ── Radar glow: driven by highest agent risk score ──

/**
 * Update the radar center glow and threat label based on the highest risk score.
 * Maps risk color to a threat level and updates the DOM + radarState.
 * @param {number} riskScore - Highest risk score across all agents (0-100).
 * @since 0.1.0
 */
function updateRadarGlow(riskScore) {
  const color = getRiskColor(riskScore);
  const label = getRiskLabel(riskScore);

  // Map risk color to threat level for radar core glow
  const threatMap = { green: 'green', yellow: 'yellow', orange: 'yellow', red: 'red' };
  const threatLevel = threatMap[color] || 'green';

  if (threatLevel !== currentThreatLevel) {
    radarThreatVal.classList.remove('threat-text-green', 'threat-text-yellow', 'threat-text-red');
    radarThreatVal.classList.add(`threat-text-${threatLevel}`);
    currentThreatLevel = threatLevel;
    radarState.threatLevel = threatLevel;
  }

  radarThreatVal.textContent = label;
  radarState.threatLabel = label;
}

// ═══ CANVAS RADAR ENGINE ═══

/** @type {Array<{id: string, label: string, icon: string, angle: number}>} */
const RADAR_NODES = [
  { id: 'ssh',     label: 'SSH',     icon: '\uD83D\uDD11', angle: -90 },
  { id: 'browser', label: 'BROWSER', icon: '\uD83C\uDF10', angle: -45 },
  { id: 'env',     label: 'ENV',     icon: '\uD83D\uDCC4', angle: 0 },
  { id: 'aws',     label: 'AWS',     icon: '\u2601',       angle: 45 },
  { id: 'git',     label: 'GIT',     icon: '\uD83D\uDD00', angle: 90 },
  { id: 'docker',  label: 'DOCKER',  icon: '\uD83D\uDC33', angle: 135 },
  { id: 'npm',     label: 'NPM',     icon: '\uD83D\uDCE6', angle: 180 },
  { id: 'kube',    label: 'KUBE',    icon: '\u2699',       angle: -135 },
];

/** Map sensitive reasons to node IDs for connection lines. */
const REASON_TO_NODE = {
  'SSH keys/config': 'ssh', 'SSH private key': 'ssh', 'SSH known hosts': 'ssh', 'SSH authorized keys': 'ssh',
  'Chrome passwords': 'browser', 'Chrome cookies': 'browser', 'Chrome autofill data': 'browser',
  'Chrome browsing history': 'browser', 'Firefox passwords': 'browser', 'Firefox cookies': 'browser',
  'Firefox key database': 'browser', 'Edge passwords': 'browser', 'Edge cookies': 'browser',
  'Environment variables': 'env',
  'AWS credentials': 'aws', 'Azure credentials': 'aws', 'GCloud credentials': 'aws',
  'Git credentials': 'git',
  'Docker credentials': 'docker',
  'NPM config (may contain tokens)': 'npm', 'PyPI config (may contain tokens)': 'npm',
  'Kubernetes config': 'kube',
};

const radarState = {
  sweepAngle: 0,
  threatLevel: 'green',
  threatLabel: 'CLEAR',
  // Agent orbits: agentName -> { angle, speed, color, label }
  agentOrbits: {},
  // Node pulse effects: nodeId -> { intensity (0-1), timestamp }
  nodePulses: {},
  // Connection lines: [{ fromAngle, toNodeId, progress (0-1), timestamp, blocked }]
  connectionLines: [],
  // Blocked flash: { active, timestamp }
  blockedFlash: { active: false, timestamp: 0 },
};

const THREAT_COLORS = {
  green:  { core: 'rgba(74, 122, 90, 0.85)',  glow: 'rgba(74, 122, 90, 0.15)' },
  yellow: { core: 'rgba(200, 168, 78, 0.85)', glow: 'rgba(200, 168, 78, 0.15)' },
  red:    { core: 'rgba(200, 122, 122, 0.85)', glow: 'rgba(200, 122, 122, 0.15)' },
};

const AGENT_COLORS = [
  'rgb(8,145,178)', 'rgb(139,92,246)', 'rgb(236,72,153)', 'rgb(245,158,11)',
  'rgb(16,185,129)', 'rgb(59,130,246)', 'rgb(239,68,68)', 'rgb(99,102,241)',
];

/**
 * Convert degrees to radians.
 * @param {number} deg - Angle in degrees.
 * @returns {number} Angle in radians.
 * @since 0.1.0
 */
function degToRad(deg) { return deg * Math.PI / 180; }
