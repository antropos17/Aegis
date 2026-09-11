<script lang="ts">
  import { t } from '../runtime/i18n';

  import { describeObservation } from '../../../src/shared/observation-display.js';
  import type { RecordData } from '../runtime/host';
  import Icon from './Icon.svelte';
  let { row }: { row: RecordData } = $props();
  let info = $derived(describeObservation(row));
</script>

<span class="observation-resource" title={info.path}>
  <span class="observation-resource-title"
    ><Icon
      name={info.kind === 'Skill' ? 'settings' : info.kind === 'Network' ? 'network' : 'file'}
    /><strong>{info.resource}</strong>{#if info.kind === 'Skill'}<span class="evidence-tag"
        >{$t('Skill')}</span
      >{/if}</span
  >
  {#if info.path && info.path !== info.resource}<small>{info.path}</small>{/if}
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
  .evidence-tag {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--muted);
    font: calc(10px * var(--ui-scale))/1.4 var(--sans);
  }
</style>
