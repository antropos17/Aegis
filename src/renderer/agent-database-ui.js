/**
 * @file agent-database-ui.js
 * @description Agent Database Manager table rendering, filtering, and detected
 *   agent sync for the Rules tab. CRUD operations are in agent-database-crud.js.
 * Depends on: state.js (agentDatabase, agentDbMap), helpers.js (escapeHtml, showToast).
 * @since 0.2.0
 */

// ═══ STATE ═══

/** @type {Object[]} Custom agents loaded from settings */
var customAgents = [];

/** @type {Set<string>} Currently detected agent display names */
const detectedAgentNames = new Set();

// ═══ DOM REFS ═══

const agentdbTbody    = document.getElementById('agentdb-tbody');
const agentdbSearch   = document.getElementById('agentdb-search');
const agentdbFilterCat  = document.getElementById('agentdb-filter-category');
const agentdbFilterRisk = document.getElementById('agentdb-filter-risk');
const agentdbFilterVendor = document.getElementById('agentdb-filter-vendor');
const agentdbCount    = document.getElementById('agentdb-count');

// ═══ HELPERS ═══

/**
 * Merge built-in agents with custom agents.
 * Custom agents override built-in agents with the same id.
 * @returns {Object[]} Merged array of agent objects
 */
function getMergedAgents() {
  const builtIn = (agentDatabase && agentDatabase.agents) ? agentDatabase.agents : [];
  const merged = builtIn.map(a => ({ ...a, _custom: false }));
  for (const ca of customAgents) {
    const idx = merged.findIndex(a => a.id === ca.id);
    if (idx >= 0) {
      merged[idx] = { ...ca, _custom: true };
    } else {
      merged.push({ ...ca, _custom: true });
    }
  }
  return merged;
}

/** Format category id to display label */
function formatCategory(cat) {
  const map = {
    'coding-assistant': 'Coding Assistant',
    'ai-ide': 'AI IDE',
    'cli-tool': 'CLI Tool',
    'autonomous-agent': 'Autonomous Agent',
    'desktop-agent': 'Desktop Agent',
    'browser-agent': 'Browser Agent',
    'agent-framework': 'Agent Framework',
    'security-devops': 'Security/DevOps',
    'ide-extension': 'IDE Extension',
  };
  return map[cat] || cat;
}

/** Get trust CSS class */
function trustClass(score) {
  if (score >= 65) return 'trust-high';
  if (score >= 40) return 'trust-mid';
  return 'trust-low';
}

// ═══ FILTER POPULATION ═══

/** Populate category and vendor filter dropdowns from current database */
function populateFilters() {
  const agents = getMergedAgents();
  const categories = [...new Set(agents.map(a => a.category).filter(Boolean))].sort();
  const vendors = [...new Set(agents.map(a => a.vendor).filter(Boolean))].sort();

  const catVal = agentdbFilterCat.value;
  agentdbFilterCat.innerHTML = '<option value="">All Categories</option>';
  for (const c of categories) {
    agentdbFilterCat.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(formatCategory(c))}</option>`;
  }
  agentdbFilterCat.value = catVal;

  const vendorVal = agentdbFilterVendor.value;
  agentdbFilterVendor.innerHTML = '<option value="">All Vendors</option>';
  for (const v of vendors) {
    agentdbFilterVendor.innerHTML += `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
  }
  agentdbFilterVendor.value = vendorVal;
}

// ═══ TABLE RENDERING ═══

