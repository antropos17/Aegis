/** @file agent-render.js @module agent-render @description Renders agent lists, attaches event handlers, click-to-filter logic. @since v0.1.0 */

// ═══ AGENT LIST RENDERING + EVENT HANDLERS ═══

/** Render all detected agents, attach handlers, update radar glow. @param {Object[]} agents */
function renderAgents(agents) {
  lastScanEl.textContent = `Last scan: ${formatTime(new Date())}`;
  updateRadarAgents(agents);
  const aiAgents = agents.filter(a => a.category === 'ai');
  const otherAgents = agents.filter(a => a.category === 'other');
  const currentPidMap = new Map();
  for (const a of agents) currentPidMap.set(a.pid, { agent: a.agent, category: a.category });
  let enteringPids = new Set();
  const exitingAgents = [];
  if (!isFirstScan) {
    for (const [pid] of currentPidMap) { if (!previousPidMap.has(pid)) enteringPids.add(pid); }
    for (const [pid, info] of previousPidMap) { if (!currentPidMap.has(pid)) exitingAgents.push({ agent: info.agent, pid, category: info.category }); }
  }
  isFirstScan = false;
  previousPidMap = new Map(currentPidMap);
  for (const a of agents) {
    agentLastSeen[a.agent] = new Date();
    if (!agentFirstSeen[a.agent]) agentFirstSeen[a.agent] = new Date();
    if (!agentActivityBins[a.agent]) agentActivityBins[a.agent] = new Array(30).fill(0);
  }
  highestRiskScore = 0;
  if (aiAgents.length === 0) {
    agentsList.innerHTML = '<div class="empty-state">\uD83D\uDEE1 No AI agents detected. Shield is clear.</div>';
  } else {
    agentsList.innerHTML = aiAgents.map(a => {
      const rs = getRiskScore(a.agent, aiFileCounts, aiSensitiveCounts, aiSshAwsCounts, aiConfigCounts);
      if (rs > highestRiskScore) highestRiskScore = rs;
      return renderAgentCard(a, aiFileCounts, aiSensitiveCounts, aiSshAwsCounts, aiConfigCounts, 'agent-card');
    }).join('');
  }
  updateRadarGlow(highestRiskScore);
  if (otherAgents.length === 0) {
    otherAgentsList.innerHTML = '<div class="empty-state">No other agent processes detected</div>';
  } else {
    otherAgentsList.innerHTML = otherAgents.map(a =>
      renderAgentCard(a, otherFileCounts, otherSensitiveCounts, otherSshAwsCounts, otherConfigCounts, 'other-agent-card')
    ).join('');
  }
  if (enteringPids.size > 0) {
    document.querySelectorAll('.agent-card[data-pid], .other-agent-card[data-pid]').forEach(card => {
      if (enteringPids.has(Number(card.dataset.pid))) card.classList.add('process-entering');
    });
  }
  for (const ex of exitingAgents) {
    const exitCard = document.createElement('div');
    exitCard.className = (ex.category === 'ai' ? 'agent-card' : 'other-agent-card') + ' process-exiting';
    exitCard.innerHTML = `<div class="agent-card-row"><div class="agent-left"><div class="agent-indicator" style="background:#9CA3AF;box-shadow:none"></div><span class="agent-name">${escapeHtml(ex.agent)}</span><span class="agent-process">PID ${ex.pid} — exited</span></div></div>`;
    exitCard.addEventListener('animationend', () => exitCard.remove());
    (ex.category === 'ai' ? agentsList : otherAgentsList).appendChild(exitCard);
    showToast(`${ex.agent} process ended`, 'warn');
  }
  document.querySelectorAll('.agent-card, .other-agent-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedAgent = selectedAgent === card.dataset.agent ? null : card.dataset.agent;
      document.querySelectorAll('.agent-card, .other-agent-card').forEach(c => c.classList.toggle('selected', c.dataset.agent === selectedAgent));
      applyAgentFilter();
    });
  });
  document.querySelectorAll('.btn-analyze').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      openAnalysis(`AI Risk Analysis — ${btn.dataset.agent}`);
      analysisContent.innerHTML = '<div class="analysis-loading">Analyzing agent activity...</div>';
      try {
        const result = await window.aegis.analyzeAgent(btn.dataset.agent);
        if (result.success) { analysisContent.textContent = result.analysis; }
        else { analysisContent.innerHTML = ''; closeAnalysis(); showToast(result.error, 'error'); }
      } catch (err) { analysisContent.innerHTML = ''; closeAnalysis(); showToast('Analysis failed', 'error'); }
    });
  });
  document.querySelectorAll('.btn-agent-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showToast(`${btn.dataset.action.charAt(0).toUpperCase() + btn.dataset.action.slice(1)} action for ${btn.dataset.agent} — coming in v0.2`, 'warn');
    });
  });
  document.querySelectorAll('.btn-expand').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const agentName = btn.dataset.agent;
      expandedAgent = expandedAgent === agentName ? null : agentName;
      renderAgents(agents);
      if (expandedAgent === agentName) loadTabContent(agentName);
    });
  });
  document.querySelectorAll('.agent-expanded-section').forEach(s => { s.addEventListener('click', (e) => e.stopPropagation()); });
  document.querySelectorAll('.agent-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      expandedAgentTab[tabBtn.dataset.agent] = tabBtn.dataset.tab;
      tabBtn.parentElement.querySelectorAll('.agent-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabBtn.dataset.tab));
      loadTabContent(tabBtn.dataset.agent);
    });
  });
  otherAgentCountEl.textContent = otherAgents.length;
  otherPanel.style.display = (otherAgents.length === 0 && !otherFeedHasEntries) ? 'none' : '';
  document.querySelectorAll('.agent-sparkline').forEach(canvas => {
    const bins = agentActivityBins[canvas.dataset.sparklineAgent];
    if (bins) {
      const dbEntry = agentDbMap[canvas.dataset.sparklineAgent];
      drawSparkline(canvas, bins, dbEntry ? dbEntry.color : 'rgba(78, 205, 196, 0.7)');
    }
  });
}

/** Filter feed entries and network rows to show only selected agent. @returns {void} */
function applyAgentFilter() {
  const filterEntries = (container, sel) => {
    container.querySelectorAll(sel).forEach(el => {
      if (!selectedAgent) { el.classList.remove('filter-hidden'); return; }
      const agentEl = sel === '.feed-entry' ? el.querySelector('.feed-agent') : null;
      const match = sel === '.net-row' ? el.dataset.agent === selectedAgent : agentEl && agentEl.textContent === selectedAgent;
      el.classList.toggle('filter-hidden', !match);
    });
  };
  filterEntries(activityFeed, '.feed-entry');
  filterEntries(otherActivityFeed, '.feed-entry');
  filterEntries(networkList, '.net-row');
}
