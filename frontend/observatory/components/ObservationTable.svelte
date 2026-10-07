<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../runtime/i18n';
  import { untrack } from 'svelte';
  import { createRecordKey, feedSnapshot, feedScroll, feedArrival } from '../runtime/activity-feed';
  import { motionAllowed } from '../runtime/motion';

  import {
    describeObservation,
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
    visible = true,
    paused = false,
    live = true,
    admissionRevision = 0,
    onSnapshotChange,
    captureContext = false,
  }: {
    rows: RecordData[];
    telemetry: Telemetry;
    inspect: (_title: string, _row: RecordData, _agents?: RecordData[]) => void;
    grouping?: 'resource' | 'agent' | 'none';
    resetKey?: string;
    visible?: boolean;
    paused?: boolean;
    live?: boolean;
    admissionRevision?: number;
    onSnapshotChange?: (_held: boolean) => void;
    captureContext?: boolean;
  } = $props();
  const key = createRecordKey();
  let surface = $state<HTMLElement>();
  let limit = $state(30);
  let reading = $state(false);
  let accepted = $state.raw<ReturnType<typeof feedSnapshot> | null>(null);
  let incoming = $derived(
    feedSnapshot(rows, grouping, instances(telemetry) as unknown as RecordData[], key),
  );
  let agents = $derived(accepted?.agents ?? incoming.agents);
  let groups = $derived(accepted?.groups ?? incoming.groups);
  let shown = $derived(groups.slice(0, limit));
  let more = $derived(limit < groups.length);
  let pending = $derived(accepted !== null && accepted.signature !== incoming.signature);
  let selection = '';
  let admittedRevision = 0;
  $effect(() => {
    onSnapshotChange?.(reading || pending || paused);
  });
  $effect(() => {
    // A reading snapshot intentionally survives source changes; it is not derived from latest rows.
    const next = incoming;
    const nextSelection = JSON.stringify([resetKey, grouping]);
    const nextAdmission = admissionRevision;
    untrack(() => {
      if (!accepted || nextSelection !== selection) {
        accepted = next;
        selection = nextSelection;
        limit = 30;
        reading = false;
        admittedRevision = nextAdmission;
      } else if (nextAdmission !== admittedRevision) {
        // A successful read or explicit Resume admits captured data without moving the reader.
        accepted = next;
        reading = false;
        admittedRevision = nextAdmission;
      } else if (!pending && accepted.signature === next.signature) {
        // Equivalent network deliveries do not replace their captured row objects.
      } else if (
        !reading &&
        visible &&
        !paused &&
        (!live || !telemetry.stale) &&
        document.visibilityState !== 'hidden'
      ) {
        accepted = next;
      } else reading = true;
    });
  });
  function showOlder() {
    if (!more) return;
    reading = true;
    limit = Math.min(limit + 30, groups.length);
  }
  function showLatest() {
    if (!pending && !reading) return;
    accepted = incoming;
    limit = 30;
    reading = false;
    surface?.scrollIntoView?.({
      block: 'start',
      behavior: motionAllowed() ? 'smooth' : 'instant',
    });
  }
  function open(group: (typeof groups)[number]) {
    const title = group.rows.length > 1 ? group.label : 'Observation';
    const selected =
      group.rows.length > 1
        ? { observationGroup: group.label, observations: group.rows }
        : group.latest;
    if (captureContext) inspect(title, selected, agents);
    else inspect(title, selected);
  }
</script>

<section
  class="panel observation-table"
  bind:this={surface}
  use:feedScroll={{
    active: visible && !paused && (!live || !telemetry.stale),
    following: !reading && !pending,
    more,
    load: showOlder,
    hold: () => (reading = true),
  }}
  onfocusin={(event) => {
    if ((event.target as HTMLElement).closest('tbody, [data-feed-older]')) reading = true;
  }}
>
  <div class="feed-toolbar">
    <div class="feed-summary">
      <span
        >{Math.min(limit, groups.length)}
        {$t('of')}
        {groups.length}
        {grouping === 'none' ? $t('records') : $t('groups')} · {accepted?.total ?? rows.length}
        {$t('observations')}</span
      >
      <p class="feed-status" role="status">
        {pending
          ? $t('Activity updates waiting')
          : reading
            ? $t('Reading retained activity')
            : $t('Following latest retained activity')}
      </p>
    </div>
    <div class="toolbar">
      <button class="button" aria-disabled={!pending && !reading} onclick={showLatest}
        ><Icon name="refresh" />{$t('Show latest')}</button
      >
    </div>
  </div>
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
        {#each shown as group (group.key)}
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
          <tr
            class="observation-group"
            use:feedArrival={visible &&
              telemetry.ready &&
              !paused &&
              (!live || !telemetry.stale) &&
              !reading &&
              !pending}
          >
            <td
              ><button class="observation-open" onclick={() => open(group)}
                >{#if grouping === 'agent'}<ObservationIdentity
                    {row}
                    {agents}
                    showHint={!info.actor ||
                      !!row.remoteIp ||
                      !!row.domain ||
                      row.sensitive === true ||
                      info.attribution === 'Indirect match'}
                  />{:else}<ObservationResource {row} />{/if}</button
              ></td
            >
            <td
              >{#if grouping === 'agent'}<ObservationResource {row} />{:else}<ObservationIdentity
                  {row}
                  {agents}
                  showHint={!info.actor ||
                    !!row.remoteIp ||
                    !!row.domain ||
                    row.sensitive === true ||
                    info.attribution === 'Indirect match'}
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
                  >{$t('since')}
                  {new Date(group.first).toLocaleTimeString()}</small
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
  <div class="feed-older" data-feed-older>
    <button class="button" aria-disabled={!more} onclick={showOlder}
      >{$t('Show older activity')}</button
    >
    <span
      >{more
        ? groups.length - shown.length + ' ' + $t('remaining')
        : $t('All matching retained activity shown')}</span
    >
  </div>
</section>

<style>
  .observation-table {
    overflow-anchor: none;
  }
  .observation-group:global(.feed-arrival) {
    animation: feed-arrival var(--motion-fast) var(--ease-settle);
  }
  @keyframes feed-arrival {
    from {
      opacity: 0.35;
    }
    to {
      opacity: 1;
    }
  }
  :global(html[data-motion='reduce']) .observation-group:global(.feed-arrival),
  :global(html.no-motion) .observation-group:global(.feed-arrival) {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .observation-group:global(.feed-arrival) {
      animation: none;
    }
  }
  .feed-toolbar,
  .feed-older {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--panel-inset);
    color: var(--muted);
    font-size: var(--text-caption);
    border-top: 0;
    border-bottom: 1px solid var(--border);
    border-radius: var(--surface-radius) var(--surface-radius) 0 0;
  }
  .feed-summary {
    display: flex;
    align-items: center;
    flex: 1 1 280px;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    min-width: 0;
  }
  .feed-status {
    margin: 0;
    min-height: 1.5em;
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .feed-toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--panel);
    row-gap: var(--space-1);
  }
  tbody button {
    scroll-margin-top: calc(var(--control-height) + var(--space-4) * 3);
  }
  .feed-older {
    border-top: 1px solid var(--border);
  }
  .button[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }
  .button[aria-disabled='true']:hover {
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
