<script lang="ts">
  import { t } from '../runtime/i18n';
  import { resultChangeLabel, type ResultReviewChange } from '../runtime/result-review';
  import ResultReviewEntry from './ResultReviewEntry.svelte';
  let {
    changes,
    complete,
    captureKey,
  }: {
    changes: readonly ResultReviewChange[];
    complete: boolean;
    captureKey: string;
  } = $props();
  const prefix = $props.id();
  let previousKey = '';
  let query = $state('');
  let kind = $state('all');
  let page = $state(0);
  let selected = $state<string[]>([]);
  let acknowledgeDeletion = $state(false);
  $effect(() => {
    if (previousKey !== captureKey) {
      previousKey = captureKey;
      query = '';
      kind = 'all';
      page = 0;
      selected = [];
      acknowledgeDeletion = false;
    }
  });
  const filtered = $derived(
    changes.filter(
      (change) =>
        (kind === 'all' || change.type === kind) &&
        change.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
  const rows = $derived(filtered.slice(page * 20, (page + 1) * 20));
  const hiddenSelections = $derived(
    selected.filter((id) => !filtered.some((row) => row.id === id)).length,
  );
  const deletionSelected = $derived(
    changes.some((change) => change.type === 'deletion' && selected.includes(change.id)),
  );
  function select(id: string, checked: boolean) {
    selected = checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id);
    acknowledgeDeletion = false;
  }
  function clearSelection() {
    selected = [];
    acknowledgeDeletion = false;
  }
  function clearFilters() {
    if (!query && kind === 'all') return;
    query = '';
    kind = 'all';
    page = 0;
  }
</script>

{#if changes.length}
  <div class="filters">
    <div class="field">
      <label for={prefix + '-search'}>{$t('Find a changed file')}</label>
      <input id={prefix + '-search'} type="search" bind:value={query} oninput={() => (page = 0)} />
    </div>
    <div class="field">
      <label for={prefix + '-kind'}>{$t('Change type')}</label>
      <select id={prefix + '-kind'} bind:value={kind} onchange={() => (page = 0)}>
        <option value="all">{$t('All changes')}</option>
        {#each ['addition', 'edit', 'deletion', 'unknown'] as type (type)}
          <option value={type}
            >{$t(resultChangeLabel(type))} ({changes.filter((row) => row.type === type)
              .length})</option
          >
        {/each}
      </select>
    </div>
  </div>
  <div class="review-draft">
    <p>{$t('Local selection only · not saved or approved')}</p>
    <p class="muted">
      {$t(
        'Select files to keep track while inspecting this comparison. Selection and deletion acknowledgment stay in this window and do not mark the artifact reviewed.',
      )}
    </p>
    <p class="muted" role="status" aria-live="polite" aria-atomic="true">
      {$t('{shown} of {total} changes', { shown: filtered.length, total: changes.length })} ·
      {$t('{count} selected · {hidden} outside the current filter', {
        count: selected.length,
        hidden: hiddenSelections,
      })}
    </p>
    <div class="actions">
      <button class="button" aria-disabled={!query && kind === 'all'} onclick={clearFilters}
        >{$t('Clear filters')}</button
      >
      <button class="button" aria-disabled={selected.length === 0} onclick={clearSelection}
        >{$t('Clear selection')}</button
      >
    </div>
  </div>
{/if}
{#if !changes.length}
  <p>
    {$t(
      complete
        ? 'No differing content in the imported snapshots.'
        : 'Changes cannot be determined from incomplete snapshots.',
    )}
  </p>
{:else if !filtered.length}
  <p>{$t('No changes match these filters.')}</p>
{/if}
{#each rows as change (change.id)}
  <ResultReviewEntry
    {change}
    selected={selected.includes(change.id)}
    onselect={(checked) => select(change.id, checked)}
  />
{/each}
{#if pages > 1}
  <div class="actions pagination" aria-label={$t('Change pages')}>
    <button
      class="button"
      aria-disabled={page === 0}
      onclick={() => {
        if (page > 0) page--;
      }}>{$t('Previous')}</button
    >
    <span>{page + 1} / {pages}</span>
    <button
      class="button"
      aria-disabled={page + 1 === pages}
      onclick={() => {
        if (page + 1 < pages) page++;
      }}>{$t('Next')}</button
    >
  </div>
{/if}
{#if deletionSelected}
  <label class="ack"
    ><input type="checkbox" bind:checked={acknowledgeDeletion} />{$t(
      'I explicitly reviewed the selected deletions.',
    )}</label
  >
{/if}
<p class="muted">{$t('Selection is a review draft. It does not authorize project writes.')}</p>

<style>
  .filters {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  input[type='search'],
  select {
    width: 100%;
    min-width: 0;
  }
  .review-draft {
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
    margin-block: var(--space-3);
  }
  .review-draft p {
    margin: 0 0 var(--space-2);
  }
  .actions,
  .ack {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .ack {
    padding-block: var(--space-3);
  }
  .pagination {
    margin-block: var(--space-3);
  }
  p {
    line-height: 1.6;
  }
  .muted {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  button {
    white-space: normal;
    min-height: var(--control-height);
  }
  @media (max-width: 600px) {
    .filters {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
