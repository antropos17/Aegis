<script lang="ts">
  import type { RecordData } from '../runtime/host';
  import { describeObservation, observationTime } from '../../../src/shared/observation-display.js';
  import ObservationResource from './ObservationResource.svelte';
  let {
    rows,
    navigate,
    limit = $bindable(20),
  }: {
    rows: RecordData[];
    navigate: (_title: string, _row: RecordData) => Promise<void>;
    limit?: number;
  } = $props();
  let sorted = $derived(
    [...rows].sort((a, b) => observationTime(b.timestamp) - observationTime(a.timestamp)),
  );
</script>

<div class="observation-history">
  <div class="section-heading">
    <h3>Recorded observations</h3>
    <span>{rows.length}</span>
  </div>
  <p class="entity-note">Each record keeps its own time, process and evidence.</p>
  {#each sorted.slice(0, limit) as row, i (i)}{@const info = describeObservation(row)}
    <button
      class="recent-event"
      data-detail-focus={'record-' + i}
      onclick={() => navigate('Observation', row)}
    >
      <time
        >{observationTime(row.timestamp)
          ? new Date(observationTime(row.timestamp)).toLocaleTimeString()
          : 'Snapshot'}</time
      >
      <span
        ><ObservationResource {row} /><small
          >{String(row.action || row.type || row.state || 'Observed')} · {info.actor ||
            info.context ||
            'Actor not recorded'}{row.pid ? ` · PID ${row.pid}` : ''} · {info.attribution}</small
        ></span
      >
    </button>
  {:else}<p class="entity-note">No recorded observations.</p>{/each}
  {#if sorted.length > limit}<button class="button" onclick={() => (limit += 20)}
      >Show 20 more</button
    >{/if}
</div>

<style>
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-heading h3 {
    margin: 0;
  }
  .recent-event {
    align-items: start;
    text-align: left;
  }
  .recent-event > span {
    min-width: 0;
    flex: 1;
  }
  small,
  time {
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
  }
  time {
    white-space: nowrap;
  }
</style>
