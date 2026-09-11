<script lang="ts">
  import { t } from '../runtime/i18n';

  import { activityBins, activityTimeLabel } from '../runtime/activity';
  import type { FileEvent } from '../../../src/shared/types';
  import type { RecordData } from '../runtime/host';
  import Icon from './Icon.svelte';
  let {
    events,
    observedAt,
    paused = false,
    stale = false,
    inspect,
  }: {
    events: FileEvent[];
    observedAt: number | null;
    paused?: boolean;
    stale?: boolean;
    inspect: (_title: string, _row: RecordData) => void;
  } = $props();
  let period = $state(15 * 60000),
    type = $state('all'),
    agent = $state(''),
    hover = $state<number | null>(null),
    focus = $state(0);
  let focused = $state(false);
  let now = $state(Date.now());
  $effect(() => {
    if (paused || stale || hover !== null || focused) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    period;
    type;
    agent;
    hover = null;
    focused = false;
  });
  let end = $derived(now + 1);
  let selection = $derived(hover ?? (focused ? focus : null));
  let bins = $derived(
    activityBins(
      events.filter((e) => (!agent || e.agent === agent) && (type === 'all' || e.sensitive)),
      end,
      period,
    ),
  );
  let maximum = $derived(
    Math.max(5, Math.ceil(Math.max(1, ...bins.map((b) => b.events.length)) / 5) * 5),
  );
  let names = $derived([...new Set(events.map((e) => e.agent).filter(Boolean))].sort());
  function caption(i: number) {
    const b = bins[i];
    return `${activityTimeLabel(b.start, true)}–${activityTimeLabel(b.end, true)} · ${b.events.length} observations`;
  }
  function keys(e: KeyboardEvent, i: number) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    focus =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? bins.length - 1
          : Math.max(0, Math.min(bins.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
    (e.currentTarget as HTMLElement).parentElement
      ?.querySelectorAll<HTMLButtonElement>('button')
      .item(focus)
      ?.focus({ preventScroll: true });
  }
</script>

<section class="panel activity-chart">
  <div class="panel-head">
    <h2><Icon name="chart" />{$t('Activity')}</h2>
    <div class="segmented" aria-label={$t('Chart period')}>
      {#each [[5, '5 min'], [15, '15 min'], [60, '1 hour']] as [n, label] (n)}<button
          aria-pressed={period === Number(n) * 60000}
          onclick={() => (period = Number(n) * 60000)}>{$t(String(label))}</button
        >{/each}
    </div>
  </div>
  <div class="chart-filters">
    <select aria-label={$t('Chart metric')} bind:value={type}
      ><option value="all">{$t('All file events')}</option><option value="sensitive"
        >{$t('Sensitive events')}</option
      ></select
    ><select aria-label={$t('Chart agent')} bind:value={agent}
      ><option value="">{$t('All agents')}</option>{#each names as name (name)}<option value={name}
          >{name}</option
        >{/each}{#if agent && !names.includes(agent)}<option value={agent}
          >{agent} {$t('· no retained events')}</option
        >{/if}</select
    >
  </div>
  <div class="chart-reading">
    <strong>{bins.reduce((sum, b) => sum + b.events.length, 0)}</strong><span
      >{$t('retained events in period')}</span
    ><span class="chart-max">{$t('Scale 0–')}{maximum} {$t('/ interval')}</span>
  </div>
  <div
    class="activity-plot"
    role="group"
    aria-label={$t('File activity histogram')}
    onpointerleave={() => (hover = null)}
  >
    {#each bins as bin, i (i)}<button
        class="chart-bucket"
        tabindex={focus === i ? 0 : -1}
        aria-label={caption(i)}
        title={caption(i)}
        onpointerenter={() => (hover = i)}
        onfocus={() => {
          focus = i;
          focused = true;
        }}
        onblur={() => (focused = false)}
        onkeydown={(e) => keys(e, i)}
        onclick={() =>
          inspect('Activity interval', {
            from: new Date(bin.start).toISOString(),
            to: new Date(bin.end).toISOString(),
            count: bin.events.length,
            observations: bin.events,
          })}
        ><span class="chart-column" style={`transform:scaleY(${bin.events.length / maximum})`}
        ></span><span class="chart-hitline"></span></button
      >{/each}
  </div>
  <div class="chart-axis">
    <span>{activityTimeLabel(end - period)}</span><span>{activityTimeLabel(end - 1)}</span>
  </div>
  <div class="chart-readout">
    {selection === null
      ? observedAt === null && !events.length
        ? $t('Waiting for observations.')
        : paused
          ? $t('View paused · retained window frozen.')
          : stale
            ? $t('Observation unavailable · retained window frozen.')
            : $t('Select an interval to inspect its events.')
      : caption(selection) + ' · Interval held while inspecting'}
  </div>
</section>

<style>
  .chart-readout {
    line-height: 1.5;
    min-height: calc(3em + var(--space-2) + var(--space-3));
  }
</style>
