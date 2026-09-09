(() => {
  const O = window.Obs;
  function activity() {
    const end = O.baseTime + O.sequence * 1000,
      start = end - 300000;
    const rows = O.agents.map((agent) => {
      const events = O.events.filter(
        (e) => e.agent === agent.id && e.timestamp > start && e.timestamp <= end,
      );
      const bins = Array(10).fill(0);
      events.forEach((e) => bins[Math.min(9, Math.floor((e.timestamp - start) / 30000))]++);
      return { agent, events, bins };
    });
    return { rows, maximum: Math.max(1, ...rows.flatMap((row) => row.bins)) };
  }
  O.radarInfo = (side) => {
    const { rows, maximum } = activity();
    const midpoint = Math.ceil(rows.length / 2);
    return rows
      .slice(side === 'left' ? 0 : midpoint, side === 'left' ? midpoint : rows.length)
      .map(({ agent: a, events, bins }) => {
        const available = O.health !== 'failed' && a.state !== 'stopped';
        return `<section class="radar-agent-card" data-id="radar-card-${a.id}">
        <button class="radar-agent-title" data-action="select" data-id="${a.id}" aria-pressed="${O.selected === a.id}" title="Select ${a.name}">${O.mark(a)}<span>${a.name}</span>${O.risk(a.risk)}</button>
        <div class="radar-agent-metrics"><span title="Current process CPU usage">CPU <b>${available ? O.num(a.cpu) + '%' : '—'}</b></span><span title="Current process memory">RAM <b>${available ? O.num(a.memory) + ' MB' : '—'}</b></span></div>
        <button class="radar-mini-chart" data-action="radar-activity" data-id="${a.id}" title="${a.name}: ${events.length} events in the last 5 minutes. Open activity." aria-label="${a.name}: ${events.length} events in the last 5 minutes; open activity">
          <svg viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true">${bins.map((count, i) => `<rect x="${i * 12}" y="0" width="8" height="24" rx="1" style="transform:scaleY(${count / maximum})"/>`).join('')}</svg>
          <span><span>${events.length} events · 5 min</span>${O.icon('chevron')}</span>
        </button>
        <div class="radar-agent-foot">${O.processLink(a, a, `PID ${a.pid}`)}<span>${O.health === 'failed' ? 'Last snapshot' : a.state === 'active' ? `${a.children.length + 1} ${a.children.length ? 'processes' : 'process'}` : a.state}</span></div>
      </section>`;
      })
      .join('');
  };
  O.updateRadarInfo = () => {
    for (const side of ['left', 'right']) O.patch(O.$(`radar-info-${side}`), O.radarInfo(side));
  };
  O.actions['radar-activity'] = (el) => {
    const row = activity().rows.find((r) => r.agent.id === el.dataset.id);
    if (!row) return;
    O.modal(
      `${row.agent.name} activity`,
      `<div class="agent-identity">${O.mark(row.agent)}<span>${row.events.length} events · last 5 minutes</span></div><div class="entity-events">${row.events.map((e) => `<button class="recent-event" data-action="event" data-id="${e.id}">${O.icon(e.type === 'network' ? 'network' : 'file')}<div><strong>${O.escape(O.shortPath(e.path))}</strong><small>${O.time(e.timestamp)} · ${O.escape(e.severity)}</small></div>${O.icon('chevron')}</button>`).join('') || O.empty('No events recorded during this interval.')}</div>`,
      '',
      'Recorded demo activity',
    );
  };
  O.emptyInspector = () =>
    `<div class="inspector-title"><span>Selected instance</span></div><div class="radar-no-selection">${O.icon('radar')}<h3>No agent selected</h3><p>Select a marker or an agent card to inspect its process.</p></div><div class="inspector-metrics"><div><strong>${O.agents.filter((a) => a.state === 'active').length}</strong><span>active agents</span></div><div><strong>${O.network.length}</strong><span>connections</span></div></div><p class="entity-note">Click empty radar space or press Escape to clear a selection.</p>`;
})();

export {};
