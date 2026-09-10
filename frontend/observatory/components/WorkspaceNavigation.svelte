<script lang="ts">
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

<div class="history-controls" aria-label="Navigation history">
  <button class="history-arrow" aria-label="Back" disabled={!canBack} onclick={() => back(-1)}
    ><Icon name="arrowLeft" /></button
  >
  <button class="history-arrow" aria-label="Forward" disabled={!canForward} onclick={() => back(1)}
    ><Icon name="chevron" /></button
  >
</div>
