<script lang="ts">
  import { instances, type RecordData, type Telemetry } from '../runtime/host';
  import { radarGroups, groupResource, groupRecord } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let mode = $state('cpu');
  let agents = $derived(radarGroups(instances(telemetry)));
  let maximum = $derived(
    mode === 'cpu'
      ? 100
      : Math.max(1, ...agents.map((g) => groupResource(g, telemetry, 'memMb') ?? 0)),
  );
</script>

<section class="panel resource-chart">
  <div class="panel-head">
    <div>
      <h2><Icon name="chart" />Agent usage</h2>
      <p>Combined usage across each agent's processes</p>
    </div>
    <div class="segmented">
      <button aria-pressed={mode === 'cpu'} onclick={() => (mode = 'cpu')}>CPU</button><button
        aria-pressed={mode === 'memMb'}
        onclick={() => (mode = 'memMb')}>RAM</button
      >
    </div>
  </div>
  <div class="resource-bars">
    {#each agents as a (a.key)}{@const value = groupResource(a, telemetry, mode)}<button
        class="usage-row"
        onclick={() => inspect(a.name, groupRecord(a))}
        ><AgentLogo id={a.key} name={a.name} /><span class="usage-body"
          ><span class="usage-heading"
            ><strong
              >{a.name}<small
                >{a.members.length} {a.members.length === 1 ? 'process' : 'processes'}</small
              ></strong
            ><span>{value === null ? '—' : value.toFixed(1) + (mode === 'cpu' ? '%' : ' MB')}</span
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
      : 'Bar length is relative to the largest agent total.'} Open an agent for its processes.
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
  .usage-heading strong small {
    display: block;
    color: var(--muted);
    font-size: 11px;
    font-weight: 400;
  }
</style>
