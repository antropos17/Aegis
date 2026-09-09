<script lang="ts">
  import { activityBins } from '../runtime/activity';
  import type { FileEvent } from '../../../src/shared/types';
  import type { RecordData } from '../runtime/host';
  import Icon from './Icon.svelte';
  let {
    events,
    observedAt,
    inspect,
  }: {
    events: FileEvent[];
    observedAt: number | null;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let period = $state(15 * 60000),
    type = $state('all'),
    instance = $state(''),
    hover = $state<number | null>(null),
    focus = $state(0);
  let end = $derived(Math.max(observedAt ?? 0, ...events.map((e) => e.timestamp)) + 1);
  let bins = $derived(
    activityBins(
      events.filter(
        (e) => (!instance || e.instanceId === instance) && (type === 'all' || e.sensitive),
      ),
      end,
      period,
    ),
  );
  let maximum = $derived(
    Math.max(5, Math.ceil(Math.max(1, ...bins.map((b) => b.events.length)) / 5) * 5),
  );
  let identities = $derived([
    ...new Map(events.filter((e) => e.instanceId).map((e) => [e.instanceId!, e.agent])).entries(),
  ]);
  function caption(i: number) {
    const b = bins[i];
    return `${new Date(b.start).toLocaleTimeString()}–${new Date(b.end).toLocaleTimeString()} · ${b.events.length} observations`;
  }
  function keys(e: KeyboardEvent, i: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    focus =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? 23
          : Math.max(0, Math.min(23, i + (e.key === 'ArrowRight' ? 1 : -1)));
    (e.currentTarget as HTMLElement).parentElement
      ?.querySelectorAll<HTMLButtonElement>('button')
      .item(focus)
      ?.focus();
  }
</script>

<section class="panel activity-chart">
  <div class="panel-head">
    <h2><Icon name="chart" />Activity</h2>
    <div class="segmented" aria-label="Chart period">
      {#each [[5, '5 min'], [15, '15 min'], [60, '1 hour']] as [n, label] (n)}<button
          aria-pressed={period === Number(n) * 60000}
          onclick={() => (period = Number(n) * 60000)}>{label}</button
        >{/each}
    </div>
  </div>
  <div class="chart-filters">
    <select aria-label="Chart metric" bind:value={type}
      ><option value="all">All file events</option><option value="sensitive"
        >Sensitive events</option
      ></select
    ><select aria-label="Chart agent" bind:value={instance}
      ><option value="">All instances</option>{#each identities as [id, name] (id)}<option
          value={id}>{name ?? 'Unknown'} · {id.split(':').at(-1)}</option
        >{/each}</select
    >
  </div>
  <div class="chart-reading">
    <strong>{bins.reduce((sum, b) => sum + b.events.length, 0)}</strong><span>events in period</span
    ><span class="chart-max">Scale 0–{maximum}</span>
  </div>
  <div class="activity-plot" role="group" aria-label="File activity histogram">
    {#each bins as bin, i (i)}<button
        class="chart-bucket"
        tabindex={focus === i ? 0 : -1}
        aria-label={caption(i)}
        title={caption(i)}
        onpointerenter={() => (hover = i)}
        onfocus={() => {
          focus = i;
          hover = i;
        }}
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
    <span>{new Date(end - period).toLocaleTimeString().slice(0, 5)}</span><span
      >{new Date(end).toLocaleTimeString().slice(0, 5)}</span
    >
  </div>
  <div class="chart-readout">
    {hover === null ? 'Select an interval to inspect its events.' : caption(hover)}
  </div>
</section>
