<script module lang="ts">
  import { writable } from 'svelte/store';
  // Payload-free session ledger: earlier views can leave commands or readbacks in flight.
  const fileReadLedger = writable({ controls: 0, revision: 0n, verifications: 0 });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import {
    record,
    records,
    invoke,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import type { AgentScope } from '../runtime/agent-scope';
  let {
    telemetry,
    scope,
    query = '',
    paused = false,
    host = null,
  }: {
    telemetry: Telemetry;
    scope?: AgentScope;
    query?: string;
    paused?: boolean;
    host?: Host | null;
  } = $props();
  let previouslyOrdinary = $state(false);
  let view = $derived(record(telemetry.stats.fileReadDiagnostics));
  let available = $derived(
    telemetry.stats.fileReadDiagnostics != null ||
      ((telemetry.stale || previouslyOrdinary) && typeof host?.controlFileReads === 'function'),
  );
  let controls = $derived(record(view.controls));
  let losses = $derived(record(view.losses));
  const loss = (key: string) => (losses[key] == null ? $t('Unknown') : String(losses[key]));
  let folder = $state('');
  let pending = $state(false);
  let verifiedRevision = $state(0n);
  let externalBarrier = $derived($fileReadLedger.revision !== verifiedRevision);
  let externalBaseline = $state<number | null>(
    untrack(() =>
      $fileReadLedger.revision === 0n
        ? null
        : typeof telemetry.statsAt === 'number'
          ? telemetry.statsAt
          : Date.now(),
    ),
  );
  let observedRevision = untrack(() => $fileReadLedger.revision);
  let pendingAction = $state<'start' | 'stop' | null>(null);
  let error = $state('');
  let stopState = $state<'idle' | 'accepted' | 'unknown' | 'confirmed' | 'inactive'>('idle');
  let stopBaseline = $state<number | null>(null);
  let hostChanged = $state(false);
  let hostBaseline = $state<number | null>(null);
  let startUnknown = $state(false);
  let startAccepted = $state(false);
  let startBaseline = $state<number | null>(null);
  let generation = 0;
  let alive = true;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  let verifying = false;
  let verificationGeneration = 0;
  let lastVerificationAt: number | null = null;
  let previousHost = untrack(() => host);
  let statusUnknown = $derived(
    hostChanged ||
      externalBarrier ||
      startUnknown ||
      $fileReadLedger.controls > 0 ||
      stopState === 'accepted' ||
      stopState === 'unknown' ||
      telemetry.stale ||
      typeof controls.canStop !== 'boolean',
  );
  let canStart = $derived(
    !statusUnknown &&
      typeof telemetry.statsAt === 'number' &&
      Number.isFinite(telemetry.statsAt) &&
      $fileReadLedger.controls === 0 &&
      controls.canStart === true &&
      controls.canStop === false &&
      stopState !== 'accepted' &&
      stopState !== 'unknown',
  );
  let showStop = $derived(
    statusUnknown ||
      $fileReadLedger.controls > 0 ||
      controls.canStop === true ||
      stopState === 'accepted' ||
      stopState === 'unknown',
  );

  $effect(() => {
    if (view.mode === 'ordinary') previouslyOrdinary = true;
  });
  $effect(() => {
    if ($fileReadLedger.revision !== observedRevision) {
      observedRevision = $fileReadLedger.revision;
      externalBaseline = typeof telemetry.statsAt === 'number' ? telemetry.statsAt : Date.now();
      lastVerificationAt = null;
    }
  });
  $effect(() => {
    if (host !== previousHost) {
      previousHost = host;
      generation++;
      verificationGeneration++;
      verifying = false;
      clearTimeout(requestTimer);
      hostChanged = true;
      hostBaseline = typeof telemetry.statsAt === 'number' ? telemetry.statsAt : Date.now();
      const uncertainStop =
        (pending && pendingAction === 'stop') ||
        stopState === 'accepted' ||
        stopState === 'unknown';
      const uncertainStart = (pending && pendingAction === 'start') || startUnknown;
      pending = false;
      stopState = uncertainStop ? 'unknown' : 'idle';
      stopBaseline = uncertainStop ? hostBaseline : null;
      startUnknown = uncertainStart;
      startAccepted = false;
      startBaseline = uncertainStart ? hostBaseline : null;
      lastVerificationAt = null;
      error = '';
    }
  });
  async function verifySupervisor(candidateAt: number, selectedHost: Host, ticket: number) {
    if ($fileReadLedger.verifications >= 2) return;
    const revision = $fileReadLedger.revision;
    const verification = ++verificationGeneration;
    fileReadLedger.update((ledger) => ({ ...ledger, verifications: ledger.verifications + 1 }));
    verifying = true;
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      if (verification === verificationGeneration) verifying = false;
    }, 3500);
    try {
      const fresh = record(await invoke(selectedHost, 'getStats'));
      if (
        expired ||
        verification !== verificationGeneration ||
        !alive ||
        host !== selectedHost ||
        generation !== ticket ||
        $fileReadLedger.revision !== revision ||
        $fileReadLedger.controls !== 0 ||
        telemetry.stale ||
        telemetry.statsAt !== candidateAt
      )
        return;
      const report = record(fresh.fileReadDiagnostics);
      const freshControls = record(report.controls);
      if (
        report.mode !== 'ordinary' ||
        report.phase !== view.phase ||
        typeof freshControls.canStop !== 'boolean' ||
        freshControls.canStop !== controls.canStop ||
        freshControls.canStart !== controls.canStart
      )
        return;
      if (hostChanged) {
        hostChanged = false;
        hostBaseline = null;
      }
      if (externalBarrier) {
        verifiedRevision = revision;
        externalBaseline = null;
      }
      if (
        (stopState === 'accepted' || stopState === 'unknown') &&
        report.phase === 'stopped' &&
        freshControls.canStop === false
      )
        stopState = 'confirmed';
      else if (
        (stopState === 'accepted' || stopState === 'unknown') &&
        report.phase === 'disabled' &&
        freshControls.canStop === false
      )
        stopState = 'inactive';
      if (startUnknown) {
        startUnknown = false;
        startAccepted = false;
        startBaseline = null;
        error = '';
      }
    } catch {
      // An unavailable readback leaves the operation unconfirmed.
    } finally {
      clearTimeout(deadline);
      fileReadLedger.update((ledger) => ({ ...ledger, verifications: ledger.verifications - 1 }));
      if (verification === verificationGeneration) verifying = false;
    }
  }
  $effect(() => {
    const baseline =
      stopState === 'accepted' || stopState === 'unknown'
        ? stopBaseline
        : startUnknown
          ? startBaseline
          : hostChanged
            ? hostBaseline
            : externalBaseline;
    if (
      !pending &&
      $fileReadLedger.controls === 0 &&
      !telemetry.stale &&
      host &&
      typeof host.getStats === 'function' &&
      (stopState === 'accepted' ||
        stopState === 'unknown' ||
        startUnknown ||
        hostChanged ||
        externalBarrier) &&
      baseline !== null &&
      typeof telemetry.statsAt === 'number' &&
      telemetry.statsAt > baseline &&
      telemetry.statsAt !== lastVerificationAt &&
      !verifying
    ) {
      lastVerificationAt = telemetry.statsAt;
      void verifySupervisor(telemetry.statsAt, host, generation);
    }
  });
  onDestroy(() => {
    alive = false;
    generation++;
    verificationGeneration++;
    clearTimeout(requestTimer);
  });
  async function control(action: 'start' | 'stop'): Promise<void> {
    if (pending || (action === 'stop' && $fileReadLedger.controls >= 2)) return;
    if (action === 'start' && (!canStart || !folder)) return;
    const selectedHost = host;
    const ticket = ++generation;
    verificationGeneration++;
    verifying = false;
    let expired = false;
    fileReadLedger.update((ledger) => ({
      ...ledger,
      controls: ledger.controls + 1,
      revision: ledger.revision + 1n,
    }));
    pending = true;
    pendingAction = action;
    error = '';
    if (action === 'stop') {
      stopBaseline = typeof telemetry.statsAt === 'number' ? telemetry.statsAt : Date.now();
      stopState = 'unknown';
    } else {
      stopState = 'idle';
      stopBaseline = null;
      startBaseline = typeof telemetry.statsAt === 'number' ? telemetry.statsAt : Date.now();
    }
    lastVerificationAt = null;
    requestTimer = setTimeout(() => {
      expired = true;
      if (!alive || ticket !== generation || selectedHost !== host) return;
      pending = false;
      if (action === 'stop') stopState = 'unknown';
      else {
        startUnknown = true;
        startAccepted = false;
        error = 'Start outcome is unknown. Wait for a fresh supervisor report.';
      }
    }, 3500);
    try {
      const result = record(
        await invoke(
          selectedHost,
          'controlFileReads',
          action === 'start' ? { action, root: folder } : { action },
        ),
      );
      if (!alive || expired || ticket !== generation || selectedHost !== host) return;
      if (result.success === true) {
        if (action === 'stop') stopState = 'accepted';
        else {
          startUnknown = true;
          startAccepted = true;
        }
      } else if (action === 'stop') stopState = 'unknown';
      else if (result.success === false) {
        startBaseline = null;
        error = 'File read monitoring could not start.';
      } else {
        startUnknown = true;
        startAccepted = false;
        error = 'Start outcome is unknown. Wait for a fresh supervisor report.';
      }
    } catch {
      if (!alive || expired || ticket !== generation || selectedHost !== host) return;
      if (action === 'stop') stopState = 'unknown';
      else {
        startUnknown = true;
        startAccepted = false;
        error = 'Start outcome is unknown. Wait for a fresh supervisor report.';
      }
    } finally {
      fileReadLedger.update((ledger) => ({
        ...ledger,
        controls: ledger.controls - 1,
        revision: ledger.revision + 1n,
      }));
      if (alive && $fileReadLedger.controls === 0) {
        const settledAt = typeof telemetry.statsAt === 'number' ? telemetry.statsAt : Date.now();
        if (stopState === 'accepted' || stopState === 'unknown') stopBaseline = settledAt;
        if (startUnknown) startBaseline = settledAt;
        lastVerificationAt = null;
      }
      if (alive && ticket === generation && !expired) {
        clearTimeout(requestTimer);
        pending = false;
      }
    }
  }
  let rows = $derived(
    records(view.reads).filter(
      (row) =>
        (!scope?.agent || row.agent === scope.agent) &&
        (!scope?.instanceId || row.instanceId === scope.instanceId) &&
        [row.path, row.agent, row.pid].join(' ').toLowerCase().includes(query.toLowerCase()),
    ),
  );
  const label = (row: RecordData, key: string) =>
    typeof row[key] === 'string' ? String(row[key]) : '';
