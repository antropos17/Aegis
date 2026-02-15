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
