<script lang="ts">
  import { t } from '../runtime/i18n';

  import { describeObservation } from '../../../src/shared/observation-display.js';
  import type { RecordData } from '../runtime/host';
  import ResourceIcon from './ResourceIcon.svelte';
  import { resourceVisual } from '../runtime/resource-visual';
  let { row }: { row: RecordData } = $props();
  let info = $derived(describeObservation(row));
  let visual = $derived(resourceVisual(row));
</script>

<span class="observation-resource" title={info.path}>
  <span class="observation-resource-title"
    ><ResourceIcon {row} compact /><strong>{info.resource}</strong></span
  >
  <small
    ><span class="resource-kind">{$t(visual.label)}</span
    >{#if info.path && info.path !== info.resource}
      · <span>{info.path}</span>{/if}</small
  >
</span>

<style>
  .observation-resource {
    display: grid;
    gap: 3px;
    min-width: 0;
    text-align: left;
  }
  .observation-resource-title {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  strong {
    font: 600 calc(12px * var(--ui-scale))/1.4 var(--sans);
    overflow-wrap: anywhere;
  }
  small {
    color: var(--muted);
    font: calc(10px * var(--ui-scale))/1.45 var(--sans);
    overflow-wrap: anywhere;
  }
  .resource-kind {
    font-weight: 500;
  }
</style>
