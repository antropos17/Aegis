(() => {
  const O = window.Obs;
  const agentFilters = ['event-agent', 'net-agent', 'chart-agent', 'analysis-agent'];
  O.decorateAgentFilters = () => {
    for (const id of agentFilters) {
      const select = O.$(id);
      if (!select) continue;
      let wrapper = select.closest('.agent-select-identity');
      if (!wrapper) {
        wrapper = document.createElement('span');
        wrapper.className = 'agent-select-identity';
        const mark = document.createElement('span');
        mark.className = 'agent-filter-mark';
        mark.setAttribute('aria-hidden', 'true');
        select.before(wrapper);
        wrapper.append(mark, select);
      }
      const agent = O.agent(select.value);
      wrapper.querySelector('.agent-filter-mark').innerHTML = agent
        ? O.mark(agent)
        : O.icon('agents');
    }
  };
  document.addEventListener('change', (event) => {
    if (agentFilters.includes(event.target.id)) O.decorateAgentFilters();
  });
  O.entityLink = (action, label, data = {}, icon = '') =>
    `<button class="entity-link" data-action="${action}" ${Object.entries(data)
      .map(([key, value]) => `data-${key}="${O.escape(value)}"`)
      .join(
        ' ',
      )} title="${O.escape(label)} · Open details">${icon ? O.icon(icon) : ''}<span>${O.escape(label)}</span></button>`;
  O.agentLink = (id) => {
    const a = O.agent(id);
    return a
      ? `<button class="table-agent" data-action="agent-detail" data-id="${a.id}" title="Open ${O.escape(a.name)} · process and activity">${O.mark(a)}<span>${O.escape(a.name)}</span></button>`
      : 'Unattributed';
  };
  O.pathLink = (path, kind = 'file') =>
    O.entityLink(
      'resource-detail',
      path,
      { path, kind },
      kind === 'network' ? 'globe' : kind === 'folder' ? 'folder' : 'file',
    );
  O.processLink = (a, p = a, label = `${p.pid} · ${p.process}`) =>
    O.entityLink('process-detail', label, { id: a.id, pid: p.pid }, 'cpu');
  O.catalogMark = (a) => {
    const entry = window.AegisCatalogIcons?.[a.id];
    if (entry?.existing) return O.mark({ id: entry.existing });
    if (entry?.file)
      return `<span class="agent-mark catalog-logo${entry.invertDark ? ' logo-adaptive' : ''}" aria-hidden="true"><img class="${entry.lightFile ? 'logo-dark' : ''}" src="${O.escape(entry.file)}" alt="" width="24" height="24" loading="lazy" draggable="false">${entry.lightFile ? `<img class="logo-light" src="${O.escape(entry.lightFile)}" alt="" width="24" height="24" loading="lazy" draggable="false">` : ''}</span>`;
    return `<span class="agent-mark logo-unavailable" title="${a.custom ? 'Custom agent' : 'Original logo unavailable'}">${O.icon('agents')}</span>`;
  };
  O.websiteLink = (website) => {
    try {
      const url = new URL(website);
      if (url.protocol !== 'https:') return 'Not available';
      return `<a class="entity-link" href="${O.escape(url.href)}" target="_blank" rel="noopener noreferrer" title="Open official website in a new tab">${O.icon('globe')}<span>${O.escape(url.hostname)}</span>${O.icon('arrow')}</a>`;
    } catch {
      return 'Not available';
    }
  };
  O.help = (text) =>
    `<button class="mini-help" data-action="explain" data-help="${O.escape(text)}" aria-label="${O.escape(text)}" title="${O.escape(text)}">?</button>`;
  const hint = document.createElement('div');
  hint.id = 'entity-hint';
  hint.className = 'entity-hint';
  hint.setAttribute('popover', 'auto');
  hint.setAttribute('role', 'tooltip');
  let hintOwner;
  const hideHint = () => {
    if (hint.matches(':popover-open')) hint.hidePopover();
    hintOwner?.removeAttribute('aria-describedby');
    hintOwner = null;
  };
  O.actions.explain = (el) => {
    const wasOpen = hintOwner === el && hint.matches(':popover-open');
    hideHint();
    if (wasOpen) return;
    (el.closest('dialog') || document.body).append(hint);
    hint.textContent = el.dataset.help;
    hintOwner = el;
    el.setAttribute('aria-describedby', hint.id);
    hint.showPopover();
    const rect = el.getBoundingClientRect();
    hint.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - hint.offsetWidth - 12))}px`;
    hint.style.top = `${Math.max(12, rect.bottom + hint.offsetHeight + 12 < innerHeight ? rect.bottom + 8 : rect.top - hint.offsetHeight - 8)}px`;
  };
  document.addEventListener(
    'click',
    (event) => {
      if (!event.target.closest('.mini-help, .entity-hint')) hideHint();
    },
    true,
  );
  document.addEventListener('scroll', hideHint, true);
  window.addEventListener('resize', hideHint);
  O.actions['copy-value'] = (el) => O.copy(el.dataset.value);
  const normalize = (value) => value.replace(/\\/g, '/').replace(/\/$/, '');
  const parentPath = (value) => {
    const path = normalize(value),
      index = path.lastIndexOf('/');
    return index > 0 ? path.slice(0, index + 1) : null;
  };
  O.actions['resource-detail'] = (el) => {
    const path = el.dataset.path,
      kind = el.dataset.kind || 'file';
    const key = normalize(path),
      parent = kind === 'network' ? null : parentPath(path);
    const matches = O.events.filter(
      (e) =>
        normalize(e.path) === key || (kind === 'folder' && normalize(e.path).startsWith(key + '/')),
    );
    const connections =
      kind === 'network'
        ? O.network.filter((n) =>
            [n.domain, n.ip, `${n.domain}:${n.port}`, `${n.ip}:${n.port}`].includes(path),
          )
        : [];
    const agents = [
      ...new Set(
        [
          ...matches.map((e) => e.agent),
          ...connections.map((n) => n.agent),
          ...O.agents.filter((a) => normalize(a.cwd) === key).map((a) => a.id),
        ].filter(Boolean),
      ),
    ];
    const records = matches
      .slice(0, 30)
      .map(
        (e) =>
          `<button class="recent-event" data-action="event" data-id="${e.id}" title="Open recorded event">${O.icon(e.type === 'network' ? 'globe' : 'file')}<div><strong>${O.escape(O.shortPath(e.path))}</strong><small>${O.escape(O.agent(e.agent)?.name || 'Unattributed')} · ${O.time(e.timestamp)}</small></div>${O.icon('chevron')}</button>`,
      )
      .join('');
    return O.modal(
      kind === 'folder' ? 'Folder' : kind === 'network' ? 'Network resource' : 'File location',
      `<dl class="details-grid"><dt>${kind === 'network' ? 'Address' : 'Path'}</dt><dd><code>${O.escape(path)}</code></dd>${parent ? `<dt>Parent folder</dt><dd>${O.pathLink(parent, 'folder')}</dd>` : ''}<dt>Agents</dt><dd class="entity-stack">${agents.map(O.agentLink).join('') || 'No associated agent in this snapshot'}</dd><dt>Recorded events</dt><dd>${matches.length}</dd></dl>${connections.length ? `<h3>Connections</h3><div class="entity-stack">${connections.map((n) => O.entityLink('network-detail', `${n.domain || n.ip}:${n.port}`, { index: O.network.indexOf(n) }, 'network')).join('')}</div>` : ''}<h3>Related activity${matches.length > 30 ? ' · latest 30' : ''}</h3><div class="entity-events">${records || O.empty('No recorded activity for this location.')}</div><p class="entity-note">Demo metadata. File contents and local folders are not accessed. Catalog paths may be relative to a workspace or home directory.</p>`,
      O.button(
        'Copy ' + (kind === 'network' ? 'address' : 'path'),
        'copy-value',
        'copy',
        `data-value="${O.escape(path)}"`,
      ),
      'Resource details',
    );
  };
  O.actions['process-detail'] = (el) => {
    const a = O.agent(el.dataset.id);
    const p = a && [a, ...a.children].find((p) => p.pid === Number(el.dataset.pid));
    if (!p) return O.notify('This process is unavailable in the current snapshot.');
    return O.modal(
      p.process,
      `<dl class="details-grid"><dt>Agent</dt><dd>${O.agentLink(a.id)}</dd><dt>PID ${O.help('A PID identifies a running process. It can be reused after that process exits.')}</dt><dd class="mono">${p.pid}</dd><dt>Instance</dt><dd class="mono">${O.escape(p.instanceId || 'Child instance identity is not recorded in this demo')}</dd><dt>Parent</dt><dd>${p === a ? O.entityLink('parent-detail', a.parent, { id: a.id }, 'cpu') : O.processLink(a)}</dd><dt>Working directory</dt><dd>${p === a ? O.pathLink(a.cwd, 'folder') : 'Not recorded for this child process'}</dd><dt>CPU / RAM</dt><dd>${O.num(p.cpu)}% / ${O.num(p.memory)} MB</dd><dt>State</dt><dd>${O.escape(p.state || 'active')}</dd></dl>`,
      O.button('Copy PID', 'copy-value', 'copy', `data-value="${p.pid}"`),
      'Process snapshot · demo',
    );
  };
  O.actions['parent-detail'] = (el) => {
    const a = O.agent(el.dataset.id);
    return O.modal(
      'Parent process chain',
      `<p class="dialog-copy mono">${O.escape(a.parent)}</p><p class="entity-note">Parent PIDs and resource measurements are not recorded in this demo.</p><h3>Child process</h3>${O.processLink(a)}`,
    );
  };
  O.actions['signature-detail'] = (el) => {
    const a = O.dbEntries().find((a) => a.id === el.dataset.id);
    if (!a) return;
    const matches = O.agents.flatMap((owner) =>
      [owner, ...owner.children]
        .filter((p) => p.process.toLowerCase() === el.dataset.signature.toLowerCase())
        .map((p) => O.processLink(owner, p)),
    );
    return O.modal(
      el.dataset.signature,
      `<p class="dialog-copy">Process-name signature used to recognize ${O.escape(a.displayName)}.</p>${O.entityLink('db-detail', a.displayName, { id: a.id }, 'database')}<h3>Matching processes</h3><div class="entity-stack">${matches.join('') || 'No exact process-name match in this snapshot.'}</div>`,
      '',
      'Catalog signature',
    );
  };
})();

export {};
