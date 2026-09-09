<script lang="ts">
  import type { StatisticsSample } from '../runtime/statistics-history';
  import { metricObservations, plotGeometry, plotMaximum } from '../runtime/statistics-plot';
  import { statisticsValue, type StatsMetric } from '../runtime/statistics-metrics';
  import StatsPlot from './StatsPlot.svelte';
  let {
    samples,
    metrics,
    selected = $bindable('cpu'),
    period = $bindable(60000),
    stale = false,
    paused = false,
    now,
  }: {
    samples: StatisticsSample[];
    metrics: StatsMetric[];
    selected?: string;
    period?: number;
    stale?: boolean;
    paused?: boolean;
    now?: number;
  } = $props();
  let pinnedAt = $state<number | null>(null),
    hoverAt = $state<number | null>(null);
  let metric = $derived(metrics.find((m) => m.id === selected) ?? metrics[0]);
  let end = $derived(now ?? samples.at(-1)?.at ?? Date.now());
  let start = $derived(end - period);
  let observations = $derived(metricObservations(samples, metric.id, start, end));
  let latest = $derived(
    metricObservations(samples, metric.id, -Infinity, end)
      .filter((s) => !paused || typeof s.values[metric.id] === 'number')
      .at(-1),
  );
  let inspecting = $derived(hoverAt ?? pinnedAt);
  let focused = $derived(
    inspecting === null ? latest : (observations.find((s) => s.at === inspecting) ?? latest),
  );
  let coverage = $derived(focused?.coverage?.[metric.id]);
  let values = $derived(
    observations
      .map((s) => s.values[metric.id])
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
  );
  let maximum = $derived(plotMaximum(values, metric.floor));
  let average = $derived(values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  $effect(() => {
    if (pinnedAt !== null && !observations.some((s) => s.at === pinnedAt)) pinnedAt = null;
  });
  function choose(id: string): void {
    selected = id;
    pinnedAt = null;
    hoverAt = null;
  }
  function time(at: number | undefined): string {
    return at === undefined
      ? 'Waiting for this source'
      : new Date(at).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
  }
</script>

<section class="panel monitor" aria-label="Live performance monitor">
  <div class="metric-rail" aria-label="Performance metrics">
    {#each metrics as item (item.id)}
      {@const series = metricObservations(samples, item.id, start, end)}
      {@const current = metricObservations(samples, item.id, -Infinity, end)
        .filter((s) => !paused || typeof s.values[item.id] === 'number')
        .at(-1)}
      {@const geometry = plotGeometry(
        series,
        item.id,
        start,
        end,
        plotMaximum(
          series.map((s) => s.values[item.id]),
          item.floor,
        ),
      )}
      <button
        class:selected={metric.id === item.id}
        aria-pressed={metric.id === item.id}
        onclick={() => choose(item.id)}
      >
        <svg viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">
          {#each geometry.paths as path, i (i)}<path d={path} />{/each}
          {#each geometry.points as point, i (i)}<circle cx={point.x} cy={point.y} r="3" />{/each}
        </svg>
        <span
          ><strong>{item.label}</strong><small
            >{statisticsValue(current?.values[item.id], item.unit)}</small
          >
          {#if current?.coverage?.[item.id] && current.coverage[item.id].measured < current.coverage[item.id].total}<em
              >Partial coverage</em
            >{/if}
        </span>
      </button>
    {/each}
  </div>
  <div class="monitor-detail">
    <header>
      <div>
        <h2>{metric.label}</h2>
        <p class="measurement-status">
          {stale
            ? 'View held'
            : inspecting === null
              ? 'Latest measurement'
              : 'Selected measurement'} · {time(focused?.at)}
        </p>
      </div>
      <strong class="current">{statisticsValue(focused?.values[metric.id], metric.unit)}</strong>
    </header>
    <div class="monitor-tools">
      <label
        >Time window<select aria-label="Performance history length" bind:value={period}
          ><option value={60000}>1 minute</option><option value={180000}>3 minutes</option><option
            value={300000}>5 minutes</option
          ></select
        ></label
      >
      <span>{values.length} measured points</span>
    </div>
    {#if coverage}<p class="coverage" class:partial={coverage.measured < coverage.total}>
        {coverage.measured < coverage.total ? 'Measured subtotal' : 'Measured total'} · {coverage.measured}
        / {coverage.total} processes
      </p>{/if}
    <StatsPlot
      {observations}
      {metric}
      {start}
      {end}
      {maximum}
      held={stale}
      focusedAt={focused?.at ?? null}
      hover={(at) => (hoverAt = at)}
    />
    <div class="scrubber">
      <label for={'stats-sample-' + metric.id}>Inspect</label>
      <input
        id={'stats-sample-' + metric.id}
        type="range"
        min="0"
        max={Math.max(0, observations.length - 1)}
        value={Math.max(0, focused ? observations.indexOf(focused) : observations.length - 1)}
        disabled={observations.length < 2}
        aria-valuetext={time(focused?.at) +
          ', ' +
          statisticsValue(focused?.values[metric.id], metric.unit)}
        oninput={(event) =>
          (pinnedAt = observations[Number(event.currentTarget.value)]?.at ?? null)}
      />
      <button
        class="button"
        aria-pressed={pinnedAt === null}
        onclick={() => {
          pinnedAt = null;
          hoverAt = null;
        }}>Latest</button
      >
    </div>
    <div class="monitor-summary">
      <div><span>Sample average</span><strong>{statisticsValue(average, metric.unit)}</strong></div>
      <div>
        <span>Peak</span><strong
          >{statisticsValue(values.length ? Math.max(...values) : null, metric.unit)}</strong
        >
      </div>
      <p>Each point is a delivered measurement. Gaps mean unavailable data.</p>
    </div>
    <details class="metric-help">
      <summary>About this metric</summary>
      <p>{metric.description}</p>
    </details>
  </div>
</section>

<style>
  .monitor {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    overflow: hidden;
  }
  .metric-rail {
    background: var(--bg);
    border-right: 1px solid var(--border);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .metric-rail button {
    min-width: 0;
    display: flex;
    gap: 10px;
    align-items: center;
    text-align: left;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 12px 8px;
    color: var(--ink);
    transition:
      background 150ms,
      border-color 150ms;
  }
  .metric-rail button:hover {
    background: var(--panel);
  }
  .metric-rail button.selected {
    background: var(--selection);
    border-color: var(--selection-border);
  }
  .metric-rail svg {
    width: 46px;
    height: 34px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    background: var(--panel);
    overflow: visible;
  }
  .metric-rail span {
    min-width: 0;
    display: grid;
    gap: 4px;
  }
  .metric-rail strong {
    font-size: 12px;
    line-height: 1.3;
    font-weight: 550;
  }
  .metric-rail small {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    font-size: 11px;
  }
  .metric-rail em {
    color: var(--amber);
    font-size: 9px;
    font-style: normal;
  }
  path {
    fill: none;
    stroke: var(--green);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
  }
  circle {
    fill: var(--green);
  }
  .monitor-detail {
    min-width: 0;
    padding: 18px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -0.4px;
  }
  .measurement-status {
    color: var(--muted);
    font-size: 10px;
    margin: 7px 0 0;
  }
  .current {
    font-size: 26px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .monitor-tools {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--muted);
    font-size: 10px;
    margin: 0 0 12px;
  }
  .monitor-tools label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  select {
    padding: 5px;
    max-width: 140px;
    font-size: 11px;
  }
  .coverage {
    margin: 0 0 14px;
    font-size: 11px;
    color: var(--muted);
  }
  .coverage.partial {
    color: var(--amber);
  }
  .scrubber {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    color: var(--muted);
    font-size: 11px;
  }
  .scrubber input {
    min-width: 30px;
    flex: 1;
    padding: 0;
    height: 20px;
    accent-color: var(--green);
  }
  .scrubber .button {
    min-height: 28px;
    padding: 5px 9px;
    font-size: 11px;
  }
  .monitor-summary {
    display: flex;
    gap: 20px;
    border-top: 1px solid var(--border);
    margin-top: 12px;
    padding-top: 12px;
    align-items: start;
  }
  .monitor-summary div {
    display: grid;
    gap: 5px;
  }
  .monitor-summary span {
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
  }
  .monitor-summary strong {
    font-size: 13px;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }
  .monitor-summary p {
    margin: 0 0 0 auto;
    max-width: 200px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.6;
  }
  .metric-help {
    margin-top: 12px;
    color: var(--muted);
    font-size: 11px;
  }
  .metric-help summary {
    cursor: pointer;
  }
  .metric-help p {
    margin: 10px 0 0;
    line-height: 1.6;
  }
  @media (max-width: 1000px) {
    .monitor {
      grid-template-columns: minmax(0, 1fr);
    }
    .metric-rail {
      flex-direction: row;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .metric-rail button {
      flex: 0 0 142px;
      padding: 8px;
    }
    .metric-rail svg {
      width: 32px;
    }
    .monitor-detail {
      padding: 16px;
    }
  }
  @media (max-width: 720px) {
    .monitor-summary p {
      display: none;
    }
    h2 {
      font-size: 18px;
    }
    .current {
      font-size: 22px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .metric-rail button {
      transition: none;
    }
  }
  :global(:root[data-motion='reduced']) .metric-rail button {
    transition: none;
  }
</style>
