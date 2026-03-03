<script>
  /**
   * @file TimelineLegend.svelte
   * @description Timeline header bar with title, severity counters, and zoom hint.
   * @since v0.3.1
   */
  import { t } from '../i18n/index.js';

  /** @type {{ summary: { critical: number, high: number, medium: number, low: number, total: number } }} */
  let { summary } = $props();
</script>

<div class="timeline-header">
  <span class="timeline-title">{$t('timeline.title')}</span>
  <div class="timeline-counters">
    {#if summary.critical > 0}
      <span class="counter critical">{summary.critical}</span>
    {/if}
    {#if summary.high > 0}
      <span class="counter high">{summary.high}</span>
    {/if}
    {#if summary.medium > 0}
      <span class="counter medium">{summary.medium}</span>
    {/if}
    <span class="counter low">{summary.low}</span>
    <span class="counter total">{summary.total}</span>
  </div>
  <span class="zoom-hint">{$t('timeline.zoom_hint')}</span>
</div>

<style>
  .timeline-header {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    padding: 0 var(--aegis-space-6) var(--aegis-space-3);
  }

  .timeline-title {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .timeline-counters {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-2);
  }

  .counter {
    font: var(--md-sys-typescale-label-medium);
    font-family: var(--fancy-font-mono);
    font-weight: 700;
    padding: 0 var(--aegis-space-3);
    border-radius: var(--md-sys-shape-corner-full);
    line-height: 1.6;
  }

  .counter.critical {
    background: color-mix(in srgb, var(--md-sys-color-error) 20%, transparent);
    color: var(--md-sys-color-error);
  }

  .counter.high {
    background: color-mix(in srgb, var(--md-sys-color-secondary) 20%, transparent);
    color: var(--md-sys-color-secondary);
  }

  .counter.medium {
    background: color-mix(in srgb, var(--md-sys-color-primary) 20%, transparent);
    color: var(--md-sys-color-primary);
  }

  .counter.low {
    background: color-mix(in srgb, var(--md-sys-color-on-surface-variant) 12%, transparent);
    color: var(--md-sys-color-on-surface-variant);
  }

  .counter.total {
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.6;
    padding: 0;
    margin-left: var(--aegis-space-2);
  }

  .zoom-hint {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.4;
    margin-left: auto;
  }
</style>
