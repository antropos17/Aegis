<script lang="ts">
  import { t } from '../runtime/i18n';
  import {
    record,
    records,
    invoke,
    confirmed,
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
  let view = $derived(record(telemetry.stats.fileReadDiagnostics));
  let available = $derived(telemetry.stats.fileReadDiagnostics != null);
  let controls = $derived(record(view.controls));
  let losses = $derived(record(view.losses));
  const loss = (key: string) => (losses[key] == null ? $t('Unknown') : String(losses[key]));
  let folder = $state('');
  let objectConsent = $state(false);
  let pending = $state(false);
  let error = $state('');
  let objectMode = $derived(view.captureMode === 'object-bound');
  let objectAdmission = $derived(record(view.admission));
  async function control(action: 'start' | 'start-object' | 'stop'): Promise<void> {
    if (pending) return;
    if (action === 'start-object' && (!objectConsent || controls.canStartObject !== true)) return;
    if (action !== 'stop' && (!folder || telemetry.stale)) return;
    pending = true;
    error = '';
    try {
      confirmed(
        await invoke(
          host,
          'controlFileReads',
          action !== 'stop' ? { action, root: folder } : { action },
        ),
      );
      if (action === 'stop') objectConsent = false;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'File read monitoring could not start';
    } finally {
      pending = false;
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
      {#if objectMode}
        {$t('Verified object reads are shown separately in Events and may affect alerts and risk.')}
        {#if objectAdmission.qualified !== true}
          {$t('Object verification is unavailable; this capture is display only.')}
        {/if}
      {/if}
    </p>
    {#if view.mode === 'ordinary' && host}
      <form
        class="read-controls"
        onsubmit={(event) => {
          event.preventDefault();
          void control(objectConsent ? 'start-object' : 'start');
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
            disabled={pending || controls.canStop === true}
            aria-describedby="file-read-scope-help"
          />
        </label>
        {#if controls.canStop === true}
          <button
            class="button"
            type="button"
            disabled={pending || telemetry.stale}
            onclick={() => void control('stop')}>{$t('Stop file read monitoring')}</button
          >
        {:else}
          <button
            class="button"
            type="submit"
            disabled={pending ||
              !folder ||
              telemetry.stale ||
              (objectConsent ? controls.canStartObject !== true : controls.canStart !== true)}
          >
            {$t(
              objectConsent ? 'Start verified object monitoring' : 'Start file read monitoring',
            )}</button
          >
        {/if}
        <label class="object-consent">
          <input
            type="checkbox"
            bind:checked={objectConsent}
            disabled={pending || controls.canStop === true || controls.canStartObject !== true}
            aria-describedby="file-read-object-help"
          />
          <span>{$t('Include verified object reads in alerts and risk')}</span>
        </label>
      </form>
      <p id="file-read-scope-help">
        {$t(
          'Choose a local folder. Start asks Windows for permission; monitoring continues until stopped, paused or suspended.',
        )}
      </p>
      <p id="file-read-object-help">
        {$t(
          'Opt in to monitor objects identified in this folder for bindings valid up to 10 seconds. A rename or move can invalidate a binding. Names are binding labels; the actual access path is unknown. New, short-lived or unproven objects remain unverified. Retained file handles may temporarily delay renaming or deleting. Proof expires after 10 seconds; cleanup runs on stop or the next two-second sweep while the sensor is responsive.',
        )}
      </p>
      {#if telemetry.stats.monitoringPaused}<p>
          {$t('Resume monitoring before starting file reads')}
        </p>{/if}
      {#if view.root}<p>{$t('Selected folder')}: {String(view.root)}</p>{/if}
      {#if error}<p role="alert">{$t(error)}</p>{/if}
    {/if}
    <p role="status">
      {view.phase === 'running' && !telemetry.stale && !telemetry.stats.monitoringPaused
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
  .read-controls .object-consent {
    display: flex;
    align-items: center;
    flex-basis: 100%;
    gap: var(--space-2);
  }
  .object-consent input {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
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
