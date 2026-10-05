<script lang="ts">
  import { t } from '../runtime/i18n';
  import { statisticsValue } from '../runtime/statistics-metrics';
  let {
    value,
    unit,
    state,
  }: {
    value: number | null | undefined;
    unit: string;
    state: 'live' | 'held' | 'paused' | 'inspecting' | 'unavailable';
  } = $props();
  const labels = {
    live: 'Live',
    held: 'Held',
    paused: 'Paused',
    inspecting: 'Inspecting',
    unavailable: 'No measurement',
  };
</script>

<div class="readout">
  <strong class="current">{statisticsValue(value, unit)}</strong>
  <span class="state" class:live={state === 'live'}
    ><i aria-hidden="true"></i>{$t(labels[state])}</span
  >
</div>

<style>
  .readout {
    display: grid;
    justify-items: end;
    gap: var(--space-1);
    min-width: 92px;
  }
  .current {
    font-size: var(--text-metric);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    text-align: right;
    line-height: 1.1;
    white-space: nowrap;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font: var(--text-caption)/1.4 var(--sans);
  }
  .state i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }
  .state.live {
    color: var(--green);
  }
</style>
