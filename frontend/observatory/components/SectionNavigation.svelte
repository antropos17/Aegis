<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { DetailTab } from '../runtime/detail-model';
  import Icon from './Icon.svelte';
  let {
    tabs,
    selected,
    change,
    prefix,
    label = 'Sections',
    controls = false,
  }: {
    tabs: DetailTab[];
    selected: string;
    change: (_id: string) => void | Promise<void>;
    prefix: string;
    label?: string;
    controls?: boolean;
  } = $props();
</script>

<nav class="section-navigation" aria-label={$t(label)}>
  <h2>{$t(label)}</h2>
  {#each tabs as tab (tab.id)}
    <button
      id={prefix + '-section-link-' + tab.id}
      aria-current={selected === tab.id ? 'location' : undefined}
      aria-controls={controls ? prefix + '-panel-' + tab.id : undefined}
      onclick={() => change(tab.id)}
    >
      {#if tab.icon}<Icon name={tab.icon} />{/if}
      <span>{$t(tab.label)}</span>
      {#if tab.count !== undefined}<span class="section-count">{tab.count}</span>{/if}
    </button>
  {/each}
</nav>

<style>
  .section-navigation {
    display: grid;
    gap: var(--space-2);
    padding: var(--panel-inset);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--raised);
    min-width: 0;
  }
  h2 {
    margin: 0 0 var(--space-1);
    color: var(--ink);
    font-size: var(--text-body);
    font-weight: 700;
  }
  button {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
    color: var(--ink);
    padding: var(--space-3);
    min-height: 40px;
    min-width: 0;
    font-weight: 600;
  }
  button[aria-current] {
    border-color: var(--ink);
    background: var(--accent-bg);
    box-shadow: inset 3px 0 0 var(--ink);
  }
  button:hover {
    border-color: var(--strong-border);
  }
  .section-count {
    margin-left: auto;
    font-size: var(--text-caption);
    color: var(--muted);
  }
</style>
