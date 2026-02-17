/**
 * @file agent-database-crud.js
 * @description Add/edit/delete/import/export forms for the Agent Database Manager.
 * Depends on: agent-database-ui.js (customAgents, populateFilters, renderAgentDbTable,
 *   getMergedAgents, agentDatabase), helpers.js (escapeHtml, showToast).
 * @since 0.2.0
 */

// ═══ DOM REFS ═══

const agentdbModal      = document.getElementById('agentdb-modal');
const agentdbModalTitle = document.getElementById('agentdb-modal-title');

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
    const builtIn = agentDatabase.agents.find(a => a.id === existingId);
    if (builtIn) {
      agent.names = builtIn.names;
      agent.displayName = builtIn.displayName;
      agent.icon = builtIn.icon;
      agent.color = builtIn.color;
    }
  }

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
      a._custom = undefined;
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

// ═══ EVENT WIRING ═══

document.getElementById('agentdb-add').addEventListener('click', openAddModal);
document.getElementById('agentdb-import').addEventListener('click', importAgentDb);
document.getElementById('agentdb-export').addEventListener('click', exportAgentDb);
document.getElementById('agentdb-modal-close').addEventListener('click', closeAgentDbModal);
document.getElementById('agentdb-modal-save').addEventListener('click', saveAgentFromModal);

agentdbModal.addEventListener('click', (e) => {
  if (e.target === agentdbModal) closeAgentDbModal();
});
