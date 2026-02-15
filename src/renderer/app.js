/**
 * @file app.js
 * @module app
 * @description Application init and orchestration: tab navigation, stats
 *   rendering, uptime ticker, monitoring pause state, resource usage footer,
 *   and IPC listener registration.
 * @since v0.1.0
 */

// ═══ TAB NAVIGATION ═══

/** Currently active tab identifier. @type {string} */
let currentTab = 'shield';

/**
 * Switch the visible tab view and trigger lazy rendering for the target tab.
 * @param {string} tab - Tab identifier ('shield', 'activity', 'rules', 'reports').
 * @returns {void}
 * @since v0.1.0
 */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-pill').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.toggle('active', v.id === `tab-${tab}`));
  if (tab === 'activity') { renderFullActivityFeed(); populateAgentFilter(); }
  if (tab === 'rules') { renderRulesPermissions(); }
  if (tab === 'reports') { updateReportStats(); renderReportsTable(); }
}

document.querySelectorAll('.tab-pill').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ═══ STATS RENDERING ═══

/**
 * Render header stats pills (files, sensitive, agents, uptime, shield score, streak).
 * @param {Object} stats - Stats object from main process (totalFiles, totalSensitive, aiAgentCount, currentAgents, uptimeMs, otherAgentCount).
 * @returns {void}
 * @since v0.1.0
 */
function renderStats(stats) {
  statFiles.textContent = stats.totalFiles.toLocaleString();
  statSensitive.textContent = stats.totalSensitive.toLocaleString();
  statAgents.textContent = stats.aiAgentCount !== undefined ? stats.aiAgentCount : stats.currentAgents;
  uptimeMs = stats.uptimeMs;
  statUptime.textContent = formatUptime(uptimeMs);

  // Sensitive count is displayed in the alert pill; radar glow is driven by risk score in renderAgents

  // Update shield score (100% = no sensitive, decreases with each sensitive access)
  const shieldScore = Math.max(0, 100 - aiTotalSensitive * 3);
  shieldScoreEl.textContent = shieldScore;

  // Update alerts pill color
  if (aiTotalSensitive > 0) {
    statSensitiveWrap.classList.add('has-alerts');
  } else {
    statSensitiveWrap.classList.remove('has-alerts');
  }

  // Streak: days since first event (simplified — always shows uptime in days)
  const uptimeDays = Math.floor(uptimeMs / 86400000);
  streakCountEl.textContent = uptimeDays;

  if (stats.otherAgentCount !== undefined) {
    otherAgentCountEl.textContent = stats.otherAgentCount;
  }
}

// Local uptime ticker
setInterval(() => {
  uptimeMs += 1000;
  statUptime.textContent = formatUptime(uptimeMs);
}, 1000);

// ═══ MONITORING PAUSE STATE ═══

const scanStatusEl = document.getElementById('scan-status');

/**
 * IPC callback: update the scan-status footer pill when monitoring is paused or resumed.
 * Registered via window.aegis.onMonitoringPaused.
 */
window.aegis.onMonitoringPaused((paused) => {
  if (paused) {
    scanStatusEl.textContent = 'PAUSED';
    scanStatusEl.classList.remove('pulse');
    scanStatusEl.classList.add('paused');
  } else {
    scanStatusEl.textContent = 'MONITORING';
    scanStatusEl.classList.remove('paused');
    scanStatusEl.classList.add('pulse');
  }
});

// ═══ RESOURCE USAGE FOOTER ═══

/** @type {number} Last recorded CPU user time (microseconds). */
let lastCpuUser = 0;
/** @type {number} Last recorded CPU system time (microseconds). */
let lastCpuSystem = 0;
/** @type {number} Timestamp of last CPU sample. */
let lastCpuTime = Date.now();

/**
 * Render CPU, memory, and heap usage into the footer status pills.
 * @param {Object} usage - Resource usage from main process (cpuUser, cpuSystem, memMB, heapMB).
 * @returns {void}
 * @since v0.1.0
 */
function renderResourceUsage(usage) {
  const now = Date.now();
  const elapsed = (now - lastCpuTime) * 1000; // microseconds
  if (elapsed > 0 && lastCpuTime > 0) {
    const deltaUser = usage.cpuUser - lastCpuUser;
    const deltaSystem = usage.cpuSystem - lastCpuSystem;
    const cpuPct = Math.min(100, Math.round(((deltaUser + deltaSystem) / elapsed) * 100));

    footerCpu.textContent = cpuPct + '%';
    footerCpu.className = 'status-value' + (cpuPct > 50 ? ' high' : cpuPct > 25 ? ' warn' : '');
  }
  lastCpuUser = usage.cpuUser;
  lastCpuSystem = usage.cpuSystem;
  lastCpuTime = now;

  footerMem.textContent = usage.memMB + ' MB';
  footerMem.className = 'status-value' + (usage.memMB > 300 ? ' high' : usage.memMB > 150 ? ' warn' : '');

  footerHeap.textContent = usage.heapMB + ' MB';
}

/**
 * Fetch the current scan interval from settings and update the footer pill.
 * @returns {void}
 * @since v0.1.0
 */
function updateFooterInterval() {
  window.aegis.getSettings().then(s => {
    footerInterval.textContent = s.scanIntervalSec + 's';
  });
}

// ═══ INIT ═══

// Load agent database from main process
window.aegis.getAgentDatabase().then(db => {
  agentDatabase = db;
  agentDbMap = Object.fromEntries(db.agents.map(a => [a.displayName, a]));
}).catch(() => {});

// Initial data — stats and resource usage are lightweight (no PowerShell).
// Process scan is deferred to main process staggered startup (3s).
loadPermissionsCache();
window.aegis.getStats().then(renderStats);
window.aegis.getResourceUsage().then(renderResourceUsage);
updateFooterInterval();
window.aegis.onScanResults(renderAgents);
window.aegis.onFileAccess(addFeedEntries);
window.aegis.onStatsUpdate(renderStats);
window.aegis.onNetworkUpdate(renderNetworkConnections);
window.aegis.onResourceUsage(renderResourceUsage);
window.aegis.onBaselineWarnings((warnings) => {
  for (const w of warnings) {
    if (!activeWarnings[w.agent]) activeWarnings[w.agent] = [];
    // Deduplicate by message
    if (!activeWarnings[w.agent].some(existing => existing.message === w.message)) {
      activeWarnings[w.agent].push(w);
      showToast(w.message, 'warn');
    }
  }
});
