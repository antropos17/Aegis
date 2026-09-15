<script lang="ts">
  import { t } from '../runtime/i18n';
  import { type ReviewRow } from '../runtime/local-security';
  import Metadata from './Metadata.svelte';
  let { rows, empty }: { rows: ReviewRow[]; empty: string } = $props();
  let query = $state('');
  let page = $state(0);
  let filtered = $derived(
    rows.filter((row) =>
      `${row.title} ${row.subtitle} ${row.severity ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
  );
  let current = $derived(Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1)));
</script>

{#if rows.length}
  <div class="row-toolbar">
    <label
      >{$t('Filter results')}<input
        type="search"
        bind:value={query}
        oninput={() => (page = 0)}
      /></label
    >
    <span class="muted">{filtered.length} / {rows.length} {$t('records')}</span>
  </div>
  <div class="evidence-rows">
    {#each filtered.slice(current * 20, (current + 1) * 20) as row (row)}
      <details>
        <summary
          ><span><strong>{row.title}</strong><small>{row.subtitle}</small></span>
          {#if row.severity}<span
              class="badge"
              class:high={['high', 'critical'].includes(row.severity)}
              class:medium={row.severity === 'medium'}>{$t(row.severity)}</span
            >{/if}
        </summary>
        <div class="row-evidence"><Metadata value={row.evidence} /></div>
      </details>
    {:else}<p class="muted">{$t('No records match this filter.')}</p>{/each}
  </div>
  {#if filtered.length > 20}<div class="pagination">
      <button class="button" disabled={current === 0} onclick={() => (page = current - 1)}
        >{$t('Previous')}</button
      >
      <span>{current + 1} / {Math.ceil(filtered.length / 20)}</span>
      <button
        class="button"
        disabled={(current + 1) * 20 >= filtered.length}
        onclick={() => (page = current + 1)}>{$t('Next')}</button
      >
    </div>{/if}
{:else}<p class="empty muted">{$t(empty)}</p>{/if}

<style>
  .row-toolbar,
  .pagination {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .row-toolbar {
    padding-bottom: var(--space-3);
  }
  label {
    display: grid;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }
  input {
    width: 100%;
  }
  details {
    border-top: 1px solid var(--border);
  }
  summary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    cursor: pointer;
  }
  summary > span:first-child {
    flex: 1;
    min-width: 0;
  }
  summary strong,
  summary small {
    display: block;
    overflow-wrap: anywhere;
  }
  summary strong {
    font-size: var(--text-body);
  }
  summary small {
    color: var(--muted);
    font-size: var(--text-caption);
    margin-top: var(--space-1);
  }
  summary::after {
    content: '+';
  }
  details[open] > summary::after {
    content: '−';
  }
  .row-evidence {
    padding: var(--space-3);
    background: var(--bg);
    border-radius: var(--control-radius);
    overflow-wrap: anywhere;
  }
  .badge.high {
    color: var(--red);
  }
  .badge.medium {
    color: var(--amber);
  }
  .pagination {
    justify-content: flex-end;
    margin-top: var(--space-3);
  }
  .empty {
    padding: var(--space-3) 0;
    line-height: 1.6;
  }
</style>
