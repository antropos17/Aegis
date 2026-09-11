<script lang="ts">
  import { tick } from 'svelte';
  import type { Telemetry, RecordData } from '../runtime/host';
  import { radarResources, type RadarResource } from '../runtime/radar-resources';
  import RadarResourceList from './RadarResourceList.svelte';
  import RadarLinks from './RadarLinks.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    liveTelemetry,
    layer,
    inspect,
    agent = $bindable(''),
  }: {
    telemetry: Telemetry;
    liveTelemetry?: Telemetry;
    layer: string;
    inspect: (_title: string, _row: RecordData) => void;
    agent?: string;
  } = $props();
  let previous:
    | {
        agents: Telemetry['agents'];
        rows: Telemetry['events'] | Telemetry['network'];
        result: RadarResource[];
      }
    | undefined;
  function read() {
    const rows = layer === 'files' ? telemetry.events : telemetry.network;
    if (previous?.agents === telemetry.agents && previous.rows === rows) return previous.result;
    const result = radarResources(telemetry, layer);
    previous = { agents: telemetry.agents, rows, result };
    return result;
  }
  const resources = $derived(read());
  const ready = $derived(telemetry.ready && (layer === 'files' || telemetry.networkAt !== null));
  const actors = $derived(
    [
      ...new Set(
        [
          ...resources.flatMap((resource) => resource.relations.map((relation) => relation.actor)),
          agent,
        ].filter(Boolean),
      ),
    ].sort(),
  );
  let query = $state('');
  let category = $state('all');
  let selected = $state.raw<RadarResource | null>(null);
  let heading = $state<HTMLHeadingElement>();
  let origin: HTMLButtonElement;
  const filtered = $derived(
    resources.filter(
      (resource) =>
        (!agent || resource.relations.some((relation) => relation.actor === agent)) &&
        (category === 'all' ||
          category === resource.level ||
          (category === 'unattributed' &&
            resource.relations.some((relation) => !relation.actor))) &&
        `${resource.label} ${resource.address} ${resource.ip} ${resource.rows.map((row) => String(row.domain || '')).join(' ')} ${resource.relations.map((relation) => relation.actor + ' ' + relation.actions.join(' ')).join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
  );
  const current = $derived(
    selected ? (resources.find((resource) => resource.key === selected!.key) ?? selected) : null,
  );
  const retained = $derived(
    !selected || resources.some((resource) => resource.key === selected!.key),
  );
  const attention = $derived(filtered.filter((resource) => resource.level === 'review').length);
  const uncertain = $derived(
    filtered.filter((resource) =>
      layer === 'network'
        ? resource.level === 'unverified'
        : resource.relations.some((relation) => !relation.actor),
    ).length,
  );
  async function select(resource: RadarResource, button: HTMLButtonElement) {
    selected = resource;
    origin = button;
    await tick();
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({ block: 'nearest' });
  }
  function clear() {
    selected = null;
    if (origin?.isConnected) origin.focus();
  }
</script>

<section
  class="resource-explorer"
  aria-label={layer === 'files' ? 'File activity explorer' : 'Network activity explorer'}
>
  <div class="explorer-summary">
    <div>
      <strong
        >{telemetry.ready && (layer === 'files' || telemetry.networkAt !== null)
          ? filtered.length
          : '—'}</strong
      ><span>{layer === 'files' ? 'unique files' : 'unique destinations'}</span>
    </div>
    <div>
      <strong class:attention={attention > 0}
        >{telemetry.ready && (layer === 'files' || telemetry.networkAt !== null)
          ? attention
          : '—'}</strong
      ><span>need review</span>
    </div>
    <div>
      <strong
        >{telemetry.ready && (layer === 'files' || telemetry.networkAt !== null)
          ? uncertain
          : '—'}</strong
      ><span>{layer === 'files' ? 'without an identified agent' : 'unverified destinations'}</span>
    </div>
  </div>
  <p class="scope-note">
    {!ready
      ? 'Waiting for observations'
      : telemetry.stale
        ? 'Last available observations'
        : layer === 'files'
          ? 'Retained file observations'
          : 'Latest connection snapshot'} · All radar pages are included. {layer === 'files'
      ? 'Activity in agents’ own files is included.'
      : 'Connections do not establish what data was sent.'}
  </p>
  <div class="explorer-filters">
    <label
      >Agent<select aria-label="Resource agent" bind:value={agent}
        ><option value="">All agents</option>{#each actors as name (name)}<option value={name}
            >{name}</option
          >{/each}</select
      ></label
    >
    <label
      >Show<select aria-label="Resource attention" bind:value={category}
        ><option value="all">All observations</option><option value="review">Needs review</option
        >{#if layer === 'network'}<option value="unverified">Unverified destinations</option
          >{/if}<option value="unattributed">Agent not identified</option></select
      ></label
    >
    <label class="resource-search"
      >Search<input
        type="search"
        aria-label={layer === 'files' ? 'Search radar files' : 'Search radar destinations'}
        placeholder={layer === 'files' ? 'File, path, agent or action…' : 'Domain, IP or agent…'}
        bind:value={query}
      /></label
    >
    {#if agent || query || category !== 'all'}<button
        class="button"
        onclick={() => {
          agent = '';
          query = '';
          category = 'all';
        }}>Clear filters</button
      >{/if}
  </div>
  <div class="explorer-body">
    {#key JSON.stringify([agent, category, query])}<RadarResourceList
        resources={filtered}
        {layer}
        selected={selected?.key}
        {select}
        {ready}
      />{/key}
    <div class="resource-details">
      <div class="detail-heading">
        <h3 bind:this={heading} tabindex="-1">
          {current ? 'Resource details' : 'Follow an agent’s activity'}
        </h3>
        {#if current}<button class="button" onclick={clear}>Clear resource selection</button>{/if}
      </div>
      {#if current && retained && !filtered.some((resource) => resource.key === current.key)}<p
          class="scope-note"
        >
          The selected resource is outside the current filters.
        </p>{/if}
      {#if current}<RadarLinks
          resource={current}
          {layer}
          telemetry={liveTelemetry ?? telemetry}
          {inspect}
          {retained}
        />
      {:else}<div class="resource-guide">
          <Icon name={layer === 'files' ? 'folder' : 'network'} />
          <h4>
            {layer === 'files'
              ? 'Choose a file to see who touched it'
              : 'Choose a destination to see who connected'}
          </h4>
          <p>Each resource keeps its recorded agents, process identities and actions together.</p>
          <div class="guide-flow">
            <span>Agent / process</span><Icon name="chevron" /><span
              >{layer === 'files' ? 'File + action' : 'Address + connection'}</span
            >
          </div>
          <p>
            Solid links have confirmed ownership evidence. Dashed links carry indirect or older
            attribution. Unidentified actors have no connecting line.
          </p>
        </div>{/if}
    </div>
  </div>
</section>

<style>
  .resource-explorer {
    padding: var(--space-4);
    font-size: var(--text-body);
    min-width: 0;
  }
  .explorer-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: center;
  }
  .explorer-summary > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .explorer-summary strong {
    font-size: var(--text-title);
  }
  .explorer-summary span,
  .scope-note {
    color: var(--muted);
  }
  .attention {
    color: var(--amber);
  }
  .scope-note {
    margin: var(--space-2) 0 var(--space-4);
    line-height: 1.6;
  }
  .explorer-filters {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  label {
    display: grid;
    gap: var(--space-1);
    color: var(--muted);
    min-width: 0;
    flex: 1 1 150px;
  }
  .resource-search {
    flex: 2 1 210px;
  }
  input,
  select {
    min-width: 0;
    max-width: 100%;
    width: 100%;
  }
  .explorer-body {
    display: grid;
    grid-template-columns: minmax(250px, 0.85fr) minmax(0, 1.15fr);
    gap: var(--space-4);
    align-items: start;
  }
  .resource-details {
    min-width: 0;
  }
  .detail-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
    min-height: var(--control-height);
  }
  h3 {
    font-size: var(--text-section);
    margin: 0;
  }
  h4 {
    font-size: var(--text-section);
    margin: var(--space-3) 0;
  }
  .resource-guide {
    padding: var(--space-5);
    border: 1px dashed var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--bg);
    color: var(--muted);
    line-height: 1.7;
  }
  .resource-guide p {
    margin: var(--space-3) 0 0;
  }
  .guide-flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-4) 0;
    color: var(--ink);
  }
  .guide-flow span {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    background: var(--panel);
  }
  @media (max-width: 1000px) {
    .explorer-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
