(() => {
  const O = window.Obs,
    F = O.filters;
  let eventLimit = 40,
    sort = 'risk',
    descending = true;
  O.filteredEvents = () =>
    O.events.filter(
      (e) =>
        (F.eventAgent === 'all' ||
          (F.eventAgent === 'unattributed' ? !e.agent : e.agent === F.eventAgent)) &&
        (F.type === 'all' || (F.type === 'sensitive' ? Boolean(e.rule) : e.type === F.type)) &&
        (F.severity === 'all' ||
          (F.severity === 'attention'
            ? e.severity !== 'low' && !e.fp
            : e.severity === F.severity)) &&
        `${e.path} ${O.agent(e.agent)?.name || ''}`.toLowerCase().includes(F.search.toLowerCase()),
    );
  const eventRow = (e) =>
    `<tr><td class="mono">${O.time(e.timestamp)}</td><td>${e.agent ? `<button class="table-agent" data-action="agent-detail" data-id="${e.agent}">${O.mark(O.agent(e.agent))}${O.agent(e.agent).name}</button>` : O.badge('Unknown')}</td><td><span class="event-type">${O.icon(e.type === 'network' ? 'globe' : e.type === 'config' ? 'settings' : 'file')}${{ connect: 'Connection', modified: 'Modified', created: 'Created' }[e.action]}</span></td><td><button class="event-resource" data-action="event" data-id="${e.id}" title="${O.escape(e.path)}">${O.escape(O.shortPath(e.path))}</button></td><td>${O.badge(e.fp ? 'FP' : { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }[e.severity], e.fp ? '' : e.severity)}</td><td>${O.attribution[e.attribution][0]}</td></tr>`;
  function eventTable() {
    const all = O.filteredEvents(),
      items = all.slice(0, eventLimit);
    let html;
    if (F.group) {
      const keys = [...new Set(items.map((e) => e.agent))];
      html = keys
        .map(
          (key) =>
            `<section class="panel" style="margin-bottom:15px">${O.panelHead(O.agent(key)?.name || 'Unattributed', `${all.filter((e) => e.agent === key).length} events`)}${O.table(['Time', 'Agent', 'Action', 'Resource', 'Severity', 'Attribution'], items.filter((e) => e.agent === key).map(eventRow))}</section>`,
        )
        .join('');
    } else
      html = `<section class="panel">${O.table(['Time', 'Agent', 'Action', 'Resource', 'Severity', 'Attribution'], items.map(eventRow))}</section>`;
    return `${all.length ? html : O.empty('No events match these filters. Reset filters to see all activity.')}<div class="pagination"><span>${Math.min(eventLimit, all.length)} of ${all.length}</span>${all.length > eventLimit ? O.button('Show more', 'more-events') : ''}</div>`;
  }
  O.renderers.events = () =>
    `<div class="filterbar"><label class="search-field">${O.icon('search')}<input id="event-search" type="search" aria-label="Find event" placeholder="Path or agent" value="${O.escape(F.search)}"></label><label>Agent<select id="event-agent">${O.agentOptions(F.eventAgent)}<option value="unattributed" ${F.eventAgent === 'unattributed' ? 'selected' : ''}>Unattributed</option></select></label><label>Type<select id="event-type">${O.options(
      [
        ['all', 'All'],
        ['file', 'Files'],
        ['config', 'Configuration files'],
        ['network', 'Network'],
        ['sensitive', 'Sensitive events'],
      ],
      F.type,
    )}</select></label><label>Severity<select id="event-severity">${O.options(
      [
        ['all', 'All'],
        ['attention', 'Needs review'],
        ['critical', 'Critical'],
        ['high', 'High'],
        ['medium', 'Medium'],
        ['low', 'Low'],
      ],
      F.severity,
    )}</select></label><label><input id="event-group" type="checkbox" ${F.group ? 'checked' : ''}>Group by agent</label>${O.button('Reset', 'reset-filters')}${O.button('CSV', 'export-filtered', 'download')}</div><div id="event-table">${eventTable()}</div>`;
  O.actions['more-events'] = () => {
    eventLimit += 40;
    O.$('event-table').innerHTML = eventTable();
  };
  O.updateEventTable = () => {
    const container = O.$('event-table');
    if (container && !container.contains(document.activeElement) && !container.matches(':hover')) {
      container.innerHTML = eventTable();
    }
  };
  O.actions['reset-filters'] = () => {
    Object.assign(F, {
      eventAgent: 'all',
      type: 'all',
      severity: 'all',
      search: '',
      group: false,
    });
    eventLimit = 40;
    O.refresh();
  };
  O.bindEvents = () => {
    for (const [id, key] of [
      ['event-search', 'search'],
      ['event-agent', 'eventAgent'],
      ['event-type', 'type'],
      ['event-severity', 'severity'],
      ['event-group', 'group'],
    ])
      O.$(id).addEventListener(id === 'event-search' ? 'input' : 'change', (e) => {
        F[key] = key === 'group' ? e.target.checked : e.target.value;
        eventLimit = 40;
        O.$('event-table').innerHTML = eventTable();
      });
  };
  const classLabels = {
    safe: 'Allowlisted',
    unknown: 'Unknown',
    flagged: 'Not allowlisted',
  };
  O.filteredNetwork = () =>
    O.network
      .filter(
        (n) =>
          (F.netClass === 'all' || n.classification === F.netClass) &&
          (F.netAgent === 'all' || n.agent === F.netAgent),
      )
      .sort((a, b) =>
        String(F.netSort === 'agent' ? O.agent(a.agent).name : a[F.netSort] || a.ip).localeCompare(
          String(F.netSort === 'agent' ? O.agent(b.agent).name : b[F.netSort] || b.ip),
        ),
      );
  function networkTable() {
    const items = O.filteredNetwork();
    return items.length
      ? O.table(
          ['Agent', 'Domain / IP', 'Port', 'State', 'Classification', 'Evidence'],
          items.map(
            (n) =>
              `<tr><td><button class="table-agent" data-action="agent-detail" data-id="${n.agent}">${O.mark(O.agent(n.agent))}${O.agent(n.agent).name}</button></td><td>${O.entityLink('network-detail', n.domain || n.ip, { index: O.network.indexOf(n) }, 'globe')}${n.domain ? `<div class="faint mono">${O.entityLink('network-detail', n.ip, { index: O.network.indexOf(n) })}</div>` : ''}</td><td class="mono">${n.port}</td><td class="mono">${n.state}</td><td>${O.badge(classLabels[n.classification], n.classification === 'safe' ? 'low' : n.classification === 'flagged' ? 'medium' : '')}</td><td><button class="text-button" data-action="network-detail" data-index="${O.network.indexOf(n)}">Address verification ${O.icon('chevron')}</button></td></tr>`,
          ),
        )
      : O.empty('No connections match these filters.');
  }
  O.renderers.network = () =>
    `<div class="notice">${O.icon('network')}Address classification and agent risk are separate assessments. An unknown hostname does not imply a threat. All addresses shown are demo data.</div><div class="filterbar"><label>Agent<select id="net-agent">${O.agentOptions(F.netAgent)}</select></label><label>Classification<select id="net-class">${O.options([['all', 'All classes'], ...Object.entries(classLabels)], F.netClass)}</select></label><label>Sort by<select id="net-sort">${O.options(
      [
        ['agent', 'By agent'],
        ['domain', 'By domain'],
        ['classification', 'By classification'],
      ],
      F.netSort,
    )}</select></label><span class="spacer"></span><span class="filter-count">${O.network.length} connections in snapshot</span></div><section class="panel" id="network-table">${networkTable()}</section>`;
  O.bindNetwork = () => {
    for (const [id, key] of [
      ['net-agent', 'netAgent'],
      ['net-class', 'netClass'],
      ['net-sort', 'netSort'],
    ])
      O.$(id).addEventListener('change', (e) => {
        F[key] = e.target.value;
        O.$('network-table').innerHTML = networkTable();
      });
  };
  O.actions['network-detail'] = (el) => {
    const n = O.network[Number(el.dataset.index)];
    O.modal(
      n.domain || n.ip,
      `<dl class="details-grid"><dt>Agent</dt><dd>${O.agentLink(n.agent)}</dd><dt>Process</dt><dd>${O.processLink(O.agent(n.agent))}</dd><dt>Address</dt><dd>${O.pathLink(`${n.ip}:${n.port}`, 'network')}</dd><dt>State</dt><dd class="mono">${n.state}</dd><dt>Classification</dt><dd>${classLabels[n.classification]}</dd><dt>Evidence</dt><dd>${n.reason}</dd><dt>Attribution</dt><dd>Confirmed by process instance</dd></dl>`,
      '',
      'Network connection · demo',
    );
  };
  function agentRows(query = '') {
    return O.agents
      .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
      .sort(
        (a, b) =>
          (sort === 'name' ? a.name.localeCompare(b.name) : (a[sort] || 0) - (b[sort] || 0)) *
          (descending ? -1 : 1),
      )
      .map(
        (a) =>
          `<tr class="agent-instance-row"><td><button class="table-agent" data-action="agent-detail" data-id="${a.id}">${O.mark(a)}<span><strong>${a.name}</strong></span></button><div class="mono">${O.processLink(a)}</div></td><td>${O.badge(a.state === 'active' ? 'Active' : a.state === 'suspended' ? 'Pause' : 'Stopped', a.state === 'active' ? 'low' : '')}</td><td>${O.risk(a.risk)}</td><td class="mono">${O.num(a.cpu)}%</td><td class="mono">${O.num(a.memory)} MB</td><td class="mono">${a.files}</td><td class="mono">${a.connections}</td><td class="mono">${O.num(a.tokens)}</td><td>${a.cost == null ? 'No data' : `$${a.cost.toFixed(2)}`}</td><td class="mono">${O.time(O.events.find((e) => e.agent === a.id)?.timestamp || O.baseTime)}</td><td><button class="text-button" data-action="agent-detail" data-id="${a.id}">Open ${O.icon('chevron')}</button></td></tr>`,
      );
  }
  function agentTable(query = '') {
    const rows = agentRows(query);
    return rows.length
      ? O.table(
          [
            'Agent',
            'Status',
            `Risk ${O.help('Risk score from 0 to 100. This is an assessment of observed activity, not a probability of compromise.')}`,
            `CPU ${O.help('Current CPU usage for this process instance, as a percentage of total capacity.')}`,
            `RAM ${O.help('Current memory usage for this process instance, in megabytes.')}`,
            'Files',
            'Network',
            'Tokens',
            'Cost',
            'Latest event',
            '',
          ],
          rows,
        )
      : O.empty('No agents found.');
  }
  O.renderers.agents = () =>
    `<div class="filterbar"><label class="search-field">${O.icon('search')}<input id="agent-search" type="search" placeholder="Find agent" aria-label="Find agent"></label><label>Sort by<select id="agent-sort">${O.options(
      [
        ['risk', 'Risk'],
        ['name', 'Name'],
        ['cpu', 'CPU'],
        ['memory', 'RAM'],
        ['files', 'Files'],
        ['connections', 'Network'],
      ],
      sort,
    )}</select></label>${O.button(descending ? 'Descending' : 'Ascending', 'sort-dir')}<span class="spacer"></span>${O.button('Watchlist', 'watchlist', 'eye')}</div><section class="panel" id="agent-table">${agentTable()}</section><div class="notice" style="margin-top:18px">${O.icon('cpu')}Usage is per process instance. A dash means no measurement is available. Token data is available for Claude Code and Codex; costs are estimates.</div>`;
  O.bindAgents = () => {
    O.$('agent-search').addEventListener(
      'input',
      (e) => (O.$('agent-table').innerHTML = agentTable(e.target.value)),
    );
    O.$('agent-sort').addEventListener('change', (e) => {
      sort = e.target.value;
      O.$('agent-table').innerHTML = agentTable(O.$('agent-search').value);
    });
  };
  O.actions['sort-dir'] = (el) => {
    descending = !descending;
    if (O.view === 'agents') {
      O.$('agent-table').innerHTML = agentTable(O.$('agent-search').value);
      el.innerHTML = `${O.icon('sort')}${descending ? 'Descending' : 'Ascending'}`;
    } else O.refresh();
  };
  O.actions.watchlist = () =>
    O.modal(
      'Watchlist',
      `<div class="notice">${O.icon('eye')}Notifications follow the agent name, including new PIDs. No automatic blocking.</div><div class="watch-list">${O.watch.size ? [...O.watch].map((name) => `<div class="watch-row">${O.agents.some((a) => a.name === name) ? O.agentLink(O.agents.find((a) => a.name === name).id) : O.escape(name)}${O.button('Remove', 'remove-watch', '', `data-name="${O.escape(name)}"`)}</div>`).join('') : O.empty('Your watchlist is empty. Add an agent from its details.')}</div>`,
    );
  O.actions['remove-watch'] = (el) => {
    O.watch.delete(el.dataset.name);
    O.persist();
    O.actions.watchlist();
  };
  O.renderers.stats = () =>
    `${O.renderDashboard('stats')}<div class="filterbar"><h2>Agent instances</h2><span class="spacer"></span><label>Sort by<select id="stats-sort">${O.options(
      [
        ['risk', 'Risk'],
        ['name', 'Name'],
        ['files', 'File activity'],
        ['connections', 'Connections'],
        ['cpu', 'CPU'],
      ],
      sort,
    )}</select></label>${O.button(descending ? 'Descending' : 'Ascending', 'sort-dir')}</div><section class="panel">${agentTable()}</section><div style="margin-top:18px"><section class="panel">${O.panelHead('Tokens and estimated cost', 'From supported agent logs')}${O.table(
      ['Source', 'Tokens', 'Estimate'],
      O.agents.map(
        (a) =>
          `<tr><td>${O.agentLink(a.id)}</td><td class="mono">${O.num(a.tokens)}</td><td>${a.cost == null ? 'No data' : `$${a.cost.toFixed(2)}`}</td></tr>`,
      ),
    )}<div class="notice" style="margin:15px">AEGIS resource usage is shown separately in the footer.</div></section></div>`;
  O.bindStats = () =>
    O.$('stats-sort').addEventListener('change', (e) => {
      sort = e.target.value;
      O.refresh();
    });
})();

export {};
