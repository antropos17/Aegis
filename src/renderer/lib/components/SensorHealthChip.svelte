<!--
  SensorHealthChip.svelte — names the sensors behind a degraded or failed app health.

  Before this, `stats.appHealth` reached the renderer and nothing read it: the health
  state was carried the whole way and then dropped, so a dead file-handle scanner and a
  quiet machine looked identical in the UI. This chip is the minimum that fixes it — it
  says WHICH sensors, by id, and nothing else.

  The names come from `appHealth.sensors.effective.degradedSensorIds` /
  `failedSensorIds` via the app-health store, never from `appHealth.reasons`: reasons
  are aggregate reason codes, and parsing prose for identifiers breaks silently the
  first time the wording changes.

  Both lists empty renders NOTHING — no wrapper, no empty section, no placeholder. A
  chip that is always present has to say "all clear" on every tick, and "all clear" is
  the one claim a health surface must not make on its own.
-->
<script lang="ts">
  import { unhealthySensors } from '../stores/app-health.js';
  import { t } from '../i18n/index.js';

  let degraded = $derived($unhealthySensors.degraded);
  let failed = $derived($unhealthySensors.failed);
</script>

{#if failed.length > 0}
  <div
    class="sensor-health"
    title="These sensors have failed and are producing no usable observation: {failed.join(
      ', ',
    )}. Their evidence is missing, not empty."
  >
    <span class="sensor-health__label">{$t('footer.sensors_failed')}</span>
    <span class="sensor-health__value sensor-health__value--failed">{failed.join(', ')}</span>
  </div>
{/if}

{#if degraded.length > 0}
  <div
    class="sensor-health"
    title="These sensors are running with incomplete observation: {degraded.join(
      ', ',
    )}. What they report is partial."
  >
    <span class="sensor-health__label">{$t('footer.sensors_degraded')}</span>
    <span class="sensor-health__value sensor-health__value--degraded">{degraded.join(', ')}</span>
  </div>
{/if}

<style>
  .sensor-health {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
  }

  .sensor-health__label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .sensor-health__value {
    font: var(--md-sys-typescale-label-medium);
    font-family: var(--fancy-font-mono);
  }

  /* Failed and degraded are different severities, so they are different colours —
     both themed roles, not the dark-only --fancy-* pair. */
  .sensor-health__value--failed {
    color: var(--md-sys-color-error);
  }

  .sensor-health__value--degraded {
    color: var(--md-sys-color-secondary);
  }
</style>
