<script lang="ts">
  import { record, type Telemetry, type RecordData } from '../runtime/host';
  import { skillFromPath } from '../../../src/shared/skill-path.js';
  import ActivityChart from './ActivityChart.svelte';
  let {
    telemetry,
    network = false,
    inspect,
  }: {
    telemetry: Telemetry;
    network?: boolean;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let query = $state('');
  let kind = $state('all');
  let page = $state(0);
  let paused = $state(false);
  let held = $state<RecordData[]>([]);
  let grouping = $state('time');
  let rows = $derived(
    (paused ? held : network ? telemetry.network : telemetry.events).map(
      (value) => value as unknown as RecordData,
    ),
  );
  let filtered = $derived(
    rows
      .filter(
        (row) =>
          (kind === 'all' ||
            (network
              ? (row.verdict ?? 'unknown') === kind
              : kind === 'sensitive'
                ? row.sensitive
                : !row.agent || record(row.attribution).status === 'unattributed')) &&
          JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          (grouping === 'agent' ? String(a.agent ?? '').localeCompare(String(b.agent ?? '')) : 0) ||
          Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0),
      ),
  );
  let visible = $derived(filtered.slice(page * 100, (page + 1) * 100));
  $effect(() => {
    query;
    kind;
    network;
    grouping;
    page = 0;
  });
</script>

{#if !network}<ActivityChart
    events={telemetry.events}
    observedAt={telemetry.lastScan}
    {inspect}
  />{/if}
<section class="panel">
  <div class="panel-head">
    <h2>{network ? 'Network connections' : 'File activity'}</h2>
    <span>{filtered.length} retained records</span>
  </div>
  <div class="toolbar inset">
    <input
      aria-label="Search events"
      type="search"
      placeholder="Agent, path, endpoint…"
      bind:value={query}
    />
    <select aria-label="Event kind" bind:value={kind}
      ><option value="all">All records</option>{#if !network}<option value="sensitive"
          >Sensitive</option
        ><option value="unattributed">Unattributed</option>{:else}<option value="flagged"
          >Flagged</option
        ><option value="unknown">Unknown identity</option><option value="allowlisted"
          >Allowlisted</option
        >{/if}</select
    >
    <select aria-label="Grouping" bind:value={grouping}
      ><option value="time">Chronological</option><option value="agent">Group by agent</option
      ></select
    >
    <button
      class="button"
      onclick={() => {
        if (!paused) held = rows;
        paused = !paused;
      }}>{paused ? 'Resume live view' : 'Pause view'}</button
    >
    <button
      class="button"
      onclick={() => {
        query = '';
        kind = 'all';
        page = 0;
      }}>Reset filters</button
    >
    {#if paused}<span class="muted">View paused · backend monitoring continues</span>{/if}
  </div>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>Time / state</th><th>Agent / instance</th><th>{network ? 'Endpoint' : 'Resource'}</th
          ><th>Evidence</th></tr
        ></thead
      >
      <tbody
        >{#each visible as row, i (row)}{@const skill = skillFromPath(row.file)}
          {#if grouping === 'agent' && (i === 0 || row.agent !== visible[i - 1].agent)}<tr
              ><th colspan="4">{String(row.agent || 'Unattributed')}</th></tr
            >{/if}
          <tr
            ><td
              >{row.timestamp
                ? new Date(Number(row.timestamp)).toLocaleTimeString()
                : String(row.state ?? 'Unavailable')}</td
            ><td
              >{String(row.agent || 'Unattributed')}<small
                >{String(row.instanceId ?? 'No confirmed instance')}</small
              ></td
            ><td
              ><button
                class="text-link"
                onclick={() => inspect(network ? 'Network observation' : 'File observation', row)}
                >{String(
                  row.file ||
                    row.domain ||
                    row.remoteIp ||
                    row.ip ||
                    `Record ${page * 100 + i + 1}`,
                )}</button
              >{#if skill}<small>Skill · {skill.name} · path observation</small
                >{/if}{#if network}<small
                  >Port {String(row.remotePort ?? row.port ?? 'unknown')} · {String(
                    row.verdict ?? 'unknown',
                  )}</small
                >{/if}</td
            ><td
              >{String(row.source ?? row.action ?? 'Unknown')}<small
                >{JSON.stringify(row.attribution ?? 'Unavailable')}</small
              ></td
            ></tr
          >
        {:else}<tr
            ><td colspan="4"
              >{telemetry.ready
                ? 'No matching records retained in this window.'
                : 'Waiting for observations.'}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
  <div class="toolbar inset">
    <button class="button" disabled={page === 0} onclick={() => page--}>Previous</button><span
      >Page {page + 1}</span
    ><button class="button" disabled={(page + 1) * 100 >= filtered.length} onclick={() => page++}
      >Next</button
    ><span class="muted">Complete persisted history is available in Audit.</span>
  </div>
</section>
