<script>
  /**
   * @file TimelineTooltip.svelte
   * @description Fixed-position tooltip for timeline dot hover.
   * @since v0.3.1
   */

  /** @type {{ visible: boolean, x: number, y: number, text: string }} */
  let { visible, x, y, text } = $props();
</script>

{#if visible}
  <div class="timeline-tooltip" style="left:{x}px; top:{y}px">
    {text}
  </div>
{/if}

<style>
  .timeline-tooltip {
    position: fixed;
    pointer-events: none;
    white-space: nowrap;
    font: var(--md-sys-typescale-label-medium);
    font-family: var(--fancy-font-mono);
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container-high);
    border: var(--aegis-card-border);
    border-radius: var(--md-sys-shape-corner-small);
    padding: var(--aegis-space-2) var(--aegis-space-5);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 9999;
  }
</style>
