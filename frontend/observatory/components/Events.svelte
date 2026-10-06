<script lang="ts">
  import { t } from '../runtime/i18n';
  import { untrack } from 'svelte';

  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  import { scopeEvidence, type AgentScope } from '../runtime/agent-scope';
  import { networkSnapshotStatus } from '../runtime/network-coverage';
  import Icon from './Icon.svelte';
  import ObservationTable from './ObservationTable.svelte';
  let {
    telemetry,
    network = false,
    showPause = true,
    viewPaused = false,
    scope,
    inspect,
    openSensors,
    advanced = true,
    combined = false,
    visible = true,
  }: {
    telemetry: Telemetry;
    network?: boolean;
    showPause?: boolean;
    viewPaused?: boolean;
    scope?: AgentScope;
    inspect: (_title: string, _row: RecordData) => void;
    openSensors?: () => void | Promise<void>;
    advanced?: boolean;
    combined?: boolean;
    visible?: boolean;
  } = $props();
  let query = $state(''),
    kind = $state('all'),
    agent = $state(''),
    attribution = $state('all'),
    severity = $state('all');
  let paused = $state(false);
  let held = $state.raw<{ files: RecordData[]; connections: RecordData[] }>({
    files: [],
    connections: [],
  });
  let channel = $state<'files' | 'connections'>('files');
  let effectiveNetwork = $derived(combined ? channel === 'connections' : network);
  let simpleFilter = $state<'all' | 'sensitive' | 'changes'>('all');
  let readingSnapshot = $state(false);
  let admissionRevision = $state(0);
  let wasPaused = false;
  let networkSeen = $state(false);
  const prefix = $props.id();
  let filtersOpen = $state(false);
  let showingPaused = $derived(paused || (!showPause && viewPaused));
  $effect(() => {
    const nextPaused = showingPaused;
    untrack(() => {
      if (!showPause && wasPaused && !nextPaused) admissionRevision += 1;
      wasPaused = nextPaused;
    });
  });
  let grouping = $state<'resource' | 'agent' | 'none'>('resource');
  let effectiveGrouping = $derived(advanced ? grouping : 'none');
  let rawRows = $derived(
    (paused
      ? effectiveNetwork
        ? held.connections
        : held.files
      : effectiveNetwork
        ? telemetry.network
        : telemetry.events) as unknown as RecordData[],
  );
  let rows = $derived(scope ? scopeEvidence(rawRows, telemetry, scope) : rawRows);
  let networkStatus = $derived(networkSnapshotStatus(telemetry, rows.length));
  $effect(() => {
    if (effectiveNetwork && rows.length > 0) networkSeen = true;
  });
  let localAgentFilter = $derived(advanced && !scope ? agent : '');
  let attributionFilter = $derived(advanced && scope && !scope.agent ? attribution : 'all');
  let effectiveKind = $derived(
    advanced
      ? scope && kind === 'unattributed'
        ? 'all'
        : kind
      : !effectiveNetwork
        ? simpleFilter
        : 'all',
  );
  let effectiveSeverity = $derived(advanced ? severity : 'all');
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
          (effectiveNetwork
            ? (row.verdict ?? 'unknown') === effectiveKind
            : effectiveKind === 'skills'
              ? !!info.skill
              : effectiveKind === 'changes'
                ? ['created', 'modified', 'deleted'].includes(String(row.action))
                : effectiveKind === 'sensitive'
                  ? row.sensitive
                  : !info.actor)) &&
        (effectiveSeverity === 'all' ||
          (effectiveSeverity === 'attention'
            ? row.sensitive
            : row.severity === effectiveSeverity)) &&
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
    simpleFilter = 'all';
  }
  function chooseChannel(next: 'files' | 'connections') {
    channel = next;
    kind = 'all';
    severity = 'all';
    readingSnapshot = false;
  }
</script>

