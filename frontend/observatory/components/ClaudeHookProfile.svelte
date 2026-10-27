<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { confirmed, invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import Icon from './Icon.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  type Operation = 'status' | 'install' | 'remove' | 'open-profile' | 'guard-start' | 'guard-stop';
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
    OBSERVED_REMOVED:
      'The recognized AEGIS hook was removed after a fresh review. Unrelated settings were preserved.',
    PROFILE_REVIEW_AVAILABLE:
      'An existing separate profile is available for a fresh targeted removal review.',
    NO_MATCHING_HOOK: 'No matching current AEGIS Bash hook was found in this separate profile.',
    AMBIGUOUS_HOOK: 'More than one matching AEGIS hook was found. Targeted removal is unavailable.',
    PLAN_REFUSED: 'This profile does not match the supported AEGIS hook structure.',
    CONFIGURED_UNOWNED:
      'This session did not install the existing hook. You can review its targeted removal.',
    OWNED_INSTALL_EXISTS: 'This profile is already configured.',
    NO_OWNED_INSTALL: 'This session has no owned installation to remove.',
    EXPIRED: 'The review expired before confirmation. Review the current change again.',
    SESSION_ENDED:
      'Previous setup approvals expired. Start a fresh review of the current separate profile.',
    SESSION_RELEASE_UNCONFIRMED:
      'The previous native session has not confirmed shutdown. Another write is unavailable.',
    INVALID_POLICY: 'Select a valid AEGIS Bash policy using schema 1 or the supported schema 2.',
    UNSUPPORTED_PATH: 'A selected path cannot be represented safely in this hook command.',
    RETENTION_LIMIT:
      'The retained backup limit was reached. Review the existing profile files before another setup.',
    PREVIEW_TOO_LARGE: 'The exact change is too large for this native review.',
    WRITE_UNCERTAIN: 'The write outcome is uncertain. Retained backups require recovery review.',
    READBACK_FAILED:
      'The written profile could not be verified. Retained backups require recovery review.',
    RETAINED_UNKNOWN: 'An uncertain result is retained. Another write is unavailable.',
    GUARD_READY: 'Broker command copied. Run it in PowerShell and compare the confirmation code.',
    GUARD_ALREADY_ACTIVE: 'A reporting session is already active.',
    GUARD_PROFILE_REQUIRED: 'Prepare the separate Claude profile before starting a session.',
    GUARD_CANCELLED: 'Terminal session preparation cancelled.',
    GUARD_STOPPED: 'Reporting stopped. A previously launched Claude process may still be running.',
    GUARD_UNAVAILABLE: 'The terminal session could not be prepared.',
  };
  const failedCodes = new Set([
    'UNAVAILABLE',
    'SESSION_ENDED',
    'SESSION_RELEASE_UNCONFIRMED',
    'INVALID_POLICY',
    'UNSUPPORTED_PATH',
    'RETENTION_LIMIT',
    'PREVIEW_TOO_LARGE',
    'WRITE_UNCERTAIN',
    'READBACK_FAILED',
    'RETAINED_UNKNOWN',
    'AMBIGUOUS_HOOK',
    'PLAN_REFUSED',
    'GUARD_PROFILE_REQUIRED',
    'GUARD_UNAVAILABLE',
  ]);
  const reasons: Record<string, string> = {
    generic: 'Selected policy decision',
    'adapter-failure': 'Hook adapter failure',
    'project-review-ordinary': 'Supported command requires provider confirmation',
    'project-deny-sensitive': 'Declared sensitive filename',
    'project-deny-destructive': 'Declared destructive command',
    'project-deny-unsupported': 'Unsupported command or input',
  };
  const sessionStatuses: Record<string, string> = {
    inactive: 'No reporting session',
    waiting: 'Waiting for the terminal broker',
    'awaiting-confirmation': 'Waiting for native code confirmation',
    active: 'Session listening; delivery remains unknown',
    refused: 'Session refused',
    expired: 'Session expired',
    ended: 'Reporting session ended',
  };
  let profileState = $state({
    code: 'IDLE',
    canInstall: false,
    canRemove: false,
    canReviewExisting: false,
    canOpen: false,
  });
  let pending = $state<Operation | null>(null);
  let failed = $state(false);
  let feedback = $state('');
  let guardSession = $state({
    status: 'inactive',
    available: false,
    lossDetected: false,
    entries: [] as { decision: string; reason: string }[],
  });
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
        canReviewExisting: value.canReviewExisting === true,
        canOpen: value.canOpen === true,
      };
      const session = record(value.guardSession);
      const entries = Array.isArray(session.entries) ? session.entries.slice(-32) : [];
      guardSession = {
        status:
          typeof session.status === 'string' && Object.hasOwn(sessionStatuses, session.status)
            ? session.status
            : 'inactive',
        available: session.available === true,
        lossDetected: session.lossDetected === true,
        entries: entries.flatMap((item: unknown) => {
          const entry = record(item);
          return typeof entry.decision === 'string' &&
            ['allow', 'ask', 'deny'].includes(entry.decision) &&
            typeof entry.reason === 'string' &&
            Object.hasOwn(reasons, entry.reason)
            ? [{ decision: entry.decision, reason: entry.reason }]
            : [];
        }),
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
        'After restart or session expiry, removal requires a fresh exact review of the recognized current AEGIS hook. Saved files do not restore old approvals.',
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
        disabled={!available ||
          pending !== null ||
          (!profileState.canRemove && !profileState.canReviewExisting)}
        aria-busy={pending === 'remove'}
        onclick={() => perform('remove')}
        >{$t(
          pending === 'remove' ? 'Preparing native review…' : 'Review AEGIS hook removal',
        )}</button
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
    <p>
      {$t(
        'Start a terminal session to receive reported policy decisions. Choose a Claude executable and the exact working folder in the selected policy, then run the copied broker command and match the confirmation code.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Reports have an unverified sender. Delivery coverage and action effects are unknown; provider confirmation is not AEGIS approval. Stopping reporting does not stop Claude.',
      )}
    </p>
    <div class="profile-actions">
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          !profileState.canOpen ||
          ['waiting', 'awaiting-confirmation', 'active'].includes(guardSession.status)}
        onclick={() => perform('guard-start')}>{$t('Prepare terminal session')}</button
      >
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          !['waiting', 'awaiting-confirmation', 'active'].includes(guardSession.status)}
        onclick={() => perform('guard-stop')}>{$t('Stop reporting')}</button
      >
    </div>
    <p class="muted">
      {$t(sessionStatuses[guardSession.status])}. {$t(
        'Refresh setup status to see recent reports.',
      )}
    </p>
    {#if guardSession.lossDetected}<p role="alert">
        {$t('Some reporting may have been lost or discarded; delivery remains unknown.')}
      </p>{/if}
    {#if guardSession.entries.length}
      <ul>
        {#each guardSession.entries as entry, index (index)}
          <li>
            {entry.decision.toUpperCase()}: {$t(reasons[entry.reason])} · {$t('Effect unknown')}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">
        {$t('No reports received; this does not establish that no actions occurred.')}
      </p>
    {/if}
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
