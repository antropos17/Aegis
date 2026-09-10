<script lang="ts">
  import type { RecordData } from '../runtime/host';
  import { observationTime } from '../../../src/shared/observation-display.js';
  import ObservationResource from './ObservationResource.svelte';
  import ObservationIdentity from './ObservationIdentity.svelte';
  let {
    rows,
    agents,
    network = false,
    inspect,
    more,
  }: {
    rows: RecordData[];
    agents: RecordData[];
    network?: boolean;
    inspect: (_title: string, _row: RecordData) => void;
    more: () => void;
  } = $props();
  let ordered = $derived(
    [...rows].sort((a, b) => observationTime(b.timestamp) - observationTime(a.timestamp)),
  );
</script>

<section
  class="panel agent-evidence"
  aria-label={network ? 'Selected agent connections' : 'Selected agent file activity'}
>
  <div class="panel-head">
    <h2>{network ? 'Connections' : 'File activity'} <small>{rows.length}</small></h2>
    <button class="text-button" onclick={more}>View all</button>
  </div>
  <div class="evidence-list">
    {#each ordered.slice(0, 4) as row, index (row.id ?? index)}
      <button
        class="evidence-row"
        aria-label={'Inspect ' + (network ? 'connection' : 'file observation') + ' ' + (index + 1)}
        onclick={() => inspect(network ? 'Connection' : 'File observation', row)}
      >
        <div class="evidence-resource">
          <ObservationResource {row} /><ObservationIdentity {row} {agents} />
        </div>
        <span class="evidence-time"
          >{observationTime(row.timestamp)
            ? new Date(observationTime(row.timestamp)).toLocaleTimeString()
            : 'Time not recorded'}</span
        >
      </button>
    {:else}<p class="empty">
        {network
          ? 'No connections with a recorded owner match this selection.'
          : 'No retained file observations with a recorded owner match this selection.'}
      </p>{/each}
  </div>
  <p class="evidence-note">
    {network
      ? 'Endpoint verification is separate from process identity.'
      : 'Unattributed activity stays in the all-agent log.'}{#if rows.length > 4}
      Showing 4 of {rows.length}.{/if}
  </p>
</section>

<style>
  .agent-evidence {
    min-width: 0;
  }
  h2 small {
    margin-left: 6px;
    color: var(--muted);
    font-weight: 400;
  }
  .panel-head {
    gap: 10px;
  }
  .evidence-row {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    padding: var(--space-3) var(--panel-inset);
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
  }
  .evidence-row:hover {
    background: var(--hover);
  }
  .evidence-resource {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .evidence-time {
    white-space: nowrap;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
    font-variant-numeric: tabular-nums;
  }
  .evidence-note,
  .empty {
    margin: 0;
    padding: var(--space-3) var(--panel-inset);
    color: var(--muted);
    line-height: 1.5;
    font-size: var(--text-caption);
  }
</style>
