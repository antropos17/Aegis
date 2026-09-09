(() => {
  const O = window.Obs;
  let updateState = 'idle',
    updateBusy = false;
  const checked = (v) => (v ? 'checked' : '');
  O.renderers.settings = () =>
    `<form id="settings-form"><div class="settings-layout"><section class="panel"><div class="settings-section"><h2>${O.icon('sun')}<span>Appearance</span></h2><label class="setting"><span>Theme</span><select name="theme" id="settings-theme">${O.options(
      [
        ['dark', 'Dark'],
        ['light', 'Light'],
        ['dark-hc', 'Dark, high contrast'],
        ['light-hc', 'Light, high contrast'],
      ],
      O.settings.theme,
    )}</select></label><label class="setting range"><span>Scale <output id="scale-value">${Math.round(O.settings.scale * 100)}%</output></span><input type="range" name="scale" id="settings-scale" min="0.8" max="1.5" step="0.1" value="${O.settings.scale}"></label><label class="setting"><span>Animations<small>Radar sweep, markers and transitions</small></span><input type="checkbox" name="motion" ${checked(O.settings.motion)}></label><div class="setting"><span>Language<small>English interface</small></span><span class="badge">English</span></div></div><div class="settings-section"><h2>${O.icon('radar')}<span>Monitoring</span></h2><label class="setting range"><span>Scan interval <output id="interval-value">${O.settings.interval} s</output></span><input id="settings-interval" name="interval" type="range" min="3" max="60" value="${O.settings.interval}"></label><div class="setting"><label class="switch"><input type="checkbox" name="notifications" ${checked(O.settings.notifications)}>Notifications</label>${O.button('Test', 'test-notification', 'bell', 'type="button"')}</div><label class="setting"><span>Exclude build folders</span><input type="checkbox" name="ignoreBuild" ${checked(O.settings.ignoreBuild)}></label><label class="setting-stack">Additional exclusions<textarea name="ignored" rows="3" maxlength="10000">${O.escape(O.settings.ignored)}</textarea><small>One folder name per line</small></label><label class="setting-stack">Sensitive paths<textarea name="patterns" rows="3" maxlength="10000">${O.escape(O.settings.patterns)}</textarea><small>One regular expression per line</small></label><p id="settings-error" class="form-error" role="alert"></p></div></section><div><section class="panel"><div class="settings-section"><h2>${O.mark({ id: 'claude' })}<span>Anthropic analysis</span></h2><p class="muted">Connect Anthropic, review evidence and customize reports in the AI analysis workspace.</p><div class="toolbar">${O.button('Open AI analysis', 'open-analysis-view', 'shield', 'type="button"')}</div></div></section><section class="panel" style="margin-top:20px"><div class="settings-section"><h2>${O.icon('refresh')}<span>Updates</span></h2><div class="setting"><span>Installed version</span><span class="mono">${O.escape(O.version)}</span></div><label class="setting"><span>Check automatically<small>Demo setting</small></span><input type="checkbox" name="automaticUpdates" ${checked(O.settings.automaticUpdates)}></label><div id="update-status">${updateView()}</div></div></section><section class="panel" style="margin-top:20px"><div class="settings-section"><h2>${O.icon('settings')}<span>Configuration</span></h2><p class="muted">Export prototype settings without the API key. Imports are checked for valid format and values.</p><div class="toolbar" style="margin-top:15px">${O.button('Export', 'export-config', 'download', 'type="button"')}${O.button('Import', 'import-config', 'upload', 'type="button"')}</div></div></section><section class="panel" style="margin-top:20px"><div class="settings-section"><h2>${O.icon('keyboard')}<span>Keyboard shortcuts</span></h2><dl class="details-grid"><dt>Commands</dt><dd><kbd>Ctrl K</kbd></dd><dt>Views</dt><dd><kbd>1</kbd> — <kbd>5</kbd></dd><dt>Search</dt><dd><kbd>/</kbd></dd><dt>Theme / settings</dt><dd><kbd>T</kbd> / <kbd>S</kbd></dd><dt>Close dialog</dt><dd><kbd>Esc</kbd></dd></dl></div></section></div></div><div class="settings-save"><button class="button" type="button" data-action="cancel-settings">${O.icon('close')}Discard changes</button><button class="button primary" type="submit">${O.icon('check')}Save settings</button></div></form>`;
  function updateView() {
    const labels = {
      idle: 'No update check yet.',
      checking: 'Checking the demo scenario…',
      available: 'Demo: update available. No installation files are downloaded.',
      downloading: 'Preparing the demo package…',
      ready: 'Demo: package ready to install.',
      installed: 'Demo: installation complete. The app did not restart.',
    };
    return `<p class="muted" role="status">${labels[updateState]}</p><div class="toolbar" style="margin-top:12px">${O.button(updateState === 'checking' ? 'Checking…' : 'Check for updates', 'check-updates', 'refresh', `type="button" ${updateBusy ? 'disabled' : ''}`)}${updateState === 'available' ? O.button('Simulate download', 'download-update', 'download', 'type="button"') : ''}${updateState === 'ready' ? O.button('Simulate install', 'install-update', '', 'type="button"') : ''}</div>`;
  }
  O.bindSettings = () => {
    O.$('settings-scale').addEventListener('input', (e) => {
      O.$('scale-value').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
      document.documentElement.style.setProperty('--ui-scale', e.target.value);
    });
    O.$('settings-theme').addEventListener(
      'change',
      (e) => (document.documentElement.dataset.theme = e.target.value),
    );
    O.$('settings-interval').addEventListener(
      'input',
      (e) => (O.$('interval-value').textContent = `${e.target.value} s`),
    );
    O.$('settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        for (const p of String(f.get('patterns')).split('\n').filter(Boolean)) new RegExp(p);
      } catch {
        O.$('settings-error').textContent =
          'Invalid regular expression. Fix the pattern before saving.';
        return;
      }
      O.settings = O.sanitizeSettings({
        theme: f.get('theme'),
        scale: Number(f.get('scale')),
        interval: Number(f.get('interval')),
        notifications: f.has('notifications'),
        motion: f.has('motion'),
        ignoreBuild: f.has('ignoreBuild'),
        automaticUpdates: f.has('automaticUpdates'),
        patterns: f.get('patterns'),
        ignored: f.get('ignored'),
      });
      O.applyTheme();
      O.syncMotion();
      O.persist();
      O.logAction('settings', 'Saved prototype settings');
      O.notify('Settings saved locally. The API key was not saved.');
      O.refresh();
    });
  };
  O.actions['cancel-settings'] = () => {
    O.applyTheme();
    O.refresh();
    O.notify('Unsaved changes discarded');
  };
  O.actions['test-notification'] = () => O.notify('AEGIS test notification · demo');
  O.actions['export-config'] = () =>
    O.download(
      'aegis-config-demo.json',
      JSON.stringify(
        {
          demo: true,
          schemaVersion: 2,
          settings: O.settings,
          permissions: O.permissions,
          instancePermissions: O.instancePermissions,
          watchlist: [...O.watch],
        },
        null,
        2,
      ),
    );
  O.actions['import-config'] = () =>
    O.importJSON((data) => {
      if (!data || data.schemaVersion !== 2 || typeof data.settings !== 'object' || !data.settings)
        throw Error('Expected prototype configuration with schemaVersion: 2.');
      const s = O.sanitizeSettings(data.settings);
      for (const p of s.patterns.split('\n').filter(Boolean))
        try {
          new RegExp(p);
        } catch {
          throw Error('Configuration contains an invalid regular expression.');
        }
      const validPermissions = (source) => {
        const result = {};
        if (!source || typeof source !== 'object') return result;
        for (const [key, value] of Object.entries(source)) {
          if (
            !O.agents.some((a) => a.name === key || a.instanceId === key) ||
            !value ||
            typeof value !== 'object'
          )
            continue;
          result[key] = {};
          for (const [category, state] of Object.entries(value))
            if (
              ['filesystem', 'sensitive', 'network', 'terminal', 'clipboard', 'screen'].includes(
                category,
              ) &&
              ['allow', 'monitor', 'block'].includes(state)
            )
              result[key][category] = state;
        }
        return result;
      };
      O.settings = s;
      O.permissions = validPermissions(data.permissions);
      O.instancePermissions = validPermissions(data.instancePermissions);
      O.watch = new Set(
        Array.isArray(data.watchlist)
          ? data.watchlist.filter((name) => O.agents.some((a) => a.name === name))
          : [],
      );
      O.applyTheme();
      O.syncMotion();
      O.persist();
      O.refresh();
      O.notify('Configuration imported');
    });
  O.actions['check-updates'] = () => {
    if (updateBusy) return;
    updateBusy = true;
    updateState = 'checking';
    O.$('update-status').innerHTML = updateView();
    setTimeout(() => {
      updateBusy = false;
      updateState = 'available';
      if (O.$('update-status')) O.$('update-status').innerHTML = updateView();
    }, 900);
  };
  O.actions['download-update'] = () => {
    updateBusy = true;
    updateState = 'downloading';
    O.$('update-status').innerHTML = updateView();
    setTimeout(() => {
      updateBusy = false;
      updateState = 'ready';
      if (O.$('update-status')) O.$('update-status').innerHTML = updateView();
    }, 1100);
  };
  O.actions['install-update'] = () =>
    O.confirm(
      'Show installation complete?',
      'This is a demo scenario. App files are unchanged and the app will not restart.',
      () => {
        updateState = 'installed';
        if (O.$('update-status')) O.$('update-status').innerHTML = updateView();
        O.notify('Demo installation complete');
      },
    );
  O.actions.sensors = () => {
    const state = O.health;
    O.modal(
      'Sensor health',
      `${[
        [
          'process',
          'Processes',
          state === 'failed' ? 'FAILED' : 'HEALTHY',
          state === 'failed'
            ? 'Monitoring unavailable; agent count unknown.'
            : 'Process enumeration available.',
        ],
        ['fs-chokidar', 'File changes', 'HEALTHY', 'File change monitoring available.'],
        [
          'fs-handle',
          'File reads',
          state === 'degraded' ? 'DEGRADED' : 'HEALTHY',
          state === 'degraded' ? 'Some observations are missing.' : 'Open file handles available.',
        ],
        ['network', 'Network connections', 'HEALTHY', 'Connection snapshot available.'],
      ]
        .map(
          ([id, name, status, desc]) =>
            `<div class="health-sensor"><div><strong>${name}</strong><small class="mono">${id}</small><small>${desc}</small></div>${O.badge(status, status === 'HEALTHY' ? 'low' : status === 'FAILED' ? 'high' : 'medium')}</div>`,
        )
        .join(
          '',
        )}<div class="setting"><label for="health-scenario">Prototype scenario</label><select id="health-scenario">${O.options(
        [
          ['healthy', 'Available'],
          ['degraded', 'Partial file visibility'],
          ['failed', 'Process sensor failure'],
        ],
        state,
      )}</select></div><div class="notice">The last snapshot is kept when a sensor fails. Missing observations do not mean agents are absent.</div>`,
      '',
      'Demo diagnostics',
    );
    O.$('health-scenario').addEventListener('change', (e) => {
      O.health = e.target.value;
      O.updateHealth();
      if (O.view !== 'settings') O.refresh();
      else
        O.$('nav-agent-count').textContent =
          O.health === 'failed' ? '?' : O.agents.filter((a) => a.state !== 'stopped').length;
      O.actions.sensors();
    });
  };
  O.updateHealth = () => {
    const bad = O.health !== 'healthy',
      failed = O.health === 'failed';
    O.$('health-banner').hidden = !bad;
    O.$('health-banner').innerHTML = bad
      ? `<div class="notice warning">${O.icon('alert')}<div><strong>${failed ? 'Process sensor unavailable' : 'Partial file-read visibility'}</strong><p>${failed ? 'Showing the last snapshot. Current agent count is unknown; demo scanning is paused.' : 'fs-handle: some observations are unavailable. Other sensors continue to report events.'}</p></div><button class="text-button" data-action="sensors">Diagnostics</button></div>`
      : '';
    O.$('footer-health').textContent = failed
      ? 'FAILED · process'
      : bad
        ? 'DEGRADED · fs-handle'
        : 'Sensors available';
    O.$('sensor-caption').textContent = failed
      ? 'No process data'
      : bad
        ? 'Partial monitoring'
        : 'Monitoring available';
    O.$('footer-dot').classList.toggle('warning', bad);
    document.documentElement.classList.toggle('paused', O.paused || failed);
    O.syncMotion();
  };
})();

export {};
