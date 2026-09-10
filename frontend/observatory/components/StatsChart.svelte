<script lang="ts">
  import type { StatisticsSample } from '../runtime/statistics-history';
  import { metricObservations, plotMaximum } from '../runtime/statistics-plot';
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
  const chartId = $props.id();
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
  let collection = $derived(
    metric.id === 'cpu' || metric.id === 'memory' ? focused?.resourceCollection : undefined,
  );
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
      {@const current = metricObservations(samples, item.id, -Infinity, end)
        .filter((s) => !paused || typeof s.values[item.id] === 'number')
        .at(-1)}
      <button
        class:selected={metric.id === item.id}
        aria-pressed={metric.id === item.id}
        onclick={() => choose(item.id)}
      >
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
              ? collection
                ? 'Latest collection'
                : 'Latest measurement'
              : collection
                ? 'Selected collection'
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
    <p class="coverage" class:partial={coverage && coverage.measured < coverage.total}>
      {#if coverage}{coverage.measured < coverage.total ? 'Measured subtotal' : 'Measured total'} · {coverage.measured}
        / {coverage.total} processes
        {#if collection && collection.oldest < collection.newest}
          · readings span {((collection.newest - collection.oldest) / 1000).toLocaleString(
            undefined,
            { maximumFractionDigits: 1 },
          )} s
        {/if}
      {:else}Coverage is shown when this source supplies measurements.{/if}
    </p>
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
      <label for={chartId + '-sample-' + metric.id}>Inspect</label>
      <input
        id={chartId + '-sample-' + metric.id}
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
      <p>
        {collection
          ? 'Latest collected readings. Cached replies add no points.'
          : 'Each point is a delivered measurement.'} Gaps mean unavailable data.
      </p>
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
    grid-template-columns: 160px minmax(0, 1fr);
    align-items: start;
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

  .metric-rail span {
    min-width: 0;
    display: grid;
    gap: 4px;
    min-height: 48px;
  }
  .metric-rail strong {
    font-size: var(--text-body);
    line-height: 1.3;
    font-weight: 550;
  }
  .metric-rail small {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .metric-rail em {
    color: var(--amber);
    font-size: var(--text-caption);
    font-style: normal;
  }

  .monitor-detail {
    min-width: 0;
    padding: var(--panel-inset);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    min-height: 48px;
    gap: 12px;
    margin-bottom: 8px;
  }
  h2 {
    margin: 0;
    font-size: var(--text-section);
    letter-spacing: -0.4px;
  }
  .measurement-status {
    color: var(--muted);
    font-size: var(--text-caption);
    margin: 7px 0 0;
  }
  .current {
    font-size: var(--text-metric);
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
    font-size: var(--text-caption);
    margin: 0 0 8px;
  }
  .monitor-tools label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  select {
    max-width: none;
    font-size: var(--text-body);
  }
  .coverage {
    margin: 0 0 8px;
    min-height: 18px;
    font-size: var(--text-caption);
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
    font-size: var(--text-caption);
  }
  .scrubber input {
    min-width: 30px;
    flex: 1;
    padding: 0;
    height: 20px;
    accent-color: var(--green);
  }
  .scrubber .button {
    min-height: var(--control-height);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-body);
  }
  .monitor-summary {
    display: flex;
    gap: 20px;
    border-top: 1px solid var(--border);
    margin-top: 12px;
    padding-top: 12px;
    align-items: start;
    min-height: 72px;
  }
  .monitor-summary div {
    display: grid;
    gap: 5px;
  }
  .monitor-summary span {
    color: var(--muted);
    font-size: var(--text-caption);
    white-space: nowrap;
  }
  .monitor-summary strong {
    font-size: var(--text-body);
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }
  .monitor-summary p {
    margin: 0 0 0 auto;
    max-width: 200px;
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.6;
  }
  .metric-help {
    margin-top: 12px;
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .metric-help summary {
    cursor: pointer;
  }
  .metric-help p {
    margin: 10px 0 0;
    line-height: 1.6;
  }
  @media (max-width: 760px) {
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

    .monitor-detail {
      padding: 16px;
    }
  }
  @media (max-width: 720px) {
    .monitor-summary p {
      display: none;
    }
    h2 {
      font-size: var(--text-section);
    }
    .current {
      font-size: var(--text-metric);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .metric-rail button {
      transition: none;
    }
  }
  :global(:root[data-motion='reduce']) .metric-rail button {
    transition: none;
  }
</style>
