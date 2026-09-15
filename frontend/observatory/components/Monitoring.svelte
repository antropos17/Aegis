<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount } from 'svelte';
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import MonitoringSummary from './MonitoringSummary.svelte';
  import Radar from './Radar.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import Agents from './Agents.svelte';
  import Icon from './Icon.svelte';
  import ObservationResource from './ObservationResource.svelte';
  import {
    describeObservation,
    groupObservations,
  } from '../../../src/shared/observation-display.js';
  let {
    telemetry,
    liveTelemetry,
    selected = $bindable(null),
    inspect,
    mode = 'overview',
    navigate,
    openStatistics,
    openAgent,
    paused = false,
  }: {
    telemetry: Telemetry;
    liveTelemetry?: Telemetry;
    selected: string | null;
    inspect: (_title: string, _row: RecordData) => void;
    mode?: string;
    paused?: boolean;
    openStatistics?: (_agent: string) => void;
    openAgent?: (_agent: string) => void;
    navigate?: (_view: string) => void | Promise<void>;
  } = $props();
  let agents = $derived(instances(telemetry));
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => {
      if (!paused && !telemetry.stale) now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  let recent = $derived(
    telemetry.events.filter(
      (e) => Number.isFinite(e.timestamp) && e.timestamp > now - 60000 && e.timestamp <= now,
    ),
  );
  $effect(() => {
    if (!telemetry.stale && selected && !agents.some((a) => a.instanceId === selected))
      selected = null;
  });
</script>

<div hidden={mode !== 'overview'}>
  <MonitoringSummary {telemetry} recentCount={recent.length} {inspect} {navigate} />
  <Radar {telemetry} {liveTelemetry} bind:selected {inspect} {openStatistics} {openAgent} />
  <div class="monitoring-activity">
    <ActivityChart
      events={telemetry.events}
      observedAt={telemetry.lastScan}
      {inspect}
      {paused}
      stale={telemetry.stale}
    />
  </div>
  <div class="recent-evidence">
    <section class="panel recent-panel">
      <div class="panel-head">
        <h2><Icon name="activity" />{$t('Recent events')}</h2>
        {#if navigate}<button class="button" onclick={() => navigate?.('events')}
            >{$t('All events')}<Icon name="chevron" /></button
          >{/if}
      </div>
      {#each groupObservations(telemetry.events as unknown as RecordData[]).slice(0, 3) as group (group.key)}
        <button
          class="recent-event"
          onclick={() =>
            inspect(
              'File observations',
              group.rows.length > 1
                ? { observationGroup: group.label, observations: group.rows }
                : group.latest,
            )}
        >
          <div>
            <ObservationResource row={group.latest} /><small
              >{describeObservation(group.latest).label} · {group.rows.length}
              {$t('records')}</small
            >
          </div>
          <time>{group.last ? new Date(group.last).toLocaleTimeString() : '—'}</time>
        </button>
      {:else}<p class="inset muted">{$t('No retained events.')}</p>{/each}
    </section>
  </div>
</div>
<div hidden={mode !== 'agents'}><Agents {telemetry} {inspect} {openStatistics} /></div>

<style>
  .recent-evidence {
    margin-top: var(--space-4);
  }
</style>
