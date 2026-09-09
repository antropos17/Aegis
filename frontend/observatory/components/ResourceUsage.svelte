<script lang="ts">
  import { instances, measured, type RecordData, type Telemetry } from '../runtime/host';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let mode = $state('cpu');
  let agents = $derived(instances(telemetry));
  let maximum = $derived(
    mode === 'cpu' ? 100 : Math.max(1, ...telemetry.resources.map((r) => measured(r.memMb) ?? 0)),
  );
</script>

<section class="panel resource-chart">
  <div class="panel-head">
    <div>
      <h2><Icon name="chart" />Agent usage</h2>
      <p>Current process snapshot</p>
    </div>
    <div class="segmented">
      <button aria-pressed={mode === 'cpu'} onclick={() => (mode = 'cpu')}>CPU</button><button
        aria-pressed={mode === 'memMb'}
        onclick={() => (mode = 'memMb')}>RAM</button
      >
    </div>
  </div>
  <div class="resource-bars">
    {#each agents as a (a.instanceId ?? a)}{@const value = telemetry.stale
        ? null
        : measured(
            telemetry.resources.find((r) => !!a.instanceId && r.instanceId === a.instanceId)?.[
              mode
            ],
          )}<button class="usage-row" onclick={() => inspect(a.name, a as unknown as RecordData)}
        ><AgentLogo id={a.agent} name={a.name} /><span class="usage-body"
          ><span class="usage-heading"
            ><strong>{a.name}</strong><span
              >{value === null ? '—' : value.toFixed(1) + (mode === 'cpu' ? '%' : ' MB')}</span
            ></span
          ><span class="usage-track"
            ><span style={`transform:scaleX(${Math.min(1, (value ?? 0) / maximum)})`}></span></span
          ></span
        ><Icon name="chevron" /></button
      >{:else}<p class="inset muted">No process measurements available.</p>{/each}
  </div>
  <p class="chart-footnote">
    {mode === 'cpu'
      ? 'Percentage of total CPU capacity.'
      : 'Bar length is relative to the largest process.'} Open an agent for process details.
  </p>
</section>

<style>
  .resource-bars {
    max-height: 286px;
    overflow: auto;
  }
  .resource-chart {
    align-self: stretch;
  }
</style>
