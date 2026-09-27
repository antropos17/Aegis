<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../runtime/i18n';
  import type { SensitiveAlert } from '../runtime/sensitive-alerts';
  import { alertBasename } from '../runtime/sensitive-alerts';
  import Icon from './Icon.svelte';

  let {
    items,
    evicted,
    onReview,
    onInspect,
    onClose,
  }: {
    items: SensitiveAlert[];
    evicted: number;
    onReview: (_id: number, _reviewed: boolean) => void;
    onInspect?: (_item: SensitiveAlert) => void;
    onClose: () => void;
  } = $props();
  let filter = $state<'open' | 'all'>('open');
  let heading: HTMLHeadingElement;
  const openCount = $derived(items.filter((item) => !item.reviewed).length);
  const visible = $derived(filter === 'open' ? items.filter((item) => !item.reviewed) : items);
  onMount(() => heading?.focus({ preventScroll: true }));

  function sourceLabel(item: SensitiveAlert): string {
    const { agent, attribution } = item.event;
    if (agent && attribution?.status === 'confirmed')
      return $t('Observed owner: {value0}', { value0: agent });
    if (agent && attribution?.status === 'inferred')
      return $t('Possible source: {value0}', { value0: agent });
    return $t('Source unverified');
  }
</script>

<div
  class="alert-center panel"
  role="dialog"
  aria-modal="false"
  aria-label={$t('Sensitive activity review')}
  tabindex="-1"
  onkeydown={(event) => {
    if (event.key === 'Escape') onClose();
  }}
>
  <header>
    <div>
      <h2 tabindex="-1" bind:this={heading}>
        <Icon name="shield" />{$t('Sensitive activity review')}
      </h2>
      <p>
        {$t(
          'Observations received in this window. Reviewing a row does not isolate a file or block access.',
        )}
      </p>
    </div>
    <button class="close" aria-label={$t('Close alert review')} onclick={onClose}>×</button>
  </header>
  <div class="summary">
    <strong>{$t('{value0} need review', { value0: openCount })}</strong>
    <span>{$t('{value0} retained alerts', { value0: items.length })}</span>
  </div>
  {#if evicted > 0}
    <p class="retention">
      {$t('{value0} older alerts left this window’s review list.', { value0: evicted })}
    </p>
  {/if}
  <div class="filters" role="group" aria-label={$t('Alert filters')}>
    <button aria-pressed={filter === 'open'} onclick={() => (filter = 'open')}
      >{$t('Needs review')}</button
    >
    <button aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}
      >{$t('All received')}</button
    >
  </div>
  <ul>
    {#each visible as item (item.id)}
      <li class:reviewed={item.reviewed}>
        <div class="record-head">
          <strong>{alertBasename(item.event.file)}</strong>
          <span class="status"
            >{item.reviewed ? $t('Reviewed this session') : $t('Needs review')}</span
          >
        </div>
        <p class="source">
          {sourceLabel(item)}{item.event._demo === true ? ` · ${$t('Simulated data')}` : ''}
        </p>
        <p class="path">{item.event.file}</p>
        <p class="details">
          {$t(
            item.event.action === 'holding'
              ? 'Handle present; read not established'
              : item.event.action,
          )}
          {#if Number.isFinite(item.event.timestamp)}
            · {new Date(item.event.timestamp).toLocaleString()}
          {/if}
          {#if item.event.reason}
            · {item.event.reason}{/if}
        </p>
        <div class="actions">
          {#if onInspect}
            <button class="review" onclick={() => onInspect(item)}>{$t('Open evidence')}</button>
          {/if}
          <button class="review" onclick={() => onReview(item.id, !item.reviewed)}
            >{item.reviewed ? $t('Return to review') : $t('Mark reviewed')}</button
          >
        </div>
      </li>
    {:else}
      <li class="empty">
        {items.length
          ? $t('No alerts need review in this window.')
          : $t('No sensitive observations received yet.')}
      </li>
    {/each}
  </ul>
</div>

<style>
  .alert-center {
    position: fixed;
    z-index: 90;
    right: 20px;
    bottom: 60px;
    width: min(520px, calc(100vw - 40px));
    max-height: min(72vh, 640px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--strong-border);
    box-shadow: var(--shadow);
  }
  header,
  .summary,
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-section);
  }
  p {
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.45;
  }
  .close {
    align-self: flex-start;
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: 22px;
    cursor: pointer;
  }
  .summary {
    justify-content: flex-start;
    font-size: var(--text-body);
  }
  .summary span,
  .retention {
    color: var(--muted);
  }
  .retention {
    padding: 0 var(--space-4);
  }
  .filters {
    justify-content: flex-start;
    padding-top: 0;
    border-bottom: 1px solid var(--border);
  }
  .filters button,
  .review {
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    background: var(--panel);
    color: var(--ink);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
  }
  .filters button[aria-pressed='true'] {
    border-color: var(--selection-border);
    background: var(--selection);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  li {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  li.reviewed {
    opacity: 0.75;
  }
  .record-head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .status {
    color: var(--amber);
    font-size: var(--text-caption);
  }
  .reviewed .status {
    color: var(--muted);
  }
  .path {
    color: var(--ink);
  }
  .details {
    margin-bottom: var(--space-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .empty {
    color: var(--muted);
  }
  @media (max-width: 600px) {
    .alert-center {
      right: 10px;
      bottom: 54px;
      width: calc(100vw - 20px);
    }
  }
</style>
