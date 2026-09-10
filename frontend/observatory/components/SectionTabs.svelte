<script lang="ts">
  import { tick } from 'svelte';
  import type { DetailTab } from '../runtime/detail-model';
  let {
    tabs,
    selected,
    change,
    prefix,
    label = 'Sections',
  }: {
    tabs: DetailTab[];
    selected: string;
    change: (_id: string) => void | Promise<void>;
    prefix: string;
    label?: string;
  } = $props();
  async function keydown(event: KeyboardEvent, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = (
      event.currentTarget as HTMLElement
    ).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    await change(tabs[next].id);
    await tick();
    buttons?.[next]?.focus({ preventScroll: true });
    buttons?.[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
</script>

<div class="section-tabs" role="tablist" aria-label={label}>
  {#each tabs as tab, i (tab.id)}
    <button
      role="tab"
      id={prefix + '-tab-' + tab.id}
      aria-controls={prefix + '-panel-' + tab.id}
      aria-selected={selected === tab.id}
      tabindex={selected === tab.id ? 0 : -1}
      onclick={() => change(tab.id)}
      onkeydown={(event) => keydown(event, i)}
    >
      {tab.label}{#if tab.count !== undefined}<span class="tab-count">{tab.count}</span>{/if}
    </button>
  {/each}
</div>
