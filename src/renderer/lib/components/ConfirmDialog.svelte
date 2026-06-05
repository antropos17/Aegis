<script>
  /**
   * @file ConfirmDialog.svelte
   * @description Generic destructive-action confirmation dialog. Mirrors the
   *   delete-confirm pattern in AgentFormModal: a scrim overlay + glass modal
   *   with title, message, a Cancel button and a danger confirm button. Esc or
   *   an overlay click cancels. All text is passed in by the caller so the
   *   component stays i18n-agnostic and reusable.
   * @since v0.10.0-alpha
   */

  /**
   * @type {{
   *   title: string,
   *   message: string,
   *   confirmLabel: string,
   *   cancelLabel: string,
   *   onconfirm: () => void,
   *   oncancel: () => void,
   * }}
   */
  let { title, message, confirmLabel, cancelLabel, onconfirm, oncancel } = $props();

  /** @type {HTMLDivElement | undefined} */
  let modalRef = $state(undefined);

  // Autofocus the dialog on open so the overlay subtree is in the keyboard
  // event path immediately and Esc reaches our handler (see AgentFormModal).
  $effect(() => {
    modalRef?.focus();
  });
</script>

<div
  class="overlay"
  role="button"
  tabindex="-1"
  onclick={oncancel}
  onkeydown={(e) => {
    if (e.key === 'Escape') oncancel();
  }}
>
  <div
    bind:this={modalRef}
    class="modal"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') oncancel();
      e.stopPropagation();
    }}
  >
    <h3 class="modal-title">{title}</h3>
    <p class="modal-text">{message}</p>
    <div class="modal-actions">
      <button class="crud-btn" onclick={oncancel}>{cancelLabel}</button>
      <button class="crud-btn danger" onclick={onconfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--md-sys-color-scrim);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--md-sys-color-surface-container-high);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-large);
    padding: var(--aegis-space-10);
    min-width: calc(360px * var(--aegis-ui-scale));
    max-width: 460px;
  }
  .modal-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0 0 var(--aegis-space-8);
  }
  .modal-text {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
    margin: 0 0 var(--aegis-space-9);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--aegis-space-4);
  }
  .crud-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: calc(7px * var(--aegis-ui-scale)) var(--aegis-space-7);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .crud-btn:hover {
    background: var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface);
    border-color: var(--aegis-border-hover);
  }
  .crud-btn.danger {
    background: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
    border-color: var(--md-sys-color-error);
  }
</style>
