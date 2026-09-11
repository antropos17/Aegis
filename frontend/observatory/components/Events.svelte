<script lang="ts">
  import { t } from '../runtime/i18n';

  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  import { scopeEvidence, type AgentScope } from '../runtime/agent-scope';
  import Icon from './Icon.svelte';
  import ObservationTable from './ObservationTable.svelte';
  let {
    telemetry,
    network = false,
    showPause = true,
    viewPaused = false,
    scope,
    inspect,
  }: {
    telemetry: Telemetry;
    network?: boolean;
    showPause?: boolean;
    viewPaused?: boolean;
    scope?: AgentScope;
    inspect: (_title: string, _row: RecordData) => void;
  } = $props();
  let query = $state(''),
    kind = $state('all'),
    agent = $state(''),
    attribution = $state('all'),
    severity = $state('all');
  let paused = $state(false),
    held = $state<RecordData[]>([]);
  let filtersOpen = $state(false);
  let showingPaused = $derived(paused || (!showPause && viewPaused));
  let grouping = $state<'resource' | 'agent' | 'none'>('resource');
  let rawRows = $derived(
    (paused ? held : network ? telemetry.network : telemetry.events) as unknown as RecordData[],
  );
  let rows = $derived(scope ? scopeEvidence(rawRows, telemetry, scope) : rawRows);
  let localAgentFilter = $derived(scope ? '' : agent);
  let attributionFilter = $derived(scope && !scope.agent ? attribution : 'all');
  let effectiveKind = $derived(scope && kind === 'unattributed' ? 'all' : kind);
  let agents = $derived(instances(telemetry) as unknown as RecordData[]);
  let agentNames = $derived(
    [...new Set(rows.map((row) => describeObservation(row, agents).label))].sort(),
  );
  let filtered = $derived(
    rows.filter((row) => {
      const info = describeObservation(row, agents);
      return (
        (!localAgentFilter ||
          (localAgentFilter === 'unattributed' ? !info.actor : info.label === localAgentFilter)) &&
        (attributionFilter === 'all' || !info.actor) &&
        (effectiveKind === 'all' ||
          (network
            ? (row.verdict ?? 'unknown') === effectiveKind
            : effectiveKind === 'skills'
              ? !!info.skill
              : effectiveKind === 'sensitive'
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
    attribution = 'all';
    severity = 'all';
  }
</script>

{#if network}<div class="notice">
    <Icon name="network" />{$t(
      'Endpoint verification describes the address. Agent identity is shown separately.',
    )}
  </div>{/if}
<div class="filterbar evidence-filters">
  <label class="search-field"
    ><Icon name="search" /><input
      aria-label={network ? $t('Search connections') : $t('Search events')}
      type="search"
      placeholder={network ? $t('Address or agent') : $t('Skill, path or agent')}
      bind:value={query}
    /></label
  >
  <label class="grouping-filter"
    >{$t('Grouping')}<select aria-label={$t('Grouping')} bind:value={grouping}
      ><option value="resource">{$t('By resource')}</option><option value="agent"
        >{$t('By agent / context')}</option
      ><option value="none">{$t('Every observation')}</option></select
    ></label
  >
  <div class="filter-actions">
    <button
      class="button"
      aria-expanded={filtersOpen}
      aria-controls={network ? 'network-filters' : 'event-filters'}
      onclick={() => (filtersOpen = !filtersOpen)}
      >{$t('Filters')}
      {#if effectiveKind !== 'all' || localAgentFilter || attributionFilter !== 'all' || severity !== 'all'}<span
          class="badge">{$t('Active')}</span
        >{/if}</button
    >
    {#if showPause}<button
        class="button"
        onclick={() => {
          if (!paused) held = [...rawRows];
          paused = !paused;
        }}
        ><Icon name={paused ? 'play' : 'pause'} />{paused
          ? $t('Resume live view')
          : $t('Pause view')}</button
      >{/if}
    <button class="button" aria-label={$t('Reset filters')} onclick={reset}>{$t('Reset')}</button>
  </div>
</div>
<div
  class="advanced-filters"
  id={network ? 'network-filters' : 'event-filters'}
  hidden={!filtersOpen}
>
  {#if !scope}<label
      >{$t('Agent / context')}<select aria-label={$t('Event agent')} bind:value={agent}
        ><option value="">{$t('All agents and resources')}</option
        >{#each agentNames as name (name)}<option>{name}</option>{/each}<option value="unattributed"
          >{$t('Actor not recorded')}</option
        ></select
      ></label
    >{:else if !scope.agent}<label
      >{$t('Attribution')}<select aria-label={$t('Attribution')} bind:value={attribution}>
        <option value="all">{$t('All attribution')}</option>
        <option value="unattributed">{$t('Actor not recorded')}</option>
      </select></label
    >{/if}
  <label
    >{network ? $t('Classification') : $t('Type')}<select
      aria-label={$t('Event kind')}
      bind:value={kind}
      ><option value="all">{$t('All')}</option>{#if network}<option value="flagged"
          >{$t('Not allowlisted')}</option
        ><option value="unknown">{$t('Endpoint unverified')}</option><option value="allowlisted"
          >{$t('Allowlisted')}</option
        >{:else}<option value="skills">{$t('Skills')}</option><option value="sensitive"
          >{$t('Sensitive events')}</option
        >{#if !scope}<option value="unattributed">{$t('Actor not recorded')}</option
          >{/if}{/if}</select
    ></label
  >
  {#if !network}<label
      >{$t('Severity')}<select bind:value={severity}
        ><option value="all">{$t('All')}</option><option value="attention"
          >{$t('Needs review')}</option
        ><option value="high">{$t('High')}</option><option value="medium">{$t('Medium')}</option
        ><option value="low">{$t('Low')}</option></select
      ></label
    >{/if}
</div>
{#if paused}<p class="notice">{$t('View paused · backend monitoring continues.')}</p>{/if}
<div class="evidence-status" role="status">
  <span
    >{filtered.length}
    {$t('of')}
    {rows.length}
    {network ? $t('connections') : $t('events')} · {showingPaused
      ? $t('Paused snapshot')
      : $t('Live view')}</span
  >{#if query || effectiveKind !== 'all' || localAgentFilter || attributionFilter !== 'all' || severity !== 'all'}<span
      class="badge">{$t('Filters active')}</span
    >{/if}
</div>
<ObservationTable
  rows={filtered}
  {telemetry}
  {inspect}
  {grouping}
  resetKey={JSON.stringify([
    query,
    effectiveKind,
    localAgentFilter,
    attributionFilter,
    severity,
    network,
    scope?.agent,
    scope?.instanceId,
  ])}
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
