<script lang="ts">
  import { instances, type RecordData, type Telemetry } from '../runtime/host';
  import { radarGroups, groupRecord } from '../runtime/radar';
  import { measuredGroupResource } from '../runtime/resources';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let mode = $state<'cpu' | 'memMb'>('cpu');
  let agents = $derived(radarGroups(instances(telemetry)));
  let readings = $derived(
    agents.map((group) => ({ group, ...measuredGroupResource(group, telemetry, mode) })),
  );
  let maximum = $derived(
    mode === 'cpu' ? 100 : Math.max(0, ...readings.map((reading) => reading.value ?? 0)) || 1,
  );
</script>

<section class="panel resource-chart">
  <div class="panel-head">
    <div>
      <h2><Icon name="chart" />Agent usage</h2>
      <p>Latest delivered measurements</p>
    </div>
    <div class="segmented">
      <button aria-pressed={mode === 'cpu'} onclick={() => (mode = 'cpu')}>CPU</button><button
        aria-pressed={mode === 'memMb'}
        onclick={() => (mode = 'memMb')}>RAM</button
      >
    </div>
  </div>
  <div class="resource-bars">
    {#each readings as reading (reading.group.key)}{@const a = reading.group}{@const value =
        reading.value}<button class="usage-row" onclick={() => inspect(a.name, groupRecord(a))}
        ><AgentLogo id={a.key} name={a.name} /><span class="usage-body"
          ><span class="usage-heading"
            ><strong
              >{a.name}<small
                >{telemetry.stale || !telemetry.ready
                  ? 'Readings paused'
                  : reading.measured + '/' + reading.total + ' processes measured'}{value !==
                  null && reading.measured < reading.total
                  ? ' · partial'
                  : ''}</small
              ></strong
            ><span>{value === null ? '—' : value.toFixed(1) + (mode === 'cpu' ? '%' : ' MB')}</span
            ></span
          ><span
            class="usage-track"
            class:partial={value !== null && reading.measured < reading.total}
            class:unavailable={value === null}
            ><span style={`transform:scaleX(${Math.min(1, (value ?? 0) / maximum)})`}></span></span
          ></span
        ><Icon name="chevron" /></button
      >{:else}<p class="inset muted">No process measurements available.</p>{/each}
  </div>
  <p class="chart-footnote">
    {mode === 'cpu'
      ? 'Percentage of total CPU capacity.'
      : 'Bar length is relative to the largest measured agent subtotal.'} Coverage identifies missing
    processes; partial readings exclude them. {#if telemetry.resourcesAt !== null && Number.isFinite(telemetry.resourcesAt)}Received
      {new Date(telemetry.resourcesAt).toLocaleTimeString()}.
    {/if}Open an agent for its processes.
  </p>
</section>

<style>
  .resource-bars {
    max-height: 286px;
    overflow: auto;
  }
  .usage-track.partial > span {
    background-image: repeating-linear-gradient(135deg, transparent 0 5px, var(--panel) 5px 7px);
  }
  .usage-track.unavailable {
    opacity: 0.45;
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
