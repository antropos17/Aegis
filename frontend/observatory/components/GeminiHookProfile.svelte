<script lang="ts">
  import { onMount } from 'svelte';
  import { confirmed, invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import Icon from './Icon.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  type Operation = 'status' | 'install' | 'remove' | 'open-profile';
  const id = $props.id();
  const launch = `$folder = Read-Host 'Paste the .gemini folder path (Enter to cancel)'
if (-not [string]::IsNullOrWhiteSpace($folder)) {
  if ((Split-Path -Leaf $folder) -eq '.gemini' -and (Test-Path -LiteralPath (Join-Path $folder 'settings.json') -PathType Leaf)) {
    $previous = [Environment]::GetEnvironmentVariable('GEMINI_CLI_HOME', 'Process')
    try {
      $env:GEMINI_CLI_HOME = Split-Path -Parent $folder
      & gemini
    } finally {
      [Environment]::SetEnvironmentVariable('GEMINI_CLI_HOME', $previous, 'Process')
    }
  } else {
    Write-Error 'Select the .gemini folder containing the reviewed settings.json.'
  }
}`;
  const messages: Record<string, string> = {
    IDLE: 'Setup has not been reviewed.',
    UNAVAILABLE: 'Packaged Windows setup files are unavailable.',
    BUSY: 'Another profile review is in progress.',
    CANCELLED: 'Review cancelled. The hook was not changed.',
    INSTALLED: 'Separate Gemini profile configured. Provider behavior is not verified.',
    REMOVED: 'The reviewed hook was removed from the separate profile.',
    INVALID_POLICY: 'Select a valid Gemini exact-deny policy of at most 4096 bytes.',
    POLICY_CHANGED: 'The selected policy changed during review. Review it again.',
    UNSUPPORTED_PATH: 'A selected path cannot be safely represented in the hook command.',
    PROFILE_CHANGED:
      'The profile is unsupported or the AEGIS hook is ambiguous. Review it manually.',
    DRAFT_REFUSED: 'The separate settings draft could not be created safely.',
    RETENTION_LIMIT:
      'The private backup limit was reached. Review retained files before another setup.',
    TARGET_CHANGED: 'The profile changed during review. Review it again.',
    TARGET_READ_FAILED: 'The profile could not be read safely.',
    PREVIEW_TOO_LARGE: 'The exact change is too large for native review.',
    EXPIRED: 'The review expired. Review the current change again.',
    BACKUP_FAILED: 'The private backup could not be verified. No change was written.',
    RETAINED_UNKNOWN: 'The write or native helper shutdown is uncertain. Review retained files.',
    OPERATION_FAILED: 'Profile review could not complete. Retained files are preserved.',
  };
  let profileState = $state({ canInstall: false, canRemove: false, canOpen: false });
  let pending = $state<Operation | null>(null);
  let feedback = $state('');
  let failure = $state(false);
  const available = $derived(!preview && typeof host?.reviewGeminiHookProfile === 'function');
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
      const result = record(confirmed(await invoke(host, 'reviewGeminiHookProfile', action)));
      if (!alive) return;
      const code = typeof result.code === 'string' ? result.code : 'OPERATION_FAILED';
      profileState = {
        canInstall: result.canInstall === true,
        canRemove: result.canRemove === true,
        canOpen: result.canOpen === true,
      };
      feedback = messages[code] || messages.OPERATION_FAILED;
      failure = !['IDLE', 'BUSY', 'CANCELLED', 'INSTALLED', 'REMOVED'].includes(code);
    } catch {
      if (alive) {
        feedback = messages.OPERATION_FAILED;
        failure = true;
      }
    } finally {
      if (alive) pending = null;
    }
  }
</script>

<section class="panel gemini-profile" aria-labelledby={id}>
  <div class="panel-head">
    <h2 {id}><Icon name="shield" />{$t('Separate Gemini hook profile')}</h2>
  </div>
  <div class="panel-body">
    <p>
      {$t(
        'Select an existing Gemini exact-deny policy and review the entire settings change in a native dialog. A private backup is retained.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Only the AEGIS-owned home is changed. Other strict-JSON settings and hooks are preserved; commented or ambiguous settings are refused for manual review.',
      )}
    </p>
    <p class="muted">
      {$t(
        'If the AEGIS installation was moved or renamed, review the old hook manually before removing it.',
      )}
    </p>
    <p class="muted">
      {$t(
        'The policy matches the complete tool input and working directory exactly. Unmatched requests receive no AEGIS decision. Other tools and launches are outside this hook.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Project and system settings, trust, hook disabling, startup failure or provider behavior can prevent the hook from working. Blocking has not been verified.',
      )}
    </p>
    <div class="profile-actions">
      <button
        class="button"
        disabled={!available || pending !== null || !profileState.canInstall}
        aria-busy={pending === 'install'}
        onclick={() => perform('install')}
      >
        {$t(
          pending === 'install'
            ? 'Preparing native review…'
            : 'Choose Gemini policy and review install',
        )}
      </button>
      <button
        class="button"
        disabled={!available || pending !== null || !profileState.canRemove}
        aria-busy={pending === 'remove'}
        onclick={() => perform('remove')}
      >
        {$t(pending === 'remove' ? 'Preparing native review…' : 'Review Gemini hook removal')}
      </button>
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
    {#if feedback}<p class={{ warning: failure }} role={failure ? 'alert' : 'status'}>
        {$t(feedback)}
      </p>{/if}
    <h3>{$t('Launch Gemini with the separate home')}</h3>
    <p>
      {$t(
        'Open the profile folder and copy the .gemini folder path from Explorer. Paste this command in Windows PowerShell, then enter that folder path when prompted. This home may require separate Gemini authentication.',
      )}
    </p>
    <pre><code>{launch}</code></pre>
  </div>
</section>

<style>
  .gemini-profile {
    margin-top: 12px;
  }
  .profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
