<script lang="ts">
  import {
    describeObservation,
    groupObservations,
  } from '../../../src/shared/observation-display.js';
  import { instances, record, type RecordData, type Telemetry } from '../runtime/host';
  import ObservationIdentity from './ObservationIdentity.svelte';
  import ObservationResource from './ObservationResource.svelte';
  let {
    rows,
    telemetry,
    inspect,
    grouping = 'resource',
    resetKey = '',
  }: {
    rows: RecordData[];
    telemetry: Telemetry;
    inspect: (_title: string, _row: RecordData) => void;
    grouping?: 'resource' | 'agent' | 'none';
    resetKey?: string;
  } = $props();
  let page = $state(0);
  let agents = $derived(instances(telemetry) as unknown as RecordData[]);
  let groups = $derived(groupObservations(rows, grouping, agents));
  let currentPage = $derived(Math.min(page, Math.max(0, Math.ceil(groups.length / 30) - 1)));
  let visible = $derived(groups.slice(currentPage * 30, (currentPage + 1) * 30));
  $effect(() => {
    resetKey;
    grouping;
    page = 0;
  });
  function open(group: (typeof groups)[number]) {
    inspect(
      group.rows.length > 1 ? group.label : 'Observation',
      group.rows.length > 1
        ? { observationGroup: group.label, observations: group.rows }
        : group.latest,
    );
  }
</script>

<section class="panel observation-table">
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>{grouping === 'agent' ? 'Agent / context' : 'Resource'}</th><th
            >{grouping === 'agent' ? 'Latest resource' : 'Agent / context'}</th
          ><th>Activity</th><th>Count</th><th>Latest</th><th>Evidence</th></tr
        ></thead
      >
      <tbody>
        {#each visible as group (group.key)}
          {@const row = group.latest}
          {@const info = describeObservation(row, agents)}
          <tr class="observation-group">
            <td
              ><button class="observation-open" onclick={() => open(group)}
                >{#if grouping === 'agent'}<ObservationIdentity
                    {row}
                    {agents}
                    showHint={!info.actor ||
                      !!row.remoteIp ||
                      !!row.domain ||
                      row.sensitive === true}
                  />{:else}<ObservationResource {row} />{/if}</button
              ></td
            >
            <td
              >{#if grouping === 'agent'}<ObservationResource {row} />{:else}<ObservationIdentity
                  {row}
                  {agents}
                  showHint={!info.actor || !!row.remoteIp || !!row.domain || row.sensitive === true}
                />{/if}</td
            >
            <td
              ><span class="event-type"
                >{String(row.action || row.type || row.state || 'Observed')}</span
              ></td
            >
            <td
              ><button
                class="observation-count"
                aria-label={`Open ${group.rows.length} observations for ${group.label}`}
                onclick={() => open(group)}
                >{group.rows.length}<small>{group.rows.length === 1 ? 'record' : 'records'}</small
                ></button
              ></td
            >
            <td class="mono"
              >{group.last
                ? new Date(group.last).toLocaleTimeString()
                : 'Snapshot'}{#if group.first && group.first !== group.last}<small
                  >since {new Date(group.first).toLocaleTimeString()}</small
                >{/if}</td
            >
            <td
              ><span
                title={Array.isArray(record(row.attribution).evidence)
                  ? (record(row.attribution).evidence as unknown[]).map(String).join(', ')
                  : info.attribution}
                class="badge"
                class:medium={row.sensitive === true ||
                  row.verdict === 'flagged' ||
                  ['sensitive', 'high', 'critical', 'medium'].includes(String(row.severity))}
                >{row.remoteIp || row.domain
                  ? row.verdict === 'allowlisted'
                    ? 'Allowlisted'
                    : row.verdict === 'flagged'
                      ? 'Not allowlisted'
                      : 'Endpoint unverified'
                  : row.sensitive || row.severity === 'sensitive'
                    ? 'Sensitive'
                    : row.severity && !['normal', 'low'].includes(String(row.severity))
                      ? String(row.severity)
                      : info.attribution}</span
              ></td
            >
          </tr>
        {:else}<tr
            ><td colspan="6" class="observation-empty"
              >{telemetry.ready
                ? 'No records match these filters.'
                : 'Waiting for observations.'}</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
  <div class="pagination">
    <span
      >{groups.length ? currentPage * 30 + 1 : 0}–{Math.min((currentPage + 1) * 30, groups.length)} of
      {groups.length}
      {grouping === 'none' ? 'records' : 'groups'} · {rows.length} observations</span
    >
    <div class="toolbar">
      <button class="button" disabled={currentPage === 0} onclick={() => (page = currentPage - 1)}
        >Previous</button
      ><button
        class="button"
        disabled={(currentPage + 1) * 30 >= groups.length}
        onclick={() => (page = currentPage + 1)}>Next</button
      >
    </div>
  </div>
</section>

<style>
  table {
    min-width: 680px;
  }
  td {
    vertical-align: middle;
  }
  td:first-child {
    width: 31%;
  }
  td:nth-child(2) {
    width: 23%;
  }
  td small {
    display: block;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
    white-space: nowrap;
  }
  .observation-open {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 0;
    border-radius: 6px;
  }
  .observation-open:hover {
    background: var(--raised);
  }
  .observation-count {
    min-width: 44px;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 7px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .observation-count:hover {
    background: var(--raised);
    border-color: var(--strong-border);
  }
  .observation-count small {
    font-weight: 400;
  }
  .observation-empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
  }
</style>
