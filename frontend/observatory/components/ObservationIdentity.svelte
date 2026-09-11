<script lang="ts">
  import { t } from '../runtime/i18n';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  import type { RecordData } from '../runtime/host';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    row,
    agents = [],
    showHint = true,
  }: { row: RecordData; agents?: RecordData[]; showHint?: boolean } = $props();
  let info = $derived(describeObservation(row, agents));
</script>

<span class="observation-identity" title={info.explanation}>
  {#if info.actor || info.context}<AgentLogo
      name={info.actor || info.context}
      size={20}
    />{:else}<Icon name={info.skill ? 'settings' : 'activity'} />{/if}
  <span
    ><strong>{info.actor || info.context || $t(info.label)}</strong>{#if showHint}<small
        >{$t(info.hint)}</small
      >{/if}</span
  >
</span>

<style>
  .observation-identity {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    text-align: left;
  }
  .observation-identity > span {
    min-width: 0;
  }
  strong {
    font-size: calc(12px * var(--ui-scale));
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
    line-height: 1.45;
  }
</style>