/** Render the agent database table with current filters applied */
function renderAgentDbTable() {
  if (!agentdbTbody) return;
  const agents = getMergedAgents();
  const search = (agentdbSearch.value || '').toLowerCase().trim();
  const catFilter = agentdbFilterCat.value;
  const riskFilter = agentdbFilterRisk.value;
  const vendorFilter = agentdbFilterVendor.value;

  const filtered = agents.filter(a => {
    if (search && !a.displayName.toLowerCase().includes(search) &&
        !(a.vendor || '').toLowerCase().includes(search) &&
        !(a.description || '').toLowerCase().includes(search)) return false;
    if (catFilter && a.category !== catFilter) return false;
    if (riskFilter && a.riskProfile !== riskFilter) return false;
    if (vendorFilter && a.vendor !== vendorFilter) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const aDetected = detectedAgentNames.has(a.displayName) ? 0 : 1;
    const bDetected = detectedAgentNames.has(b.displayName) ? 0 : 1;
    if (aDetected !== bDetected) return aDetected - bDetected;
    return a.displayName.localeCompare(b.displayName);
  });

  let html = '';
  for (const agent of filtered) {
    const detected = detectedAgentNames.has(agent.displayName);
    const rowClass = detected ? 'agentdb-detected' : '';
    const statusClass = detected ? 'status-detected' : 'status-not-detected';
    const statusText = detected ? 'DETECTED' : 'NOT DETECTED';
    const trust = agent.defaultTrust || 0;
    const risk = agent.riskProfile || 'medium';
    const isCustom = agent._custom;

    html += `<tr class="${rowClass}" data-agent-id="${escapeHtml(agent.id)}">
      <td class="agentdb-icon-cell">${agent.icon || ''}</td>
      <td><span class="agentdb-name">${escapeHtml(agent.displayName)}</span>${isCustom ? '<span class="agentdb-name-custom">CUSTOM</span>' : ''}</td>
      <td>${escapeHtml(agent.vendor || '')}</td>
      <td><span class="agentdb-category">${escapeHtml(formatCategory(agent.category || ''))}</span></td>
      <td><span class="agentdb-trust ${trustClass(trust)}">${trust}</span></td>
      <td><span class="agentdb-risk risk-${risk}">${risk.toUpperCase()}</span></td>
      <td><span class="agentdb-status ${statusClass}">${statusText}</span></td>
      <td class="agentdb-actions">
        <button class="agentdb-btn-edit" data-id="${escapeHtml(agent.id)}" data-custom="${isCustom}">EDIT</button>
        ${isCustom ? `<button class="agentdb-btn-delete" data-id="${escapeHtml(agent.id)}">DELETE</button>` : ''}
      </td>
    </tr>`;
  }

  agentdbTbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-dim)">No agents match filters</td></tr>';
  agentdbCount.textContent = `${filtered.length} of ${agents.length} agents`;

  agentdbTbody.querySelectorAll('.agentdb-btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.id, btn.dataset.custom === 'true');
    });
  });
  agentdbTbody.querySelectorAll('.agentdb-btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCustomAgent(btn.dataset.id);
    });
  });
}

// ═══ DETECTED AGENTS SYNC ═══

/**
 * Update the set of detected agent names from scan results.
 * Called by renderAgents (in agent-render.js) when scan results arrive.
 * @param {Object[]} agents - Detected agents from scan
 */
function updateDetectedForDb(agents) {
  detectedAgentNames.clear();
  for (const a of agents) {
    detectedAgentNames.add(a.agent);
    if (a.displayLabel) detectedAgentNames.add(a.displayLabel);
  }
  if (currentTab === 'rules') {
    renderAgentDbTable();
  }
}

// ═══ INIT ═══

/** Full render of the agent database section */
async function renderAgentDatabase() {
  try {
    customAgents = await window.aegis.getCustomAgents();
  } catch (_) {
    customAgents = [];
  }
  populateFilters();
  renderAgentDbTable();
}

// Filter listeners
let agentdbSearchTimeout = null;
agentdbSearch.addEventListener('input', () => {
  clearTimeout(agentdbSearchTimeout);
  agentdbSearchTimeout = setTimeout(renderAgentDbTable, 200);
});
agentdbFilterCat.addEventListener('change', renderAgentDbTable);
agentdbFilterRisk.addEventListener('change', renderAgentDbTable);
agentdbFilterVendor.addEventListener('change', renderAgentDbTable);
