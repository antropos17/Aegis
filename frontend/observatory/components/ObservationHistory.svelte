<script lang="ts">
  import { t } from '../runtime/i18n';

  import type { RecordData } from '../runtime/host';
  import { createRecordKey, keyedRecords } from '../runtime/activity-feed';
  import {
    describeObservation,
    observationTime,
    endpointLabel,
  } from '../../../src/shared/observation-display.js';
  import ObservationResource from './ObservationResource.svelte';
  import Icon from './Icon.svelte';
  let {
    rows,
    navigate,
    limit = $bindable(20),
    query = $bindable(''),
  }: {
    rows: RecordData[];
    navigate: (_title: string, _row: RecordData) => Promise<void>;
    limit?: number;
    query?: string;
  } = $props();
  const key = createRecordKey();
  let matching = $derived(
    rows.filter((row) => {
      const info = describeObservation(row);
      return [
        info.path,
        info.resource,
        info.actor,
        info.context,
        info.attribution,
        row.pid,
        row.action,
        row.type,
        row.state,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase());
    }),
  );
  let sorted = $derived(
    keyedRecords(matching, key).sort(
      (a, b) => observationTime(b.row.timestamp) - observationTime(a.row.timestamp),
    ),
  );
</script>

<div class="observation-history">
  <div class="section-heading">
    <h3>{$t('Recorded observations')}</h3>
    <span>{rows.length}</span>
  </div>
  <label class="detail-search"
    ><Icon name="search" /><input
      aria-label={$t('Find a record')}
      type="search"
      placeholder={$t('Resource, action, PID or attribution')}
      bind:value={query}
    /></label
  >
  <p class="entity-note">
    {matching.length}
    {$t('of')}
    {rows.length}
    {$t('records · newest first')}
  </p>
  {#each sorted.slice(0, limit) as entry (entry.key)}{@const row = entry.row}{@const info =
      describeObservation(row)}
    <button
      class="recent-event"
      data-detail-focus={'record-' + entry.key}
      onclick={() => navigate('Observation', row)}
    >
      <time
        >{observationTime(row.timestamp)
          ? new Date(observationTime(row.timestamp)).toLocaleTimeString()
          : $t('Snapshot')}</time
      >
      <span
        ><ObservationResource {row} /><small
          >{String(row.action || row.state || row.type || 'Observed')} · {info.actor ||
            info.context ||
            $t('Actor not recorded')}{row.pid
            ? $t(' · PID {value0}', { value0: row.pid })
            : ''}{row.localIp || row.localPort
            ? ' · Local ' +
              (endpointLabel({ remoteIp: row.localIp, remotePort: row.localPort }) ||
                'port ' + row.localPort)
            : ''} · {info.attribution}</small
        ></span
      >
    </button>
  {:else}<p class="entity-note">
      {rows.length ? $t('No records match this search.') : $t('No recorded observations.')}
    </p>{/each}
  {#if sorted.length > limit || limit > 20}<button
      class="button"
      aria-disabled={sorted.length <= limit}
      onclick={() => {
        if (sorted.length > limit) limit += 20;
      }}
      >{#if sorted.length > limit}{$t('Show')}
        {Math.min(20, sorted.length - limit)}
        {$t('more')}{:else}{$t('All matching retained activity shown')}{/if}</button
    >{/if}
</div>

<style>
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-heading h3 {
    margin: 0;
  }
  .recent-event {
    align-items: start;
    text-align: left;
  }
  .recent-event > span {
    min-width: 0;
    flex: 1;
  }
  small,
  time {
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
  }
  time {
    white-space: nowrap;
  }
</style>
