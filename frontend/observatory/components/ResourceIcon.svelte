<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { RecordData } from '../runtime/host';
  import { resourceVisual } from '../runtime/resource-visual';
  import Icon from './Icon.svelte';
  let { row, compact = false }: { row: RecordData; compact?: boolean } = $props();
  const visual = $derived(resourceVisual(row));
</script>

<span class="resource-symbol" class:compact title={$t(visual.label)} aria-hidden="true">
  <Icon name={visual.icon} />
</span>

<style>
  .resource-symbol {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: calc(30px * var(--ui-scale));
    height: calc(30px * var(--ui-scale));
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    background: var(--bg);
    color: var(--ink);
  }
  .resource-symbol :global(.icon) {
    width: calc(20px * var(--ui-scale));
    height: calc(20px * var(--ui-scale));
  }
  .compact {
    width: calc(24px * var(--ui-scale));
    height: calc(24px * var(--ui-scale));
  }
  .compact :global(.icon) {
    width: calc(16px * var(--ui-scale));
    height: calc(16px * var(--ui-scale));
  }
</style>
