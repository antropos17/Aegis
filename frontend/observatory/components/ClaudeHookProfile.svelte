<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { confirmed, invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import Icon from './Icon.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  type Operation = 'status' | 'install' | 'remove' | 'open-profile';
  const id = $props.id();
  const messages: Record<string, string> = {
    IDLE: 'Setup has not been reviewed.',
    READY: 'Prepared setup files are available for native review.',
    UNAVAILABLE:
      'Native setup files are unavailable. This requires the prepared Windows helper and .NET 10.0.10.',
    BUSY: 'Another profile review is still in progress.',
    CANCELLED: 'Review cancelled. The hook was not changed.',
    INSTALLED: 'Separate profile configured. Blocking is not verified.',
    REMOVED: 'The reviewed owned hook was removed.',
    CONFIGURED_UNOWNED: 'An existing hook profile requires a separate ownership recovery review.',
    OWNED_INSTALL_EXISTS: 'This profile is already configured.',
    NO_OWNED_INSTALL: 'This session has no owned installation to remove.',
    EXPIRED: 'The review expired before confirmation. Review the current change again.',
    SESSION_ENDED:
      'The setup session ended. Retained profile files need a separate recovery review.',
    INVALID_POLICY: 'Select a valid AEGIS schema-1 Bash policy.',
    UNSUPPORTED_PATH: 'A selected path cannot be represented safely in this hook command.',
    RETENTION_LIMIT:
      'The retained backup limit was reached. Review the existing profile files before another setup.',
    PREVIEW_TOO_LARGE: 'The exact change is too large for this native review.',
    WRITE_UNCERTAIN: 'The write outcome is uncertain. Retained backups require recovery review.',
    READBACK_FAILED:
      'The written profile could not be verified. Retained backups require recovery review.',
    RETAINED_UNKNOWN: 'An uncertain result is retained. Another write is unavailable.',
  };
  const failedCodes = new Set([
    'UNAVAILABLE',
    'SESSION_ENDED',
    'INVALID_POLICY',
    'UNSUPPORTED_PATH',
    'RETENTION_LIMIT',
    'PREVIEW_TOO_LARGE',
    'WRITE_UNCERTAIN',
    'READBACK_FAILED',
    'RETAINED_UNKNOWN',
  ]);
  let profileState = $state({ code: 'IDLE', canInstall: false, canRemove: false, canOpen: false });
  let pending = $state<Operation | null>(null);
  let failed = $state(false);
  let feedback = $state('');
  let alive = true;
  let available = $derived(!preview && typeof host?.reviewClaudeHookProfile === 'function');
  onDestroy(() => {
    alive = false;
  });
  onMount(() => {
    if (available) void perform('status');
  });
  async function perform(action: Operation) {
    if (!available || pending !== null) return;
    pending = action;
    failed = false;
    try {
      const value = record(confirmed(await invoke(host, 'reviewClaudeHookProfile', action)));
      if (!alive) return;
      const code = typeof value.code === 'string' ? value.code : 'OPERATION_FAILED';
      profileState = {
        code,
        canInstall: value.canInstall === true,
        canRemove: value.canRemove === true,
        canOpen: value.canOpen === true,
      };
      feedback =
        messages[code] || 'Profile review could not complete. Retained files are preserved.';
      failed = failedCodes.has(code) || !Object.hasOwn(messages, code);
    } catch {
      if (alive) {
        feedback = 'Profile review could not complete. Retained files are preserved.';
        failed = true;
      }
    } finally {
      if (alive) pending = null;
    }
  }
</script>

<section class="panel hook-profile" aria-labelledby={id}>
  <div class="panel-head">
    <h2 {id}><Icon name="shield" />{$t('Separate Claude hook profile')}</h2>
  </div>
  <div class="panel-body">
    <p>
      {$t(
        'Prepare an AEGIS-owned settings profile for an explicitly selected Claude launch. Native review shows the exact file and changed lines before confirmation.',
      )}
    </p>
    <p class="muted">
      {$t(
        'This creates a private draft and retained backups. Use the profile only with --settings. Personal Claude settings are not edited; Bash blocking remains unverified.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Install and removal belong to this setup session, for up to three minutes. Restart and expired-session recovery are not available here.',
      )}
    </p>
    <div class="profile-actions">
      <button
        class="button"
        disabled={!available || pending !== null || !profileState.canInstall}
        aria-busy={pending === 'install'}
        onclick={() => perform('install')}
        >{$t(
          pending === 'install' ? 'Preparing native review…' : 'Choose policy and review install',
        )}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null || !profileState.canRemove}
        aria-busy={pending === 'remove'}
        onclick={() => perform('remove')}
        >{$t(pending === 'remove' ? 'Preparing native review…' : 'Review removal')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null || !profileState.canOpen}
        onclick={() => perform('open-profile')}>{$t('Open profile folder')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null}
        onclick={() => perform('status')}>{$t('Refresh setup status')}</button
      >
    </div>
    {#if feedback}<p role={failed ? 'alert' : 'status'} class:failed class="profile-feedback">
        {$t(feedback)}
      </p>{/if}
    {#if preview}<p class="muted">
        {$t('Profile changes are disabled in this simulated preview.')}
      </p>{:else if !available}<p class="muted">
        {$t('Profile review requires the AEGIS desktop connection.')}
      </p>{/if}
  </div>
</section>

<style>
  .hook-profile {
    min-width: 0;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  .panel-body {
    display: grid;
    gap: var(--space-3);
  }
  p {
    margin: 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--muted);
  }
  .profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .profile-feedback {
    padding: var(--space-3);
    background: var(--raised);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
  }
  .failed {
    color: var(--amber);
  }
</style>
