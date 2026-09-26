<script lang="ts">
  import { t } from '../runtime/i18n';
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupRecord } from '../runtime/radar';
  import { measuredStatisticsTotal } from '../runtime/statistics-metrics';
  import { networkSnapshotStatus } from '../runtime/network-coverage';
  let {
    telemetry,
    recentCount,
    inspect,
    navigate,
  }: {
    telemetry: Telemetry;
    recentCount: number;
    inspect: (_title: string, _row: RecordData) => void;
    navigate?: (_view: string) => void | Promise<void>;
  } = $props();
  const summaryId = $props.id();
  let expanded = $state(false);
  let agents = $derived(instances(telemetry));
  let groups = $derived(radarGroups(agents));
  let highestRisk = $derived([...groups].sort((a, b) => b.risk - a.risk)[0]);
  let tokenTotal = $derived(measuredStatisticsTotal(telemetry, telemetry.tokens, 'totalTokens'));
  let sensitiveEvents = $derived(telemetry.events.filter((event) => event.sensitive === true));
  let networkStatus = $derived(networkSnapshotStatus(telemetry));
</script>

<div id={summaryId} class="summary monitoring-summary" class:expanded>
  <button class="summary-stat" onclick={() => navigate?.('agents')}>
    <span>{$t('Agents')}</span><strong
      >{telemetry.ready ? groups.length : '—'}<small
        >{telemetry.stale ? $t('last seen') : $t('online')}</small
      ></strong
    >
    <p>{agents.length} {$t('processes in snapshot')}</p>
  </button>
  <button
    class="summary-stat"
    disabled={!highestRisk}
    onclick={() =>
      highestRisk &&
      inspect(highestRisk.name, { ...groupRecord(highestRisk), detailSection: 'risk' })}
  >
    <span>{$t('Highest risk')}</span><strong>{highestRisk?.risk ?? '—'}<small>/100</small></strong>
    <p>
      {highestRisk
        ? $t('{agent} · view explanation', { agent: highestRisk.name })
        : $t('Waiting for observed agents')}
    </p>
  </button>
  <div class="summary-stat">
    <span>{$t('Events / min')}</span><strong>{telemetry.ready ? recentCount : '—'}</strong>
    <p>{telemetry.events.length} {$t('retained events')}</p>
  </div>
  <button
    class="summary-stat attention"
    onclick={() => inspect('Sensitive events', { observations: sensitiveEvents })}
    ><span>{$t('Sensitive events')}</span><strong
      >{telemetry.ready ? sensitiveEvents.length : '—'}</strong
    >
    <p>{$t('Retained file observations')}</p></button
  >
  <button class="summary-stat" onclick={() => navigate?.('network')}>
    <span>{$t('Connections')}</span><strong
      >{networkStatus === 'unavailable' ? '—' : telemetry.network.length}</strong
    >
    <p>
      {#if networkStatus === 'unavailable'}{$t(
          'Network observation unavailable',
        )}{:else if networkStatus === 'retained'}{$t(
          'Retained network snapshot',
        )}{:else}{telemetry.network.filter((n) => n.verdict === 'unknown').length}
        {$t('unverified endpoints')}{/if}
    </p>
  </button>
  <div class="summary-stat">
    <span>{$t('Tokens')}</span><strong
      >{tokenTotal.value === null
        ? '—'
        : Intl.NumberFormat('en', { notation: 'compact' }).format(tokenTotal.value)}</strong
    >
    <p>
      {tokenTotal.measured} / {tokenTotal.total}
      {$t('current processes measured')}{tokenTotal.value !== null &&
      tokenTotal.measured < tokenTotal.total
        ? $t(' · subtotal')
        : ''}
    </p>
  </div>
  <button
    class="button summary-metrics-toggle"
    aria-expanded={expanded}
    aria-controls={summaryId}
    onclick={() => (expanded = !expanded)}>{$t(expanded ? 'Fewer metrics' : 'More metrics')}</button
  >
</div>

<style>
  .summary-metrics-toggle {
    display: none;
  }
  @media (max-height: 700px) {
    .summary.monitoring-summary:not(.expanded) {
      grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
    }
    .monitoring-summary:not(.expanded) > .summary-stat:nth-child(n + 3) {
      display: none;
    }
    .monitoring-summary:not(.expanded) > .summary-stat {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }
    .monitoring-summary:not(.expanded) > .summary-stat > span {
      margin: 0;
    }
    .monitoring-summary:not(.expanded) > .summary-stat strong {
      font-size: var(--text-section);
      margin: 0;
    }
    .monitoring-summary:not(.expanded) > .summary-stat p {
      display: none;
    }
    .summary-metrics-toggle {
      display: block;
      align-self: stretch;
    }
    .expanded .summary-metrics-toggle {
      grid-column: 1 / -1;
    }
  }
</style>
