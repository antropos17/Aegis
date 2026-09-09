<script lang="ts">
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups } from '../runtime/radar';
  import Radar from './Radar.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import Agents from './Agents.svelte';
  import Timeline from './Timeline.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    selected = $bindable(null),
    inspect,
    mode = 'overview',
  }: {
    telemetry: Telemetry;
    selected: string | null;
    inspect: (title: string, row: RecordData) => void;
    mode?: string;
  } = $props();
  let agents = $derived(instances(telemetry)),
    groups = $derived(radarGroups(agents));
  let end = $derived(
    Math.max(telemetry.lastScan ?? 0, ...telemetry.events.map((e) => e.timestamp)),
  );
  let recent = $derived(telemetry.events.filter((e) => e.timestamp > end - 60000));
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
    <div class="summary-stat">
      <span>Agents</span><strong
        >{telemetry.ready ? groups.length : '—'}<small
          >{telemetry.stale ? 'last seen' : 'online'}</small
        ></strong
      >
      <p>{agents.length} processes in snapshot</p>
    </div>
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
    <div class="summary-stat">
      <span>Connections</span><strong>{telemetry.ready ? telemetry.network.length : '—'}</strong>
      <p>{telemetry.network.filter((n) => n.verdict === 'unknown').length} unknown</p>
    </div>
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
    <ActivityChart events={telemetry.events} observedAt={telemetry.lastScan} {inspect} />
  </div>
  <div class="overview-bottom">
    <Timeline {telemetry} {inspect} />
    <section class="panel recent-panel">
      <div class="panel-head"><h2><Icon name="activity" />Recent events</h2></div>
      {#each [...telemetry.events]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 3) as event (event)}<button
          class="recent-event"
          onclick={() => inspect('File observation', event as unknown as RecordData)}
          ><Icon name="file" />
          <div>
            <strong>{event.file.split(/[/\\]/).pop()}</strong><small
              >{event.agent ?? 'Unattributed'}</small
            >
          </div>
          <time>{new Date(event.timestamp).toLocaleTimeString()}</time></button
        >{:else}<p class="inset muted">No retained events.</p>{/each}
    </section>
  </div>
</div>
<div hidden={mode !== 'agents'}><Agents {telemetry} {inspect} /></div>
