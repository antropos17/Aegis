<script lang="ts">
  import { t } from '../runtime/i18n';

  import Icon from './Icon.svelte';
  let {
    back,
    canBack,
    canForward,
  }: {
    back: (_delta: number) => void;
    canBack: boolean;
    canForward: boolean;
  } = $props();
</script>

<div class="history-controls" aria-label={$t('Navigation history')}>
  <button class="history-arrow" aria-label={$t('Back')} disabled={!canBack} onclick={() => back(-1)}
    ><Icon name="arrowLeft" /></button
  >
  <button
    class="history-arrow"
    aria-label={$t('Forward')}
    disabled={!canForward}
    onclick={() => back(1)}><Icon name="chevron" /></button
  >
</div>
