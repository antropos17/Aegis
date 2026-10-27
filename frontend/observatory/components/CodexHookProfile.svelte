<script module lang="ts">
  type Custody = {
    retained: boolean;
    unknown: boolean;
    outstanding: number;
    revision: number;
    refreshRequired: boolean;
    listeners: Set<() => void>;
  };
  const custodyByHost = new WeakMap<object, Custody>();
  const newCustody = (): Custody => ({
    retained: false,
    unknown: false,
    outstanding: 0,
    revision: 0,
    refreshRequired: false,
    listeners: new Set(),
  });
  const notifyCustody = (value: Custody) => {
    for (const listener of value.listeners) listener();
  };
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
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
  const none = () => ({ canInstall: false, canRemove: false, canOpen: false, canLaunch: false });
  let capabilities = $state(none());
  let capabilitiesRevision = $state(-1);
  let pending = $state<Operation | null>(null);
  let feedback = $state('');
  let failure = $state(false);
  let custody: Custody | null = null;
  let custodyView = $state({
    retained: false,
    unknown: false,
    outstanding: 0,
    revision: 0,
    refreshRequired: false,
  });
  const syncCustody = () => {
    if (custody)
      custodyView = {
        retained: custody.retained,
        unknown: custody.unknown,
        outstanding: custody.outstanding,
        revision: custody.revision,
        refreshRequired: custody.refreshRequired,
      };
  };
  const available = $derived(!preview && typeof host?.reviewCodexHookProfile === 'function');
  let alive = true;
  let generation = 0;
  $effect(() => {
    const nextHost = host;
    const nextPreview = preview;
    untrack(() => {
      generation++;
      if ((pending === 'install' || pending === 'remove') && custody) {
        custody.unknown = true;
        custody.refreshRequired = true;
        notifyCustody(custody);
      }
      pending = null;
      capabilities = none();
      feedback = '';
      failure = false;
      if (nextHost && typeof nextHost === 'object') {
        const known = custodyByHost.get(nextHost);
        if (!custody) custody = known || newCustody();
        else if (known && known !== custody) {
          known.retained = true;
          known.unknown = true;
          notifyCustody(known);
          custody.retained = true;
          custody.unknown = true;
        }
        custodyByHost.set(nextHost, custody);
        custody.listeners.add(syncCustody);
        syncCustody();
      }
      if (!nextPreview && typeof nextHost?.reviewCodexHookProfile === 'function')
        void perform('status');
    });
  });
  onDestroy(() => {
    if ((pending === 'install' || pending === 'remove') && custody) {
      custody.unknown = true;
      custody.refreshRequired = true;
      notifyCustody(custody);
    }
    alive = false;
    generation++;
    custody?.listeners.delete(syncCustody);
  });
  async function perform(action: Operation) {
    if (!available || pending) return;
    const requestGeneration = generation;
    const requestHost = host;
    const requestCustody = custody;
    if (!requestCustody) return;
    const requestRevision = requestCustody.revision;
    const current = () =>
      alive && generation === requestGeneration && host === requestHost && !preview;
    const mutation = action === 'install' || action === 'remove';
    if (action !== 'status' && capabilitiesRevision !== requestCustody.revision) return;
    if (
      (mutation || action === 'prepare-launch') &&
      (requestCustody.outstanding || requestCustody.retained || requestCustody.refreshRequired)
    )
      return;
    if (mutation) {
      requestCustody.outstanding++;
      notifyCustody(requestCustody);
    }
    pending = action;
    capabilities = none();
    try {
      const raw = record(await invoke(requestHost, 'reviewCodexHookProfile', action));
      const code = raw.code;
      if (
        typeof code === 'string' &&
        ['WRITE_UNCERTAIN', 'READBACK_FAILED', 'RETAINED_UNKNOWN'].includes(code)
      ) {
        requestCustody.retained = true;
        notifyCustody(requestCustody);
      }
      const result = record(confirmed(raw));
      if (!current()) return;
      if (
        typeof code !== 'string' ||
        !Object.hasOwn(messages, code) ||
        typeof result.available !== 'boolean' ||
        typeof result.canInstall !== 'boolean' ||
        typeof result.canRemove !== 'boolean' ||
        typeof result.canOpen !== 'boolean' ||
        ((result.canInstall || result.canRemove) && !result.available) ||
        (result.canRemove && !result.canOpen) ||
        (code === 'UNAVAILABLE' && result.available) ||
        (code === 'INSTALLED' && !['install', 'status', 'open-profile'].includes(action)) ||
        (code === 'REMOVED' && !['remove', 'status', 'open-profile'].includes(action)) ||
        (code === 'IDLE' && !['status', 'open-profile'].includes(action)) ||
        (code === 'LAUNCH_READY' && action !== 'prepare-launch')
      )
        throw Error('invalid-response');
      if (
        action === 'status' &&
        (requestCustody.outstanding || requestCustody.revision !== requestRevision)
      ) {
        feedback = messages.BUSY;
        failure = false;
        return;
      }
      const uncertain = ['WRITE_UNCERTAIN', 'READBACK_FAILED', 'RETAINED_UNKNOWN'].includes(code);
      const blocked = uncertain || ['BUSY', 'UNAVAILABLE', 'OPERATION_FAILED'].includes(code);
      if (mutation && (uncertain || code === 'OPERATION_FAILED')) requestCustody.unknown = true;
      if (action === 'status' && !blocked && !requestCustody.retained)
        requestCustody.refreshRequired = false;
      notifyCustody(requestCustody);
      capabilities = {
        canInstall: !blocked && result.canInstall,
        canRemove: !blocked && result.canRemove,
        canOpen: code !== 'BUSY' && result.canOpen,
        canLaunch: !blocked && result.available && result.canOpen,
      };
      capabilitiesRevision = requestRevision + (mutation ? 1 : 0);
      feedback =
        ['status', 'open-profile'].includes(action) && code === 'INSTALLED'
          ? 'Last verified setup result was installation; the current profile has not been rechecked.'
          : ['status', 'open-profile'].includes(action) && code === 'REMOVED'
            ? 'Last verified setup result was removal; the current profile has not been rechecked.'
            : messages[code];
      failure = !['IDLE', 'BUSY', 'CANCELLED', 'INSTALLED', 'REMOVED', 'LAUNCH_READY'].includes(
        code,
      );
    } catch {
      if (current()) {
        if (mutation) {
          requestCustody.unknown = true;
          requestCustody.refreshRequired = true;
          notifyCustody(requestCustody);
        }
        capabilities = none();
        feedback = messages.OPERATION_FAILED;
        failure = true;
      }
    } finally {
      if (mutation) {
        requestCustody.outstanding--;
        requestCustody.revision++;
        if (!current() || requestCustody.unknown) requestCustody.refreshRequired = true;
        notifyCustody(requestCustody);
      }
      if (current()) pending = null;
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
        disabled={!available ||
          pending !== null ||
          capabilitiesRevision !== custodyView.revision ||
          !capabilities.canInstall ||
          custodyView.outstanding > 0 ||
          custodyView.retained ||
          custodyView.refreshRequired}
        onclick={() => perform('install')}>{$t('Choose Codex policy and review install')}</button
      >
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          capabilitiesRevision !== custodyView.revision ||
          !capabilities.canRemove ||
          custodyView.outstanding > 0 ||
          custodyView.retained ||
          custodyView.refreshRequired}
        onclick={() => perform('remove')}>{$t('Review Codex hook removal')}</button
      >
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          capabilitiesRevision !== custodyView.revision ||
          !capabilities.canLaunch ||
          custodyView.outstanding > 0 ||
          custodyView.retained ||
          custodyView.refreshRequired}
        onclick={() => perform('prepare-launch')}>{$t('Review Codex terminal command')}</button
      >
      <button
        class="button"
        disabled={!available ||
          pending !== null ||
          capabilitiesRevision !== custodyView.revision ||
          !capabilities.canOpen}
        onclick={() => perform('open-profile')}>{$t('Open profile folder')}</button
      >
      <button
        class="button"
        disabled={!available || pending !== null}
        onclick={() => perform('status')}>{$t('Refresh setup status')}</button
      >
    </div>
    {#if custodyView.unknown}<p role="alert">
        {$t(
          'The outcome of a previous profile change is unknown. Refresh can restore current controls but cannot confirm that change.',
        )}
      </p>{/if}
    {#if custodyView.retained}<p role="alert">
        {$t(
          'An uncertain native result is retained. Profile changes and launch review remain unavailable.',
        )}
      </p>{/if}
    {#if custodyView.outstanding > 0 || custodyView.refreshRequired}<p role="status">
        {$t(
          'A previous profile operation is still running or has just finished. Refresh setup status again.',
        )}
      </p>{/if}
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
