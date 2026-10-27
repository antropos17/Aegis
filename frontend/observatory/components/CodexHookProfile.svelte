<script lang="ts">
  import { onMount } from 'svelte';
  import { confirmed, invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import Icon from './Icon.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  type Operation = 'status' | 'install' | 'remove' | 'open-profile' | 'prepare-launch';
  const id = $props.id();
  const messages: Record<string, string> = {
    IDLE: 'Setup has not been reviewed.',
    UNAVAILABLE: 'Packaged Windows setup files are unavailable.',
    BUSY: 'Another profile review is in progress.',
    CANCELLED: 'Review cancelled. The hook was not changed.',
    INSTALLED: 'Separate Codex hook profile configured. Provider behavior is not verified.',
    REMOVED: 'The reviewed hook was removed from the separate profile.',
    LAUNCH_READY: 'Reviewed terminal command copied. Run it from the exact policy folder.',
    INVALID_POLICY: 'Select a valid AEGIS Bash policy.',
    POLICY_CHANGED: 'The selected policy changed during review. Review it again.',
    UNSUPPORTED_PATH: 'A selected path cannot be safely represented in the hook command.',
    CODEX_INVALID: 'Select a local regular codex.exe without linked folders.',
    CODEX_CHANGED: 'The selected Codex executable changed during review. Select it again.',
    PROFILE_CHANGED: 'The profile is unsupported or changed. Review it manually.',
    DRAFT_REFUSED: 'The separate settings draft could not be created safely.',
    RETENTION_LIMIT:
      'The private backup limit was reached. Review retained files before another setup.',
    TARGET_CHANGED: 'The profile changed during review. Review it again.',
    TARGET_READ_FAILED: 'The profile could not be read safely.',
    PREVIEW_TOO_LARGE: 'The exact change is too large for native review.',
    EXPIRED: 'The review expired. Review the current change again.',
    BACKUP_FAILED: 'The private backup could not be verified. No change was written.',
    WRITE_UNCERTAIN: 'The write outcome is uncertain. Retained backups require recovery review.',
    READBACK_FAILED:
      'The written profile could not be verified. Retained backups require recovery review.',
    RETAINED_UNKNOWN: 'The write or native helper shutdown is uncertain. Review retained files.',
    OPERATION_FAILED: 'Profile review could not complete. Retained files are preserved.',
  };
  let capabilities = $state({ canInstall: false, canRemove: false, canOpen: false });
  let pending = $state<Operation | null>(null);
  let feedback = $state('');
  let failure = $state(false);
  const available = $derived(!preview && typeof host?.reviewCodexHookProfile === 'function');
  let alive = true;
  onMount(() => {
    if (available) void perform('status');
    return () => {
      alive = false;
    };
  });
  async function perform(action: Operation) {
    if (!available || pending) return;
    pending = action;
    try {
      const result = record(confirmed(await invoke(host, 'reviewCodexHookProfile', action)));
      if (!alive) return;
      const code = typeof result.code === 'string' ? result.code : 'OPERATION_FAILED';
      capabilities = {
        canInstall: result.canInstall === true,
        canRemove: result.canRemove === true,
        canOpen: result.canOpen === true,
      };
      feedback = messages[code] || messages.OPERATION_FAILED;
      failure = !['IDLE', 'BUSY', 'CANCELLED', 'INSTALLED', 'REMOVED', 'LAUNCH_READY'].includes(
        code,
      );
    } catch {
      if (alive) {
        capabilities = { canInstall: false, canRemove: false, canOpen: false };
        feedback = messages.OPERATION_FAILED;
        failure = true;
      }
    } finally {
      if (alive) pending = null;
    }
  }
</script>

<section class="panel codex-profile" aria-labelledby={id}>
  <div class="panel-head">
    <h2 {id}><Icon name="shield" />{$t('Separate Codex hook profile')}</h2>
  </div>
  <div class="panel-body">
    <p>
      {$t(
        'Select an existing AEGIS Bash policy and review the exact separate hook file in a native dialog. A private backup is retained.',
      )}
    </p>
    <p class="muted">
      {$t(
        'The launch derives a one-session override from the reviewed file. Existing user, project and managed settings remain in effect; they may suppress or change hook behavior.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Select the native codex.exe during launch review, then run the copied command in Windows PowerShell from the exact policy folder. Review and trust the hook manually with /hooks; AEGIS does not change trust.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Codex cannot honor ask for this hook: AEGIS converts ask to deny. The built-in project policy asks for supported commands, so this route denies them.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Hook errors, timeouts or malformed responses may let the tool continue. write_stdin is not checked again. Installed Codex behavior and blocking are not verified.',
      )}
    </p>
    <div class="profile-actions">
      <button
        class="button"
        disabled={!available || pending !== null || !capabilities.canInstall}
        onclick={() => perform('install')}>{$t('Choose Codex policy and review install')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null || !capabilities.canRemove}
        onclick={() => perform('remove')}>{$t('Review Codex hook removal')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null || !capabilities.canOpen}
        onclick={() => perform('prepare-launch')}>{$t('Review Codex terminal command')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null || !capabilities.canOpen}
        onclick={() => perform('open-profile')}>{$t('Open profile folder')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null}
        onclick={() => perform('status')}>{$t('Refresh setup status')}</button
      >
    </div>
    {#if feedback}<p role={failure ? 'alert' : 'status'}>{$t(feedback)}</p>{/if}
    {#if preview}<p class="muted">
        {$t('Profile changes are disabled in this simulated preview.')}
      </p>{:else if !available}<p class="muted">
        {$t('Profile review requires the AEGIS desktop connection.')}
      </p>{/if}
  </div>
</section>

<style>
  .codex-profile {
    margin-top: 12px;
  }
  .profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }
</style>
