<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import SectionTabs from './SectionTabs.svelte';
  import type { DetailTab } from '../runtime/detail-model';
  let {
    title,
    caption,
    close,
    children,
    actions,
    tabs,
    selected = $bindable('general'),
  }: {
    title: string;
    caption: string;
    close: () => void;
    children: Snippet<[string]>;
    actions: Snippet;
    tabs: DetailTab[];
    selected?: string;
  } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  let body: HTMLDivElement;
  const scroll: Record<string, number> = {};
  let previous = '';
  $effect.pre(() => {
    const next = selected;
    untrack(() => {
      if (previous && body) scroll[previous] = body.scrollTop;
      previous = next;
    });
    void tick().then(() => {
      if (body && selected === next) body.scrollTop = scroll[next] ?? 0;
    });
  });
  onMount(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    heading.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  });
</script>

<dialog class="editor-dialog" bind:this={dialog} aria-labelledby={id} oncancel={close}>
  <div class="modal-head">
    <div>
      <span class="muted">{caption}</span>
      <h2 {id} tabindex="-1" bind:this={heading}>{title}</h2>
    </div>
    <button class="icon-button" aria-label={$t('Close dialog')} onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  <SectionTabs
    {tabs}
    {selected}
    prefix={id}
    label={caption + ' sections'}
    change={(tab) => {
      selected = tab;
    }}
  />
  <div class="editor-body" bind:this={body}>
    {#each tabs as tab (tab.id)}<div
        role="tabpanel"
        tabindex="0"
        id={id + '-panel-' + tab.id}
        aria-labelledby={id + '-tab-' + tab.id}
        hidden={tab.id !== selected}
      >
        {#if tab.id === selected}{@render children(selected)}{/if}
      </div>{/each}
  </div>
  <div class="modal-actions">{@render actions()}</div>
</dialog>

<style>
  .editor-dialog[open] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    scrollbar-gutter: auto;
    padding: 0;
    top: 18px;
    width: min(700px, calc(100vw - 36px));
    height: min(590px, calc(100dvh - 36px));
    max-height: calc(100dvh - 36px);
    border-radius: 12px;
  }
  .modal-head {
    flex: 0 0 auto;
    display: flex;
    align-items: start;
    margin: 0;
    border-bottom: 1px solid var(--border);
  }
  .modal-head > div {
    min-width: 0;
    flex: 1;
  }
  .editor-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    padding: 18px 20px;
  }
  .modal-actions {
    flex: 0 0 auto;
    margin: 0;
    gap: 8px;
  }
  .editor-body :global(.form-grid) {
    gap: 16px;
  }
  .editor-body :global(input),
  .editor-body :global(select),
  .editor-body :global(textarea) {
    max-width: 100%;
    min-width: 0;
  }
  .editor-body :global(label) {
    min-width: 0;
    font: 500 calc(12px * var(--ui-scale))/1.5 var(--sans);
    color: var(--muted);
  }
  .editor-body :global([hidden]) {
    display: none;
  }
</style>
