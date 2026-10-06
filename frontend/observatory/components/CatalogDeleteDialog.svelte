<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../runtime/i18n';
  import Action from './Action.svelte';
  let {
    name,
    pending,
    confirm,
    cancel,
  }: {
    name: string;
    pending: boolean;
    confirm: () => Promise<void>;
    cancel: () => void;
  } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let cancelButton: HTMLButtonElement;
  function dismiss() {
    if (!pending) cancel();
  }
  onMount(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    cancelButton.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  });
</script>

<dialog
  class="editor-dialog delete-dialog"
  bind:this={dialog}
  aria-labelledby={id + '-title'}
  aria-describedby={id + '-copy'}
  aria-busy={pending}
  oncancel={(event) => {
    event.preventDefault();
    dismiss();
  }}
>
  <div class="modal-head"><h2 id={id + '-title'}>{$t('Delete custom agent?')}</h2></div>
  <div class="delete-copy" id={id + '-copy'}>
    <p>{$t('Remove {name} from your custom catalog?', { name })}</p>
    <p>
      {$t(
        'Its process signatures will no longer identify this custom agent. Recorded activity is kept.',
      )}
    </p>
  </div>
  <div class="modal-actions">
    <button class="button" bind:this={cancelButton} aria-disabled={pending} onclick={dismiss}
      >{$t('Cancel')}</button
    >
    <Action disabled={pending} action={confirm}>{$t('Delete agent')}</Action>
  </div>
</dialog>

<style>
  .delete-dialog {
    width: min(520px, calc(100vw - 36px));
    max-height: calc(100dvh - 36px);
    padding: 0;
    border-radius: var(--surface-radius);
  }
  .modal-head,
  .modal-actions {
    margin: 0;
  }
  .modal-head {
    border-bottom: 1px solid var(--border);
  }
  .delete-copy {
    padding: var(--space-4) var(--space-5);
  }
  p {
    margin: 0;
  }
  p + p {
    margin-top: var(--space-3);
  }
  .button[aria-disabled='true'] {
    cursor: wait;
  }
</style>
