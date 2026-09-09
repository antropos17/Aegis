<script lang="ts">
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  import Icon from './Icon.svelte';
  import ObservationTable from './ObservationTable.svelte';
  let {
    telemetry,
    network = false,
    showPause = true,
    inspect,
  }: {
    telemetry: Telemetry;
    network?: boolean;
    showPause?: boolean;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let query = $state(''),
    kind = $state('all'),
    agent = $state(''),
    severity = $state('all');
  let paused = $state(false),
    held = $state<RecordData[]>([]);
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
        [JSON.stringify(row), info.label, info.resource, info.kind, info.context]
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
<div class="filterbar">
  <label class="search-field"
    ><Icon name="search" /><input
      aria-label={network ? 'Search connections' : 'Search events'}
      type="search"
      placeholder={network ? 'Address or agent' : 'Skill, path or agent'}
      bind:value={query}
    /></label
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
  <label
    >Grouping<select aria-label="Grouping" bind:value={grouping}
      ><option value="resource">By resource</option><option value="agent">By agent / context</option
      ><option value="none">Every observation</option></select
    ></label
  >
  {#if showPause}<button
      class="button"
      onclick={() => {
        if (!paused) held = rows;
        paused = !paused;
      }}
      ><Icon name={paused ? 'play' : 'pause'} />{paused ? 'Resume live view' : 'Pause view'}</button
    >{/if}
  <button class="button" aria-label="Reset filters" onclick={reset}>Reset</button>
</div>
{#if paused}<p class="notice">View paused · backend monitoring continues.</p>{/if}
<ObservationTable
  rows={filtered}
  {telemetry}
  {inspect}
  {grouping}
  resetKey={JSON.stringify([query, kind, agent, severity, network])}
/>
