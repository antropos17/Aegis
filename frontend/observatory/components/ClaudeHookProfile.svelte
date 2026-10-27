<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { confirmed, invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import { claudeHookLaunchCommand } from '../runtime/claude-hook-guide';
  import Icon from './Icon.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  type Operation =
    | 'status'
    | 'install'
    | 'install-project-policy'
    | 'remove'
    | 'open-profile'
    | 'guard-start'
    | 'guard-start-snapshot'
    | 'guard-stop';
  type Outcome = 'reported-completed' | 'reported-failed' | 'unknown';
  const id = $props.id();
  const messages: Record<string, string> = {
    IDLE: 'Setup has not been reviewed.',
    READY: 'Prepared setup files are available for native review.',
    UNAVAILABLE: 'Native setup files are unavailable or failed their integrity checks.',
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
    POLICY_CREATE_REFUSED:
      'The new project policy could not be created. The profile was not installed.',
    POLICY_CREATE_UNCERTAIN:
      'Policy creation could not be verified. Retained files require review before another setup.',
    POLICY_UNADOPTED:
      'A new policy was retained, but the profile was not installed. Review retained files before another setup.',
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
    GUARD_PROFILE_UNVERIFIED:
      'The current hook or policy could not be verified for the selected working folder. Review the profile and policy.',
    GUARD_RELEASE_UNCONFIRMED:
      'The previous native reader did not confirm shutdown. Another reporting session is unavailable.',
    GUARD_CANCELLED: 'Terminal session preparation cancelled.',
    GUARD_STOPPED: 'Reporting stopped. A previously launched Claude process may still be running.',
    GUARD_SNAPSHOT_BUSY:
      'A previous project inventory check is still finishing. Try again after it completes.',
    GUARD_SNAPSHOT_UNAVAILABLE:
      'The project snapshot check did not succeed and launch was refused. Review the project and snapshot before trying again.',
    GUARD_SNAPSHOT_REVIEW_REQUIRED:
      'The project needs a fresh Local security review and explicit snapshot acceptance.',
    GUARD_SNAPSHOT_INCOMPATIBLE:
      'The snapshot does not match this project, inventory scope or selected catalog.',
    GUARD_SNAPSHOT_INCOMPLETE:
      'The project inventory or snapshot is incomplete. Review the coverage gaps first.',
    GUARD_UNAVAILABLE: 'The terminal session could not be prepared.',
  };
  const failedCodes = new Set([
    'UNAVAILABLE',
    'SESSION_ENDED',
    'SESSION_RELEASE_UNCONFIRMED',
    'INVALID_POLICY',
    'POLICY_CREATE_REFUSED',
    'POLICY_CREATE_UNCERTAIN',
    'POLICY_UNADOPTED',
    'UNSUPPORTED_PATH',
    'RETENTION_LIMIT',
    'PREVIEW_TOO_LARGE',
    'WRITE_UNCERTAIN',
    'READBACK_FAILED',
    'RETAINED_UNKNOWN',
    'AMBIGUOUS_HOOK',
    'PLAN_REFUSED',
    'GUARD_PROFILE_REQUIRED',
    'GUARD_PROFILE_UNVERIFIED',
    'GUARD_RELEASE_UNCONFIRMED',
    'GUARD_UNAVAILABLE',
    'GUARD_SNAPSHOT_BUSY',
    'GUARD_SNAPSHOT_UNAVAILABLE',
    'GUARD_SNAPSHOT_REVIEW_REQUIRED',
    'GUARD_SNAPSHOT_INCOMPATIBLE',
    'GUARD_SNAPSHOT_INCOMPLETE',
  ]);
  const reasons: Record<string, string> = {
    generic: 'Selected policy decision',
    'adapter-failure': 'Hook adapter failure',
    'project-review-ordinary': 'Provider confirmation requested for supported command',
    'project-review-script':
      'Project script can run unchecked actions; provider confirmation requested',
    'project-review-edit':
      'Patch contents, written paths and executable are unverified; provider confirmation requested',
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
  const reasonDecisions: Record<string, string[]> = {
    generic: ['allow', 'ask', 'deny'],
    'adapter-failure': ['deny'],
    'project-review-ordinary': ['ask'],
    'project-review-script': ['ask'],
    'project-review-edit': ['ask'],
    'project-deny-sensitive': ['deny'],
    'project-deny-destructive': ['deny'],
    'project-deny-unsupported': ['deny'],
  };
  const outcomes: Record<Outcome, string> = {
    'reported-completed': 'Claimed provider result: tool completed',
    'reported-failed': 'Claimed provider result: tool failed',
    unknown: 'Provider result unknown',
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
  type GuardEntry = { decision: string; reason: string; outcome: Outcome };
  type GuardSnapshot = {
    status: string;
    available: boolean;
    lossDetected: boolean;
    afterHooks: boolean;
    afterHooksAtAdmission: boolean;
    entries: GuardEntry[];
  };
  let guardSession = $state<GuardSnapshot | null>(null);
  let guardStatusKnown = $state(false);
  let retainedReports = $state(false);
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
    guardStatusKnown = false;
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
      if (
        typeof session.status === 'string' &&
        Object.hasOwn(sessionStatuses, session.status) &&
        typeof session.available === 'boolean' &&
        session.available === (session.status === 'active') &&
        typeof session.lossDetected === 'boolean' &&
        typeof session.afterHooks === 'boolean' &&
        typeof session.afterHooksAtAdmission === 'boolean' &&
        Array.isArray(session.entries)
      ) {
        const entries = session.entries.slice(-32).flatMap<GuardEntry>((item: unknown) => {
          const entry = record(item);
          return typeof entry.decision === 'string' &&
            ['allow', 'ask', 'deny'].includes(entry.decision) &&
            typeof entry.reason === 'string' &&
            Object.hasOwn(reasonDecisions, entry.reason) &&
            reasonDecisions[entry.reason].includes(entry.decision)
            ? [
                {
                  decision: entry.decision,
                  reason: entry.reason,
                  outcome:
                    entry.outcome === 'reported-completed' || entry.outcome === 'reported-failed'
                      ? entry.outcome
                      : ('unknown' as const),
                },
              ]
            : [];
        });
        const previous = guardSession?.entries ?? [];
        retainedReports = entries.length === 0 && previous.length > 0;
        guardSession = {
          status: session.status,
          available: session.available,
          lossDetected: session.lossDetected,
          afterHooks: session.afterHooks,
          afterHooksAtAdmission: session.afterHooksAtAdmission,
          entries: retainedReports ? previous : entries,
        };
        guardStatusKnown = ![
          'GUARD_RELEASE_UNCONFIRMED',
          'SESSION_RELEASE_UNCONFIRMED',
          'RETAINED_UNKNOWN',
        ].includes(code);
      }
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
        'This creates a private draft and retained backups. Personal Claude settings are not edited.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Reporting expires after at most two and a half minutes. Profile checks are periodic and cannot prevent changes between a check and an action.',
      )}
    </p>
    <p class="muted">
      {$t(
        'Other Claude settings and managed controls may disable or override the selected hook; effective configuration is unknown.',
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
        aria-busy={pending === 'install-project-policy'}
        onclick={() => perform('install-project-policy')}
        >{$t(
          pending === 'install-project-policy'
            ? 'Preparing native review…'
            : 'Choose project and review built-in policy',
        )}</button
      >
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
    <div class="launch-guide">
      <h3>{$t('Launch with this separate profile')}</h3>
      <p>
        {$t(
          'After installing the profile, open its folder and copy the folder path from the Explorer address bar. In Windows PowerShell, run the command below, then paste the folder path without quotes when prompted. Press Enter on an empty prompt to cancel.',
        )}
      </p>
      <pre><code>{claudeHookLaunchCommand}</code></pre>
      <p class="muted">
        {$t(
          'This route requires Claude Code. If Claude invokes the hook, it evaluates Bash requests against the selected policy. Other tools and launches without the profile are outside its scope.',
        )}
      </p>
      <p class="muted">{$t('This direct route does not send decision reports to AEGIS.')}</p>
      <p class="muted">
        {$t(
          'A configured profile does not verify blocking. Claude behavior when a hook is missing, cannot start, times out, or returns malformed output has not been qualified. Schema-1 policies match the full Bash input and working directory exactly.',
        )}
      </p>
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
          !guardStatusKnown ||
          !guardSession ||
          ['waiting', 'awaiting-confirmation', 'active'].includes(guardSession.status)}
        onclick={() => perform('guard-start')}>{$t('Prepare terminal session')}</button
      >
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          !profileState.canOpen ||
          !guardStatusKnown ||
          !guardSession ||
          ['waiting', 'awaiting-confirmation', 'active'].includes(guardSession.status)}
        onclick={() => perform('guard-start-snapshot')}
        >{$t('Prepare with accepted project snapshot')}</button
      >
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          (!['waiting', 'awaiting-confirmation', 'active'].includes(guardSession?.status ?? '') &&
            profileState.code !== 'GUARD_RELEASE_UNCONFIRMED')}
        onclick={() => perform('guard-stop')}>{$t('Stop reporting')}</button
      >
    </div>
    <p class="muted">
      {$t(
        'The ordinary terminal session does not check a project snapshot. The snapshot-checked option compares recognized project inventory only; acceptance is local, not authenticated, and the project can change after the check. Use Local security to review and explicitly accept a complete snapshot first.',
      )}
    </p>
    {#if !guardStatusKnown}<p class="muted" role="status">
        {$t(
          pending !== null
            ? 'Checking reporting session status…'
            : 'Reporting session status is unavailable. Refresh setup status to try again.',
        )}
      </p>{/if}
    {#if guardSession}<p class="muted">
        {$t('Last successful check; current session status may have changed:')}
        {$t(sessionStatuses[guardSession.status])}. {$t(
          'Refresh setup status to see recent reports.',
        )}
      </p>{/if}
    {#if guardSession && guardSession.status !== 'inactive'}
      <p class="muted">
        {$t(
          guardSession.afterHooks
            ? 'At the last successful check, after-result hooks were verified in the selected profile; current status may have changed and delivery remains unknown.'
            : guardSession.afterHooksAtAdmission
              ? 'After-result hooks were verified at admission; current profile verification is unknown.'
              : 'After-result hooks were not verified at the last successful check; delivery remains unknown.',
        )}
      </p>
    {/if}
    {#if guardSession?.lossDetected}<p role="alert">
        {$t('Some reporting may have been lost or discarded; delivery remains unknown.')}
      </p>{/if}
    {#if guardSession?.entries.length}
      {#if retainedReports || !guardStatusKnown}<p class="muted">
          {$t('Retained reports are historical and may not describe the current session.')}
        </p>{/if}
      <ul>
        {#each guardSession.entries as entry, index (index)}
          <li>
            {entry.decision.toUpperCase()}: {$t(reasons[entry.reason])} · {$t(
              outcomes[entry.outcome],
            )} · {$t('Effect unknown')}
          </li>
        {/each}
      </ul>
    {:else if guardSession}
      <p class="muted">
        {$t(
          'At the last successful check, no reports were received; this does not establish that no actions occurred.',
        )}
      </p>
    {/if}
    {#if feedback}<p role={failed ? 'alert' : 'status'} class={['profile-feedback', { failed }]}>
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
  .launch-guide {
    display: grid;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
  }
  pre {
    margin: 0;
    padding: var(--space-3);
    overflow-x: auto;
    background: var(--raised);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
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
