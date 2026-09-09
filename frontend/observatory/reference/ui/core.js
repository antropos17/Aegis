(() => {
  const O = window.Obs;
  const paths = {
    terminal: '<path d="m4 6 5 6-5 6m8 0h8"/>',
    balance: '<path d="M12 3v18M6 21h12M4 7h16M5 7l-4 8h8L5 7Zm14 0-4 8h8l-4-8Z"/>',
    clipboard:
      '<rect x="5" y="5" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="6" rx="1"/>',
    keyboard:
      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
    sort: '<path d="M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 6-7"/>',
    agents:
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    activity: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
    network:
      '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10 8-4 7m8-7 4 7M8 18h8"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
    database:
      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/>',
    report: '<path d="M5 2h10l4 4v16H5ZM9 10h6m-6 4h6m-6 4h4"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    chart: '<path d="M3 3v18h18M7 16v-5m5 5V6m5 10V9"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1m12-12 1-1"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m7 4 14 8-14 8Z"/>',
    refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-6v6h6m-5 6a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    file: '<path d="M5 2h9l5 5v15H5Zm9 0v6h5"/>',
    folder: '<path d="M3 7V5h7l2 3h9v12H3Z"/>',
    key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-1 5 3-3"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    download: '<path d="M12 2v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
    link: '<path d="m10 7 2-2a5 5 0 0 1 7 7l-2 2m-3 3-2 2a5 5 0 0 1-7-7l2-2m1 6 8-8"/>',
    bell: '<path d="M5 17V9a7 7 0 0 1 14 0v8l2 2H3Zm5 5h4"/>',
    spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  };
  O.icon = (name) =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  O.icons = (root = document) =>
    root.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = O.icon(el.dataset.icon)));
  O.$ = (id) => document.getElementById(id);
  O.escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (x) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[x],
    );
  O.agent = (id) => O.agents.find((a) => a.id === id);
  O.num = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);
  O.time = (t) => new Date(t).toLocaleTimeString('en-US', { hour12: false });
  O.band = (r) => (r < 35 ? 'low' : r < 66 ? 'medium' : 'high');
  O.risk = (r) => `<span class="risk-value ${O.band(r)}">${r}<small>/100</small></span>`;
  O.badge = (text, kind = '') => `<span class="badge ${kind}">${O.escape(text)}</span>`;
  O.mark = (a) => {
    const images =
      a.id === 'cursor'
        ? ['dark', 'light']
            .map(
              (theme) =>
                `<img class="logo-${theme}" src="assets/agents/cursor-${theme}.svg" alt="" width="24" height="24" draggable="false" />`,
            )
            .join('')
        : `<img src="assets/agents/${a.id}.png" alt="" width="24" height="24" draggable="false" />`;
    return `<span class="agent-mark agent-logo-${a.id}" aria-hidden="true">${images}</span>`;
  };
  const actionIcons = {
    'reset-permissions': 'refresh',
    'reset-filters': 'refresh',
    'sort-dir': 'sort',
    'edit-agent': 'edit',
    'delete-agent': 'trash',
    'close-modal': 'close',
    'more-events': 'plus',
    'more-database': 'plus',
    'more-audit': 'history',
    'db-detail': 'chevron',
    'rule-detail': 'shield',
    'remove-watch': 'close',
    'install-update': 'download',
  };
  O.button = (label, action, icon = '', extra = '') => {
    const glyph = icon || actionIcons[action];
    return `<button class="button" data-action="${action}" ${extra}>${glyph ? O.icon(glyph) : ''}${label}</button>`;
  };
  O.options = (values, current) =>
    values
      .map(
        ([id, label]) =>
          `<option value="${O.escape(id)}" ${id === current ? 'selected' : ''}>${O.escape(label)}</option>`,
      )
      .join('');
  O.agentOptions = (selected) =>
    O.options([['all', 'All agents'], ...O.agents.map((a) => [a.id, a.name])], selected);
  O.empty = (message) => `<div class="empty">${O.icon('search')}<p>${O.escape(message)}</p></div>`;
  O.shortPath = (p) => p.replace('X:/Projects/', '~/').replace('C:/Users/demo/', '~/');
  O.visibleEvents = () =>
    O.events.filter(
      (e) =>
        e.timestamp >= O.baseTime + O.sequence * 1000 - O.range * 60000 - O.offset * 1000 &&
        e.timestamp <= O.baseTime + O.sequence * 1000 - O.offset * 1000,
    );
  const panelIcons = {
    'Agent radar': 'radar',
    'Agent usage': 'cpu',
    Activity: 'chart',
    Timeline: 'history',
    'Recent events': 'activity',
    'Session summary': 'report',
    Export: 'download',
    'Agent instances': 'agents',
    'Tokens and estimated cost': 'chart',
  };
  O.panelHead = (title, subtitle = '', actions = '', mark = '') => {
    const agent = O.agents.find((a) => a.name === title);
    const identity =
      mark || (agent ? O.mark(agent) : panelIcons[title] ? O.icon(panelIcons[title]) : '');
    return `<div class="panel-head"><div><h2>${identity}<span>${title}</span></h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><div class="toolbar">${actions}</div></div>`;
  };
  O.notify = (text) => {
    O.$('toast').textContent = text;
    clearTimeout(O.toastTimer);
    O.toastTimer = setTimeout(() => (O.$('toast').textContent = ''), 4000);
  };
  const feedback = new WeakMap();
  O.animate = (element) => {
    if (!element || !O.settings.motion || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const previous = feedback.get(element);
    const opacity = previous ? getComputedStyle(element).opacity : 0.72;
    previous?.cancel();
    const animation = element.animate([{ opacity }, { opacity: 1 }], {
      duration: 160,
      easing: 'ease-out',
    });
    feedback.set(element, animation);
    animation.onfinish = () => feedback.delete(element);
  };
  let lastModalBody = '';
  O.modal = (title, body, actions = '', caption = '') => {
    const d = O.$('modal');
    const wasOpen = d.open;
    const sameDetail = O.$('modal-title').textContent === title;
    const bodyElement = O.$('modal-body');
    const oldScroll = bodyElement.scrollTop;
    const sameContent = lastModalBody === body;
    const focusedData = d.contains(document.activeElement)
      ? { ...document.activeElement.dataset }
      : null;
    const focusedAction = d.contains(document.activeElement)
      ? document.activeElement.dataset.action
      : null;
    O.$('modal-title').textContent = title;
    O.$('modal-caption').textContent = caption;
    O.$('modal-body').innerHTML = body;
    O.$('modal-actions').innerHTML = actions || O.button('Close', 'close-modal');
    O.icons(d);
    if (!d.open) d.showModal();
    bodyElement.scrollTop =
      wasOpen && sameDetail && (sameContent || ['watch', 'ack'].includes(focusedAction))
        ? oldScroll
        : 0;
    lastModalBody = body;
    d.scrollTop = 0;
    if (wasOpen && focusedAction) {
      [...d.querySelectorAll('[data-action]')]
        .find((el) =>
          Object.entries(focusedData).every(([key, value]) => el.dataset[key] === value),
        )
        ?.focus({ preventScroll: true });
    }
    if (wasOpen && !d.contains(document.activeElement)) {
      const heading = O.$('modal-title');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    if (!wasOpen) {
      const target =
        bodyElement.querySelector(
          'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])',
        ) || O.$('modal-title');
      if (target.id === 'modal-title') target.tabIndex = -1;
      target.focus({ preventScroll: true });
      O.animate(d);
    }
  };
  O.actions['close-modal'] = () => O.$('modal').close();
  O.confirm = (title, body, onConfirm) => {
    O.pendingConfirm = onConfirm;
    O.modal(
      title,
      `<p class="dialog-copy">${O.escape(body)}</p>`,
      `${O.button('Cancel', 'close-modal')}<button class="button danger" data-action="confirm">Confirm</button>`,
      'Demo action',
    );
  };
  O.actions.confirm = () => {
    O.$('modal').close();
    const fn = O.pendingConfirm;
    O.pendingConfirm = null;
    fn?.();
  };
  O.download = (name, text, type = 'application/json') => {
    const blob = new Blob([text], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    O.notify(`Saved: ${name}`);
  };
  O.copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      O.notify('Copied');
    } catch {
      O.modal(
        'Copy',
        `<textarea readonly rows="3" aria-label="Text to copy">${O.escape(text)}</textarea>`,
      );
    }
  };
  O.importJSON = (handler) => {
    O.importHandler = handler;
    O.$('file-import').value = '';
    O.$('file-import').click();
  };
  O.$('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 2e6) throw Error('File exceeds 2 MB');
      await O.importHandler(JSON.parse(await f.text()));
    } catch (err) {
      O.modal(
        'Import failed',
        `<p role="alert">${O.escape(err.message || 'Invalid JSON format')}</p>`,
      );
    }
  });
  O.logAction = (type, detail) => O.auditActions.unshift({ timestamp: Date.now(), type, detail });
  O.persist = () => {
    try {
      localStorage.setItem(
        'aegis.observatory.preview.v1',
        JSON.stringify({
          settings: O.settings,
          watch: [...O.watch],
          permissions: O.permissions,
          instancePermissions: O.instancePermissions,
          preset: O.preset,
          custom: O.custom,
        }),
      );
    } catch {
      O.notify('Settings will last until this page is closed');
    }
  };
  O.sanitizeSettings = (s) => {
    const v = { ...O.settings };
    if (!s || typeof s !== 'object') return v;
    if (['dark', 'light', 'dark-hc', 'light-hc'].includes(s.theme)) v.theme = s.theme;
    for (const k of ['notifications', 'motion', 'ignoreBuild', 'automaticUpdates'])
      if (typeof s[k] === 'boolean') v[k] = s[k];
    for (const k of ['patterns', 'ignored'])
      if (typeof s[k] === 'string') v[k] = s[k].slice(0, 10000);
    if (Number.isFinite(s.scale)) v.scale = Math.min(1.5, Math.max(0.8, s.scale));
    if (Number.isFinite(s.interval)) v.interval = Math.min(60, Math.max(3, s.interval));
    return v;
  };
  try {
    const stored = JSON.parse(localStorage.getItem('aegis.observatory.preview.v1') || 'null');
    if (stored) {
      O.settings = O.sanitizeSettings(stored.settings);
      if (['paranoid', 'strict', 'balanced', 'developer'].includes(stored.preset)) {
        O.preset = stored.preset;
      }
      O.watch = new Set(
        Array.isArray(stored.watch)
          ? stored.watch.filter((x) => O.agents.some((a) => a.name === x))
          : [],
      );
      O.permissions =
        stored.permissions && typeof stored.permissions === 'object' ? stored.permissions : {};
      O.instancePermissions =
        stored.instancePermissions && typeof stored.instancePermissions === 'object'
          ? stored.instancePermissions
          : {};
      O.custom = Array.isArray(stored.custom)
        ? stored.custom
            .filter((a) => typeof a?.displayName === 'string' && Array.isArray(a.names))
            .slice(0, 500)
        : [];
    }
  } catch {}
  O.applyTheme = () => {
    document.documentElement.dataset.theme = O.settings.theme;
    document.documentElement.style.setProperty('--ui-scale', O.settings.scale);
    document.documentElement.classList.toggle('no-motion', !O.settings.motion);
  };
  O.actions.theme = () => {
    O.settings.theme = O.settings.theme.startsWith('dark') ? 'light' : 'dark';
    O.applyTheme();
    O.persist();
  };
  O.table = (headers, rows) =>
    `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  O.applyTheme();
})();

export {};
