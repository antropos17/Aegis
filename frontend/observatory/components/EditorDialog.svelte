<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    title,
    caption,
    close,
    children,
    actions,
  }: {
    title: string;
    caption: string;
    close: () => void;
    children: Snippet;
    actions: Snippet;
  } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
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
    <button class="icon-button" aria-label="Close dialog" onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  <div class="editor-body">{@render children()}</div>
  <div class="modal-actions">{@render actions()}</div>
</dialog>

<style>
  .editor-dialog[open] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    scrollbar-gutter: auto;
    padding: 16px;
    top: 18px;
    max-height: calc(100dvh - 36px);
  }
  .modal-head {
    flex: 0 0 auto;
    display: flex;
    align-items: start;
    gap: 12px;
    margin: 0;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    overflow-wrap: anywhere;
    line-height: 1.3;
  }
  .editor-body {
    min-height: 0;
    min-width: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
    padding: 16px 4px;
  }
  .modal-actions {
    flex: 0 0 auto;
    margin: 0;
    padding-top: 12px;
    gap: 8px;
  }
  .editor-body :global(.form-grid) {
    gap: 12px;
  }
  .editor-body :global(input),
  .editor-body :global(select),
  .editor-body :global(textarea) {
    max-width: 100%;
    min-width: 0;
  }
  .editor-body :global(label) {
    min-width: 0;
  }
  @media (max-width: 550px) {
    .editor-dialog[open] {
      padding: 12px;
    }
  }
</style>
