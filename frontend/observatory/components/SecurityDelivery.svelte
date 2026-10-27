<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import type { Telemetry } from '../runtime/host';
  import { securityDelivery } from '../runtime/security-delivery';
  import {
    advanceDeliveryRate,
    RATE_BUCKETS,
    type DeliveryRateState,
  } from '../runtime/security-delivery-rate';

  let { telemetry, now }: { telemetry: Telemetry; now: number } = $props();
  let delivery = $derived(securityDelivery(telemetry, Math.max(now, Date.now())));
  let rateState = $state<DeliveryRateState | null>(null);
  $effect(() => {
    const snapshot = telemetry;
    const receivedNow = Math.max(now, Date.now());
    rateState = advanceDeliveryRate(
      untrack(() => rateState),
      snapshot,
      receivedNow,
    );
  });
  const rateLabels = {
    'file-watch': 'File watcher',
    'file-handle': 'File handle scan',
    process: 'Process',
    network: 'Network',
    other: 'Other',
  };
</script>

<section class="delivery" aria-labelledby="security-delivery-heading">
  <h4 id="security-delivery-heading">{$t('Security event delivery')}</h4>
  <p>{$t('Audit-lane report. It does not measure sensor coverage or detection completeness.')}</p>
  <section class="rates" aria-labelledby="security-delivery-rates">
    <h5 id="security-delivery-rates">
      {$t('Accepted audit-lane records per second between samples')}
    </h5>
    <p>
      {$t(
        'These rates are not total sensor activity or completeness. Zero does not mean no activity.',
      )}
    </p>
    {#if rateState?.rates && rateState.intervalMs !== null}
      <p>
        {$t('Sample interval: {seconds} seconds. Source freshness is unknown.', {
          seconds: (rateState.intervalMs / 1000).toFixed(2),
        })}
      </p>
      <dl>
        {#each RATE_BUCKETS as bucket (bucket)}
          <div>
            <dt>{$t(rateLabels[bucket])}</dt>
            <dd>{rateState.rates[bucket].toFixed(2)}</dd>
          </div>
        {/each}
      </dl>
    {:else}
      <p role="status">
        {$t('Admission rates unavailable; two valid producer samples are required.')}
      </p>
    {/if}
  </section>
  {#if delivery.available}
    <p class="freshness">{$t('Last received report; source freshness is unknown.')}</p>
    <dl>
      <div>
        <dt>{$t('Accepted in this run')}</dt>
        <dd>{delivery.accepted}</dd>
      </div>
      <div>
        <dt>{$t('Audit acknowledgements in this run')}</dt>
        <dd>{delivery.delivered}</dd>
      </div>
      <div>
        <dt>{$t('Buffered in memory')}</dt>
        <dd>{delivery.buffered}</dd>
      </div>
      <div>
        <dt>{$t('Known lost records')}</dt>
        <dd>{delivery.lost}</dd>
      </div>
      <div>
        <dt>{$t('Known loss in pending or in-flight ledger')}</dt>
        <dd>{delivery.pendingLoss}</dd>
      </div>
      <div>
        <dt>{$t('Known spill records')}</dt>
        <dd>{delivery.spillRecords}</dd>
      </div>
      <div>
        <dt>{$t('Spill storage bytes')}</dt>
        <dd>{delivery.spillBytes}</dd>
      </div>
    </dl>
    <ul>
      <li>
        {delivery.unknownLoss
          ? $t('Loss of an unknown count was reported.')
          : $t('No unknown-count loss was reported.')}
      </li>
      <li>
        {delivery.markerDurable
          ? $t('No loss-marker persistence failure reported.')
          : $t('Loss marker reported not durable.')}
      </li>
      <li>
        {delivery.replayPending
          ? $t('Startup replay was pending; new observations may be rejected.')
          : $t('Startup replay was not pending.')}
      </li>
      <li>
        {delivery.spillBlocked
          ? $t('Spill storage was blocked.')
          : $t('Spill storage was not reported blocked.')}
      </li>
    </ul>
    <p>
      {$t(
        'Acknowledgements include replay and can include duplicates. Uninspected spill segments may be excluded from known records. Spill bytes include metadata and quarantine; display evictions are counted separately.',
      )}
    </p>
  {:else}
    <p role="status">{$t('Security event delivery report is unavailable.')}</p>
  {/if}
</section>

<style>
  .delivery {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--space-3);
    margin-bottom: var(--space-3);
  }
  h4 {
    margin: 0;
    font-size: calc(12px * var(--ui-scale));
    font-weight: 650;
  }
  h5 {
    margin: 0;
    font-size: 11px;
    font-weight: 650;
  }
  .rates {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  p {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
    margin: var(--space-1) 0 0;
  }
  .freshness {
    font-weight: 650;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
    gap: var(--space-3);
    margin: var(--space-3) 0;
  }
  dt {
    color: var(--muted);
    font-size: 10px;
  }
  dd {
    margin: var(--space-1) 0 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  ul {
    margin: var(--space-2) 0;
    padding-left: var(--space-4);
    font-size: 11px;
    line-height: 1.6;
  }
</style>
