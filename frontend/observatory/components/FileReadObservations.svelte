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
  let pending = $state(false);
  let error = $state('');
  async function control(action: 'start' | 'stop'): Promise<void> {
    if (pending) return;
    pending = true;
    error = '';
    try {
      confirmed(
        await invoke(
          host,
          'controlFileReads',
          action === 'start' ? { action, root: folder } : { action },
        ),
      );
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
    </p>
    {#if view.mode === 'ordinary' && host}
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
            disabled={pending || !folder || telemetry.stale || controls.canStart !== true}
          >
            {$t('Start file read monitoring')}</button
          >
        {/if}
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
