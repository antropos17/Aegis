(() => {
  const O = window.Obs;
  const attrib = {
    pid: ['PID confirmed', 'Connection matched to a process instance.'],
    cwd: ['Working directory match', 'Indirect match. The specific process action is unconfirmed.'],
    temporal: [
      'Time correlation',
      'Indirect match. Timing alone does not establish that the agent acted.',
    ],
    unknown: ['Unknown', 'No confirmed owner for this event.'],
  };
  O.attribution = attrib;
  O.setRadarSelection = (id) => {
    O.selected = O.agent(id)?.id || null;
    if (O.view !== 'overview') return;
    O.patch(O.$('inspector'), inspector());
    document.querySelectorAll('[data-action="select"]').forEach((button) => {
      const active = button.dataset.id === O.selected;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const open = O.$('open-selected-agent');
    if (open) open.disabled = !O.selected;
  };
  O.actions['clear-radar-selection'] = () => O.setRadarSelection(null);
  O.actions.select = (el) => {
    if (!O.agent(el.dataset.id)) return;
    O.setRadarSelection(el.dataset.id);
    if (O.view !== 'overview' || getComputedStyle(O.$('inspector')).display === 'none')
      O.actions['agent-detail'](el);
  };
  O.actions['agent-detail'] = (el) => {
    const a = O.agent(el?.dataset.id || O.selected);
    if (!a) return;
    O.setRadarSelection(a.id);
    const e = O.events.filter((e) => e.agent === a.id).slice(0, 4);
    O.modal(
      a.name,
      `<div class="agent-detail-grid"><div><div class="agent-identity">${O.mark(a)}<div><strong>${a.vendor}</strong><small>${a.state === 'active' ? 'Active' : a.state === 'suspended' ? 'Suspended' : 'Stopped'} · session ${a.minutes} min</small></div></div><dl class="details-grid"><dt>Risk</dt><dd>${O.risk(a.risk)}</dd><dt>Working directory</dt><dd>${O.pathLink(a.cwd, 'folder')}</dd><dt>Parent process</dt><dd>${O.entityLink('parent-detail', a.parent, { id: a.id }, 'cpu')}</dd><dt>Instance</dt><dd>${O.processLink(a, a, a.instanceId)}</dd><dt>CPU / RAM</dt><dd>${O.num(a.cpu)}% / ${O.num(a.memory)} MB</dd><dt>Tokens</dt><dd>${O.num(a.tokens)} ${a.tokens == null ? '· no data' : `· est. $${a.cost.toFixed(2)}`}</dd></dl><div class="toolbar">${O.button(O.watch.has(a.name) ? 'Remove from watchlist' : 'Add to watchlist', 'watch', 'eye', `data-id="${a.id}"`)}${O.button(O.ack.has(a.instanceId) ? 'Clear review' : 'Reviewed', 'ack', 'check', `data-id="${a.id}"`)}</div></div><div><h3>Process instances</h3>${[a, ...a.children].map((p, i) => `<div class="process-row"><div>${O.processLink(a, p)}<small>${i ? 'Child process' : 'Root process'} · ${O.num(p.cpu)}% / ${O.num(p.memory)} MB</small></div><div class="toolbar">${O.button('PID', 'copy-pid', 'copy', `data-pid="${p.pid}"`)}${O.button('Pause', 'suspend', 'pause', `data-id="${a.id}" data-pid="${p.pid}"`)}${O.button('Resume', 'resume', 'play', `data-id="${a.id}" data-pid="${p.pid}"`)}${O.button('Stop', 'kill', 'stop', `data-id="${a.id}" data-pid="${p.pid}"`)}</div></div>`).join('')}<h3 style="margin-top:24px">Recent events</h3>${e.map((event) => `<button class="recent-event" data-action="event" data-id="${event.id}">${O.icon(event.type === 'network' ? 'globe' : 'file')}<div><strong>${O.escape(O.shortPath(event.path))}</strong><small>${attrib[event.attribution][0]}</small></div></button>`).join('')}</div></div>`,
      `${O.button('Instance permissions', 'instance-rights', 'shield', `data-id="${a.id}"`)}${O.button('Agent analysis', 'agent-analysis', 'spark', `data-id="${a.id}"`)}`,
      'Agent instance · demo',
    );
  };
  O.actions['copy-pid'] = (el) => O.copy(el.dataset.pid);
  O.actions.watch = (el) => {
    const a = O.agent(el.dataset.id || O.selected);
    if (!a) return O.notify('Select an agent first.');
    if (O.watch.has(a.name)) O.watch.delete(a.name);
    else O.watch.add(a.name);
    O.persist();
    O.logAction('watchlist', a.name);
    O.notify(
      O.watch.has(a.name)
        ? `${a.name}: watching for new instances. No automatic blocking.`
        : `${a.name} removed from watchlist`,
    );
    if (O.$('modal').open) O.actions['agent-detail']({ dataset: { id: a.id } });
    else O.refresh();
  };
  O.actions.ack = (el) => {
    const a = O.agent(el.dataset.id || O.selected);
    if (!a) return O.notify('Select an agent first.');
    if (O.ack.has(a.instanceId)) O.ack.delete(a.instanceId);
    else O.ack.add(a.instanceId);
    O.logAction('acknowledge', a.instanceId);
    O.notify(O.ack.has(a.instanceId) ? 'Instance marked as reviewed' : 'Review cleared');
    if (O.$('modal').open) O.actions['agent-detail']({ dataset: { id: a.id } });
    else O.refresh();
  };
  for (const action of ['suspend', 'resume', 'kill'])
    O.actions[action] = (el) => {
      const a = O.agent(el.dataset.id || O.selected);
      if (!a) return O.notify('Select an agent first.');
      const pid = Number(el.dataset.pid || a.pid);
      const apply = () => {
        const state =
          action === 'suspend' ? 'suspended' : action === 'resume' ? 'active' : 'stopped';
        const target = pid === a.pid ? a : a.children.find((p) => p.pid === pid);
        if (!target || target.state === 'stopped') {
          O.notify('This demo process has already stopped');
          return;
        }
        if (target) target.state = state;
        O.logAction(action, `demo PID ${pid}`);
        O.notify(
          `Demo PID ${pid}: ${state === 'active' ? 'resumed' : state === 'suspended' ? 'suspended' : 'stopped'}`,
        );
        O.refresh();
        O.actions['agent-detail']({ dataset: { id: a.id } });
      };
      if (action === 'kill')
        O.confirm(
          `Stop ${a.name}?`,
          `Demo PID ${pid} will be marked as stopped. Real processes are unaffected.`,
          apply,
        );
      else apply();
    };
  O.actions.event = (el) => {
    const e = O.events.find((e) => e.id === el.dataset.id);
    if (!e) return;
    O.activeEvent = e.id;
    const a = O.agent(e.agent);
    O.modal(
      e.path.split(/[\\/]/).pop(),
      `<div class="toolbar">${O.badge({ low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }[e.severity], e.severity)}${O.badge({ file: 'File', config: 'Configuration', network: 'Network' }[e.type])}${e.fp ? O.badge('False positive') : ''}</div><dl class="details-grid"><dt>Time</dt><dd class="mono">${O.time(e.timestamp)}</dd><dt>Agent</dt><dd>${O.agentLink(e.agent)}</dd><dt>Action</dt><dd>${{ modified: 'Modified', created: 'Created', connect: 'Connection' }[e.action]}</dd><dt>Resource</dt><dd>${O.pathLink(e.path, e.type === 'network' ? 'network' : 'file')}</dd><dt>Attribution ${O.help('Confirmed PID evidence links a process instance. Directory or timing matches are indirect and do not prove that the agent acted.')}</dt><dd>${attrib[e.attribution][0]}</dd><dt>Evidence</dt><dd>${attrib[e.attribution][1]}</dd><dt>Rule</dt><dd>${e.rule || 'No sensitive-path rule matched'}</dd></dl><div class="notice">${O.icon('file')}File contents are not displayed. This event contains metadata only.</div>`,
      `${O.button('Copy path', 'copy-event', 'copy', `data-id="${e.id}"`)}${O.button('Show location', 'reveal-event', 'folder', `data-id="${e.id}"`)}${e.severity !== 'low' ? O.button(e.fp ? 'Clear false positive' : 'False positive', 'false-positive', 'check', `data-id="${e.id}"`) : ''}`,
      'Event · demo data',
    );
  };
  O.actions['copy-event'] = (el) =>
    O.copy(O.events.find((e) => e.id === (el?.dataset.id || O.activeEvent)).path);
  O.actions['reveal-event'] = (el) => {
    const e = O.events.find((e) => e.id === (el?.dataset.id || O.activeEvent));
    return O.actions['resource-detail']({
      dataset: {
        path: e.path,
        kind: e.type === 'network' ? 'network' : 'file',
      },
    });
  };
  O.actions['false-positive'] = (el) => {
    const e = O.events.find((e) => e.id === (el?.dataset.id || O.activeEvent));
    e.fp = !e.fp;
    O.logAction('false-positive', e.path);
    O.actions.event({ dataset: { id: e.id } });
    O.notify(e.fp ? 'Demo event marked as a false positive' : 'Review cleared');
    O.refresh();
  };
  function inspector() {
    const a = O.agent(O.selected);
    if (!a) return O.emptyInspector();
    const ev = O.events.find((e) => e.agent === a.id),
      count = O.events.filter((e) => e.agent === a.id).length;
    return `<div class="inspector-title"><span>Selected instance</span><button data-action="agent-detail" data-id="${a.id}" aria-label="Open agent details">${O.icon('chevron')}</button></div><div class="agent-identity">${O.mark(a)}<div>${O.entityLink('agent-detail', a.name, { id: a.id })}<small class="mono">${O.processLink(a, a, `PID ${a.pid}`)} · ${a.minutes} min</small></div></div><div class="inspector-risk"><div><span>Risk</span>${O.badge(a.risk < 35 ? 'Low' : a.risk < 66 ? 'Medium' : 'High', O.band(a.risk))}</div>${O.risk(a.risk)}</div><div class="risk-track"><i style="transform:scaleX(${a.risk / 100});background:var(--${a.risk < 35 ? 'green' : a.risk < 66 ? 'amber' : 'red'})"></i></div><div class="inspector-metrics"><div><strong>${O.num(a.cpu)}%</strong><span>CPU</span></div><div><strong>${a.memory}</strong><span>RAM, MB</span></div><div><strong>${count}</strong><span>events</span></div></div><div class="finding ${ev.severity === 'low' ? 'ordinary' : ''}"><div>${O.icon(ev.type === 'network' ? 'network' : 'file')}<span>${ev.severity === 'low' ? 'Latest action' : 'Needs review'}</span><time>${O.time(ev.timestamp)}</time></div>${O.entityLink('event', O.shortPath(ev.path), { id: ev.id })}<p>${ev.type === 'network' ? 'Outbound process connection.' : 'File change detected.'}</p></div><div class="attribution-line">${O.icon('link')}<span>${attrib[ev.attribution][0]}. ${attrib[ev.attribution][1]}</span></div><div class="toolbar">${O.button('Review', 'event', '', `data-id="${ev.id}"`)}${O.button('Process', 'agent-detail', '', `data-id="${a.id}"`)}</div><div class="inspector-secondary"><button class="text-button" data-action="watch" data-id="${a.id}">${O.icon('eye')}${O.watch.has(a.name) ? 'Watching' : 'Monitor'}</button><button class="text-button" data-action="ack" data-id="${a.id}">${O.icon('check')}${O.ack.has(a.instanceId) ? 'Reviewed' : 'Mark reviewed'}</button></div>`;
  }
  function radar() {
    return `<div class="radar-workspace"><aside class="radar-info radar-info-left" id="radar-info-left" aria-label="Agent activity, left">${O.radarInfo('left')}</aside><div class="radar-stage" data-layer="${O.layer}" tabindex="0" role="group" aria-label="Agent radar. Click empty space or press Escape to clear selection."><div class="radar-coordinate">${O.health === 'failed' ? 'Sensor unavailable' : 'Processes visible'}<br>Local monitoring</div><div class="radar-dial"><div class="dial-grid"></div><div class="dial-ticks"></div><div class="dial-sweep"></div><span class="bearing north">0°</span><span class="bearing east">90°</span><span class="bearing south">180°</span><span class="bearing west">270°</span><div class="radar-center">${O.icon('shield')}</div>${O.agents
      .filter((a) => a.state !== 'stopped')
      .map((a) => {
        const rad = (a.angle * Math.PI) / 180,
          dist = 22 + a.risk * 0.24;
        const x = 50 + Math.sin(rad) * dist,
          y = 50 - Math.cos(rad) * dist;
        return `<button class="radar-blip ${x < 50 ? 'label-left' : ''} ${O.band(a.risk)} ${a.state === 'suspended' ? 'is-suspended' : ''}" style="left:${x}%;top:${y}%;--echo-delay:${a.angle / 40 - 9}s" data-action="select" data-id="${a.id}" aria-label="${a.name}, risk ${a.risk}" aria-pressed="${O.selected === a.id}"><span class="blip-dot">${O.mark(a)}</span><span class="blip-meta"><strong>${a.name}</strong><small>${a.risk} / 100</small></span></button>`;
      })
      .join(
        '',
      )}</div>${O.layer === 'radar' ? '' : `<svg class="radar-links" aria-hidden="true" data-routes="pending">${[4, 5].map((duration, i) => `<g><path/><circle r="2" opacity="0"><animateMotion dur="${duration}s" repeatCount="indefinite" /><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.88;1" dur="${duration}s" repeatCount="indefinite"/></circle></g>`).join('')}</svg><button class="resource-node" data-route-index="0" data-action="${O.layer === 'files' ? 'latest' : 'open-network'}">${O.layer === 'files' ? '.env.local' : 'api.anthropic.com'}</button><button class="resource-node" data-route-index="1" data-action="${O.layer === 'files' ? 'latest' : 'open-network'}">${O.layer === 'files' ? 'src/main/' : 'api.openai.com'}</button>`}<div class="radar-scale">Farther from center:<br>higher risk</div></div><aside class="radar-info radar-info-right" id="radar-info-right" aria-label="Agent activity, right">${O.radarInfo('right')}</aside></div>`;
  }
  O.renderers.overview = () => {
    const ev = O.visibleEvents(),
      active = O.agents.filter((a) => a.state !== 'stopped');
    return `<div class="summary"><div class="summary-stat"><span>Agents</span><strong>${O.health === 'failed' ? '—' : active.length}<small>${O.health === 'failed' ? 'no data' : 'online'}</small></strong><p>${active.length + active.reduce((s, a) => s + a.children.length, 0)} processes in snapshot</p></div><div class="summary-stat"><span>Average risk</span><strong>${active.length ? Math.round(active.reduce((s, a) => s + a.risk, 0) / active.length) : '—'}<small>/100</small></strong><p>Highest: ${active.length ? Math.max(...active.map((a) => a.risk)) : '—'}</p></div><div class="summary-stat"><span>Events / min</span><strong>${O.events.filter((e) => e.timestamp > O.baseTime + O.sequence * 1000 - 60000).length}</strong><p>${ev.length} in ${O.range} min</p></div><button class="summary-stat attention" data-action="sensitive"><span>Sensitive events</span><strong>${ev.filter((e) => e.rule && !e.fp).length}</strong><p>File events</p></button><div class="summary-stat"><span>Connections</span><strong>${O.network.length}</strong><p>${O.network.filter((n) => n.classification === 'unknown').length} unknown</p></div><div class="summary-stat"><span>Tokens</span><strong>80.9<small>k</small></strong><p>Est. $1.16 · 2 sources</p></div></div><div class="overview-grid"><section class="panel radar-panel">${O.panelHead(
      'Agent radar',
      'Risk and active instances',
      `<div class="segmented" aria-label="Radar layer">${[
        ['radar', 'Radar'],
        ['files', 'Files'],
        ['network', 'Network'],
      ]
        .map(
          ([id, label]) =>
            `<button data-action="layer" data-id="${id}" aria-pressed="${O.layer === id}">${O.icon({ radar: 'radar', files: 'folder', network: 'network' }[id])}${label}</button>`,
        )
        .join('')}</div>`,
    )}<div id="radar-body">${radar()}</div><div class="radar-bottom"><div class="radar-legend"><span class="low"><i></i>Low 0–34</span><span class="medium"><i></i>Medium 35–65</span><span class="high"><i></i>High 66–100</span></div><button id="open-selected-agent" data-action="agent-detail" ${O.selected ? '' : 'disabled'}>Open selected agent</button></div><div class="scan-progress" id="scan-progress"></div></section><aside class="panel inspector" id="inspector">${inspector()}</aside></div>${O.renderDashboard('overview')}<div class="overview-bottom"><section class="panel timeline-panel">${O.panelHead('Timeline', '', `<span class="filter-count" id="timeline-count">${ev.length} events</span>`)}<div id="timeline-body">${O.renderTimeline()}</div><div class="timeline-controls"><label>Range<select id="timeline-range">${O.options(
      [
        ['5', '5 min'],
        ['15', '15 min'],
        ['60', '1 hour'],
      ],
      String(O.range),
    )}</select></label><input type="range" id="timeline-offset" aria-label="Timeline offset in seconds" min="0" max="900" value="${O.offset}" step="15"><button class="text-button" data-action="now">Jump to now</button></div></section><section class="panel recent-panel">${O.panelHead('Recent events', '', `<button class="text-button" data-view="events">Event log ${O.icon('chevron')}</button>`)}<div id="recent-list">${O.recent()}</div></section></div>`;
  };
  O.recent = () =>
    O.events
      .slice(0, 3)
      .map(
        (e) =>
          `<button class="recent-event" data-action="event" data-id="${e.id}">${O.icon(e.type === 'network' ? 'globe' : 'file')}<div><strong>${O.escape(e.path.split(/[\\/]/).pop())}</strong><small>${O.agent(e.agent)?.name || 'Unattributed'}</small></div><time>${O.time(e.timestamp)}</time></button>`,
      )
      .join('');
  O.actions.layer = (el) => {
    O.layer = el.dataset.id;
    O.patch(O.$('radar-body'), radar());
    document
      .querySelectorAll('[data-action=layer]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    O.syncMotion();
    O.observeRadar();
  };
  O.actions.latest = (el) => {
    const code = el?.textContent?.includes('src/main/');
    const event = O.events.find((e) => e.path.endsWith(code ? '/scan-loop.js' : '/.env.local'));
    if (event) O.actions.event({ dataset: { id: event.id } });
  };
  O.actions['open-network'] = () => O.navigate('network');
  O.actions.now = () => {
    O.offset = 0;
    O.updateTimeline();
  };
  O.actions.sensitive = () => {
    O.filters.severity = 'attention';
    O.filters.type = 'sensitive';
    O.filters.eventAgent = 'all';
    O.filters.search = '';
    O.navigate('events');
  };
  O.bindOverview = () => {
    O.$('radar-body').addEventListener('click', (event) => {
      if (
        event.target.closest('.radar-stage') &&
        !event.target.closest('button, a, input, select')
      ) {
        O.setRadarSelection(null);
      }
    });
    O.$('radar-body').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        O.setRadarSelection(null);
      }
    });
    O.$('timeline-body')?.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const ranges = [5, 15, 60];
        O.range =
          ranges[Math.max(0, Math.min(2, ranges.indexOf(O.range) + (event.deltaY > 0 ? 1 : -1)))];
        O.updateTimeline();
      },
      { passive: false },
    );
    O.$('timeline-range')?.addEventListener('change', (e) => {
      O.range = Number(e.target.value);
      O.updateTimeline();
    });
    O.$('timeline-offset')?.addEventListener('input', (e) => {
      O.offset = Number(e.target.value);
      O.updateTimeline();
    });
  };
  O.updateTimeline = () => {
    O.patch(O.$('timeline-body'), O.renderTimeline());
    O.$('timeline-count').textContent = `${O.visibleEvents().length} events`;
    O.$('timeline-range').value = String(O.range);
    O.$('timeline-offset').value = String(O.offset);
    document.querySelector('.summary-stat:nth-child(3) p').textContent =
      `${O.visibleEvents().length} in ${O.range} min`;
    document.querySelector('.summary-stat.attention strong').textContent = O.visibleEvents().filter(
      (e) => e.rule && !e.fp,
    ).length;
  };
})();

export {};
