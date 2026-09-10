<script lang="ts">
  import { onMount } from 'svelte';
  import { instances, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupRecord } from '../runtime/radar';
  import { measuredStatisticsTotal } from '../runtime/statistics-metrics';
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
    selected = $bindable(null),
    inspect,
    mode = 'overview',
    navigate,
    openStatistics,
    openAgent,
    paused = false,
  }: {
    telemetry: Telemetry;
    selected: string | null;
    inspect: (_title: string, _row: RecordData) => void;
    mode?: string;
    paused?: boolean;
    openStatistics?: (_agent: string) => void;
    openAgent?: (_agent: string) => void;
    navigate?: (_view: string) => void | Promise<void>;
  } = $props();
  let agents = $derived(instances(telemetry)),
    groups = $derived(radarGroups(agents));
  let highestRisk = $derived([...groups].sort((a, b) => b.risk - a.risk)[0]);
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
  let tokenTotal = $derived(measuredStatisticsTotal(telemetry, telemetry.tokens, 'totalTokens'));
  let sensitiveEvents = $derived(telemetry.events.filter((event) => event.sensitive === true));
  $effect(() => {
    if (!telemetry.stale && selected && !agents.some((a) => a.instanceId === selected))
      selected = null;
  });
</script>

<div hidden={mode !== 'overview'}>
  <div class="summary monitoring-summary">
    <button class="summary-stat" onclick={() => navigate?.('agents')}>
      <span>Agents</span><strong
        >{telemetry.ready ? groups.length : '—'}<small
          >{telemetry.stale ? 'last seen' : 'online'}</small
        ></strong
      >
      <p>{agents.length} processes in snapshot</p>
    </button>
    <button
      class="summary-stat"
      disabled={!highestRisk}
      onclick={() =>
        highestRisk &&
        inspect(highestRisk.name, { ...groupRecord(highestRisk), detailSection: 'risk' })}
    >
      <span>Highest risk</span><strong>{highestRisk?.risk ?? '—'}<small>/100</small></strong>
      <p>
        {highestRisk ? highestRisk.name + ' · view explanation' : 'Waiting for observed agents'}
      </p>
    </button>
    <div class="summary-stat">
      <span>Events / min</span><strong>{telemetry.ready ? recent.length : '—'}</strong>
      <p>{telemetry.events.length} retained events</p>
    </div>
    <button
      class="summary-stat attention"
      onclick={() => inspect('Sensitive events', { observations: sensitiveEvents })}
      ><span>Sensitive events</span><strong>{telemetry.ready ? sensitiveEvents.length : '—'}</strong
      >
      <p>Retained file observations</p></button
    >
    <button class="summary-stat" onclick={() => navigate?.('network')}>
      <span>Connections</span><strong>{telemetry.ready ? telemetry.network.length : '—'}</strong>
      <p>{telemetry.network.filter((n) => n.verdict === 'unknown').length} unverified endpoints</p>
    </button>
    <div class="summary-stat">
      <span>Tokens</span><strong
        >{tokenTotal.value === null
          ? '—'
          : Intl.NumberFormat('en', { notation: 'compact' }).format(tokenTotal.value)}</strong
      >
      <p>
        {tokenTotal.measured} / {tokenTotal.total} current processes measured{tokenTotal.value !==
          null && tokenTotal.measured < tokenTotal.total
          ? ' · subtotal'
          : ''}
      </p>
    </div>
  </div>
  <Radar {telemetry} bind:selected {inspect} {openStatistics} {openAgent} />
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
        <h2><Icon name="activity" />Recent events</h2>
        {#if navigate}<button class="button" onclick={() => navigate?.('events')}
            >All events<Icon name="chevron" /></button
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
              >{describeObservation(group.latest).label} · {group.rows.length} records</small
            >
          </div>
          <time>{group.last ? new Date(group.last).toLocaleTimeString() : '—'}</time>
        </button>
      {:else}<p class="inset muted">No retained events.</p>{/each}
    </section>
  </div>
</div>
<div hidden={mode !== 'agents'}><Agents {telemetry} {inspect} {openStatistics} /></div>

<style>
  .recent-evidence {
    margin-top: var(--space-4);
  }
</style>
