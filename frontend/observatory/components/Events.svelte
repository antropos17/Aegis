<script lang="ts">
  import { record, instances, type Telemetry, type RecordData } from '../runtime/host';
  import { skillFromPath } from '../../../src/shared/skill-path.js';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
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
    severity = $state('all'),
    page = $state(0),
    paused = $state(false),
    held = $state<RecordData[]>([]),
    grouping = $state('time');
  let rows = $derived(
    (paused ? held : network ? telemetry.network : telemetry.events).map(
      (v) => v as unknown as RecordData,
    ),
  );
  let agentNames = $derived(
    [...new Set(rows.map((r) => String(r.agent ?? '')).filter(Boolean))].sort(),
  );
  let filtered = $derived(
    rows
      .filter(
        (row) =>
          (!agent || (agent === 'unattributed' ? !row.agent : row.agent === agent)) &&
          (kind === 'all' ||
            (network
              ? (row.verdict ?? 'unknown') === kind
              : kind === 'sensitive'
                ? row.sensitive
                : !row.agent || record(row.attribution).status === 'unattributed')) &&
          (severity === 'all' ||
            (severity === 'attention' ? row.sensitive : row.severity === severity)) &&
          JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          (grouping === 'agent' ? String(a.agent ?? '').localeCompare(String(b.agent ?? '')) : 0) ||
          Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0),
      ),
  );
  let visible = $derived(filtered.slice(page * 40, (page + 1) * 40));
  $effect(() => {
    query;
    kind;
    agent;
    severity;
    network;
    grouping;
    page = 0;
  });
  function attribution(row: RecordData) {
    const a = record(row.attribution);
    return a.status === 'confirmed'
      ? 'PID confirmed'
      : a.status === 'inferred'
        ? 'Indirect match'
        : a.status === 'ambiguous'
          ? 'Ambiguous'
          : 'Unknown';
  }
  function inspectAgent(row: RecordData) {
    const a = instances(telemetry).find((a) => !!row.instanceId && a.instanceId === row.instanceId);
    inspect(
      a?.name ?? 'Attributed instance',
      (a as unknown as RecordData) ?? { instanceId: row.instanceId, agent: row.agent },
    );
  }
  function reset() {
    query = '';
    kind = 'all';
    agent = '';
    severity = 'all';
  }
</script>

