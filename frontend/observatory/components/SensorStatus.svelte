<script lang="ts">
  import { t } from '../runtime/i18n';

  import { record, type RecordData } from '../runtime/host';
  let { health }: { health: RecordData } = $props();
  let effective = $derived(record(record(health.sensors).effective));
  function ids(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  }
  let failed = $derived(ids(effective.failedSensorIds));
  let degraded = $derived(ids(effective.degradedSensorIds));
</script>

{#if failed.length}<p class="failed" role="status">
    {$t('Failed sensors:')}
    {failed.join(', ')}{$t('. Their observations are unavailable.')}
  </p>{/if}
{#if degraded.length}<p class="degraded" role="status">
    {$t('Degraded sensors:')}
    {degraded.join(', ')}{$t('. Observations are incomplete.')}
  </p>{/if}

<style>
  p {
    padding: 8px 12px;
    border: 1px solid currentColor;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .failed {
    color: var(--red);
  }
  .degraded {
    color: var(--amber);
  }
</style>
