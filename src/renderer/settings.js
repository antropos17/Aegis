/** @file settings.js @module settings @description Export handlers, settings panel open/close/save, pattern management, permissions grid. @since v0.1.0 */

// ═══ EXPORT BUTTONS ═══

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true; exportBtn.textContent = 'EXPORTING...';
  try {
    const result = await window.aegis.exportLog();
    if (result.success) showToast(`Exported ${result.eventCount} events to ${result.path}`, 'success');
    else showToast('Export cancelled', '');
  } catch (err) { showToast('Export failed', 'error'); }
  exportBtn.disabled = false; exportBtn.textContent = 'EXPORT JSON';
});

exportCsvBtn.addEventListener('click', async () => {
  exportCsvBtn.disabled = true; exportCsvBtn.textContent = 'EXPORTING...';
  try {
    const result = await window.aegis.exportCsv();
    if (result.success) showToast(`Exported ${result.eventCount} entries to ${result.path}`, 'success');
    else showToast('Export cancelled', '');
  } catch (err) { showToast('CSV export failed', 'error'); }
  exportCsvBtn.disabled = false; exportCsvBtn.textContent = 'EXPORT CSV';
});

reportBtn.addEventListener('click', async () => {
  reportBtn.disabled = true; reportBtn.textContent = 'GENERATING...';
  try {
    const result = await window.aegis.generateReport();
    if (result.success) showToast('Report opened in browser', 'success');
  } catch (err) { showToast('Report generation failed', 'error'); }
  reportBtn.disabled = false; reportBtn.textContent = 'GENERATE REPORT';
});

// ═══ SETTINGS PANEL ═══

/** Open settings overlay and populate form fields. @returns {Promise<void>} */
async function openSettings() {
  settingsOverlay.classList.remove('hidden');
  const s = await window.aegis.getSettings();
  settingInterval.value = s.scanIntervalSec;
  settingIntervalVal.textContent = s.scanIntervalSec + 's';
  settingNotifications.checked = s.notificationsEnabled;
  settingStartMinimized.checked = s.startMinimized;
  settingAutoStart.checked = s.autoStartWithWindows;
  settingApiKey.value = s.anthropicApiKey || '';
  currentPatterns = [...(s.customSensitivePatterns || [])];
  renderPatterns();
}

/** Close settings overlay. @returns {void} */
function closeSettings() { settingsOverlay.classList.add('hidden'); }

/** Render custom sensitive-pattern list inside settings. @returns {void} */
function renderPatterns() {
  if (currentPatterns.length === 0) {
    patternsList.innerHTML = '<div class="empty-state" style="padding:6px;font-size:11px">No custom patterns</div>';
    return;
  }
  patternsList.innerHTML = currentPatterns.map((p, i) =>
    `<div class="pattern-item"><span>${escapeHtml(p)}</span><button class="btn-pattern-remove" data-idx="${i}">&times;</button></div>`
  ).join('');
  patternsList.querySelectorAll('.btn-pattern-remove').forEach(btn => {
    btn.addEventListener('click', () => { currentPatterns.splice(parseInt(btn.dataset.idx, 10), 1); renderPatterns(); });
  });
}

/** Render per-agent permissions grid in settings panel. @returns {void} */
function renderSettingsPermissions() {
  const permGrid = document.getElementById('perm-grid');
  if (!permGrid) return;
  if (seenAgentsList.length === 0) {
    permGrid.innerHTML = '<div class="empty-state" style="padding:10px;font-size:11px">No agents detected yet</div>';
    return;
  }
  let html = `<div class="perm-grid-header"><span>AGENT</span>${PERM_CATEGORIES.map(c => `<span>${PERM_SHORT[c]}</span>`).join('')}</div>`;
  for (const agentName of seenAgentsList) {
    if (!cachedPermissions[agentName]) {
      cachedPermissions[agentName] = {};
      for (const cat of PERM_CATEGORIES) cachedPermissions[agentName][cat] = 'monitor';
    }
    const perms = cachedPermissions[agentName];
    html += `<div class="perm-grid-row"><span class="perm-grid-agent">${escapeHtml(agentName)}</span>`;
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
      const next = PERM_CYCLE[cachedPermissions[btn.dataset.agent][btn.dataset.cat] || 'monitor'];
      cachedPermissions[btn.dataset.agent][btn.dataset.cat] = next;
      btn.textContent = next === 'allow' ? 'A' : next === 'monitor' ? 'M' : 'B';
      btn.className = `perm-tristate perm-state-${next}`;
    });
  });
}

// ── Settings event handlers ──
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });
settingInterval.addEventListener('input', () => { settingIntervalVal.textContent = settingInterval.value + 's'; });

patternAddBtn.addEventListener('click', () => {
  const val = patternInput.value.trim();
  if (!val) return;
  try { new RegExp(val); } catch (_) { showToast('Invalid regex pattern', 'error'); return; }
  currentPatterns.push(val);
  patternInput.value = '';
  renderPatterns();
});
patternInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') patternAddBtn.click(); });

settingsSave.addEventListener('click', async () => {
  const currentSettings = await window.aegis.getSettings();
  const newSettings = {
    scanIntervalSec: parseInt(settingInterval.value, 10),
    notificationsEnabled: settingNotifications.checked,
    customSensitivePatterns: [...currentPatterns],
    startMinimized: settingStartMinimized.checked,
    autoStartWithWindows: settingAutoStart.checked,
    anthropicApiKey: settingApiKey.value.trim(),
    darkMode: currentSettings.darkMode || false,
  };
  try {
    await window.aegis.saveSettings(newSettings);
    showToast('Settings saved', 'success');
    closeSettings();
    updateFooterInterval();
  } catch (err) { showToast('Failed to save settings', 'error'); }
});