{#if combined}<div class="activity-channels" role="group" aria-label={$t('Activity source')}>
    <button class="button" aria-pressed={!effectiveNetwork} onclick={() => chooseChannel('files')}
      ><Icon name="folder" />{$t('Files')}</button
    >
    <button
      class="button"
      aria-pressed={effectiveNetwork}
      onclick={() => chooseChannel('connections')}
      ><Icon name="network" />{$t('Connections')}</button
    >
  </div>{/if}
{#if effectiveNetwork}<div class="notice">
    <Icon name="network" />{$t(
      'Endpoint verification describes the address. Agent identity is shown separately.',
    )}
  </div>{/if}
<div class="filterbar evidence-filters">
  <label class="search-field"
    ><Icon name="search" /><input
      aria-label={effectiveNetwork ? $t('Search connections') : $t('Search events')}
      type="search"
      placeholder={effectiveNetwork ? $t('Address or agent') : $t('Skill, path or agent')}
      bind:value={query}
    /></label
  >
  {#if advanced}<label class="grouping-filter"
      >{$t('Grouping')}<select aria-label={$t('Grouping')} bind:value={grouping}
        ><option value="resource">{$t('By resource')}</option><option value="agent"
          >{$t('By agent / context')}</option
        ><option value="none">{$t('Every observation')}</option></select
      ></label
    >{/if}
  <div class="filter-actions">
    {#if advanced}<button
        class="button"
        aria-expanded={filtersOpen}
        aria-controls={prefix + '-filters'}
        onclick={() => (filtersOpen = !filtersOpen)}
        ><Icon name="settings" />{$t('Filters')}
        {#if effectiveKind !== 'all' || localAgentFilter || attributionFilter !== 'all' || effectiveSeverity !== 'all'}<span
            class="badge">{$t('Active')}</span
          >{/if}</button
      >{:else if !effectiveNetwork}
      <button
        class="button"
        aria-pressed={simpleFilter === 'all'}
        onclick={() => (simpleFilter = 'all')}>{$t('All activity')}</button
      >
      <button
        class="button"
        aria-pressed={simpleFilter === 'changes'}
        onclick={() => (simpleFilter = 'changes')}>{$t('Filesystem changes')}</button
      >
      <button
        class="button"
        aria-pressed={simpleFilter === 'sensitive'}
        onclick={() => (simpleFilter = 'sensitive')}>{$t('Sensitive events')}</button
      >
    {/if}
    {#if showPause}<button
        class="button"
        onclick={() => {
          if (!paused)
            held = {
              files: [...telemetry.events] as unknown as RecordData[],
              connections: [...telemetry.network] as unknown as RecordData[],
            };
          else admissionRevision += 1;
          paused = !paused;
        }}
        ><Icon name={paused ? 'play' : 'pause'} />{paused
          ? $t('Resume live view')
          : $t('Pause view')}</button
      >{/if}
    <button class="button" aria-label={$t('Reset filters')} onclick={reset}
      ><Icon name="refresh" />{$t('Reset')}</button
    >
  </div>
</div>
{#if advanced}<div class="advanced-filters" id={prefix + '-filters'} hidden={!filtersOpen}>
    {#if !scope}<label
        >{$t('Agent / context')}<select aria-label={$t('Event agent')} bind:value={agent}
          ><option value="">{$t('All agents and resources')}</option
          >{#each agentNames as name (name)}<option>{name}</option>{/each}<option
            value="unattributed">{$t('Actor not recorded')}</option
          ></select
        ></label
      >{:else if !scope.agent}<label
        >{$t('Attribution')}<select aria-label={$t('Attribution')} bind:value={attribution}>
          <option value="all">{$t('All attribution')}</option>
          <option value="unattributed">{$t('Actor not recorded')}</option>
        </select></label
      >{/if}
    <label
      >{effectiveNetwork ? $t('Classification') : $t('Type')}<select
        aria-label={$t('Event kind')}
        bind:value={kind}
        ><option value="all">{$t('All')}</option>{#if effectiveNetwork}<option value="flagged"
            >{$t('Not allowlisted')}</option
          ><option value="unknown">{$t('Endpoint unverified')}</option><option value="allowlisted"
            >{$t('Allowlisted')}</option
          >{:else}<option value="skills">{$t('Skills')}</option><option value="sensitive"
            >{$t('Sensitive events')}</option
          >{#if !scope}<option value="unattributed">{$t('Actor not recorded')}</option
            >{/if}{/if}</select
      ></label
    >
    {#if !effectiveNetwork}<label
        >{$t('Severity')}<select bind:value={severity}
          ><option value="all">{$t('All')}</option><option value="attention"
            >{$t('Needs review')}</option
          ><option value="high">{$t('High')}</option><option value="medium">{$t('Medium')}</option
          ><option value="low">{$t('Low')}</option></select
        ></label
      >{/if}
  </div>{/if}
{#if paused}<p class="notice">
    {$t('View paused · backend monitoring continues.')}
  </p>{/if}
<div class="evidence-status" role="status">
  <span
    >{#if readingSnapshot}{$t('Reading retained activity')} · {effectiveNetwork
        ? $t('Retained network snapshot')
        : $t('Paused snapshot')}{:else if effectiveNetwork && networkStatus === 'unavailable'}{$t(
        'Network observation unavailable',
      )}{:else}{filtered.length}
      {$t('of')}
      {rows.length}
      {effectiveNetwork ? $t('connections') : $t('events')} · {effectiveNetwork &&
      (networkStatus === 'retained' || readingSnapshot)
        ? $t('Retained network snapshot')
        : showingPaused
          ? $t('Paused snapshot')
          : effectiveNetwork
            ? $t('Latest connection snapshot')
            : $t('Live view')}{/if}</span
  >{#if query || effectiveKind !== 'all' || localAgentFilter || attributionFilter !== 'all' || effectiveSeverity !== 'all'}<span
      class="badge">{$t('Filters active')}</span
    >{/if}
</div>
{#if effectiveNetwork && networkStatus === 'unavailable'}
  <div class="notice network-recovery">
    <p>
      {$t('No current network snapshot. Check sensor health in Statistics.')}
    </p>
    {#if openSensors}
      <button class="button" onclick={openSensors}
        ><Icon name="activity" />{$t('Review sensor health')}</button
      >
    {/if}
  </div>
{/if}
{#if !effectiveNetwork || networkStatus !== 'unavailable' || networkSeen}
  <ObservationTable
    rows={filtered}
    {telemetry}
    {inspect}
    grouping={effectiveGrouping}
    {visible}
    paused={showingPaused}
    {admissionRevision}
    onSnapshotChange={(held) => (readingSnapshot = held)}
    resetKey={JSON.stringify([
      query,
      effectiveKind,
      localAgentFilter,
      attributionFilter,
      effectiveSeverity,
      effectiveNetwork,
      scope?.agent,
      scope?.instanceId,
    ])}
  />
{/if}

<style>
  .activity-channels {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .activity-channels .button[aria-pressed='true'],
  .filter-actions .button[aria-pressed='true'] {
    background: var(--selection);
    border-color: var(--selection-border);
  }
  .network-recovery {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .network-recovery p {
    margin: 0;
    flex: 1 1 240px;
  }
  .network-recovery .button {
    white-space: normal;
    min-height: var(--control-height);
    height: auto;
  }
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
