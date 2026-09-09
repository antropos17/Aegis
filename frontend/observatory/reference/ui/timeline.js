/* Group dense events into selectable time buckets; keep four keyboard entry points. */
(() => {
  const O = window.Obs;
  const severity = ['low', 'medium', 'high', 'critical'];
  O.renderTimeline = () => {
    const events = O.visibleEvents();
    const end = O.baseTime + O.sequence * 1000 - O.offset * 1000;
    const start = end - O.range * 60000;
    const width =
      document.querySelector('.lane-bars')?.clientWidth ||
      Math.max(72, innerWidth - (innerWidth <= 760 ? 220 : innerWidth <= 1050 ? 480 : 720));
    const buckets = Math.max(2, Math.floor(width / 28));
    return `<div class="lanes">${O.agents
      .map((agent) => {
        const groups = new Map();
        for (const event of events.filter((e) => e.agent === agent.id)) {
          const bucket = Math.min(
            buckets - 1,
            Math.floor(((event.timestamp - start) / (end - start)) * buckets),
          );
          if (!groups.has(bucket)) groups.set(bucket, []);
          groups.get(bucket).push(event);
        }
        return `<div class="lane"><button class="lane-label" data-action="agent-detail" data-id="${agent.id}" title="Open agent activity">${O.mark(agent)}<span>${agent.name}</span></button><div class="lane-bars" role="group" aria-label="${agent.name} events. Use left and right arrow keys.">${[
          ...groups,
        ]
          .sort(([a], [b]) => a - b)
          .map(([bucket, items], index) => {
            const level = items.reduce(
              (value, event) => Math.max(value, severity.indexOf(event.severity)),
              0,
            );
            return `<button class="event-tick ${severity[level]}" style="left:${((bucket + 0.5) / buckets) * 100}%" tabindex="${index ? -1 : 0}" data-action="event-cluster" data-id="${agent.id}:${bucket}" data-events="${items.map((event) => event.id).join('|')}" aria-label="${agent.name}: ${items.length} ${items.length === 1 ? 'event' : 'events'}, ${O.time(items.at(-1).timestamp)} to ${O.time(items[0].timestamp)}" title="${items.length} ${items.length === 1 ? 'event' : 'events'}">${items.length > 1 ? items.length : '·'}</button>`;
          })
          .join('')}</div></div>`;
      })
      .join(
        '',
      )}</div><div class="time-labels">${[0, 0.25, 0.5, 0.75, 1].map((t) => `<span>${O.time(start + (end - start) * t).slice(0, 5)}</span>`).join('')}</div><div class="timeline-help"><span>Grouped by time · ← → to browse</span><button class="text-button" data-view="events">Open event list</button></div>`;
  };
  O.actions['event-cluster'] = (element) => {
    const ids = new Set(element.dataset.events.split('|'));
    const events = O.events.filter((event) => ids.has(event.id));
    if (events.length === 1) {
      O.actions.event({ dataset: { id: events[0].id } });
      return;
    }
    O.modal(
      'Events in this interval',
      `<div class="interval-events"><div class="interval-columns" aria-hidden="true"><span>Time</span><span>Event / agent</span></div>${events
        .map(
          (event) =>
            `<button class="recent-event interval-event" data-action="event" data-id="${event.id}"><time>${O.time(event.timestamp)}</time><div><strong>${O.escape(O.shortPath(event.path))}</strong><small>${O.agent(event.agent)?.name || 'Unknown agent'} · ${event.severity}</small></div></button>`,
        )
        .join('')}</div>`,
      '',
      `${events.length} demo events`,
    );
  };
  const bindOverview = O.bindOverview;
  let timelineWidth = 0;
  const resize = new ResizeObserver((entries) => {
    const body = entries[0]?.target;
    if (!body?.isConnected || O.view !== 'overview' || body.clientWidth === timelineWidth) return;
    timelineWidth = body.clientWidth;
    O.updateTimeline();
  });
  O.bindOverview = () => {
    bindOverview();
    resize.disconnect();
    timelineWidth = 0;
    resize.observe(O.$('timeline-body'));
    O.$('timeline-body').addEventListener('keydown', (event) => {
      const tick = event.target.closest('.event-tick');
      if (!tick || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const ticks = [...tick.parentElement.querySelectorAll('.event-tick')];
      const index = ticks.indexOf(tick);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? ticks.length - 1
            : Math.max(
                0,
                Math.min(ticks.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)),
              );
      ticks.forEach((button, i) => (button.tabIndex = i === next ? 0 : -1));
      ticks[next].focus({ preventScroll: true });
    });
  };
})();

export {};
