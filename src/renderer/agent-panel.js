/** @file agent-panel.js @module agent-panel @description Agent card rendering with trust bars, sparklines, baselines, and tabbed expand. @since v0.1.0 */

// ═══ AGENT CARD RENDERING ═══

/** Build the HTML for a single agent card. @param {Object} a @param {Object} countsMap @param {Object} sensitiveMap @param {Object} sshAwsMap @param {Object} configCounts @param {string} cardClass @returns {string} */
function renderAgentCard(a, countsMap, sensitiveMap, sshAwsMap, configCounts, cardClass) {
  const count = countsMap[a.agent] || 0;
  const sc = sensitiveMap[a.agent] || 0;
  const countClass = sc > 0 ? 'agent-file-count has-sensitive' : 'agent-file-count';
  const countLabel = count === 1 ? '1 file' : `${count} files`;
  const sensitiveLabel = sc > 0 ? `<span class="agent-sensitive-count">${sc} sensitive</span>` : '';
  const riskScore = getRiskScore(a.agent, countsMap, sensitiveMap, sshAwsMap, configCounts);
  const riskColor = getRiskColor(riskScore);
  const trustScore = getTrustScore(a.agent, riskScore);
  const trustGrade = getTrustGrade(trustScore);
  const trustColor = getTrustColor(trustScore);
  const isSelected = selectedAgent === a.agent;
  const warns = activeWarnings[a.agent];
  const warnBadge = warns && warns.length > 0 ? `<span class="baseline-warn-badge">\u26A0 ${warns.length}</span>` : '';
  const isExpanded = expandedAgent === a.agent;
  const chain = a.parentChain || [];
  const chainHtml = chain.length > 0 ? `<div class="agent-parent-chain">\u21B3 Launched by: ${chain.map(p => escapeHtml(p)).join(' \u2192 ')}</div>` : '';
  const dbEntry = agentDbMap[a.agent];
  const agentIcon = dbEntry ? dbEntry.icon : '';
  const lastSeenTime = agentLastSeen[a.agent];
  const firstSeenTime = agentFirstSeen[a.agent];
  const lastSeenStr = lastSeenTime ? formatTime(lastSeenTime) : '--:--:--';
  const sessionDurStr = firstSeenTime ? formatDuration(Date.now() - firstSeenTime.getTime()) : '--';
  const activeTab = expandedAgentTab[a.agent] || 'baseline';
  const expandedHtml = isExpanded
    ? `<div class="agent-expanded-section" data-agent="${escapeHtml(a.agent)}">
        <div class="agent-tab-bar">
          <button class="agent-tab${activeTab === 'baseline' ? ' active' : ''}" data-tab="baseline" data-agent="${escapeHtml(a.agent)}">BASELINE</button>
          <button class="agent-tab${activeTab === 'permissions' ? ' active' : ''}" data-tab="permissions" data-agent="${escapeHtml(a.agent)}">PERMISSIONS</button>
        </div>
        <div class="agent-tab-content" data-agent="${escapeHtml(a.agent)}"></div>
      </div>` : '';
  return `<div class="${cardClass}${isSelected ? ' selected' : ''}" data-agent="${escapeHtml(a.agent)}" data-pid="${a.pid}">
    <div class="agent-card-row">
      <div class="agent-left">
        <div class="agent-indicator"></div>
        ${agentIcon ? `<span class="agent-icon">${agentIcon}</span>` : ''}
        <span class="agent-name">${escapeHtml(a.agent)}</span>${warnBadge}
        <span class="agent-process">${escapeHtml(a.process)}</span>
      </div>
      <div class="agent-right">
        <span class="agent-pid">PID ${a.pid}</span>
        <span class="agent-status-pill">${a.status}</span>
        <span class="risk-badge risk-${riskColor}">${riskScore}</span>
        ${sensitiveLabel}<span class="${countClass}">${countLabel}</span>
      </div>
    </div>
    <div class="agent-trust-row">
      <span class="trust-grade trust-${trustColor}">${trustGrade}</span>
      <div class="trust-bar-wrap"><div class="trust-bar-fill trust-${trustColor}" style="width:${trustScore}%"></div></div>
      <span class="trust-score-num">${trustScore}</span>
    </div>
    <div class="agent-meta-row">
      <span class="agent-last-seen">Last: ${lastSeenStr}</span>
      <span class="agent-session-dur">Session: ${sessionDurStr}</span>
      <canvas class="agent-sparkline" width="120" height="20" data-sparkline-agent="${escapeHtml(a.agent)}"></canvas>
    </div>
    <div class="agent-actions">
      <button class="btn-agent-action action-trust" data-agent="${escapeHtml(a.agent)}" data-action="trust">TRUST</button>
      <button class="btn-agent-action action-sandbox" data-agent="${escapeHtml(a.agent)}" data-action="sandbox">SANDBOX</button>
      <button class="btn-agent-action action-block" data-agent="${escapeHtml(a.agent)}" data-action="block">BLOCK</button>
      <button class="btn-analyze" data-agent="${escapeHtml(a.agent)}">ANALYZE</button>
      <button class="btn-expand" data-agent="${escapeHtml(a.agent)}" title="Behavior baseline">${isExpanded ? '\u25B2' : '\u25BC'}</button>
    </div>
    ${chainHtml}${expandedHtml}
  </div>`;
}

