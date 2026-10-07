<script lang="ts">
  import { t } from '../runtime/i18n';
  let { period = $bindable(60000), points }: { period?: number; points: number } = $props();
  const windows = [
    { value: 60000, label: '1 min' },
    { value: 180000, label: '3 min' },
    { value: 300000, label: '5 min' },
  ];
</script>

<div class="monitor-tools">
  <div class="history-windows" role="group" aria-label={$t('Performance history length')}>
    {#each windows as window (window.value)}
      <button aria-pressed={period === window.value} onclick={() => (period = window.value)}
        >{$t(window.label)}</button
      >
    {/each}
  </div>
  <span>{points} {$t('measured points')}</span>
</div>

<style>
  .monitor-tools {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .history-windows {
    display: inline-flex;
    gap: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: 1px;
  }
  button {
    min-height: calc(var(--control-height) - 4px);
    padding: calc(var(--space-1) / 2) var(--space-2);
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--muted);
    font: var(--text-caption)/1.4 var(--sans);
  }
  button:hover {
    color: var(--ink);
    background: var(--bg);
  }
  button[aria-pressed='true'] {
    color: var(--ink);
    background: var(--selection);
    border-color: var(--selection-border);
  }
</style>