{#if network}<div class="notice">
    <Icon name="network" />Address classification and agent risk are separate assessments. An
    unknown hostname does not imply a threat.
  </div>{/if}
<div class="filterbar">
  {#if !network}<label class="search-field"
      ><Icon name="search" /><input
        aria-label="Search events"
        type="search"
        placeholder="Path or agent"
        bind:value={query}
      /></label
    >{/if}
  <label
    >Agent<select aria-label="Event agent" bind:value={agent}
      ><option value="">All agents</option>{#each agentNames as name (name)}<option>{name}</option
        >{/each}<option value="unattributed">Unattributed</option></select
    ></label
  >
  <label
    >{network ? 'Classification' : 'Type'}<select aria-label="Event kind" bind:value={kind}
      ><option value="all">All</option>{#if network}<option value="flagged">Not allowlisted</option
        ><option value="unknown">Unknown</option><option value="allowlisted">Allowlisted</option
        >{:else}<option value="sensitive">Sensitive events</option><option value="unattributed"
          >Unattributed</option
        >{/if}</select
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
    >{network ? 'Sort by' : 'Grouping'}<select aria-label="Grouping" bind:value={grouping}
      ><option value="time">{network ? 'Recent first' : 'Chronological'}</option><option
        value="agent">Group by agent</option
      ></select
    ></label
  >
  {#if showPause}<button
      class="button"
      onclick={() => {
        if (!paused) held = rows;
        paused = !paused;
      }}
      ><Icon name={paused ? 'play' : 'pause'} />{paused ? 'Resume live view' : 'Pause view'}</button
    >{/if}<button class="button" aria-label="Reset filters" onclick={reset}>Reset</button><span
    class="spacer"
  ></span><span class="filter-count">{filtered.length} {network ? 'connections' : 'events'}</span>
</div>
{#if paused}<p class="notice">View paused · backend monitoring continues.</p>{/if}
<section class="panel">
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          >{#if network}<th>Agent</th><th>Address</th><th>Port</th><th>State</th><th
              >Classification</th
            ><th>Evidence</th>{:else}<th>Time</th><th>Agent</th><th>Action</th><th>Resource</th><th
              >Severity</th
            ><th>Attribution</th>{/if}</tr
        ></thead
      >
      <tbody
        >{#each visible as row, i (row)}{@const skill = skillFromPath(row.file)}
          {#if grouping === 'agent' && (i === 0 || row.agent !== visible[i - 1].agent)}<tr
              class="group-row"><th colspan="6">{String(row.agent ?? 'Unattributed')}</th></tr
            >{/if}
          <tr
            >{#if network}
              <td
                ><button class="table-agent" onclick={() => inspectAgent(row)}
                  ><AgentLogo name={String(row.agent ?? '')} />{String(
                    row.agent ?? 'Unknown',
                  )}</button
                ></td
              >
              <td
                ><button class="entity-link" onclick={() => inspect('Network observation', row)}
                  ><Icon name="globe" />{String(
                    row.domain ?? row.remoteIp ?? row.ip ?? 'Unknown',
                  )}</button
                >{#if row.domain}<small class="mono">{String(row.remoteIp ?? row.ip ?? '')}</small
                  >{/if}</td
              ><td class="mono">{String(row.remotePort ?? row.port ?? '—')}</td><td class="mono"
                >{String(row.state ?? 'Unknown')}</td
              ><td
                ><span class="badge" class:medium={row.verdict === 'flagged'}
                  >{row.verdict === 'allowlisted'
                    ? 'Allowlisted'
                    : row.verdict === 'flagged'
                      ? 'Not allowlisted'
                      : 'Unknown'}</span
                ></td
              ><td
                ><button class="text-button" onclick={() => inspect('Network observation', row)}
                  >Address verification<Icon name="chevron" /></button
                ></td
              >
            {:else}
              <td class="mono"
                >{row.timestamp ? new Date(Number(row.timestamp)).toLocaleTimeString() : '—'}</td
              ><td
                >{#if row.agent}<button class="table-agent" onclick={() => inspectAgent(row)}
                    ><AgentLogo name={String(row.agent)} />{String(row.agent)}</button
                  >{:else}<span class="badge">Unknown</span>{/if}</td
              ><td
                ><span class="event-type"
                  ><Icon name={skill ? 'settings' : 'file'} />{String(
                    row.action ?? 'Observed',
                  )}</span
                ></td
              ><td
                ><button
                  class="event-resource"
                  title={String(row.file ?? '')}
                  onclick={() => inspect('File observation', row)}
                  >{String(row.file ?? 'Unknown resource')}</button
                >{#if skill}<small>Skill · {skill.name} · path observation</small>{/if}</td
              ><td
                ><span class="badge" class:medium={row.sensitive === true}
                  >{String(row.severity ?? (row.sensitive ? 'Sensitive' : '—'))}</span
                ></td
              ><td
                title={Array.isArray(record(row.attribution).evidence)
                  ? (record(row.attribution).evidence as unknown[]).map(String).join(', ')
                  : 'No evidence supplied'}>{attribution(row)}</td
              >
            {/if}</tr
          >
        {:else}<tr
            ><td colspan="6"
              >{telemetry.ready
                ? 'No records match these filters.'
                : 'Waiting for observations.'}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>
<div class="pagination">
  <span
    >{filtered.length ? page * 40 + 1 : 0}–{Math.min((page + 1) * 40, filtered.length)} of {filtered.length}</span
  >
  <div class="toolbar">
    <button class="button" disabled={page === 0} onclick={() => page--}>Previous</button><button
      class="button"
      disabled={(page + 1) * 40 >= filtered.length}
      onclick={() => page++}>Next</button
    >
  </div>
</div>
