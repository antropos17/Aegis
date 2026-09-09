<script lang="ts">
  import type { StatisticsSample } from '../runtime/statistics-history';
  import { statisticsPaths } from '../runtime/statistics-history';
  import { statisticsValue, type StatsMetric } from '../runtime/statistics-metrics';
  let {
    samples,
    metrics,
    selected = $bindable('cpu'),
    stale = false,
  }: {
    samples: StatisticsSample[];
    metrics: StatsMetric[];
    selected?: string;
    stale?: boolean;
  } = $props();
  let cursor = $state<number | null>(null);
  let period = $state(120);
  let metric = $derived(metrics.find((m) => m.id === selected) ?? metrics[0]);
  let visible = $derived(samples.slice(-period));
  let latest = $derived(visible.at(-1));
  let focused = $derived(
    cursor === null ? latest : (visible.find((s) => s.at === cursor) ?? latest),
  );
  let maximum = $derived(
    Math.max(metric.floor ?? 1, ...visible.map((s) => s.values[metric.id] ?? 0)) *
      (metric.floor ? 1 : 1.08),
  );
  let measuredValues = $derived(
    visible.map((s) => s.values[metric.id]).filter((n): n is number => typeof n === 'number'),
  );
  let average = $derived(
    measuredValues.length
      ? measuredValues.reduce((a, b) => a + b, 0) / measuredValues.length
      : null,
  );
  function choose(id: string): void {
    selected = id;
    cursor = null;
  }
  function time(at: number | undefined): string {
    return at ? new Date(at).toLocaleTimeString() : 'Waiting for a sample';
  }
</script>

