<script lang="ts">
  import { t } from '../runtime/i18n';
  import { saveAdvancedMode } from '../runtime/interface-mode';
  import SettingsGroup from './SettingsGroup.svelte';

  let {
    advanced = true,
    onAdvancedChange,
  }: {
    advanced?: boolean;
    onAdvancedChange: (_advanced: boolean) => void;
  } = $props();
  const id = $props.id();
  let error = $state(false);
  let saved = $state(false);

  function change(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const next = !input.checked;
    try {
      saveAdvancedMode(next);
    } catch {
      input.checked = !advanced;
      saved = false;
      error = true;
      return;
    }
    error = false;
    saved = true;
    onAdvancedChange(next);
  }
</script>

<div class="interface-preference">
  <SettingsGroup
    title={$t('Interface')}
    description={$t(
      'Advanced shows every workspace by default. Enable Simple to keep agents, activity and file checks together.',
    )}
  >
    <label class="setting">
      <span>
        {$t('Simple interface')}
        <small id={id + '-help'}
          >{$t('Saved separately on this device. Your settings draft is unchanged.')}</small
        >
      </span>
      <input
        type="checkbox"
        aria-label={$t('Simple interface')}
        aria-describedby={id + '-help'}
        checked={!advanced}
        onchange={change}
      />
    </label>
    {#if error}
      <p role="alert" class="preference-feedback">
        {$t(
          'Could not save interface preference on this device. Your previous mode is still selected.',
        )}
      </p>
    {:else if saved}
      <p role="status" class="preference-feedback">
        {$t(advanced ? 'Advanced interface saved.' : 'Simple interface saved.')}
      </p>
    {/if}
  </SettingsGroup>
</div>

<style>
  .interface-preference {
    margin-bottom: var(--space-4);
  }
  .preference-feedback {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  [role='alert'] {
    color: var(--red);
  }
</style>
