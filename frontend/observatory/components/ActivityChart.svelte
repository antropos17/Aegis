<script lang="ts">
  import { activityBins } from '../runtime/activity';
  import type { FileEvent } from '../../../src/shared/types';
  import type { RecordData } from '../runtime/host';
  let {
    events,
    observedAt,
    inspect,
  }: {
    events: FileEvent[];
    observedAt: number | null;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let period = $state(30 * 60 * 1000);
  let type = $state('all');
  let instance = $state('');
  let hover = $state<number | null>(null);
  let end = $derived(Math.max(observedAt ?? 0, ...events.map((e) => e.timestamp)) + 1);
  let filtered = $derived(
    events.filter(
      (event) =>
        (!instance || event.instanceId === instance) && (type === 'all' || event.sensitive),
    ),
  );
  let bins = $derived(activityBins(filtered, end, period));
  let maximum = $derived(Math.max(1, ...bins.map((bin) => bin.events.length)));
  let identities = $derived([
    ...new Set(events.map((e) => e.instanceId).filter(Boolean)),
  ] as string[]);
  function caption(index: number) {
    const bin = bins[index];
    return `${new Date(bin.start).toLocaleTimeString()}–${new Date(bin.end).toLocaleTimeString()} · ${bin.events.length} observations`;
  }
</script>

<section class="panel activity-chart">
  <div class="panel-head">
    <h2>Activity over time</h2>
    <span>Retained file observations</span>
  </div>
  <div class="toolbar inset">
    <label
      >Period<select bind:value={period}
        ><option value={5 * 60 * 1000}>5 minutes</option><option value={30 * 60 * 1000}
          >30 minutes</option
        ><option value={60 * 60 * 1000}>1 hour</option><option value={24 * 60 * 60 * 1000}
          >24 hours</option
        ></select
      ></label
    ><label
      >Type<select bind:value={type}
        ><option value="all">All</option><option value="sensitive">Sensitive</option></select
      ></label
    ><label
      >Instance<select bind:value={instance}
        ><option value="">All instances</option>{#each identities as id (id)}<option value={id}
            >{id}</option
          >{/each}</select
      ></label
    >
  </div>
  <div class="bars inset" aria-label="File activity histogram">
    {#each bins as bin, index (index)}<button
        aria-label={caption(index)}
        title={caption(index)}
        style={`--height:${(bin.events.length / maximum) * 100}%`}
        onpointerenter={() => (hover = index)}
        onfocus={() => (hover = index)}
        onclick={() =>
          inspect('Activity interval', {
            from: new Date(bin.start).toISOString(),
            to: new Date(bin.end).toISOString(),
            count: bin.events.length,
            observations: bin.events,
          })}><span></span></button
      >{/each}
  </div>
  <p class="inset muted">
    {hover !== null
      ? caption(hover)
      : events.length
        ? 'Focus or hover an interval; activate it to inspect its exact observations.'
        : 'No file observations retained.'}
  </p>
</section>

<style>
  .bars {
    display: flex;
    height: 160px;
    gap: 5px;
    padding-bottom: 0;
  }
  .bars button {
    position: relative;
    flex: 1;
    min-width: 4px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    padding: 0;
  }
  .bars span {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--height);
    min-height: 1px;
    border-radius: 3px 3px 0 0;
    background: var(--muted);
  }
  .activity-chart {
    margin-bottom: 12px;
  }
</style>