<section class="panel monitor" aria-label="Live performance monitor">
  <div class="metric-rail" aria-label="Performance metrics">
    {#each metrics as item (item.id)}
      {@const max = Math.max(item.floor ?? 1, ...visible.map((s) => s.values[item.id] ?? 0))}
      <button
        class:selected={metric.id === item.id}
        aria-pressed={metric.id === item.id}
        onclick={() => choose(item.id)}
      >
        <svg viewBox="0 0 600 164" preserveAspectRatio="none" aria-hidden="true">
          {#each statisticsPaths(visible, item.id, max) as path, index (index)}<path
              d={path}
            />{/each}
        </svg>
        <span
          ><strong>{item.label}</strong><small
            >{statisticsValue(latest?.values[item.id], item.unit)}</small
          ></span
        >
      </button>
    {/each}
  </div>
  <div class="monitor-detail">
    <header>
      <div>
        <p class="eyebrow">Performance history</p>
        <h2>{metric.label}</h2>
      </div>
      <div class="current">
        <strong>{statisticsValue(focused?.values[metric.id], metric.unit)}</strong><small
          >{cursor !== null
            ? 'Selected observation'
            : stale
              ? 'Last reliable observation'
              : 'Latest observation'}</small
        >
      </div>
    </header>
    <div
      class="plot"
      role="img"
      aria-label={metric.label +
        ' history, ' +
        measuredValues.length +
        ' measured samples. Current value ' +
        statisticsValue(focused?.values[metric.id], metric.unit)}
    >
      <div class="plot-top">
        <span>{statisticsValue(maximum, metric.unit)}</span><span
          >{stale ? 'Observation paused' : 'Observed samples'}</span
        >
      </div>
      <svg viewBox="0 0 600 164" preserveAspectRatio="none" aria-hidden="true">
        {#each [4, 42.5, 81, 119.5, 158] as y (y)}<line x1="2" x2="598" y1={y} y2={y} />{/each}
        {#each [2, 101, 200, 300, 400, 499, 598] as x (x)}<line
            x1={x}
            x2={x}
            y1="4"
            y2="158"
          />{/each}
        {#each statisticsPaths(visible, metric.id, maximum) as path, index (index)}<path
            d={path}
          />{/each}
        {#if focused && visible.length}
          {@const x =
            2 + ((focused.at - visible[0].at) / Math.max(1, latest!.at - visible[0].at)) * 596}
          <line class="cursor" x1={x} x2={x} y1="4" y2="158" />
          {#if typeof focused.values[metric.id] === 'number'}
            <circle
              cx={x}
              cy={158 - Math.min(1, focused.values[metric.id]! / maximum) * 154}
              r="3.5"
            />
          {/if}
        {/if}
      </svg>
      {#if !measuredValues.length}<div class="plot-empty">
          <strong>Waiting for measured data</strong><span
            >Missing or incomplete measurements appear as gaps.</span
          >
        </div>{/if}
      <div class="plot-times">
        <span>{time(visible[0]?.at)}</span><span>{time(latest?.at)}</span>
      </div>
    </div>
    <div class="scrubber">
      <label for={'stats-sample-' + metric.id}>Sample</label>
      <input
        id={'stats-sample-' + metric.id}
        type="range"
        min="0"
        max={Math.max(0, visible.length - 1)}
        value={Math.max(0, focused ? visible.indexOf(focused) : 0)}
        disabled={visible.length < 2}
        aria-valuetext={time(focused?.at) +
          ', ' +
          statisticsValue(focused?.values[metric.id], metric.unit)}
        oninput={(event) => (cursor = visible[Number(event.currentTarget.value)]?.at ?? null)}
      />
      <button class="button" aria-pressed={cursor === null} onclick={() => (cursor = null)}
        >Latest</button
      >
    </div>
    <div class="monitor-summary">
      <div><span>Average</span><strong>{statisticsValue(average, metric.unit)}</strong></div>
      <div>
        <span>Peak</span><strong
          >{statisticsValue(
            measuredValues.length ? Math.max(...measuredValues) : null,
            metric.unit,
          )}</strong
        >
      </div>
      <label
        >History<select aria-label="Performance history length" bind:value={period}
          ><option value={30}>30 samples</option><option value={60}>60 samples</option><option
            value={120}>120 samples</option
          ></select
        ></label
      >
    </div>
    <p class="metric-description">{metric.description}</p>
  </div>
</section>

<style>
  .monitor {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
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
    width: 50px;
    height: 34px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    background: var(--panel);
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
  }
  path {
    fill: none;
    stroke: var(--green);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .monitor-detail {
    min-width: 0;
    padding: 20px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  h2 {
    margin: 5px 0 0;
    font-size: 20px;
    letter-spacing: -0.5px;
  }
  .eyebrow {
    color: var(--muted);
    font-size: 10px;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }
  .current {
    display: grid;
    gap: 4px;
    text-align: right;
  }
  .current strong {
    font-size: 25px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.8px;
  }
  .current small {
    font-size: 10px;
    color: var(--muted);
  }
  .plot {
    position: relative;
  }
  .plot svg {
    width: 100%;
    height: 180px;
    display: block;
    overflow: visible;
  }
  .plot line {
    stroke: var(--border);
    vector-effect: non-scaling-stroke;
  }
  .plot .cursor {
    stroke: var(--muted);
    stroke-dasharray: 3 4;
    opacity: 0.55;
  }
  .plot circle {
    fill: var(--green);
    stroke: var(--panel);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .plot-top,
  .plot-times {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 10px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .plot-top {
    margin-bottom: 8px;
  }
  .plot-times {
    margin-top: 8px;
  }
  .plot-empty {
    position: absolute;
    inset: 25% 10% 25%;
    display: grid;
    align-content: center;
    text-align: center;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--panel);
    border-radius: 8px;
    font-size: 12px;
  }
  .plot-empty span {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
  }
  .scrubber {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    font-size: 11px;
    color: var(--muted);
  }
  .scrubber input {
    min-width: 30px;
    flex: 1;
    padding: 0;
    height: 20px;
    accent-color: var(--green);
  }
  .scrubber .button {
    font-size: 11px;
    padding: 5px 9px;
    min-height: 28px;
  }
  .monitor-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    border-top: 1px solid var(--border);
    padding-top: 14px;
    margin-top: 14px;
  }
  .monitor-summary div {
    display: grid;
    gap: 5px;
  }
  .monitor-summary span,
  .monitor-summary label {
    font-size: 10px;
    color: var(--muted);
  }
  .monitor-summary strong {
    font-size: 13px;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }
  .monitor-summary label {
    margin-left: auto;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  select {
    padding: 5px;
    font-size: 11px;
    max-width: 140px;
  }
  .metric-description {
    font-size: 11px;
    line-height: 1.6;
    color: var(--muted);
    margin: 14px 0 0;
  }
  @media (max-width: 1000px) {
    .monitor {
      grid-template-columns: 155px minmax(0, 1fr);
    }
    .metric-rail svg {
      width: 32px;
    }
    .monitor-detail {
      padding: 16px;
    }
  }
  @media (max-width: 720px) {
    .monitor {
      grid-template-columns: minmax(0, 1fr);
    }
    .metric-rail {
      flex-direction: row;
      overflow: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .metric-rail button {
      min-width: 145px;
    }
    .plot svg {
      height: 160px;
    }
    .current strong {
      font-size: 21px;
    }
    h2 {
      font-size: 18px;
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
