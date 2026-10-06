<script lang="ts">
  import { t } from '../runtime/i18n';

  import type { RecordData } from '../runtime/host';
  import { describeObservation, observationTime } from '../../../src/shared/observation-display.js';
  import { describeProtectionObservation } from '../runtime/protection';
  import ObservationResource from './ObservationResource.svelte';
  import ObservationIdentity from './ObservationIdentity.svelte';
  import Icon from './Icon.svelte';
  let {
    rows,
    agents,
    network = false,
    inspect,
    more,
  }: {
    rows: RecordData[];
    agents: RecordData[];
    network?: boolean;
    inspect: (_title: string, _row: RecordData) => void;
    more: () => void;
  } = $props();
  let ordered = $derived(
    [...rows].sort((a, b) => observationTime(b.timestamp) - observationTime(a.timestamp)),
  );
  let filter = $state<'all' | 'sensitive'>('all');
  let sensitiveCount = $derived(rows.filter((row) => row.sensitive === true).length);
  let filtered = $derived(
    !network && filter === 'sensitive' ? ordered.filter((row) => row.sensitive === true) : ordered,
  );
  let visible = $derived(filtered.slice(0, 4));
  let hasOpenHandle = $derived(
    !network && visible.some((row) => row.action === 'holding' || row.action === 'accessed'),
  );
</script>

<section
  class="panel agent-evidence"
  aria-label={network ? $t('Selected agent connections') : $t('Selected agent file activity')}
>
  <div class="panel-head">
    <h2>
      <Icon name={network ? 'network' : 'folder'} />{network
        ? $t('Connections')
        : $t('File activity')} <small>{rows.length}</small>
    </h2>
    <button class="text-button" onclick={more}>{$t('View all')}</button>
  </div>
  {#if !network}
    <div class="evidence-filters" role="group" aria-label={$t('Activity filters')}>
      <button class="button" aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}
        >{$t('All activity')}</button
      >
      <button
        class="button"
        aria-pressed={filter === 'sensitive'}
        onclick={() => (filter = 'sensitive')}
        >{$t('Sensitive events')} <span class="filter-count">{sensitiveCount}</span></button
      >
    </div>
    {#if filter === 'sensitive'}
      <p class="filter-note">{$t('Recorded activity involving files classified as sensitive.')}</p>
    {/if}
  {/if}
  <div class="evidence-list">
    {#each visible as row (row.eventId ?? row.id ?? row)}
      {@const activity = describeProtectionObservation(row, network)}
      <button
        class="evidence-row"
        aria-label={$t('Open evidence') +
          ' · ' +
          describeObservation(row).resource +
          ' · ' +
          $t(activity.action)}
        onclick={() => inspect(network ? 'Connection' : 'File observation', row)}
      >
        <div class="evidence-resource">
          <ObservationResource {row} /><ObservationIdentity {row} {agents} />
          <span class="evidence-activity">
            {$t(activity.action)}
            {#if !network && row.sensitive === true}<span class="badge medium"
                >{$t('Sensitive')}</span
              >{/if}
          </span>
          {#if !network && row.sensitive === true && typeof row.reason === 'string' && row.reason.trim()}
            <span class="evidence-reason">{$t('Recorded reason:')} {row.reason}</span>
          {/if}
        </div>
        <span class="evidence-action">
          <span class="evidence-time"
            >{observationTime(row.timestamp)
              ? new Date(observationTime(row.timestamp)).toLocaleTimeString()
              : $t('Time not recorded')}</span
          >
          <span class="evidence-open">{$t('Open evidence')} <Icon name="chevron" /></span>
        </span>
      </button>
    {:else}<p class="empty">
        {network
          ? $t('No connections with a recorded owner match this selection.')
          : filter === 'sensitive'
            ? $t('No records match these filters.')
            : $t('No retained file observations with a recorded owner match this selection.')}
      </p>{/each}
  </div>
  <p class="evidence-note">
    {network
      ? $t('Endpoint verification is separate from process identity.')
      : $t('Unattributed activity stays in the all-agent log.')}{filtered.length > 4
      ? ' ' + $t('Showing 4 of') + ' ' + filtered.length + '.'
      : ''}
  </p>
  {#if hasOpenHandle}<p class="handle-note">
      {$t('An open handle does not prove that file contents were read.')}
    </p>{/if}
</section>

<style>
  .agent-evidence {
    min-width: 0;
  }
  h2 small {
    margin-left: 6px;
    color: var(--muted);
    font-weight: 400;
  }
  .panel-head {
    gap: 10px;
  }
  .evidence-filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3) var(--panel-inset);
    border-bottom: 1px solid var(--border);
  }
  .evidence-filters .button {
    height: auto;
    min-height: var(--control-height);
    white-space: normal;
  }
  .evidence-filters .button[aria-pressed='true'] {
    background: var(--selection);
    border-color: var(--selection-border);
  }
  .filter-count {
    font-variant-numeric: tabular-nums;
  }
  .evidence-row {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    padding: var(--space-3) var(--panel-inset);
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
  }
  .evidence-row:hover {
    background: var(--hover);
  }
  .evidence-resource {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .evidence-activity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-caption);
  }
  .evidence-reason {
    color: var(--muted);
    font-size: var(--text-caption);
    overflow-wrap: anywhere;
  }
  .evidence-action {
    display: flex;
    flex-direction: column;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .evidence-open {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .evidence-time {
    white-space: nowrap;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
    font-variant-numeric: tabular-nums;
  }
  .evidence-note,
  .filter-note,
  .handle-note,
  .empty {
    margin: 0;
    padding: var(--space-3) var(--panel-inset);
    color: var(--muted);
    line-height: 1.5;
    font-size: var(--text-caption);
  }
  .handle-note {
    padding-top: 0;
  }
  @media (max-width: 1050px) {
    .evidence-row {
      flex-wrap: wrap;
    }
    .evidence-action {
      flex-direction: row;
      align-items: center;
      flex-wrap: wrap;
      width: 100%;
    }
  }
</style>
