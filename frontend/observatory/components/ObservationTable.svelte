<script lang="ts">
  import { t } from '../runtime/i18n';

  import {
    describeObservation,
    groupObservations,
    observationGroupEvidence,
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
  function changePage(next: number) {
    if (next < 0 || next >= Math.ceil(groups.length / 30)) return;
    page = next;
  }
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
  <nav class="pagination" aria-label={$t('Observation pages')}>
    <span
      >{groups.length ? currentPage * 30 + 1 : 0}–{Math.min((currentPage + 1) * 30, groups.length)}
      {$t('of')}
      {groups.length}
      {grouping === 'none' ? $t('records') : $t('groups')} · {rows.length}
      {$t('observations')}</span
    >
    <div class="toolbar">
      <button
        class="button"
        aria-disabled={currentPage === 0}
        onclick={() => changePage(currentPage - 1)}>{$t('Previous')}</button
      ><button
        class="button"
        aria-disabled={(currentPage + 1) * 30 >= groups.length}
        onclick={() => changePage(currentPage + 1)}>{$t('Next')}</button
      >
    </div>
  </nav>
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>{grouping === 'agent' ? $t('Agent / context') : $t('Resource')}</th><th
            >{grouping === 'agent' ? $t('Latest resource') : $t('Agent / context')}</th
          ><th>{$t('Activity')}</th><th>{$t('Count')}</th><th>{$t('Latest')}</th></tr
        ></thead
      >
      <tbody>
        {#each visible as group (group.key)}
          {@const row = group.latest}
          {@const info = describeObservation(row, agents)}
          {@const evidence = observationGroupEvidence(group.rows, agents)}
          {@const actions = [
            ...new Set(
              group.rows.map((entry) =>
                String(entry.action || entry.state || entry.type || 'Observed'),
              ),
            ),
          ]}
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
                />{/if}
              <div class="row-evidence">
                <span
                  title={group.rows
                    .flatMap((entry) =>
                      Array.isArray(record(entry.attribution).evidence)
                        ? (record(entry.attribution).evidence as string[])
                        : [],
                    )
                    .join(', ') || evidence}
                  class="badge"
                  class:medium={group.rows.some(
                    (entry) =>
                      entry.sensitive === true ||
                      entry.verdict === 'flagged' ||
                      ['sensitive', 'high', 'critical', 'medium'].includes(String(entry.severity)),
                  )}>{evidence}</span
                >
              </div></td
            >
            <td
              ><span class="event-type"
                >{actions.length > 1 ? actions.length + ' activity types' : actions[0]}</span
              ></td
            >
            <td
              ><button
                class="observation-count"
                aria-label={$t('Open {value0} observations for {value1}', {
                  value0: group.rows.length,
                  value1: group.label,
                })}
                onclick={() => open(group)}
                >{group.rows.length}<small
                  >{group.rows.length === 1 ? $t('record') : $t('records')}</small
                ></button
              ></td
            >
            <td class="mono"
              >{group.last
                ? new Date(group.last).toLocaleTimeString()
                : $t('Snapshot')}{#if group.first && group.first !== group.last}<small
                  >{$t('since')} {new Date(group.first).toLocaleTimeString()}</small
                >{/if}</td
            >
          </tr>
        {:else}<tr
            ><td colspan="5" class="observation-empty"
              >{telemetry.ready
                ? $t('No records match these filters.')
                : $t('Waiting for observations.')}</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .observation-table .pagination {
    flex-direction: row;
    border-top: 0;
    border-bottom: 1px solid var(--border);
    border-radius: var(--surface-radius) var(--surface-radius) 0 0;
  }
  .pagination .button[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }
  .pagination .button[aria-disabled='true']:hover {
    background: var(--panel);
    border-color: var(--border);
  }

  table {
    min-width: 640px;
    table-layout: fixed;
    width: 100%;
  }
  td {
    vertical-align: middle;
  }
  th:first-child,
  td:first-child {
    width: 32%;
  }
  th:nth-child(2),
  td:nth-child(2) {
    width: 28%;
  }
  th:nth-child(3),
  td:nth-child(3) {
    width: 13%;
  }
  th:nth-child(4),
  td:nth-child(4) {
    width: 10%;
  }
  th:nth-child(5),
  td:nth-child(5) {
    width: 17%;
  }
  .row-evidence {
    margin-top: 7px;
  }
  .row-evidence :global(.badge) {
    white-space: normal;
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
