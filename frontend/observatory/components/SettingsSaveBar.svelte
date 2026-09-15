<script lang="ts">
  import { t } from '../runtime/i18n';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  let {
    loaded,
    dirty,
    mutation,
    validation,
    validationId,
    fix,
    save,
    discard,
  }: {
    loaded: boolean;
    dirty: boolean;
    mutation: 'save' | 'replace' | null;
    validation: string;
    validationId: string;
    fix: () => Promise<void>;
    save: () => Promise<void>;
    discard: () => Promise<void>;
  } = $props();
</script>

<div class="settings-save">
  {#if validation}<div class="validation-summary">
      <p id={validationId} role="alert">{$t(validation)}</p>
      <button class="button" onclick={fix}>{$t('Fix invalid setting')}</button>
    </div>{/if}
  <span class="settings-draft" role="status"
    >{!loaded
      ? $t('Loading settings…')
      : mutation === 'save'
        ? $t('Saving changes…')
        : mutation === 'replace'
          ? $t('Reloading settings…')
          : dirty
            ? $t('Unsaved changes')
            : $t('Settings saved')}</span
  >
  <Action disabled={!loaded || !dirty || mutation !== null} action={discard}
    ><Icon name="close" />{$t('Discard changes')}</Action
  >
  <Action disabled={!loaded || !dirty || mutation !== null || !!validation} action={save}
    ><Icon name="check" />{$t('Save settings')}</Action
  >
</div>

<style>
  .settings-save {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3) var(--panel-inset);
    background: var(--panel);
    border-top: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
  }
  .settings-draft {
    margin-right: auto;
    color: var(--muted);
    font-size: var(--text-body);
  }
  .validation-summary {
    flex-basis: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .validation-summary p {
    margin: 0;
    flex: 1;
    font-size: var(--text-body);
  }
  .validation-summary .button {
    flex-shrink: 0;
  }
  .settings-save :global(.action-control:last-child .button:not(:disabled)) {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }
  @media (max-width: 700px) {
    .validation-summary {
      flex-wrap: wrap;
    }
  }
</style>
