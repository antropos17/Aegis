/**
 * @file permissions.js - Agent permission rendering for card tabs and Rules tab,
 * plus protection presets (Paranoid/Strict/Balanced/Developer).
 * Depends on: state.js (PERM_CATEGORIES, PERM_LABELS, PERM_SHORT, PERM_CYCLE,
 * cachedPermissions, seenAgentsList, loadPermissionsCache),
 * helpers.js (escapeHtml, showToast).
 * @since 0.1.0
 */

// ═══ PROTECTION PRESETS ═══

/** @type {Object<string, Object<string, string>>} Preset permission configurations. */
const PROTECTION_PRESETS = {
  paranoid:  { filesystem:'block', sensitive:'block', network:'block', terminal:'block', clipboard:'block', screen:'block' },
  strict:   { filesystem:'monitor', sensitive:'block', network:'block', terminal:'block', clipboard:'monitor', screen:'monitor' },
  balanced: { filesystem:'monitor', sensitive:'monitor', network:'monitor', terminal:'monitor', clipboard:'monitor', screen:'monitor' },
  developer:{ filesystem:'allow', sensitive:'monitor', network:'allow', terminal:'allow', clipboard:'allow', screen:'allow' },
};

/**
 * Apply a named protection preset to all seen agents and persist.
 * @param {string} presetName - Preset key: 'paranoid', 'strict', 'balanced', or 'developer'.
 * @since 0.1.0
 */
function applyPreset(presetName) {
  const preset = PROTECTION_PRESETS[presetName];
  if (!preset) return;
  for (const agentName of seenAgentsList) {
    if (!cachedPermissions[agentName]) cachedPermissions[agentName] = {};
    for (const cat of PERM_CATEGORIES) {
      cachedPermissions[agentName][cat] = preset[cat];
    }
  }
  renderRulesPermissions();
  window.aegis.saveAgentPermissions(cachedPermissions);
  showToast(`Applied ${presetName.toUpperCase()} preset`, 'success');
}

// ═══ AGENT CARD PERMISSIONS TAB ═══

/**
 * Render the inline permission controls inside an agent card's PERMISSIONS tab.
 * Shows a tri-state button (ALLOW / MONITOR / BLOCK) for each permission category.
 * @param {HTMLElement} container - DOM container to render into.
 * @param {string} agentName - Agent display name.
 * @since 0.1.0
 */
function renderPermissionsTab(container, agentName) {
  // Ensure cached permissions exist for this agent
  if (!cachedPermissions[agentName]) {
    cachedPermissions[agentName] = {};
    for (const cat of PERM_CATEGORIES) cachedPermissions[agentName][cat] = 'monitor';
  }
  const perms = cachedPermissions[agentName];

  const descriptions = {
    filesystem: 'Read/write files',
    sensitive:  'Access .env, SSH keys, credentials',
    network:    'Outbound connections',
    terminal:   'Shell command execution',
    clipboard:  'Read/write clipboard',
    screen:     'Screen capture access',
  };

  container.innerHTML = `
    <div class="perm-card-grid">
      ${PERM_CATEGORIES.map(cat => {
        const state = perms[cat] || 'monitor';
        const label = state.toUpperCase();
        return `
          <div class="perm-card-row">
            <div class="perm-card-label">
              ${PERM_LABELS[cat]}
              <span class="perm-card-desc">${descriptions[cat]}</span>
            </div>
            <button class="perm-tristate-inline perm-state-${state}" data-agent="${escapeHtml(agentName)}" data-cat="${cat}">${label}</button>
          </div>`;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('.perm-tristate-inline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const current = perms[cat] || 'monitor';
      const next = PERM_CYCLE[current];
      perms[cat] = next;
      btn.textContent = next.toUpperCase();
      btn.className = `perm-tristate-inline perm-state-${next}`;
      // Persist immediately
      try {
        await window.aegis.saveAgentPermissions(cachedPermissions);
      } catch (_) {}
    });
  });
}

// ═══ RULES TAB ═══

/**
 * Render the full permissions grid in the Rules tab.
 * Loads permissions from cache, builds the agent x category matrix,
 * and attaches tri-state cycle handlers.
 * @since 0.1.0
 */
function renderRulesPermissions() {
  const permGrid = document.getElementById('rules-perm-grid');
  if (!permGrid) return;

  loadPermissionsCache().then(() => {
    if (seenAgentsList.length === 0) {
      permGrid.innerHTML = '<div class="empty-state" style="padding:10px;font-size:11px">No agents detected yet</div>';
      return;
    }

    let html = `<div class="perm-grid-header">
      <span>AGENT</span>
      ${PERM_CATEGORIES.map(c => `<span>${PERM_SHORT[c]}</span>`).join('')}
    </div>`;

    for (const agentName of seenAgentsList) {
      if (!cachedPermissions[agentName]) {
        cachedPermissions[agentName] = {};
        for (const cat of PERM_CATEGORIES) cachedPermissions[agentName][cat] = 'monitor';
      }
      const perms = cachedPermissions[agentName];

      html += `<div class="perm-grid-row">`;
      html += `<span class="perm-grid-agent">${escapeHtml(agentName)}</span>`;
      for (const cat of PERM_CATEGORIES) {
        const state = perms[cat] || 'monitor';
        const label = state === 'allow' ? 'A' : state === 'monitor' ? 'M' : 'B';
        html += `<button class="perm-tristate perm-state-${state}" data-agent="${escapeHtml(agentName)}" data-cat="${cat}">${label}</button>`;
      }
      html += `</div>`;
    }

    permGrid.innerHTML = html;

    permGrid.querySelectorAll('.perm-tristate').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const agent = btn.dataset.agent;
        const cat = btn.dataset.cat;
        const current = cachedPermissions[agent][cat] || 'monitor';
        const next = PERM_CYCLE[current];
        cachedPermissions[agent][cat] = next;
        const label = next === 'allow' ? 'A' : next === 'monitor' ? 'M' : 'B';
        btn.textContent = label;
        btn.className = `perm-tristate perm-state-${next}`;
      });
    });
  });
}

// ── Rules tab action buttons ──

document.getElementById('rules-save').addEventListener('click', async () => {
  try {
    await window.aegis.saveAgentPermissions(cachedPermissions);
    showToast('Permissions saved', 'success');
  } catch (_) {
    showToast('Failed to save permissions', 'error');
  }
});

document.getElementById('rules-reset').addEventListener('click', async () => {
  try {
    const result = await window.aegis.resetPermissionsToDefaults();
    cachedPermissions = result.permissions;
    seenAgentsList = result.seenAgents;
    renderRulesPermissions();
    showToast('Permissions reset to defaults', 'success');
  } catch (_) {
    showToast('Failed to reset permissions', 'error');
  }
});
