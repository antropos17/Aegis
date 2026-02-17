/**
 * @file reports.js
 * @module reports
 * @description Activity tab filtering and full-feed rendering, plus the
 *   Reports tab with per-agent aggregate statistics and risk table.
 * @since v0.1.0
 */

// ═══ ACTIVITY TAB ═══

const fullActivityFeed = document.getElementById('full-activity-feed');
const filterAgent = document.getElementById('filter-agent');
const filterSeverity = document.getElementById('filter-severity');
const filterFiletype = document.getElementById('filter-filetype');
const clearFiltersBtn = document.getElementById('clear-filters');

/**
 * Populate the agent dropdown filter with all agents seen in events.
 * @returns {void}
 * @since v0.1.0
 */
function populateAgentFilter() {
  const agents = new Set();
  for (const ev of allActivityEvents) agents.add(ev.agent);
  const current = filterAgent.value;
  filterAgent.innerHTML = '<option value="">All Agents</option>';
  for (const a of agents) {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    if (a === current) opt.selected = true;
    filterAgent.appendChild(opt);
  }
}

/**
 * Test whether an event matches the current agent/severity/filetype filters.
 * @param {Object} ev - File-access event object.
 * @returns {boolean} True if the event passes all active filters.
 * @since v0.1.0
 */