</script>

{#if available}
  <section class="read-observations" aria-label={$t('File read observations')}>
    <h3>{$t('File read observations')}</h3>
    <p class="notice">
      {$t(
        'Experimental capture · candidate paths. Potential risks are based on path rules; file contents and malicious intent are not inspected.',
      )}
      {$t('These observations do not change risk scores or audit history.')}
    </p>
    {#if (view.mode === 'ordinary' || view.mode == null) && host}
      <form
        class="read-controls"
        onsubmit={(event) => {
          event.preventDefault();
          void control('start');
        }}
      >
        <label>
          <span>{$t('Folder to monitor')}</span>
          <input
            bind:value={folder}
            maxlength="1024"
            autocomplete="off"
            spellcheck="false"
            placeholder="C:\Users\you\project"
            disabled={pending || !canStart}
            aria-describedby="file-read-scope-help"
          />
        </label>
        {#if showStop}
          <button
            class="button"
            type="button"
            disabled={pending || $fileReadLedger.controls >= 2}
            aria-busy={pending}
            onclick={() => void control('stop')}>{$t('Stop file read monitoring')}</button
          >
        {/if}
        <button class="button" type="submit" disabled={pending || !folder || !canStart}>
          {$t('Start file read monitoring')}</button
        >
      </form>
      <p id="file-read-scope-help">
        {$t(
          'Choose a local folder. Start asks Windows for permission; monitoring continues until stopped, paused or suspended.',
        )}
      </p>
      {#if telemetry.stats.monitoringPaused}<p>
          {$t('Resume monitoring before starting file reads')}
        </p>{/if}
      {#if view.root}<p>{$t('Selected folder')}: {String(view.root)}</p>{/if}
      <p aria-label={$t('File read control status')} aria-live="polite" aria-atomic="true">
        {$t(
          pending && pendingAction === 'stop'
            ? 'Requesting stop…'
            : $fileReadLedger.controls >= 2
              ? 'Control replies are still pending. Their outcome is unknown.'
              : stopState === 'accepted'
                ? 'Stop requested. Waiting for a fresh supervisor report.'
                : stopState === 'unknown'
                  ? 'Stop outcome is unknown. You can retry.'
                  : stopState === 'confirmed'
                    ? 'File read monitoring reported stopped.'
                    : stopState === 'inactive'
                      ? 'File read monitoring is off.'
                      : startAccepted
                        ? 'Start requested. Waiting for a fresh supervisor report.'
                        : '',
        )}
      </p>
      {#if error}<p role="alert">{$t(error)}</p>{/if}
    {/if}
    <p role="status">
      {statusUnknown
        ? $t('File read monitoring status is unknown. The last report is retained.')
        : view.phase === 'running' && !telemetry.stats.monitoringPaused
          ? $t('Capture running')
          : view.phase === 'starting'
            ? $t('Waiting for Windows permission')
            : view.phase === 'disabled'
              ? $t('File read monitoring is off')
              : view.phase === 'failed'
                ? $t('File read monitoring failed. Review sensor health in Statistics.')
                : $t('Capture is not live · retained observations only')}
      · {$t('Kernel events lost')}: {loss('kernelEvents')}
      · {$t('Realtime buffers lost')}: {loss('realtimeBuffers')}
      · {$t('Log buffers lost')}: {loss('logBuffers')}
      · {$t('Collector records dropped')}: {loss('collectorDropped')}
      · {$t('Mapping resets')}: {loss('mappingResets')}
      · {$t('Omitted observations')}: {String(view.omitted ?? 0)}
    </p>
    {#if paused}<p>{$t('View paused · backend monitoring continues.')}</p>{:else}
      <div class="read-table">
        <table>
          <thead
            ><tr
              ><th>{$t('Agent')}</th><th>{$t('Action')}</th><th>{$t('File')}</th><th
                >{$t('Risk')}</th
              ><th>{$t('Evidence')}</th></tr
            ></thead
          >
          <tbody>
            {#each rows as row (String(row.id))}
              <tr>
                <td
                  >{label(row, 'agent') || $t('Actor unverified')}{#if row.pid}<small
                      >PID {String(row.pid)}</small
                    >{/if}</td
                >
                <td>{$t('Read observed')}<small>{String(row.reads)} {$t('observations')}</small></td
                >
                <td class="path">{label(row, 'path')}</td>
                <td class:sensitive={!!row.sensitiveReason}>
                  {row.sensitiveReason ? $t('Potential sensitive read') : $t('Risk not classified')}
                  {#if row.sensitiveReason}<small>{label(row, 'sensitiveReason')}</small>{/if}
                </td>
                <td
                  >{$t('Candidate path')}<small
                    >{row.agent
                      ? $t('Issuing process verified')
                      : $t('Issuing agent unverified')}</small
                  ></td
                >
              </tr>
            {:else}<tr
                ><td colspan="5"
                  >{$t(
                    'No scoped read observations available. Short reads may have unresolved paths or issuing processes.',
                  )}</td
                ></tr
              >{/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .read-observations {
    margin-top: var(--space-4);
    padding: var(--panel-inset);
    border: 1px solid var(--strong-border);
    background: var(--panel);
    border-radius: var(--surface-radius);
    min-width: 0;
  }
  h3 {
    margin: 0 0 var(--space-2);
  }
  p {
    color: var(--muted);
    line-height: 1.5;
  }
  .read-table {
    overflow: auto;
    max-height: 320px;
  }
  .read-controls {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .read-controls label {
    display: grid;
    flex: 1 1 240px;
    gap: var(--space-1);
    min-width: 0;
    color: var(--muted);
  }
  input {
    min-width: 0;
    height: 28px;
    padding: 0 var(--space-2);
    background: var(--panel);
    border: 1px solid var(--strong-border);
    color: var(--text);
    font: inherit;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-caption);
    text-align: left;
  }
  th,
  td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--strong-border);
    vertical-align: top;
  }
  .path {
    overflow-wrap: anywhere;
    min-width: 120px;
  }
  small {
    display: block;
    color: var(--muted);
    margin-top: var(--space-1);
  }
  .sensitive {
    color: var(--amber);
  }
</style>
