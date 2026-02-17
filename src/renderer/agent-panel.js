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
  const anomalyScore = agentAnomalyScores[a.agent] || 0;
  const anomalyColor = getAnomalyColor(anomalyScore);
  const anomalyTooltipLines = (warns || []).map(w => w.message);
  const anomalyTooltip = anomalyTooltipLines.length > 0 ? anomalyTooltipLines.join('&#10;') : 'No anomalies detected';
  const anomalyBadge = anomalyScore > 0 ? `<span class="anomaly-badge anomaly-${anomalyColor}" title="${escapeHtml(anomalyTooltip)}">${anomalyScore}</span>` : '';
  const isExpanded = expandedAgent === a.agent;
  const chain = a.parentChain || [];
  const chainHtml = chain.length > 0 ? `<div class="agent-parent-chain">\u21B3 Launched by: ${chain.map(p => escapeHtml(p)).join(' \u2192 ')}</div>` : '';
  const dbEntry = agentDbMap[a.agent];
  const agentIcon = dbEntry ? dbEntry.icon : '';
  const pids = a.pids || [{ pid: a.pid, process: a.process }];
  const pidExtra = pids.length > 1 ? ` +${pids.length - 1}` : '';
  const processCountBadge = pids.length > 1 ? `<span class="agent-process-count">${pids.length} processes</span>` : '';
  const displayName = a.displayLabel || a.agent;
  const lastSeenTime = agentLastSeen[a.agent];
  const firstSeenTime = agentFirstSeen[a.agent];
  const lastSeenStr = lastSeenTime ? formatTime(lastSeenTime) : '--:--:--';
  const sessionDurStr = firstSeenTime ? formatDuration(Date.now() - firstSeenTime.getTime()) : '--';
  const activeTab = expandedAgentTab[a.agent] || 'processes';
  const tabDefs = [
    { key: 'processes', label: 'PROCESSES' },
    { key: 'files', label: 'FILES' },
    { key: 'network', label: 'NETWORK' },
    { key: 'baseline', label: 'BASELINE' },
    { key: 'permissions', label: 'PERMISSIONS' },
  ];
  const expandedHtml = isExpanded
    ? `<div class="agent-expanded-section" data-agent="${escapeHtml(a.agent)}">
        <div class="agent-tab-bar">
          ${tabDefs.map(t => `<button class="agent-tab${activeTab === t.key ? ' active' : ''}" data-tab="${t.key}" data-agent="${escapeHtml(a.agent)}">${t.label}</button>`).join('')}
        </div>
        <div class="agent-tab-content" data-agent="${escapeHtml(a.agent)}"></div>
      </div>` : '';
  return `<div class="${cardClass}${isSelected ? ' selected' : ''}" data-agent="${escapeHtml(a.agent)}" data-pid="${a.pid}">
    <div class="agent-card-row">
      <div class="agent-left">
        <div class="agent-indicator"></div>
        ${agentIcon ? `<span class="agent-icon">${agentIcon}</span>` : ''}
        <span class="agent-name">${escapeHtml(displayName)}</span>${warnBadge}${processCountBadge}
        <span class="agent-process">${escapeHtml(a.process)}</span>
      </div>
      <div class="agent-right">
        <span class="agent-pid">PID ${a.pid}${pidExtra}</span>
        <span class="agent-status-pill">${a.status}</span>
        <span class="risk-badge risk-${riskColor}">${riskScore}</span>${anomalyBadge}
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

/** Load active tab content for an expanded agent card. @param {string} agentName @returns {Promise<void>} */
async function loadTabContent(agentName) {
  const container = document.querySelector(`.agent-tab-content[data-agent="${agentName}"]`);
  if (!container) return;
  const tab = expandedAgentTab[agentName] || 'processes';
  if (tab === 'permissions') { renderPermissionsTab(container, agentName); return; }
  if (tab === 'processes') { renderProcessesTab(container, agentName); return; }
  if (tab === 'files') { renderFilesTab(container, agentName); return; }
  if (tab === 'network') { renderNetworkTab(container, agentName); return; }
  container.innerHTML = '<div class="baseline-maturity-note">Loading baseline...</div>';
  try {
    const data = await window.aegis.getAgentBaseline(agentName);
    const c2 = document.querySelector(`.agent-tab-content[data-agent="${agentName}"]`);
    if (c2) renderBaselineSection(c2, agentName, data);
  } catch (_) {}
}

// ═══ NEW TAB RENDERERS ═══

/** Render the PROCESSES tab — lists all PIDs with kill/suspend buttons. @param {HTMLElement} container @param {string} agentName */
function renderProcessesTab(container, agentName) {
  const pids = agentPidGroups[agentName] || [];
  if (pids.length === 0) {
    container.innerHTML = '<div class="baseline-maturity-note">No process data available.</div>';
    return;
  }
  container.innerHTML = `<div class="process-list">${pids.map(p =>
    `<div class="process-row" data-pid="${p.pid}">
      <span class="process-name">${escapeHtml(p.process)}</span>
      <span class="process-pid">PID ${p.pid}</span>
      <button class="btn-process-action btn-suspend" data-pid="${p.pid}" title="Suspend process">SUSPEND</button>
      <button class="btn-process-action btn-kill" data-pid="${p.pid}" title="Kill process">KILL</button>
    </div>`
  ).join('')}</div>`;

  container.querySelectorAll('.btn-kill').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pid = Number(btn.dataset.pid);
      const row = btn.closest('.process-row');
      try {
        const result = await window.aegis.killProcess(pid);
        if (result.success) {
          row.style.opacity = '0.3';
          row.style.pointerEvents = 'none';
          showToast(`PID ${pid} terminated`, 'warn');
        } else {
          showToast(`Failed to kill PID ${pid}: ${result.error}`, 'error');
        }
      } catch (err) { showToast(`Kill failed: ${err.message}`, 'error'); }
    });
  });

  container.querySelectorAll('.btn-suspend').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pid = Number(btn.dataset.pid);
      const isSuspended = btn.textContent === 'RESUME';
      try {
        const result = isSuspended
          ? await window.aegis.resumeProcess(pid)
          : await window.aegis.suspendProcess(pid);
        if (result.success) {
          btn.textContent = isSuspended ? 'SUSPEND' : 'RESUME';
          btn.classList.toggle('btn-suspend', isSuspended);
          btn.classList.toggle('btn-resume', !isSuspended);
          showToast(`PID ${pid} ${isSuspended ? 'resumed' : 'suspended'}`, 'warn');
        } else {
          showToast(`Failed: ${result.error}`, 'error');
        }
      } catch (err) { showToast(`Action failed: ${err.message}`, 'error'); }
    });
  });
}

/** Render the FILES tab — shows per-agent file history. @param {HTMLElement} container @param {string} agentName */
function renderFilesTab(container, agentName) {
  const events = allActivityEvents.filter(e => e.agent === agentName).slice(-50).reverse();
  if (events.length === 0) {
    container.innerHTML = '<div class="baseline-maturity-note">No file activity recorded for this agent.</div>';
    return;
  }
  container.innerHTML = `<div class="agent-file-list">${events.map(e => {
    const time = e.time ? formatTime(new Date(e.time)) : '--:--';
    const sensitiveTag = e.sensitive ? '<span class="sensitive-tag">SENSITIVE</span>' : '';
    return `<div class="agent-file-row${e.sensitive ? ' sensitive' : ''}">
      <span class="feed-time">${time}</span>
      <span class="feed-action action-${(e.action || '').toLowerCase()}">${escapeHtml(e.action || 'access')}</span>
      <span class="feed-file">${escapeHtml(e.file || e.path || '')}</span>
      ${sensitiveTag}
    </div>`;
  }).join('')}</div>`;
}

/** Render the NETWORK tab — shows per-agent connections. @param {HTMLElement} container @param {string} agentName */
function renderNetworkTab(container, agentName) {
  const conns = latestNetworkConnections.filter(c => c.agent === agentName);
  if (conns.length === 0) {
    container.innerHTML = '<div class="baseline-maturity-note">No active network connections for this agent.</div>';
    return;
  }
  container.innerHTML = `<div class="agent-net-list">${conns.map(c => {
    const domainText = c.domain || 'unknown';
    const safe = isDomainSafe(c.domain);
    const domainClass = c.flagged ? 'domain-suspicious' : (!c.domain ? 'domain-unknown' : (safe ? 'domain-safe' : 'domain-unknown'));
    return `<div class="agent-net-row">
      <span class="net-ip">${escapeHtml(c.remoteIp)}</span>
      <span class="net-port">:${c.remotePort}</span>
      <span class="net-domain ${domainClass}">${escapeHtml(domainText)}</span>
      <span class="net-state ${c.state.toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(c.state)}</span>
    </div>`;
  }).join('')}</div>`;
}
