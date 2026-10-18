<script lang="ts">
  import { t } from '../runtime/i18n';
  import { record, records, type RecordData, type Telemetry } from '../runtime/host';
  import type { AgentScope } from '../runtime/agent-scope';
  let {
    telemetry,
    scope,
    query = '',
    paused = false,
  }: {
    telemetry: Telemetry;
    scope?: AgentScope;
    query?: string;
    paused?: boolean;
  } = $props();
  let view = $derived(record(telemetry.stats.fileReadDiagnostics));
  let available = $derived(telemetry.stats.fileReadDiagnostics != null);
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
    <p role="status">
      {view.phase === 'running' && !telemetry.stale && !telemetry.stats.monitoringPaused
        ? $t('Capture running')
        : $t('Capture is not live · retained observations only')}
      · {$t('Observed loss')}: {view.lossCount == null ? $t('Unknown') : String(view.lossCount)}
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
    color: var(--warning);
  }
</style>
