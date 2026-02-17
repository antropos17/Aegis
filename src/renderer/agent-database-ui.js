/**
 * @file agent-database-ui.js - Agent Database Manager UI for the Rules tab.
 * Renders a searchable, filterable table of all agents (built-in + custom),
 * with add/edit/delete/import/export capabilities.
 * Depends on: state.js (agentDatabase, agentDbMap), helpers.js (escapeHtml, showToast).
 * @since 0.2.0
 */

// ═══ STATE ═══

/** @type {Object[]} Custom agents loaded from settings */
let customAgents = [];

/** @type {Set<string>} Currently detected agent display names */
const detectedAgentNames = new Set();

// ═══ DOM REFS ═══

const agentdbTbody    = document.getElementById('agentdb-tbody');
const agentdbSearch   = document.getElementById('agentdb-search');
const agentdbFilterCat  = document.getElementById('agentdb-filter-category');
const agentdbFilterRisk = document.getElementById('agentdb-filter-risk');
const agentdbFilterVendor = document.getElementById('agentdb-filter-vendor');
const agentdbCount    = document.getElementById('agentdb-count');
const agentdbModal    = document.getElementById('agentdb-modal');
const agentdbModalTitle = document.getElementById('agentdb-modal-title');

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

  // Sort: detected first, then alphabetical
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

  // Attach event listeners
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

// ═══ MODAL ═══

/** Clear all form fields */
function clearForm() {
  document.getElementById('agentdb-f-name').value = '';
  document.getElementById('agentdb-f-patterns').value = '';
  document.getElementById('agentdb-f-vendor').value = '';
  document.getElementById('agentdb-f-category').value = 'coding-assistant';
  document.getElementById('agentdb-f-trust').value = '50';
  document.getElementById('agentdb-f-risk').value = 'medium';
  document.getElementById('agentdb-f-domains').value = '';
  document.getElementById('agentdb-f-desc').value = '';
  document.getElementById('agentdb-f-website').value = '';
  document.getElementById('agentdb-f-id').value = '';
  document.getElementById('agentdb-f-builtin').value = 'false';
}

/** Open the add modal */
function openAddModal() {
  clearForm();
  agentdbModalTitle.textContent = 'Add Custom Agent';
  document.getElementById('agentdb-f-name').disabled = false;
  document.getElementById('agentdb-f-patterns').disabled = false;
  agentdbModal.classList.remove('hidden');
}

/** Open the edit modal for an existing agent */
function openEditModal(agentId, isCustom) {
  clearForm();
  const agents = getMergedAgents();
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;

  agentdbModalTitle.textContent = isCustom ? 'Edit Custom Agent' : 'Edit Agent';
  document.getElementById('agentdb-f-name').value = agent.displayName || '';
  document.getElementById('agentdb-f-name').disabled = !isCustom;
  document.getElementById('agentdb-f-patterns').value = (agent.names || []).join(', ');
  document.getElementById('agentdb-f-patterns').disabled = !isCustom;
  document.getElementById('agentdb-f-vendor').value = agent.vendor || '';
  document.getElementById('agentdb-f-category').value = agent.category || 'coding-assistant';
  document.getElementById('agentdb-f-trust').value = agent.defaultTrust || 50;
  document.getElementById('agentdb-f-risk').value = agent.riskProfile || 'medium';
  document.getElementById('agentdb-f-domains').value = (agent.knownDomains || []).join(', ');
  document.getElementById('agentdb-f-desc').value = agent.description || '';
  document.getElementById('agentdb-f-website').value = agent.website || '';
  document.getElementById('agentdb-f-id').value = agent.id;
  document.getElementById('agentdb-f-builtin').value = isCustom ? 'false' : 'true';

  agentdbModal.classList.remove('hidden');
}

/** Close the modal */
function closeAgentDbModal() {
  agentdbModal.classList.add('hidden');
}

