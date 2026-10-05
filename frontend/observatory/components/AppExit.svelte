<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
  import Icon from './Icon.svelte';

  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const feedbackId = $props.id();
  let pending = $state(false);
  let confirming = $state(false);
  let feedback = $state('');
  let dialog: HTMLDialogElement;
  let cancelButton: HTMLButtonElement;
  let trigger: HTMLButtonElement;
  let alive = true;
  let available = $derived(!preview && typeof host?.quitApp === 'function');
  onDestroy(() => (alive = false));

  function ask() {
    if (!available || pending || confirming) return;
    feedback = '';
    confirming = true;
    dialog.showModal();
    cancelButton.focus({ preventScroll: true });
  }

  function cancel() {
    if (pending || !confirming) return;
    confirming = false;
    feedback = 'Exit cancelled.';
    dialog.close();
    trigger.focus({ preventScroll: true });
  }

  async function quit() {
    if (!available || pending || !confirming) return;
    pending = true;
    feedback = '';
    try {
      const result = record(await invoke(host, 'quitApp', true));
      if (!alive) return;
      if (result.success === true) return;
      feedback = 'AEGIS could not quit. Try again.';
    } catch {
      if (alive) feedback = 'AEGIS could not quit. Try again.';
    }
    if (alive) pending = false;
  }
</script>

<div class="app-exit">
  <button
    class="button"
    bind:this={trigger}
    disabled={!available}
    aria-disabled={pending}
    aria-busy={pending}
    aria-describedby={feedbackId}
    title={$t('Stop monitoring and quit AEGIS')}
    onclick={ask}><Icon name="close" />{$t(pending ? 'Quitting…' : 'Quit AEGIS')}</button
  >
  <p class="exit-feedback" id={feedbackId} role="status">
    {$t(!available ? 'Available in the desktop app.' : confirming ? '' : feedback)}
  </p>
</div>

<dialog
  class="editor-dialog exit-dialog"
  bind:this={dialog}
  aria-labelledby={feedbackId + '-title'}
  aria-describedby={feedbackId + '-copy'}
  aria-busy={pending}
  oncancel={(event) => {
    event.preventDefault();
    cancel();
  }}
>
  <div class="modal-head">
    <div>
      <span class="muted">AEGIS</span>
      <h2 id={feedbackId + '-title'}>{$t('Quit AEGIS?')}</h2>
    </div>
    <button
      class="icon-button"
      aria-label={$t('Close dialog')}
      aria-disabled={pending}
      onclick={cancel}><Icon name="close" /></button
    >
  </div>
  <div class="exit-body">
    <div class="dialog-copy" id={feedbackId + '-copy'}>
      <p>{$t('Monitoring stops until you open AEGIS again.')}</p>
      <p>{$t('Saved preferences and recorded history are kept. Unsaved edits are discarded.')}</p>
    </div>
    <p class="exit-feedback" role="status">{$t(confirming ? feedback : '')}</p>
  </div>
  <div class="modal-actions">
    <button class="button" bind:this={cancelButton} aria-disabled={pending} onclick={cancel}
      >{$t('Cancel')}</button
    >
    <button class="button primary" aria-disabled={pending} aria-busy={pending} onclick={quit}
      ><Icon name="close" />{$t(pending ? 'Quitting…' : 'Quit AEGIS')}</button
    >
  </div>
</dialog>

<style>
  .app-exit {
    min-width: 0;
    padding: 0 var(--space-2);
  }
  .app-exit .button {
    width: 100%;
    justify-content: center;
  }
  .button[aria-disabled='true'] {
    cursor: wait;
  }
  .exit-feedback {
    min-height: 1.5em;
    margin: var(--space-1) 0 0;
    font-size: var(--text-caption);
    line-height: 1.5;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .exit-dialog {
    width: min(520px, calc(100vw - 36px));
    max-height: calc(100dvh - 36px);
    padding: 0;
    border-radius: 12px;
  }
  .modal-head {
    margin: 0;
    border-bottom: 1px solid var(--border);
  }
  .modal-head > div {
    min-width: 0;
  }
  .exit-body {
    padding: 18px 20px;
  }
  .dialog-copy p {
    margin: 0;
  }
  .dialog-copy p + p {
    margin-top: 12px;
  }
  .exit-body .exit-feedback:empty {
    display: none;
  }
  .modal-actions {
    margin: 0;
  }
</style>
