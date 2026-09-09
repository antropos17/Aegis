<script lang="ts">
  import { workspaces } from '../runtime/navigation';
  import Icon from './Icon.svelte';
  let {
    view,
    navigate,
    back,
    canBack,
    canForward,
  }: {
    view: string;
    navigate: (_id: string) => Promise<void>;
    back: (_delta: number) => void;
    canBack: boolean;
    canForward: boolean;
  } = $props();
  let group = $derived(workspaces.find((entry) => entry.id === view)?.group);
  let related = $derived(workspaces.filter((entry) => entry.group === group));
  async function keydown(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? related.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + related.length) % related.length;
    await navigate(related[next].id);
    document
      .querySelector<HTMLButtonElement>('.workspace-tabs [aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }
</script>

<div class="workspace-navigation">
  <div class="history-controls">
    <button class="history-arrow" aria-label="Back" disabled={!canBack} onclick={() => back(-1)}
      ><Icon name="arrowLeft" /></button
    >
    <button
      class="history-arrow"
      aria-label="Forward"
      disabled={!canForward}
      onclick={() => back(1)}><Icon name="chevron" /></button
    >
  </div>
  <div class="workspace-tabs" role="tablist" aria-label="Related workspaces">
    {#each related as entry, index (entry.id)}
      <div class="workspace-tab" class:active={view === entry.id}>
        <button
          role="tab"
          id={'workspace-tab-' + entry.id}
          aria-controls="workspace-content"
          aria-selected={view === entry.id}
          tabindex={view === entry.id ? 0 : -1}
          onkeydown={(event) => keydown(event, index)}
          onclick={() => navigate(entry.id)}
        >
          <Icon name={entry.icon} />{entry.label}
        </button>
      </div>
    {/each}
  </div>
</div>
