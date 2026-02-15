/**
 * @file state.js - Global application state, DOM references, and tracking objects.
 * All variables declared here are shared globally via script tags (no imports/exports).
 * @since 0.1.0
 */

// ── DOM refs ──
const agentsList = document.getElementById('agents-list');
const activityFeed = document.getElementById('activity-feed');
const sensitiveCountEl = document.getElementById('sensitive-count');
const lastScanEl = document.getElementById('last-scan');
const clearBtn = document.getElementById('clear-feed');
const exportBtn = document.getElementById('export-log');
const toastEl = document.getElementById('toast');

const otherAgentsList = document.getElementById('other-agents-list');
const otherActivityFeed = document.getElementById('other-activity-feed');
const otherSensitiveCountEl = document.getElementById('other-sensitive-count');
const otherAgentCountEl = document.getElementById('other-agent-count');
const otherToggleBtn = document.getElementById('other-toggle');
const otherPanel = document.getElementById('other-agents-panel');

const networkList = document.getElementById('network-list');
const networkCountEl = document.getElementById('network-count');

const exportCsvBtn = document.getElementById('export-csv');
const reportBtn = document.getElementById('generate-report');

const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const settingsSave = document.getElementById('settings-save');
const settingInterval = document.getElementById('setting-interval');
const settingIntervalVal = document.getElementById('setting-interval-val');
const settingNotifications = document.getElementById('setting-notifications');
const settingStartMinimized = document.getElementById('setting-start-minimized');
const settingAutoStart = document.getElementById('setting-auto-start');
const settingApiKey = document.getElementById('setting-api-key');
const patternsList = document.getElementById('patterns-list');
const patternInput = document.getElementById('pattern-input');
const patternAddBtn = document.getElementById('pattern-add');

const analysisOverlay = document.getElementById('analysis-overlay');
const analysisClose = document.getElementById('analysis-close');
const analysisContent = document.getElementById('analysis-content');
const analysisTitle = document.getElementById('analysis-title');

let currentPatterns = [];

const footerCpu = document.getElementById('footer-cpu');
const footerMem = document.getElementById('footer-mem');
const footerHeap = document.getElementById('footer-heap');
const footerInterval = document.getElementById('footer-interval');

const statFiles = document.getElementById('stat-files');
const statAgents = document.getElementById('stat-agents');
const statSensitive = document.getElementById('stat-sensitive');
const statUptime = document.getElementById('stat-uptime');
const radarThreatVal = document.getElementById('radar-threat-val');
const shieldScoreEl = document.getElementById('shield-score');
const streakCountEl = document.getElementById('streak-count');
const statSensitiveWrap = document.getElementById('stat-sensitive-wrap');

const showMoreBtn = document.getElementById('show-more-feed');
let feedCollapsed = true;
const VISIBLE_FEED_ROWS = 10;

const radarCanvas = document.getElementById('radar-canvas');
const radarCtx = radarCanvas.getContext('2d');

const MAX_FEED_ENTRIES = 500;
const MAX_OTHER_FEED_ENTRIES = 200;

// ── Local tracking (split by category) ──
const aiFileCounts = {};
const aiSensitiveCounts = {};
const aiSshAwsCounts = {};    // .ssh / .aws access count per agent
const aiConfigCounts = {};    // config file access count per agent
let aiTotalSensitive = 0;
let aiFeedHasEntries = false;

const otherFileCounts = {};
const otherSensitiveCounts = {};
const otherSshAwsCounts = {};
const otherConfigCounts = {};
let otherTotalSensitive = 0;

const netConnectionCounts = {};
const netUnknownDomainCounts = {};
let otherFeedHasEntries = false;

// Timestamped event log for time-decay scoring
const eventLog = [];

// Project directory — files inside this dir don't count toward risk score
let projectDir = '';
window.aegis.getProjectDir().then(dir => {
  projectDir = dir.replace(/\\/g, '/').toLowerCase();
});

/**
 * Check whether a file path is inside the project working directory.
 * @param {string} filePath - Absolute path to test.
 * @returns {boolean} True if the path starts with the project directory.
 * @since 0.1.0
 */
function isProjectFile(filePath) {
  if (!projectDir || !filePath) return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith(projectDir);
}

// ── Agent Database (loaded from main process) ──
let agentDatabase = { agents: [] };
let agentDbMap = {};

// ── Last seen / session duration / sparkline tracking ──
const agentLastSeen = {};
const agentFirstSeen = {};
const agentActivityBins = {};

// ── Default trust scores ──
const DEFAULT_UNKNOWN_TRUST = 20;

/**
 * Get the default trust score for a named agent.
 * @param {string} name - Agent display name.
 * @returns {number} Trust score (0-100), falls back to DEFAULT_UNKNOWN_TRUST.
 * @since 0.1.0
 */
function getDefaultTrust(name) {
  const entry = agentDbMap[name];
  return entry ? entry.defaultTrust : DEFAULT_UNKNOWN_TRUST;
}

let selectedAgent = null;
let expandedAgent = null;
const activeWarnings = {};
const expandedAgentTab = {};

// ── Permissions cache (persisted via IPC) ──
const PERM_CATEGORIES = ['filesystem', 'sensitive', 'network', 'terminal', 'clipboard', 'screen'];
const PERM_LABELS = {
  filesystem: 'Filesystem',
  sensitive:  'Sensitive files',
  network:    'Network',
  terminal:   'Terminal',
  clipboard:  'Clipboard',
  screen:     'Screen',
};
const PERM_SHORT = { filesystem: 'FS', sensitive: 'SENS', network: 'NET', terminal: 'TERM', clipboard: 'CLIP', screen: 'SCR' };
const PERM_CYCLE = { allow: 'monitor', monitor: 'block', block: 'allow' };

let cachedPermissions = {};
let seenAgentsList = [];

/**
 * Load the permissions cache from the main process via IPC.
 * @returns {Promise<void>}
 * @since 0.1.0
 */
async function loadPermissionsCache() {
  try {
    const result = await window.aegis.getAllPermissions();
    cachedPermissions = result.permissions || {};
    seenAgentsList = result.seenAgents || [];
  } catch (_) {}
}

/**
 * Get the permission state for an agent in a given category.
 * @param {string} agentName - Agent display name.
 * @param {string} category - Permission category (e.g. 'filesystem').
 * @returns {string} Permission state: 'allow', 'monitor', or 'block'.
 * @since 0.1.0
 */
function getPermission(agentName, category) {
  const perms = cachedPermissions[agentName];
  if (perms && perms[category]) return perms[category];
  return 'monitor'; // default fallback
}

let uptimeMs = 0;
let currentThreatLevel = 'green';
let previousPidMap = new Map();
let isFirstScan = true;
let highestRiskScore = 0;

/** Store all events for full activity feed (ACTIVITY tab + REPORTS). @type {Object[]} */
const allActivityEvents = [];
