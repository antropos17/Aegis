<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { RecordData, Telemetry } from '../runtime/host';
  import type { AgentScope } from '../runtime/agent-scope';
  import { scopeStatistics } from '../runtime/statistics-scope';
  import { completeStatisticsTotal, statisticsValue } from '../runtime/statistics-metrics';
  import { networkSnapshotStatus } from '../runtime/network-coverage';
  import Icon from './Icon.svelte';

  let {
    telemetry,
    scope,
    files,
    connections,
    workerCount,
    processObserved,
    section,
    prefix,
    select,
    paused = false,
    continuous = false,
  }: {
    telemetry: Telemetry;
    scope: AgentScope;
    files: RecordData[];
    connections: RecordData[];
    workerCount: number;
    processObserved: boolean;
    section: string;
    prefix: string;
    select: (_section: string) => void;
    paused?: boolean;
    continuous?: boolean;
  } = $props();

  let scoped = $derived(scopeStatistics(telemetry, scope));
  let cpu = $derived(completeStatisticsTotal(scoped, scoped.resources, 'cpu'));
  let memory = $derived(completeStatisticsTotal(scoped, scoped.resources, 'memMb'));
  let networkStatus = $derived(networkSnapshotStatus(scoped, connections.length));
  let processSection = $derived(
    scope.instanceId && processObserved ? 'process-controls' : 'processes',
  );
</script>

<section class="agent-context-summary" aria-label={$t('Agent context summary')}>
  <button
    class="context-card"
    aria-controls={prefix + '-panel-resources'}
    aria-expanded={continuous ? undefined : section === 'resources'}
    onclick={() => select('resources')}
  >
    <span class="context-title"><Icon name="chart" />{$t('Resources')}<Icon name="chevron" /></span>
    <span class="context-values">
      <span><small>{$t('CPU')}</small><strong>{statisticsValue(cpu, '%')}</strong></span>
      <span><small>{$t('RAM')}</small><strong>{statisticsValue(memory, 'MB')}</strong></span>
    </span>
    <span class="context-note"
      >{paused
        ? $t('View paused')
        : scoped.stale || !scoped.ready
          ? $t('No current measurement')
          : cpu === null || memory === null
            ? $t('Resource measurements incomplete')
            : $t('View resource history')}</span
    >
  </button>
  <button
    class="context-card"
    aria-controls={prefix + '-panel-activity'}
    aria-expanded={continuous ? undefined : section === 'activity'}
    onclick={() => select('activity')}
  >
    <span class="context-title"
      ><Icon name="activity" />{$t('Activity')}<Icon name="chevron" /></span
    >
    <span class="context-values">
      <span
        ><small>{$t('File observations')}</small><strong
          >{telemetry.ready ? files.length : '—'}</strong
        ></span
      >
      <span
        ><small>{$t('Connections')}</small><strong
          >{networkStatus === 'unavailable' ? '—' : connections.length}</strong
        ></span
      >
    </span>
    <span class="context-note"
      >{networkStatus === 'retained'
        ? $t('Retained network snapshot')
        : networkStatus === 'unavailable'
          ? $t('Network observation unavailable')
          : $t('View retained activity')}</span
    >
  </button>
  <button
    class="context-card"
    aria-controls={prefix + '-panel-' + (continuous ? processSection : 'processes')}
    aria-expanded={continuous ? undefined : section === 'processes'}
    onclick={() => select(processSection)}
  >
    <span class="context-title"
      ><Icon name="cpu" />{$t('Worker processes')}<Icon name="chevron" /></span
    >
    <span class="context-values">
      <span
        ><small>{$t('All processes')}</small><strong>{telemetry.ready ? workerCount : '—'}</strong
        ></span
      >
    </span>
    <span class="context-note"
      >{processSection === 'process-controls'
        ? $t('View process controls')
        : !telemetry.ready
          ? $t('Waiting for observed agents')
          : telemetry.stale
            ? $t('Last reliable observation')
            : $t('View worker processes')}</span
    >
  </button>
</section>

<style>
  .agent-context-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    min-width: 0;
  }
  .context-card {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
    color: var(--ink);
    text-align: left;
    font-family: var(--sans);
  }
  .context-card:hover {
    border-color: var(--strong-border);
    background: var(--raised);
  }
  .context-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-caption);
    font-weight: 600;
  }
  .context-title :global(.icon:last-child) {
    margin-left: auto;
    flex: none;
    color: var(--muted);
  }
  .context-values {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }
  .context-values > span {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
  }
  small,
  .context-note {
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  strong {
    font-size: var(--text-body);
    font-weight: 600;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 980px) {
    .context-card {
      padding: var(--space-2);
    }
    .context-values {
      gap: var(--space-1);
    }
  }
</style>
