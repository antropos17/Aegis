<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import type { StatisticsSample } from '../runtime/statistics-history';
  import { nearestObservation, plotGeometry, plotX } from '../runtime/statistics-plot';
  import { statisticsValue, type StatsMetric } from '../runtime/statistics-metrics';
  import {
    createLivePlotMotion,
    observeLivePlotMotion,
    type LivePlotFrame,
  } from '../runtime/live-plot';
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
  const id = $props.id();
  let surface: HTMLDivElement;
  let motion = $state(false);
  let displayed = $state.raw<LivePlotFrame>();
  let animator: ReturnType<typeof createLivePlotMotion> | undefined;
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
  let target = $derived({
    key: metric.id + ':' + (end - start),
    stepped,
    maximum,
    geometry: plotGeometry(observations, metric.id, start, end, maximum, stepped),
  });
  let frame = $derived(displayed ?? target);
  let geometry = $derived(frame.geometry);
  let focus = $derived(
    focusedAt === null ? undefined : geometry.points.find((p) => p.at === focusedAt),
  );
  let endpoint = $derived(geometry.points.at(-1));
  let available = $derived(endpoint && (held || observations.at(-1)?.at === endpoint.at));
  let axisLabels = $derived(
    [1, 0.75, 0.5, 0.25, 0].map((fraction) =>
      metric.unit === 'USD'
        ? statisticsValue(frame.maximum * fraction, metric.unit)
        : (frame.maximum * fraction).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          (metric.unit ? ' ' + metric.unit : ''),
    ),
  );
  let axisCharacters = $derived(
    Math.max(
      ...axisLabels.map((label) => label.length),
      statisticsValue(endpoint?.value, metric.unit).length,
    ),
  );
  onMount(() => {
    animator = createLivePlotMotion((value) => {
      displayed = value;
    });
    animator.update(target, false);
    const dispose = observeLivePlotMotion(surface, (allowed) => {
      motion = allowed;
      if (!allowed) animator?.finish();
    });
    return () => {
      dispose();
      animator?.destroy();
      animator = undefined;
    };
  });
  $effect(() => {
    const next = target,
      animate = motion && !held && focusedAt === null;
    untrack(() => animator?.update(next, animate));
  });
  function point(event: PointerEvent): void {
    const box =
      event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    if (!box || !box.width) return;
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
  bind:this={surface}
  class:held
  role="img"
  aria-label={metric.label +
    ' history, ' +
    target.geometry.points.length +
    ' measured samples; ' +
    Math.round((end - start) / 1000) +
    ' seconds'}
>
  <div class="axis-values" style={`--axis-characters:${axisCharacters}`} aria-hidden="true">
    {#each axisLabels as label, i (i)}
      <span>{label}</span>
    {/each}
    {#if available && endpoint}
      <strong
        class="endpoint-value"
        style:top={`clamp(14px, ${(endpoint.y / 160) * 100}%, calc(100% - 14px))`}
      >
        {statisticsValue(endpoint.value, metric.unit)}
      </strong>
    {/if}
  </div>
  <div class="plot-area">
    <svg
      viewBox="0 0 600 160"
      preserveAspectRatio="none"
      aria-hidden="true"
      onpointermove={point}
      onpointerleave={() => hover(null)}
    >
      <defs>
        <linearGradient id={id + '-fill'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--green)" stop-opacity="0.16" />
          <stop offset="100%" stop-color="var(--green)" stop-opacity="0" />
        </linearGradient>
      </defs>
      {#each [0, 40, 80, 120, 160] as y (y)}<line
          class="grid"
          x1="0"
          x2="600"
          y1={y}
          y2={y}
        />{/each}
      {#each geometry.segments as segment, i (i)}
        {#if segment.length > 1}
          <path
            class="area"
            fill={`url(#${id}-fill)`}
            d={geometry.paths[i] +
              ` L ${segment.at(-1)?.x.toFixed(2)} 160 L ${segment[0].x.toFixed(2)} 160 Z`}
          />
        {/if}
        <path class="trace" d={geometry.paths[i]} />
      {/each}
      {#each geometry.points as p (p.at)}<circle class="sample" cx={p.x} cy={p.y} r="1.5" />{/each}
      {#if available && endpoint}<line
          class="guide"
          x1={endpoint.x}
          x2="600"
          y1={endpoint.y}
          y2={endpoint.y}
        />{/if}
      {#if focusedAt !== null}<line
          class="cursor"
          x1={plotX(focusedAt, start, end)}
          x2={plotX(focusedAt, start, end)}
          y1="0"
          y2="160"
        />{/if}
      {#if focus}<circle class="focus" cx={focus.x} cy={focus.y} r="4" />{/if}
    </svg>
    {#if available && endpoint}
      <span
        class="endpoint"
        aria-hidden="true"
        style:left={endpoint.x / 6 + '%'}
        style:top={endpoint.y / 1.6 + '%'}
      ></span>
    {/if}
    {#if focus}
      <div
        class="plot-tooltip"
        aria-hidden="true"
        style:left={`clamp(8px, ${focus.x / 6}%, calc(100% - var(--tooltip-width) - 8px))`}
      >
        <span>{new Date(focus.at).toLocaleTimeString()}</span><strong
          >{statisticsValue(focus.value, metric.unit)}</strong
        >
      </div>
    {/if}
    {#if !geometry.points.length}<div class="plot-empty">
        <strong>{$t('No measurements in this interval')}</strong><span
          >{$t('Waiting for this metric’s source.')}</span
        >
      </div>{/if}
  </div>
  <div class="plot-times" aria-hidden="true">
    <span>{ago(1)} {$t('ago')}</span><span>{ago(0.5)} {$t('ago')}</span><span
      >{held ? $t('Held') : $t('Now')}</span
    >
  </div>
</div>

<style>
  .plot {
    --tooltip-width: calc(var(--text-caption) * 12);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-3);
    min-width: 0;
  }
  .axis-values {
    grid-column: 2;
    grid-row: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    color: var(--muted);
    font: var(--text-caption)/1 var(--mono);
    font-variant-numeric: tabular-nums;
    min-width: calc(var(--axis-characters) * 1ch + 20px);
    padding-left: var(--space-2);
  }
  .axis-values > span {
    white-space: nowrap;
  }
  .endpoint-value {
    position: absolute;
    left: 0;
    padding: 6px var(--space-2);
    transform: translateY(-50%);
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--green);
    border-radius: 6px;
    white-space: nowrap;
    font-weight: 500;
  }
  .plot-area {
    grid-column: 1;
    grid-row: 1;
    position: relative;
    min-width: 0;
  }
  svg {
    width: 100%;
    height: clamp(160px, 24vh, 220px);
    display: block;
    overflow: visible;
  }
  line {
    vector-effect: non-scaling-stroke;
  }
  .grid {
    stroke: var(--border);
    stroke-dasharray: 2 5;
  }
  .trace {
    fill: none;
    stroke: var(--green);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .area {
    stroke: none;
  }
  .sample {
    fill: var(--green);
    opacity: 0.35;
  }
  .focus {
    fill: var(--green);
    stroke: var(--panel);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .guide {
    stroke: var(--green);
    stroke-dasharray: 3 5;
    opacity: 0.45;
  }
  .cursor {
    stroke: var(--muted);
    stroke-dasharray: 3 4;
  }
  .endpoint {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green);
    border: 2px solid var(--panel);
    box-sizing: content-box;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .held :is(.trace, .guide) {
    stroke: var(--muted);
  }
  .held :is(.sample, .endpoint) {
    background: var(--muted);
    fill: var(--muted);
  }
  .held .endpoint-value {
    border-color: var(--strong-border);
    color: var(--muted);
  }
  .plot-tooltip {
    position: absolute;
    top: var(--space-2);
    width: var(--tooltip-width);
    max-width: calc(100% - 16px);
    box-sizing: border-box;
    overflow-wrap: anywhere;
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    background: var(--panel);
    font: var(--text-caption)/1.4 var(--mono);
    pointer-events: none;
    color: var(--muted);
  }
  .plot-tooltip strong {
    color: var(--ink);
    font-weight: 550;
  }
  .plot-times {
    grid-row: 2;
    grid-column: 1;
    display: flex;
    justify-content: space-between;
    gap: var(--space-1);
    color: var(--muted);
    font: var(--text-caption)/1.4 var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .plot-empty {
    position: absolute;
    inset: 15% 5%;
    display: grid;
    align-content: center;
    gap: var(--space-2);
    text-align: center;
    font-size: var(--text-body);
    color: var(--muted);
  }
  .plot-empty strong {
    color: var(--ink);
    font-weight: 500;
  }
</style>
