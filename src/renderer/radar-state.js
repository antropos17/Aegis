/**
 * @file radar-state.js - Solar System radar: constants, state, and glow update.
 * Depends on: state.js (radarThreatVal, currentThreatLevel),
 * risk-scoring.js (getRiskColor, getRiskLabel).
 * @since 0.2.0
 */

// ── Radar glow: driven by highest agent risk score ──

/**
 * Update the radar center glow and threat label based on the highest risk score.
 * Also drives corePulse intensity for the central star effect.
 * @param {number} riskScore - Highest risk score across all agents (0-100).
 * @since 0.1.0
 */
function updateRadarGlow(riskScore) {
  const color = getRiskColor(riskScore);
  const label = getRiskLabel(riskScore);

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

  // Drive core pulse intensity from risk
  radarState.corePulse.intensity = 0.3 + (riskScore / 100) * 0.7;
}

// ═══ SOLAR SYSTEM RADAR ═══

/** @type {Array<{id: string, label: string, icon: string, color: string, orbitRadius: number, speed: number}>} */
const ORBITAL_NODES = [
  { id: 'ssh',     label: 'SSH',     icon: '\u2387', color: '#a89878', orbitRadius: 0.65, speed: 0.3 },
  { id: 'browser', label: 'WEB',     icon: '\u25CE', color: '#7898a8', orbitRadius: 0.70, speed: 0.25 },
  { id: 'env',     label: 'ENV',     icon: '\u2261', color: '#88a878', orbitRadius: 0.60, speed: 0.35 },
  { id: 'aws',     label: 'CLOUD',   icon: '\u2601', color: '#a88868', orbitRadius: 0.75, speed: 0.2 },
  { id: 'git',     label: 'GIT',     icon: '\u2442', color: '#9878a8', orbitRadius: 0.55, speed: 0.4 },
  { id: 'docker',  label: 'DOCKER',  icon: '\u2338', color: '#78a0a8', orbitRadius: 0.80, speed: 0.15 },
  { id: 'npm',     label: 'PKG',     icon: '\u29C9', color: '#a87888', orbitRadius: 0.50, speed: 0.45 },
  { id: 'kube',    label: 'KUBE',    icon: '\u2699', color: '#8898a8', orbitRadius: 0.85, speed: 0.1 },
];

/** Map sensitive reasons to node IDs for lightning targeting. */
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
  // Agent star core
  selectedAgent: null,
  threatLevel: 'green',
  threatLabel: 'CLEAR',
  // Orbital positions: nodeId -> { angle }
  orbits: {},
  // Lightning bolts: [{ targetNodeId, startTime, duration, intensity, riskLevel, color, seed }]
  lightnings: [],
  // Core pulse animation
  corePulse: { phase: 0, intensity: 0.5 },
  // Particle system: [{ x, y, life, maxLife, vx, vy, color, size }]
  sparkles: [],
  // Solar flares: [{ angle, size, speed, startTime, duration }]
  flares: [],
  // Compat: agentOrbits dict preserved for boostAgentSpeed existence check
  agentOrbits: {},
  // Blocked flash overlay
  blockedFlash: { active: false, timestamp: 0 },
};

// Initialize orbits with random starting angles
for (const node of ORBITAL_NODES) {
  radarState.orbits[node.id] = { angle: Math.random() * Math.PI * 2 };
}

const THREAT_COLORS = {
  green:  { core: 'rgba(74, 122, 90, 0.85)',  glow: 'rgba(74, 122, 90, 0.15)' },
  yellow: { core: 'rgba(200, 168, 78, 0.85)', glow: 'rgba(200, 168, 78, 0.15)' },
  red:    { core: 'rgba(200, 122, 122, 0.85)', glow: 'rgba(200, 122, 122, 0.15)' },
};

const AGENT_COLORS = [
  'rgb(8,145,178)', 'rgb(139,92,246)', 'rgb(236,72,153)', 'rgb(245,158,11)',
  'rgb(16,185,129)', 'rgb(59,130,246)', 'rgb(239,68,68)', 'rgb(99,102,241)',
];
