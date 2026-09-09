<script lang="ts">
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  import Icon from './Icon.svelte';
  import ObservationTable from './ObservationTable.svelte';
  let {
    telemetry,
    network = false,
    showPause = true,
    viewPaused = false,
    inspect,
  }: {
    telemetry: Telemetry;
    network?: boolean;
    showPause?: boolean;
    viewPaused?: boolean;
    inspect: (_title: string, _row: RecordData) => void;
  } = $props();
  let query = $state(''),
    kind = $state('all'),
    agent = $state(''),
    severity = $state('all');
  let paused = $state(false),
    held = $state<RecordData[]>([]);
  let filtersOpen = $state(false);
  let showingPaused = $derived(paused || (!showPause && viewPaused));
  let grouping = $state<'resource' | 'agent' | 'none'>('resource');
  let rows = $derived(
    (paused ? held : network ? telemetry.network : telemetry.events) as unknown as RecordData[],
  );
  let agents = $derived(instances(telemetry) as unknown as RecordData[]);
  let agentNames = $derived(
    [...new Set(rows.map((row) => describeObservation(row, agents).label))].sort(),
  );
  let filtered = $derived(
    rows.filter((row) => {
      const info = describeObservation(row, agents);
      return (
        (!agent || (agent === 'unattributed' ? !info.actor : info.label === agent)) &&
        (kind === 'all' ||
          (network
            ? (row.verdict ?? 'unknown') === kind
            : kind === 'skills'
              ? !!info.skill
              : kind === 'sensitive'
                ? row.sensitive
                : !info.actor)) &&
        (severity === 'all' ||
          (severity === 'attention' ? row.sensitive : row.severity === severity)) &&
        [
          row.file,
          row.path,
          row.domain,
          row.remoteIp,
          row.remotePort,
          row.pid,
          row.action,
          row.type,
          row.reason,
          info.label,
          info.resource,
          info.kind,
          info.context,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    }),
  );
  function reset() {
    query = '';
    kind = 'all';
    agent = '';
    severity = 'all';
  }
</script>

{#if network}<div class="notice">
    <Icon name="network" />Endpoint verification describes the address. Agent identity is shown
    separately.
  </div>{/if}
<div class="filterbar evidence-filters">
  <label class="search-field"
    ><Icon name="search" /><input
      aria-label={network ? 'Search connections' : 'Search events'}
      type="search"
      placeholder={network ? 'Address or agent' : 'Skill, path or agent'}
      bind:value={query}
    /></label
  >
  <label class="grouping-filter"
    >Grouping<select aria-label="Grouping" bind:value={grouping}
      ><option value="resource">By resource</option><option value="agent">By agent / context</option
      ><option value="none">Every observation</option></select
    ></label
  >
  <div class="filter-actions">
    <button
      class="button"
      aria-expanded={filtersOpen}
      aria-controls={network ? 'network-filters' : 'event-filters'}
      onclick={() => (filtersOpen = !filtersOpen)}
      >Filters {#if kind !== 'all' || agent || severity !== 'all'}<span class="badge">Active</span
        >{/if}</button
    >
    {#if showPause}<button
        class="button"
        onclick={() => {
          if (!paused) held = rows;
          paused = !paused;
        }}
        ><Icon name={paused ? 'play' : 'pause'} />{paused
          ? 'Resume live view'
          : 'Pause view'}</button
      >{/if}
    <button class="button" aria-label="Reset filters" onclick={reset}>Reset</button>
  </div>
</div>
<div
  class="advanced-filters"
  id={network ? 'network-filters' : 'event-filters'}
  hidden={!filtersOpen}
>
  <label
    >Agent / context<select aria-label="Event agent" bind:value={agent}
      ><option value="">All agents and resources</option>{#each agentNames as name (name)}<option
          >{name}</option
        >{/each}<option value="unattributed">Actor not recorded</option></select
    ></label
  >
  <label
    >{network ? 'Classification' : 'Type'}<select aria-label="Event kind" bind:value={kind}
      ><option value="all">All</option>{#if network}<option value="flagged">Not allowlisted</option
        ><option value="unknown">Endpoint unverified</option><option value="allowlisted"
          >Allowlisted</option
        >{:else}<option value="skills">Skills</option><option value="sensitive"
          >Sensitive events</option
        ><option value="unattributed">Actor not recorded</option>{/if}</select
    ></label
  >
  {#if !network}<label
      >Severity<select bind:value={severity}
        ><option value="all">All</option><option value="attention">Needs review</option><option
          value="high">High</option
        ><option value="medium">Medium</option><option value="low">Low</option></select
      ></label
    >{/if}
</div>
{#if paused}<p class="notice">View paused · backend monitoring continues.</p>{/if}
<div class="evidence-status" role="status">
  <span
    >{filtered.length} of {rows.length}
    {network ? 'connections' : 'events'} · {showingPaused ? 'Paused snapshot' : 'Live view'}</span
  >{#if query || kind !== 'all' || agent || severity !== 'all'}<span class="badge"
      >Filters active</span
    >{/if}
</div>
<ObservationTable
  rows={filtered}
  {telemetry}
  {inspect}
  {grouping}
  resetKey={JSON.stringify([query, kind, agent, severity, network])}
/>

<style>
  .evidence-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
  }
  .evidence-filters > label {
    min-width: 0;
    margin: 0;
  }
  .evidence-filters > .search-field {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    flex: 1 1 180px;
    gap: 8px;
  }
  .evidence-filters > .search-field input {
    flex: 1 1 0;
    width: 100%;
    min-width: 0;
  }
  .grouping-filter {
    flex: 0 1 190px;
  }
  .grouping-filter select {
    width: 100%;
    min-width: 0;
  }
  .filter-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .advanced-filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    padding: 14px;
    margin-top: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .advanced-filters[hidden] {
    display: none;
  }
  .advanced-filters label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
    min-width: 0;
  }
  .advanced-filters select {
    width: 100%;
    min-width: 0;
  }
  .evidence-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 12px 0;
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
  }
  @media (max-width: 1050px) {
    .advanced-filters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
