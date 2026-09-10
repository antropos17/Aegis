<script lang="ts">
  import type { RecordData } from '../runtime/host';
  import {
    describeObservation,
    observationTime,
    endpointLabel,
  } from '../../../src/shared/observation-display.js';
  import ObservationResource from './ObservationResource.svelte';
  import Icon from './Icon.svelte';
  let {
    rows,
    navigate,
    limit = $bindable(20),
    query = $bindable(''),
  }: {
    rows: RecordData[];
    navigate: (_title: string, _row: RecordData) => Promise<void>;
    limit?: number;
    query?: string;
  } = $props();
  let matching = $derived(
    rows.filter((row) => {
      const info = describeObservation(row);
      return [
        info.path,
        info.resource,
        info.actor,
        info.context,
        info.attribution,
        row.pid,
        row.action,
        row.type,
        row.state,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase());
    }),
  );
  let sorted = $derived(
    [...matching].sort((a, b) => observationTime(b.timestamp) - observationTime(a.timestamp)),
  );
</script>

<div class="observation-history">
  <div class="section-heading">
    <h3>Recorded observations</h3>
    <span>{rows.length}</span>
  </div>
  <label class="detail-search"
    ><Icon name="search" /><input
      aria-label="Find a record"
      type="search"
      placeholder="Resource, action, PID or attribution"
      bind:value={query}
    /></label
  >
  <p class="entity-note">{matching.length} of {rows.length} records · newest first</p>
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
          >{String(row.action || row.state || row.type || 'Observed')} · {info.actor ||
            info.context ||
            'Actor not recorded'}{row.pid ? ` · PID ${row.pid}` : ''}{row.localIp || row.localPort
            ? ' · Local ' +
              (endpointLabel({ remoteIp: row.localIp, remotePort: row.localPort }) ||
                'port ' + row.localPort)
            : ''} · {info.attribution}</small
        ></span
      >
    </button>
  {:else}<p class="entity-note">
      {rows.length ? 'No records match this search.' : 'No recorded observations.'}
    </p>{/each}
  {#if sorted.length > limit}<button class="button" onclick={() => (limit += 20)}
      >Show {Math.min(20, sorted.length - limit)} more</button
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