/** Render baseline deviation section inside an expanded agent card. @param {HTMLElement} container @param {string} agentName @param {Object} data */
function renderBaselineSection(container, agentName, data) {
  const warns = activeWarnings[agentName] || [];
  let warningHtml = '';
  if (warns.length > 0) {
    warningHtml = `<div class="baseline-warnings">${warns.map(w => `<div class="baseline-warn-line">${escapeHtml(w.message)}</div>`).join('')}</div>`;
  }
  if (data.sessionCount < 3) {
    const note = data.sessionCount === 0 ? 'No baseline data yet. Baselines require 3+ sessions.' : `Baseline building: ${data.sessionCount}/3 sessions recorded.`;
    container.innerHTML = warningHtml + `<div class="baseline-maturity-note">${note}</div>`;
    return;
  }
  const avg = data.averages, cur = data.currentSession;
  const stats = [
    [Math.round(avg.filesPerSession), 'AVG FILES/SESSION', `Current: ${cur.totalFiles}`],
    [Math.round(avg.sensitivePerSession * 10) / 10, 'AVG SENSITIVE/SESSION', `Current: ${cur.sensitiveCount}`],
    [data.sessionCount, 'SESSIONS RECORDED', `Dirs: ${cur.directoryCount}`],
    [avg.knownEndpoints.length, 'KNOWN ENDPOINTS', `Current: ${cur.endpointCount}`],
  ];
  const statsHtml = `<div class="baseline-grid">${stats.map(([val, label, cur]) =>
    `<div class="baseline-stat"><div class="baseline-stat-value">${val}</div><div class="baseline-stat-label">${label}</div><div class="baseline-stat-current">${cur}</div></div>`
  ).join('')}</div>`;
  const topDirs = avg.typicalDirectories.slice(0, 5);
  const topEps = avg.knownEndpoints.slice(0, 8);
  const none = '<div class="baseline-detail-item" style="color:#37474f">None yet</div>';
  const dirsHtml = topDirs.length > 0 ? topDirs.map(d => `<div class="baseline-detail-item">${escapeHtml(d)}</div>`).join('') : none;
  const epsHtml = topEps.length > 0 ? topEps.map(ep => `<div class="baseline-detail-item">${escapeHtml(ep)}</div>`).join('') : none;
  container.innerHTML = warningHtml + statsHtml + `<div class="baseline-details">
    <div class="baseline-detail-group"><div class="baseline-detail-title">TYPICAL DIRECTORIES</div>${dirsHtml}</div>
    <div class="baseline-detail-group"><div class="baseline-detail-title">KNOWN ENDPOINTS</div>${epsHtml}</div>
  </div>`;
}

/** Load active tab content (baseline or permissions) for an expanded agent card. @param {string} agentName @returns {Promise<void>} */
async function loadTabContent(agentName) {
  const container = document.querySelector(`.agent-tab-content[data-agent="${agentName}"]`);
  if (!container) return;
  const tab = expandedAgentTab[agentName] || 'baseline';
  if (tab === 'permissions') { renderPermissionsTab(container, agentName); return; }
  container.innerHTML = '<div class="baseline-maturity-note">Loading baseline...</div>';
  try {
    const data = await window.aegis.getAgentBaseline(agentName);
    const c2 = document.querySelector(`.agent-tab-content[data-agent="${agentName}"]`);
    if (c2) renderBaselineSection(c2, agentName, data);
  } catch (_) {}
}