/** Save from modal (add or edit) */
async function saveAgentFromModal() {
  const name = document.getElementById('agentdb-f-name').value.trim();
  const patternsRaw = document.getElementById('agentdb-f-patterns').value.trim();
  if (!name || !patternsRaw) {
    showToast('Name and process patterns are required', 'error');
    return;
  }

  const patterns = patternsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const existingId = document.getElementById('agentdb-f-id').value;
  const isBuiltinEdit = document.getElementById('agentdb-f-builtin').value === 'true';

  const agent = {
    id: existingId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    names: patterns,
    displayName: name,
    vendor: document.getElementById('agentdb-f-vendor').value.trim() || 'Custom',
    category: document.getElementById('agentdb-f-category').value,
    icon: '',
    color: '#888888',
    defaultTrust: parseInt(document.getElementById('agentdb-f-trust').value, 10) || 50,
    website: document.getElementById('agentdb-f-website').value.trim(),
    description: document.getElementById('agentdb-f-desc').value.trim(),
    knownDomains: document.getElementById('agentdb-f-domains').value.split(',').map(s => s.trim()).filter(Boolean),
    knownPorts: [443],
    configPaths: [],
    parentEditors: [],
    riskProfile: document.getElementById('agentdb-f-risk').value,
  };

  if (isBuiltinEdit) {
    // For built-in agents, save as a custom override (only trust, risk, domains editable)
    const builtIn = agentDatabase.agents.find(a => a.id === existingId);
    if (builtIn) {
      agent.names = builtIn.names;
      agent.displayName = builtIn.displayName;
      agent.icon = builtIn.icon;
      agent.color = builtIn.color;
    }
  }

  // Update or add in custom agents
  const idx = customAgents.findIndex(a => a.id === agent.id);
  if (idx >= 0) {
    customAgents[idx] = agent;
  } else {
    customAgents.push(agent);
  }

  await window.aegis.saveCustomAgents(customAgents);
  closeAgentDbModal();
  populateFilters();
  renderAgentDbTable();
  showToast(`Agent "${agent.displayName}" saved`, 'success');
}

/** Delete a custom agent */
async function deleteCustomAgent(agentId) {
  const agent = customAgents.find(a => a.id === agentId);
  if (!agent) return;
  customAgents = customAgents.filter(a => a.id !== agentId);
  await window.aegis.saveCustomAgents(customAgents);
  populateFilters();
  renderAgentDbTable();
  showToast(`Agent "${agent.displayName}" deleted`, 'success');
}

// ═══ IMPORT / EXPORT ═══

async function exportAgentDb() {
  try {
    const result = await window.aegis.exportAgentDatabase();
    if (result.success) showToast('Agent database exported', 'success');
  } catch (_) {
    showToast('Export failed', 'error');
  }
}

async function importAgentDb() {
  try {
    const result = await window.aegis.importAgentDatabase();
    if (!result.success) return;
    const imported = result.agents || [];
    let added = 0;
    for (const a of imported) {
      if (!a.id || !a.displayName) continue;
      a._custom = undefined; // clean
      const idx = customAgents.findIndex(c => c.id === a.id);
      if (idx >= 0) {
        customAgents[idx] = a;
      } else {
        customAgents.push(a);
      }
      added++;
    }
    if (added > 0) {
      await window.aegis.saveCustomAgents(customAgents);
      populateFilters();
      renderAgentDbTable();
      showToast(`Imported ${added} agent(s)`, 'success');
    } else {
      showToast('No valid agents found in file', 'error');
    }
  } catch (_) {
    showToast('Import failed', 'error');
  }
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
  // Re-render only if the rules tab is visible
  if (currentTab === 'rules') {
    renderAgentDbTable();
  }
}

// ═══ INIT + EVENT WIRING ═══

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

// Button listeners
document.getElementById('agentdb-add').addEventListener('click', openAddModal);
document.getElementById('agentdb-import').addEventListener('click', importAgentDb);
document.getElementById('agentdb-export').addEventListener('click', exportAgentDb);
document.getElementById('agentdb-modal-close').addEventListener('click', closeAgentDbModal);
document.getElementById('agentdb-modal-save').addEventListener('click', saveAgentFromModal);

// Filter listeners (debounced search)
let agentdbSearchTimeout = null;
agentdbSearch.addEventListener('input', () => {
  clearTimeout(agentdbSearchTimeout);
  agentdbSearchTimeout = setTimeout(renderAgentDbTable, 200);
});
agentdbFilterCat.addEventListener('change', renderAgentDbTable);
agentdbFilterRisk.addEventListener('change', renderAgentDbTable);
agentdbFilterVendor.addEventListener('change', renderAgentDbTable);

// Close modal on backdrop click
agentdbModal.addEventListener('click', (e) => {
  if (e.target === agentdbModal) closeAgentDbModal();
});
