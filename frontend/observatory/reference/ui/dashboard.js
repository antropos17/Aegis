/* Charts use event timestamps and current agent snapshots from the demo store. */
(() => {
  const O = window.Obs;
  const state = { range: 15, agent: 'all', metric: 'all', resource: 'cpu' };
  const metricNames = {
    all: 'All events',
    network: 'Connections',
    attention: 'Needs review',
  };
  const allowed = (event) =>
    (state.agent === 'all' || event.agent === state.agent) &&
    (state.metric === 'all' ||
      (state.metric === 'network'
        ? event.type === 'network'
        : event.severity !== 'low' && !event.fp));
  const series = () => {
    const end = O.baseTime + O.sequence * 1000;
    const start = end - state.range * 60000;
    const buckets = Array.from({ length: 24 }, (_, index) => ({
      start: start + (index * (end - start)) / 24,
      end: start + ((index + 1) * (end - start)) / 24,
      events: [],
    }));
    for (const event of O.events) {
      if (!allowed(event) || event.timestamp < start || event.timestamp > end) continue;
      const index = Math.min(23, Math.floor(((event.timestamp - start) / (end - start)) * 24));
      buckets[index].events.push(event);
    }
    return {
      buckets,
      start,
      end,
      total: buckets.reduce((sum, bucket) => sum + bucket.events.length, 0),
    };
  };
  const segments = (action, entries, current) =>
    `<div class="segmented">${entries.map(([id, label]) => `<button data-action="${action}" data-id="${id}" aria-pressed="${String(id) === String(current)}">${label}</button>`).join('')}</div>`;

  O.renderDashboard = (
    scope,
  ) => `<div class="dashboard-grid" id="live-dashboard" data-scope="${scope}">
    <section class="panel activity-chart">
      ${O.panelHead(
        'Activity',
        '',
        segments(
          'chart-range',
          [
            [5, '5 min'],
            [15, '15 min'],
            [60, '1 hour'],
          ],
          state.range,
        ),
      )}
      <div class="chart-filters"><label><span class="sr-only">Chart metric</span><select id="chart-metric">${O.options(Object.entries(metricNames), state.metric)}</select></label><label><span class="sr-only">Chart agent</span><select id="chart-agent">${O.agentOptions(state.agent)}</select></label></div>
      <div class="chart-reading"><strong id="chart-total">0</strong><span>events in period</span><span class="chart-max" id="chart-max"></span></div>
      <div class="activity-plot" role="group" aria-label="Events over time. Arrow keys select an interval; Enter opens its events."></div>
      <div class="chart-axis"><span id="chart-start"></span><span id="chart-end"></span></div>
      <div class="chart-readout" id="chart-readout">Select an interval to inspect its events.</div>
    </section>
    <section class="panel resource-chart">
      ${O.panelHead(
        'Agent usage',
        'Current process snapshot',
        segments(
          'chart-resource',
          [
            ['cpu', 'CPU'],
            ['memory', 'RAM'],
          ],
          state.resource,
        ),
      )}
      <div id="resource-bars"></div><p class="chart-footnote" id="resource-caption"></p>
    </section>
  </div>`;

  function readBucket(button) {
    if (!button?.classList.contains('chart-bucket')) return;
    const readout = O.$('chart-readout');
    if (readout) readout.textContent = button.getAttribute('aria-label');
  }
  O.updateDashboard = () => {
    const root = O.$('live-dashboard');
    if (!root) return;
    const data = series();
    const max = Math.max(1, ...data.buckets.map((bucket) => bucket.events.length));
    const axisMax = Math.max(5, Math.ceil(max / 5) * 5);
    O.patch(
      root.querySelector('.activity-plot'),
      data.buckets
        .map((bucket, index) => {
          const count = bucket.events.length;
          const label = `${O.time(bucket.start)}–${O.time(bucket.end)} · ${count} ${count === 1 ? 'event' : 'events'}`;
          return `<button class="chart-bucket" data-action="chart-bucket" data-id="${index}" data-events="${bucket.events.map((event) => event.id).join('|')}" tabindex="${index ? -1 : 0}" aria-label="${label}"><span class="chart-column" style="transform:scaleY(${count / axisMax})"></span><span class="chart-hitline"></span></button>`;
        })
        .join(''),
    );
    const total = O.$('chart-total');
    if (total.textContent !== String(data.total)) {
      total.textContent = data.total;
      O.animate(total);
    }
    O.$('chart-max').textContent = `Scale 0–${axisMax}`;
    O.$('chart-start').textContent = O.time(data.start).slice(0, 5);
    O.$('chart-end').textContent = O.time(data.end).slice(0, 5);
    const current = root.querySelector('.chart-bucket:focus');
    if (current) {
      root
        .querySelectorAll('.chart-bucket')
        .forEach((button) => (button.tabIndex = button === current ? 0 : -1));
      readBucket(current);
    } else O.$('chart-readout').textContent = 'Select an interval to inspect its events.';
    const ram = state.resource === 'memory';
    const maximum = ram ? Math.max(1, ...O.agents.map((agent) => agent.memory)) : 100;
    O.patch(
      O.$('resource-bars'),
      O.agents
        .map(
          (agent) => `<button class="usage-row" data-action="agent-detail" data-id="${agent.id}">
      ${O.mark(agent)}<span class="usage-body"><span class="usage-heading"><strong>${agent.name}</strong><span>${O.num(agent[state.resource])}${ram ? ' MB' : '%'}</span></span><span class="usage-track"><span style="transform:scaleX(${agent[state.resource] / maximum})"></span></span></span>${O.icon('chevron')}</button>`,
        )
        .join(''),
    );
    O.$('resource-caption').textContent = ram
      ? 'Bar length is relative to the largest process. Values are in MB.'
      : 'Percentage of total CPU capacity. Open an agent for process details.';
  };
  O.bindDashboard = () => {
    const root = O.$('live-dashboard');
    if (!root) return;
    O.updateDashboard();
    O.$('chart-metric').addEventListener('change', (event) => {
      state.metric = event.target.value;
      O.updateDashboard();
    });
    O.$('chart-agent').addEventListener('change', (event) => {
      state.agent = event.target.value;
      O.updateDashboard();
    });
    root.addEventListener('pointerover', (event) =>
      readBucket(event.target.closest('.chart-bucket')),
    );
    root.addEventListener('focusin', (event) => readBucket(event.target));
    root.querySelector('.activity-plot').addEventListener('pointerleave', () => {
      if (!root.querySelector('.chart-bucket:focus'))
        O.$('chart-readout').textContent = 'Select an interval to inspect its events.';
    });
    root.addEventListener('keydown', (event) => {
      if (
        !event.target.matches('.chart-bucket') ||
        !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      )
        return;
      event.preventDefault();
      const buttons = [...root.querySelectorAll('.chart-bucket')];
      const index = buttons.indexOf(event.target);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 23
            : Math.max(0, Math.min(23, index + (event.key === 'ArrowRight' ? 1 : -1)));
      buttons.forEach((button, i) => (button.tabIndex = i === next ? 0 : -1));
      buttons[next].focus({ preventScroll: true });
    });
  };
  O.actions['chart-range'] = (element) => {
    state.range = Number(element.dataset.id);
    document
      .querySelectorAll('[data-action="chart-range"]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button === element)));
    O.updateDashboard();
  };
  O.actions['chart-resource'] = (element) => {
    state.resource = element.dataset.id;
    document
      .querySelectorAll('[data-action="chart-resource"]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button === element)));
    O.updateDashboard();
  };
  O.actions['chart-bucket'] = (element) => {
    if (!element.dataset.events) {
      O.notify('No events in this interval');
      return;
    }
    O.actions['event-cluster'](element);
  };
})();

export {};
