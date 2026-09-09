<script lang="ts">
  import type { StatisticsSample } from '../runtime/statistics-history';
  import { nearestObservation, plotGeometry, plotX } from '../runtime/statistics-plot';
  import type { StatsMetric } from '../runtime/statistics-metrics';
  let {
    observations,
    metric,
    start,
    end,
    maximum,
    held = false,
    focusedAt,
    hover,
  }: {
    observations: StatisticsSample[];
    metric: StatsMetric;
    start: number;
    end: number;
    maximum: number;
    held?: boolean;
    focusedAt: number | null;
    hover: (_at: number | null) => void;
  } = $props();
  let stepped = $derived(
    [
      'processes',
      'products',
      'connections',
      'tokens',
      'input',
      'output',
      'cost',
      'evictions',
      'risk',
    ].includes(metric.id),
  );
  let geometry = $derived(plotGeometry(observations, metric.id, start, end, maximum, stepped));
  let focus = $derived(
    focusedAt === null ? undefined : geometry.points.find((p) => p.at === focusedAt),
  );
  function point(event: PointerEvent) {
    const box =
      event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    if (!box) return;
    const at =
      start + Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (end - start);
    hover(nearestObservation(observations, at)?.at ?? null);
  }
  function ago(fraction: number): string {
    const seconds = Math.round(((end - start) * fraction) / 1000);
    return seconds >= 60
      ? (seconds / 60).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' min'
      : seconds + ' s';
  }
</script>

<div
  class="plot"
  role="img"
  aria-label={metric.label +
    ' history, ' +
    geometry.points.length +
    ' measured samples; ' +
    Math.round((end - start) / 1000) +
    ' seconds'}
>
  <div class="axis-values" aria-hidden="true">
    {#each [1, 0.75, 0.5, 0.25, 0] as fraction (fraction)}<span
        >{(maximum * fraction).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          (metric.unit ? ' ' + metric.unit : '')}</span
      >{/each}
  </div>
  <div class="plot-area">
    <svg
      viewBox="0 0 600 160"
      preserveAspectRatio="none"
      aria-hidden="true"
      onpointermove={point}
      onpointerleave={() => hover(null)}
    >
      {#each [0, 40, 80, 120, 160] as y (y)}<line x1="0" x2="600" y1={y} y2={y} />{/each}
      {#each [0, 150, 300, 450, 600] as x (x)}<line x1={x} x2={x} y1="0" y2="160" />{/each}
      {#each geometry.paths as path, i (i)}<path d={path} />{/each}
      {#each geometry.points as p (p.at)}<circle
          cx={p.x}
          cy={p.y}
          r={p.at === focusedAt ? 3.5 : 1.5}
        />{/each}
      {#if focusedAt !== null}<line
          class="cursor"
          x1={plotX(focusedAt, start, end)}
          x2={plotX(focusedAt, start, end)}
          y1="0"
          y2="160"
        />{/if}
      {#if focus}<circle class="focus" cx={focus.x} cy={focus.y} r="4" />{/if}
    </svg>
    {#if !geometry.points.length}<div class="plot-empty">
        <strong>No measurements in this interval</strong><span
          >Waiting for this metric’s source.</span
        >
      </div>{/if}
    <div class="plot-times" aria-hidden="true">
      <span>{ago(1)} ago</span><span>{ago(0.5)} ago</span><span>{held ? 'Held' : 'Now'}</span>
    </div>
  </div>
</div>

<style>
  .plot {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
  }
  .axis-values {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: end;
    padding-bottom: 26px;
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .plot-area {
    position: relative;
    min-width: 0;
  }
  svg {
    width: 100%;
    height: clamp(140px, 24vh, 220px);
    display: block;
    overflow: visible;
  }
  line {
    stroke: var(--border);
    vector-effect: non-scaling-stroke;
  }
  path {
    fill: none;
    stroke: var(--green);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  circle {
    fill: var(--green);
  }
  .focus {
    stroke: var(--panel);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .cursor {
    stroke: var(--muted);
    stroke-dasharray: 3 4;
  }
  .plot-times {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    margin-top: 10px;
    height: 16px;
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .plot-empty {
    position: absolute;
    inset: 15% 5% 30%;
    display: grid;
    align-content: center;
    gap: 8px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
  }
  .plot-empty strong {
    color: var(--ink);
    font-weight: 500;
  }
</style>