function matchesFilters(ev) {
  // Agent filter
  if (filterAgent.value && ev.agent !== filterAgent.value) return false;
  // Severity filter
  if (filterSeverity.value) {
    if (filterSeverity.value === 'sensitive' && !ev.sensitive) return false;
    if (filterSeverity.value === 'config' && !isConfigFile(ev.file)) return false;
    if (filterSeverity.value === 'normal' && (ev.sensitive || isConfigFile(ev.file))) return false;
  }
  // File type filter
  if (filterFiletype.value) {
    const ext = ev.file.split('.').pop().toLowerCase();
    const typeMap = {
      js: ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'],
      json: ['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'xml'],
      env: ['env', 'pem', 'key', 'pfx', 'p12'],
      py: ['py', 'pyw', 'pyc'],
    };
    const allowed = typeMap[filterFiletype.value];
    if (allowed) {
      if (!allowed.includes(ext)) return false;
    } else if (filterFiletype.value === 'other') {
      const allKnown = Object.values(typeMap).flat();
      if (allKnown.includes(ext)) return false;
    }
  }
  return true;
}

/**
 * Re-render the full activity feed in the Activity tab, applying current filters.
 * @returns {void}
 * @since v0.1.0
 */
function renderFullActivityFeed() {
  if (allActivityEvents.length === 0) {
    fullActivityFeed.innerHTML = '<div class="empty-state">No activity events recorded yet</div>';
    return;
  }
  fullActivityFeed.innerHTML = '';
  for (const ev of allActivityEvents) {
    if (!matchesFilters(ev)) continue;
    fullActivityFeed.appendChild(createFeedEntry(ev));
  }
  if (fullActivityFeed.children.length === 0) {
    fullActivityFeed.innerHTML = '<div class="empty-state">No events match current filters</div>';
  }
  fullActivityFeed.scrollTop = fullActivityFeed.scrollHeight;
}

filterAgent.addEventListener('change', renderFullActivityFeed);
filterSeverity.addEventListener('change', renderFullActivityFeed);
filterFiletype.addEventListener('change', renderFullActivityFeed);
clearFiltersBtn.addEventListener('click', () => {
  filterAgent.value = '';
  filterSeverity.value = '';
  filterFiletype.value = '';
  renderFullActivityFeed();
});

// ═══ REPORTS TAB ═══

const reportFilesEl = document.getElementById('report-files');
const reportSensitiveEl = document.getElementById('report-sensitive');
const reportAgentsEl = document.getElementById('report-agents');
const reportNetworkEl = document.getElementById('report-network');

/**
 * Update the summary stat pills in the Reports tab header.
 * @returns {void}
 * @since v0.1.0
 */
function updateReportStats() {
  reportFilesEl.textContent = allActivityEvents.length;
  reportSensitiveEl.textContent = allActivityEvents.filter(e => e.sensitive).length;
  reportAgentsEl.textContent = new Set(allActivityEvents.map(e => e.agent)).size;
  // Network count from current network data
  const netCount = networkList.querySelectorAll('.net-row').length;
  reportNetworkEl.textContent = netCount;
  renderReportsTable();
}

/**
 * Render the per-agent aggregate statistics table in the Reports tab,
 * sorted by risk score descending.
 * @returns {void}
 * @since v0.1.0
 */
function renderReportsTable() {
  const wrap = document.getElementById('reports-table-wrap');
  if (!wrap) return;

  // Aggregate per-agent stats
  const agentStats = {};
  for (const ev of allActivityEvents) {
    if (!agentStats[ev.agent]) agentStats[ev.agent] = { files: 0, sensitive: 0, network: 0, risk: 0 };
    agentStats[ev.agent].files++;
    if (ev.sensitive) agentStats[ev.agent].sensitive++;
  }

  // Add network counts
  for (const [agent, count] of Object.entries(netConnectionCounts)) {
    if (!agentStats[agent]) agentStats[agent] = { files: 0, sensitive: 0, network: 0, risk: 0 };
    agentStats[agent].network = count;
  }

  // Compute risk scores
  for (const agent of Object.keys(agentStats)) {
    agentStats[agent].risk = getRiskScore(agent, aiFileCounts, aiSensitiveCounts, aiSshAwsCounts, aiConfigCounts);
  }

  const sorted = Object.entries(agentStats).sort((a, b) => b[1].risk - a[1].risk);

  if (sorted.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No agent data to display</div>';
    return;
  }

  let html = `<table class="reports-table">
    <thead><tr>
      <th>Agent</th>
      <th>Files</th>
      <th>Sensitive</th>
      <th>Network</th>
      <th>Risk</th>
    </tr></thead><tbody>`;

  for (const [agent, stats] of sorted) {
    const dbEntry = agentDbMap[agent];
    const icon = dbEntry ? dbEntry.icon + ' ' : '';
    const riskColor = getRiskColor(stats.risk);
    html += `<tr>
      <td>${icon}${escapeHtml(agent)}</td>
      <td>${stats.files}</td>
      <td style="color:${stats.sensitive > 0 ? 'var(--red)' : 'inherit'}">${stats.sensitive}</td>
      <td>${stats.network}</td>
      <td><span class="risk-badge risk-${riskColor}" style="display:inline-flex;width:auto;height:auto;padding:2px 8px;border-radius:10px;font-size:10px">${stats.risk}</span></td>
    </tr>`;
  }

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ═══ AI THREAT ANALYSIS ═══

const threatAnalysisBtn = document.getElementById('run-threat-analysis');
const threatAnalysisResults = document.getElementById('threat-analysis-results');

threatAnalysisBtn.addEventListener('click', async () => {
  threatAnalysisBtn.disabled = true;
  threatAnalysisBtn.textContent = 'ANALYZING...';
  threatAnalysisResults.innerHTML = '<div class="threat-loading"><div class="threat-spinner"></div>Running AI threat analysis via Anthropic API...</div>';
  try {
    const result = await window.aegis.analyzeSession();
    if (result.success) {
      renderThreatAnalysis(result);
    } else {
      threatAnalysisResults.innerHTML = `<div class="threat-error">${escapeHtml(result.error)}</div>`;
      showToast(result.error, 'error');
    }
  } catch (err) {
    threatAnalysisResults.innerHTML = `<div class="threat-error">Analysis failed: ${escapeHtml(err.message)}</div>`;
    showToast('Threat analysis failed', 'error');
  }
  threatAnalysisBtn.disabled = false;
  threatAnalysisBtn.textContent = 'RUN AI THREAT ANALYSIS';
});

/**
 * Render AI threat analysis results into the reports tab.
 * @param {Object} result - Analysis result with summary, findings, riskRating, recommendations.
 * @returns {void}
 * @since v0.2.0
 */
function renderThreatAnalysis(result) {
  const ratingColors = { 'CLEAR': 'green', 'LOW': 'green', 'MEDIUM': 'yellow', 'HIGH': 'orange', 'CRITICAL': 'red' };
  const ratingColor = ratingColors[result.riskRating] || 'yellow';
  let html = '<div class="threat-results">';
  html += `<div class="threat-rating-card"><span class="threat-rating-badge threat-${ratingColor}">${escapeHtml(result.riskRating || 'UNKNOWN')}</span><span class="threat-rating-label">THREAT LEVEL</span></div>`;
  html += `<div class="threat-card"><div class="threat-card-title">EXECUTIVE SUMMARY</div><div class="threat-card-text">${escapeHtml(result.summary || 'No summary available')}</div></div>`;
  if (result.findings && result.findings.length > 0) {
    html += `<div class="threat-card"><div class="threat-card-title">FINDINGS</div><ul class="threat-list">${result.findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`;
  }
  if (result.recommendations && result.recommendations.length > 0) {
    html += `<div class="threat-card"><div class="threat-card-title">RECOMMENDED ACTIONS</div><ul class="threat-list">${result.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;
  }
  html += '<button id="threat-print-report" class="btn-action btn-report" style="margin-top:12px">GENERATE PRINTABLE REPORT</button>';
  html += '</div>';
  threatAnalysisResults.innerHTML = html;
  document.getElementById('threat-print-report').addEventListener('click', () => generateThreatReport(result));
}

/**
 * Generate and open a printable HTML threat report.
 * @param {Object} analysis - Analysis result object.
 * @returns {void}
 * @since v0.2.0
 */
function generateThreatReport(analysis) {
  const now = new Date().toLocaleString();
  const ratingColors = { 'CLEAR': '#38A169', 'LOW': '#38A169', 'MEDIUM': '#ED8936', 'HIGH': '#ED8936', 'CRITICAL': '#E53E3E' };
  const rc = ratingColors[analysis.riskRating] || '#ED8936';
  const totalFiles = allActivityEvents.length;
  const totalSensitive = allActivityEvents.filter(e => e.sensitive).length;
  const totalAgents = new Set(allActivityEvents.map(e => e.agent)).size;
  const totalNet = networkList.querySelectorAll('.net-row').length;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AEGIS Threat Analysis Report</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#0a0e17;color:#E0E5EC;margin:0;padding:24px}
h1{color:#4ECDC4;font-size:28px;margin-bottom:4px}.meta{color:#8896A6;font-size:12px;margin-bottom:20px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.stat{text-align:center;padding:12px;background:#12162b;border-radius:8px}
.stat-val{font-size:24px;font-weight:700}.stat-label{font-size:10px;color:#8896A6;letter-spacing:1px}
.section{background:#12162b;border-radius:10px;padding:16px;margin-bottom:16px}
.section-title{font-size:12px;letter-spacing:2px;color:#8896A6;margin-bottom:8px;font-weight:700}
.rating{display:inline-block;padding:6px 20px;border-radius:12px;font-weight:800;font-size:18px;letter-spacing:2px;color:#fff;background:${rc}}
ul{margin:8px 0;padding-left:20px}li{margin:4px 0;color:#c8d0da}
.footer{margin-top:20px;text-align:center;color:#8896A6;font-size:11px}
@media print{body{background:#fff;color:#222}.section,.stat{background:#f5f5f5;border:1px solid #ddd}h1{color:#2a9d8f}.rating{border:2px solid ${rc}}}</style></head>
<body><h1>AEGIS Threat Analysis Report</h1><div class="meta">Generated: ${now}</div>
<div class="stats">
<div class="stat"><div class="stat-val" style="color:#4ECDC4">${totalFiles}</div><div class="stat-label">FILES ACCESSED</div></div>
<div class="stat"><div class="stat-val" style="color:#E53E3E">${totalSensitive}</div><div class="stat-label">SENSITIVE ALERTS</div></div>
<div class="stat"><div class="stat-val" style="color:#4ECDC4">${totalAgents}</div><div class="stat-label">AGENTS DETECTED</div></div>
<div class="stat"><div class="stat-val" style="color:#4299E1">${totalNet}</div><div class="stat-label">NETWORK CONNECTIONS</div></div>
</div>
<div class="section"><div class="section-title">THREAT LEVEL</div><span class="rating">${analysis.riskRating || 'UNKNOWN'}</span></div>
<div class="section"><div class="section-title">EXECUTIVE SUMMARY</div><p>${(analysis.summary || '').replace(/\n/g, '<br>')}</p></div>
${analysis.findings && analysis.findings.length > 0 ? `<div class="section"><div class="section-title">FINDINGS</div><ul>${analysis.findings.map(f => `<li>${f}</li>`).join('')}</ul></div>` : ''}
${analysis.recommendations && analysis.recommendations.length > 0 ? `<div class="section"><div class="section-title">RECOMMENDED ACTIONS</div><ul>${analysis.recommendations.map(r => `<li>${r}</li>`).join('')}</ul></div>` : ''}
<div class="footer">Generated by AEGIS — AI Agent Privacy Shield</div></body></html>`;
  window.aegis.openThreatReport(html).catch(() => showToast('Failed to open report', 'error'));
}
