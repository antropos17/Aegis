(() => {
  const O = window.Obs;
  const labels = {
    overview: 'Monitoring',
    agents: 'Agents',
    events: 'Events',
    network: 'Network',
    rules: 'Rules & permissions',
    database: 'Agent catalog',
    analysis: 'AI analysis',
    reports: 'Reports',
    audit: 'Audit',
    stats: 'Statistics',
    settings: 'Settings',
  };
  let commands = [],
    commandIndex = 0,
    clockTick = 0,
    scanTick = 0;
  O.refresh = () => {
    O.syncMotion?.();
    const content = O.$('content');
    content.innerHTML = O.renderers[O.view]();
    O.icons(content);
    ({
      overview: O.bindOverview,
      agents: O.bindAgents,
      events: O.bindEvents,
      network: O.bindNetwork,
      rules: O.bindRules,
      database: O.bindDatabase,
      analysis: O.bindAnalysis,
      audit: O.bindAudit,
      stats: O.bindStats,
      settings: O.bindSettings,
    })[O.view]?.();
    const pageTitle = O.$('page-title');
    const viewIcon = document.querySelector(`.nav[data-view="${O.view}"] [data-icon]`)?.dataset
      .icon;
    pageTitle.innerHTML = `${O.icon(viewIcon || 'monitor')}<span>${O.escape(labels[O.view])}</span>`;
    O.$('nav-agent-count').textContent =
      O.health === 'failed' ? '?' : O.agents.filter((a) => a.state !== 'stopped').length;
    O.bindDashboard?.();
    O.decorateAgentFilters();
    O.syncMotion();
    O.observeRadar();
  };
  O.navigate = (view) => {
    if (!labels[view]) return;
    if (O.view === view) return;
    if (O.view === 'settings' && view !== 'settings') O.applyTheme();
    O.view = view;
    O.$('crumb').textContent = labels[view];
    O.$('page-title').textContent = labels[view];
    document.title = `AEGIS — ${labels[view]}`;
    document.querySelectorAll('.nav[data-view]').forEach((el) => {
      const active = el.dataset.view === view;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    O.refresh();
    O.$('main').scrollTo({ top: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  O.syncMotion = () => {
    const frozen =
      O.paused ||
      O.health === 'failed' ||
      !O.settings.motion ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.hidden;
    document.querySelectorAll('.radar-links').forEach((svg) => {
      if (frozen) svg.pauseAnimations?.();
      else svg.unpauseAnimations?.();
    });
    document.documentElement.classList.toggle(
      'paused',
      O.paused || O.health === 'failed' || document.hidden,
    );
    O.syncRadarClock(frozen);
    if (!O.settings.motion || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document
        .getAnimations()
        .filter((animation) => !animation.animationName)
        .forEach((animation) => animation.finish());
    }
  };
  O.actions.pause = () => {
    O.paused = !O.paused;
    O.$('pause').innerHTML =
      `${O.icon(O.paused ? 'play' : 'pause')}<span>${O.paused ? 'Resume' : 'Pause'}</span>`;
    O.$('pause').setAttribute('aria-pressed', String(O.paused));
    O.$('live-state').innerHTML =
      `${O.icon(O.paused ? 'pause' : 'activity')}${O.paused ? 'Paused' : 'Demo stream'}`;
    O.syncMotion();
    O.notify(O.paused ? 'Demo stream and animations paused' : 'Demo stream resumed');
  };
  function appendDemo() {
    if (O.health === 'failed') return;
    const active = O.agents.filter((a) => a.state === 'active');
    if (!active.length) return;
    const a = active[scanTick % active.length],
      t = O.templates.find((t) => t[0] === a.id && t[2] === 'low') || O.templates[2];
    const e = {
      id: `demo-live-${Date.now()}-${scanTick}`,
      agent: a.id,
      type: t[1],
      severity: t[2],
      action: t[3],
      path: t[4],
      attribution: t[5],
      rule: null,
      timestamp: O.baseTime + O.sequence * 1000,
      fp: false,
    };
    O.events.unshift(e);
    O.events = O.events.slice(0, 1000);
    scanTick++;
    O.$('scan-ms').textContent = `${112 + (scanTick % 17)} ms`;
    if (O.view === 'overview') {
      O.updateRadarInfo();
      const x = O.$('recent-list');
      if (x && !x.matches(':hover') && !x.contains(document.activeElement)) {
        O.patch(x, O.recent());
        O.animate(x.firstElementChild);
      }
      if (!O.offset && !O.$('timeline-body').contains(document.activeElement)) {
        O.patch(O.$('timeline-body'), O.renderTimeline());
        O.$('timeline-count').textContent = `${O.visibleEvents().length} events`;
      }
      const count = document.querySelector('.summary-stat:nth-child(3) strong');
      if (count) {
        count.textContent = O.events.filter(
          (e) => e.timestamp > O.baseTime + O.sequence * 1000 - 60000,
        ).length;
        O.animate(count);
        document.querySelector('.summary-stat:nth-child(3) p').textContent =
          `${O.visibleEvents().length} in ${O.range} min`;
      }
    }
    if (O.view === 'events') O.updateEventTable?.();
    O.updateDashboard?.();
  }
  O.actions.scan = () => {
    if (O.health === 'failed') {
      O.notify('Process sensor unavailable: scan returned no result');
      return;
    }
    O.sequence++;
    appendDemo();
    const p = O.$('scan-progress');
    if (p) {
      p.classList.remove('scanning');
      void p.offsetWidth;
      p.classList.add('scanning');
    }
    O.notify(
      `Demo scan: ${O.agents.filter((a) => a.state !== 'stopped').length} agents in snapshot`,
    );
  };
  function commandList() {
    const all = [
      ...Object.entries(labels).map(([id, label]) => ({
        label,
        group: 'View',
        glyph: O.icon(
          document.querySelector(`.nav[data-view="${id}"] [data-icon]`)?.dataset.icon || 'monitor',
        ),
        run: () => O.navigate(id),
      })),
      ...O.agents.map((a) => ({
        label: a.name,
        group: `PID ${a.pid}`,
        glyph: O.mark(a),
        run: () => O.actions['agent-detail']({ dataset: { id: a.id } }),
      })),
      { label: 'Toggle theme', group: 'Appearance', run: O.actions.theme },
      {
        label: O.paused ? 'Resume monitoring' : 'Pause monitoring',
        group: 'Stream',
        run: O.actions.pause,
      },
      {
        label: 'Suspend selected process',
        group: 'Demo',
        run: () => O.actions.suspend({ dataset: { id: O.selected } }),
      },
      {
        label: 'Stop selected process',
        group: 'Demo',
        run: () => O.actions.kill({ dataset: { id: O.selected } }),
      },
      { label: 'Export JSON', group: 'File', run: O.actions['export-json'] },
      { label: 'Export CSV', group: 'File', run: O.actions['export-csv'] },
      { label: 'Export HTML', group: 'File', run: O.actions['export-html'] },
      { label: 'ZIP archive', group: 'File', run: O.actions['export-zip'] },
      { label: 'Watchlist', group: 'Agents', run: O.actions.watchlist },
      {
        label: 'Sensor health',
        group: 'Diagnostics',
        run: O.actions.sensors,
      },
      {
        label: 'Threat analysis',
        group: 'Reports',
        run: O.actions['open-analysis-view'],
      },
    ];
    const q = O.$('command-search').value.toLowerCase();
    commands = all.filter((c) => c.label.toLowerCase().includes(q));
    commandIndex = Math.min(commandIndex, Math.max(commands.length - 1, 0));
    O.$('command-results').innerHTML = commands.length
      ? commands
          .map(
            (c, i) =>
              `<button class="command-option ${i === commandIndex ? 'selected' : ''}" data-action="execute-command" data-index="${i}">${c.glyph || O.icon({ Appearance: 'sun', Stream: 'activity', Demo: 'cpu', File: 'download', Agents: 'eye', Diagnostics: 'shield', Reports: 'report' }[c.group] || 'chevron')}<span>${O.escape(c.label)}</span><small>${c.group}</small></button>`,
          )
          .join('')
      : O.empty('No commands found.');
  }
  O.actions.commands = () => {
    const d = O.$('commands');
    if (d.open) {
      d.close();
      return;
    }
    O.$('command-search').value = '';
    commandIndex = 0;
    commandList();
    d.showModal();
    O.$('command-search').focus();
  };
  O.actions['execute-command'] = (el) => {
    const cmd = commands[Number(el.dataset.index)];
    if (!cmd) return;
    O.$('commands').close();
    cmd.run();
  };
  O.$('command-search').addEventListener('input', () => {
    commandIndex = 0;
    commandList();
  });
  O.$('commands').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      commandIndex =
        (commandIndex + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) %
        Math.max(commands.length, 1);
      commandList();
      O.$('command-results').children[commandIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
    if (e.key === 'Enter' && document.activeElement === O.$('command-search')) {
      e.preventDefault();
      O.actions['execute-command']({ dataset: { index: commandIndex } });
    }
  });
  document.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      O.navigate(view.dataset.view);
      return;
    }
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled) O.actions[el.dataset.action]?.(el);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!O.$('modal').open) O.actions.commands();
      return;
    }
    if (O.$('commands').open || O.$('modal').open) return;
    const input =
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) ||
      document.activeElement.isContentEditable;
    const tab = ['overview', 'events', 'rules', 'reports', 'stats'][Number(e.key) - 1];
    if (tab && (!input || e.ctrlKey)) {
      e.preventDefault();
      O.navigate(tab);
      return;
    }
    if (input) return;
    if (e.key.toLowerCase() === 's') O.navigate('settings');
    if (e.key.toLowerCase() === 't') O.actions.theme();
    if (e.key === '/') {
      e.preventDefault();
      const focusSearch = () => document.querySelector('#content input[type=search]')?.focus();
      if (!document.querySelector('#content input[type=search]'))
        Promise.resolve(O.navigate('events')).then(focusSearch);
      else focusSearch();
    }
  });
  document.addEventListener('visibilitychange', O.syncMotion);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', O.syncMotion);
  setInterval(() => {
    if (O.paused || O.health === 'failed' || document.hidden) return;
    O.sequence++;
    clockTick++;
    const seconds = 9258 + O.sequence;
    O.$('session-clock').textContent = [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    if (clockTick % O.settings.interval === 0) appendDemo();
  }, 1000);
  O.$('version').textContent = O.version.split('-')[0];
  document.querySelectorAll('.nav[data-view]').forEach((button) => {
    button.setAttribute('aria-label', labels[button.dataset.view]);
    button.setAttribute('title', labels[button.dataset.view]);
  });
  O.icons();
  O.refresh();
  O.updateHealth();
})();

export {};
