<script lang="ts">
  import type { ProtectionActivity } from '../runtime/protection';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    activity,
    ready,
    filter = $bindable('all'),
    selectedKey,
    select,
  }: {
    activity: ProtectionActivity[];
    ready: boolean;
    filter?: string;
    selectedKey?: string;
    select: (_item: ProtectionActivity, _button: HTMLButtonElement) => void;
  } = $props();
  let query = $state('');
  let limit = $state(8);
  $effect(() => {
    filter;
    query;
    limit = 8;
  });
  const filtered = $derived(
    activity.filter(
      (item) =>
        (filter === 'all' || item.level === filter) &&
        `${item.actor} ${item.target} ${item.action}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
  );
  function chooseFilter(next: string) {
    filter = next;
  }
  const labels = { review: 'Review needed', unverified: 'Unverified', observed: 'No risk flag' };
</script>

<section class="panel activity-panel" aria-label="Agent activity">
  <div class="activity-head">
    <h3>Who did what, and where?</h3>
    <p>
      Retained file activity and the latest network snapshot. Select an activity for its
      explanation.
    </p>
  </div>
  <div class="filters">
    <div class="filter-buttons" aria-label="Activity filters">
      {#each [['all', 'All activity'], ['review', 'Needs review'], ['unverified', 'Unverified']] as [id, label] (id)}
        <button aria-pressed={filter === id} onclick={() => chooseFilter(id)}>{label}</button>
      {/each}
    </div>
    <label class="search"
      ><Icon name="search" /><input
        type="search"
        aria-label="Search agent activity"
        placeholder="Agent, file or address…"
        bind:value={query}
        oninput={() => (limit = 8)}
      /></label
    >
  </div>
  <div class="activity-list">
    {#each filtered.slice(0, limit) as item (item.key)}
      <button
        class="activity-row"
        class:review={item.level === 'review'}
        aria-label={`${item.actor}. ${item.attribution}. ${item.action}: ${item.target}. ${labels[item.level]}. ${item.rows.length} records.`}
        aria-pressed={selectedKey === item.key}
        onclick={(event) => select(item, event.currentTarget)}
      >
        <span class="who"
          ><AgentLogo name={item.actor} size={24} /><span
            ><strong>{item.actor}</strong><small>{item.attribution}</small></span
          ></span
        >
        <span class="what"
          ><span>{item.action}</span><strong>{item.resource}</strong><small class="path"
            >{item.target}</small
          ></span
        >
        <span class="verdict"
          ><span class="activity-verdict">{labels[item.level]}</span><small
            >{item.rows.length > 1 ? `${item.rows.length} records` : item.kind}</small
          ></span
        >
      </button>
    {:else}<div class="empty">
        <h4>{!ready ? 'Waiting for observations' : 'No matching activity'}</h4>
        <p>
          {!ready
            ? 'AEGIS has not received a reliable snapshot yet.'
            : filter === 'review'
              ? 'No retained activity has these review flags. This is not a guarantee that the computer is safe.'
              : 'Try another filter or wait for activity. AEGIS may not observe every action.'}
        </p>
      </div>{/each}
  </div>
  <div class="list-footer">
    <span>{Math.min(limit, filtered.length)} of {filtered.length} groups</span
    >{#if filtered.length > limit}<button class="button" onclick={() => (limit += 8)}
        >Show more activity</button
      >{/if}
  </div>
</section>

<style>
  .activity-panel {
    min-width: 0;
    container-type: inline-size;
  }
  p {
    color: var(--muted);
    line-height: 1.6;
    margin: 0;
  }
  button {
    cursor: pointer;
  }
  .activity-head {
    padding: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  h3 {
    font-size: var(--text-section);
    margin: 0 0 var(--space-2);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .filter-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .filter-buttons button {
    background: transparent;
    color: var(--muted);
    border: 1px solid transparent;
    border-radius: var(--control-radius);
    padding: var(--space-2);
    min-height: var(--control-height);
    font: inherit;
  }
  .filter-buttons button[aria-pressed='true'] {
    background: var(--bg);
    color: var(--text);
    border-color: var(--strong-border);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1 1 160px;
    max-width: 280px;
  }
  .search input {
    min-width: 0;
    width: 100%;
    font: inherit;
  }
  .activity-row {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(150px, 0.8fr) minmax(0, 1.8fr) minmax(105px, 0.6fr);
    gap: var(--space-4);
    padding: var(--space-4);
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
    line-height: 1.5;
  }
  .activity-row:hover,
  .activity-row[aria-pressed='true'] {
    background: var(--bg);
  }
  .activity-row[aria-pressed='true'] {
    box-shadow: inset 3px 0 var(--muted);
  }
  .who {
    display: flex;
    align-items: start;
    gap: var(--space-2);
    min-width: 0;
  }
  .who > span,
  .what {
    min-width: 0;
  }
  .who strong,
  .who small,
  .what > *,
  .verdict > * {
    display: block;
  }
  strong,
  .path {
    overflow-wrap: anywhere;
  }
  small {
    font-size: var(--text-caption);
    color: var(--muted);
  }
  .path {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .verdict {
    text-align: right;
  }
  .activity-verdict {
    font-size: var(--text-body);
    font-weight: 600;
  }
  .review .activity-verdict {
    color: var(--amber);
  }
  .list-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-caption);
    color: var(--muted);
    padding: var(--space-3) var(--space-4);
  }
  .empty {
    padding: var(--space-5);
  }
  .empty h4 {
    margin: 0 0 var(--space-2);
  }

  @container (max-width: 540px) {
    .activity-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
    }
    .what {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .verdict {
      grid-column: 2;
      grid-row: 1;
    }
  }
</style>
