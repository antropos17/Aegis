<script lang="ts">
  import { onMount } from 'svelte';
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups } from '../runtime/radar';
  import Radar from './Radar.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import Agents from './Agents.svelte';
  import Timeline from './Timeline.svelte';
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
    paused = false,
  }: {
    telemetry: Telemetry;
    selected: string | null;
    inspect: (title: string, row: RecordData) => void;
    mode?: string;
    paused?: boolean;
    navigate?: (_view: string) => void | Promise<void>;
  } = $props();
  let agents = $derived(instances(telemetry)),
    groups = $derived(radarGroups(agents));
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
  let tokenTotal = $derived(
    telemetry.tokens.length && telemetry.tokens.every((t) => measured(t.totalTokens) !== null)
      ? telemetry.tokens.reduce((sum, t) => sum + Number(t.totalTokens), 0)
      : null,
  );
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
    <div class="summary-stat">
      <span>Average risk</span><strong
        >{groups.length
          ? Math.round(groups.reduce((sum, g) => sum + g.risk, 0) / groups.length)
          : '—'}<small>/100</small></strong
      >
      <p>Highest: {groups.length ? Math.max(...groups.map((g) => g.risk)) : '—'}</p>
    </div>
    <div class="summary-stat">
      <span>Events / min</span><strong>{telemetry.ready ? recent.length : '—'}</strong>
      <p>{telemetry.events.length} retained events</p>
    </div>
    <button
      class="summary-stat attention"
      onclick={() =>
        inspect('Sensitive events', { observations: telemetry.events.filter((e) => e.sensitive) })}
      ><span>Sensitive events</span><strong>{String(telemetry.stats.aiSensitive ?? '—')}</strong>
      <p>File events · session</p></button
    >
    <button class="summary-stat" onclick={() => navigate?.('network')}>
      <span>Connections</span><strong>{telemetry.ready ? telemetry.network.length : '—'}</strong>
      <p>{telemetry.network.filter((n) => n.verdict === 'unknown').length} unverified endpoints</p>
    </button>
    <div class="summary-stat">
      <span>Tokens</span><strong
        >{tokenTotal === null
          ? '—'
          : Intl.NumberFormat('en', { notation: 'compact' }).format(tokenTotal)}</strong
      >
      <p>
        {tokenTotal === null ? 'No measurement' : telemetry.tokens.length + ' reported sources'}
      </p>
    </div>
  </div>
  <Radar {telemetry} bind:selected {inspect} />
  <div class="monitoring-activity">
    <ActivityChart
      events={telemetry.events}
      observedAt={telemetry.lastScan}
      {inspect}
      {paused}
      stale={telemetry.stale}
    />
  </div>
  <div class="overview-bottom">
    <Timeline {telemetry} {inspect} {paused} />
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
<div hidden={mode !== 'agents'}><Agents {telemetry} {inspect} /></div>
