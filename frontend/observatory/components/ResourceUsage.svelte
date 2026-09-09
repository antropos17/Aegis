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

<section class="panel usage-panel">
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
  <div class="usage-body">
    {#each agents as agent (agent.instanceId ?? agent)}{@const sample = agent.instanceId
        ? telemetry.resources.find((r) => r.instanceId === agent.instanceId)
        : undefined}{@const value = measured(sample?.[mode])}<button
        class="usage-row"
        onclick={() => inspect(agent.name, agent as unknown as RecordData)}
        ><span class="usage-identity"
          ><AgentLogo name={agent.name} size={20} /><span
            >{agent.name}<small>PID {agent.pid}</small></span
          ><strong
            >{value === null ? '—' : value.toFixed(1)}{value === null
              ? ''
              : mode === 'cpu'
                ? '%'
                : ' MB'}</strong
          ></span
        ><span class="track"
          ><span style={`transform:scaleX(${Math.min(1, (value ?? 0) / maximum)})`}></span></span
        ></button
      >{:else}<p class="muted">No process measurements available.</p>{/each}
  </div>
  <p class="usage-caption">
    {mode === 'cpu'
      ? 'Percentage of total CPU capacity.'
      : 'Memory relative to the largest measured process.'} — means unavailable.
  </p>
</section>

<style>
  .usage-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin-top: 0;
  }
  .usage-body {
    max-height: 280px;
    overflow: auto;
    padding: 10px 16px;
  }
  .usage-row {
    width: 100%;
    padding: 8px 0;
    text-align: left;
  }
  .usage-identity {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: calc(11px * var(--ui-scale));
  }
  .usage-identity > span {
    flex: 1;
  }
  .usage-identity small {
    display: block;
    color: var(--muted);
  }
  .track {
    display: block;
    height: 4px;
    border-radius: 3px;
    background: var(--border);
    margin-top: 8px;
    overflow: hidden;
  }
  .track > span {
    display: block;
    height: 100%;
    background: var(--muted);
    transform-origin: left;
    transition: transform 280ms ease;
  }
  .usage-caption {
    padding: 12px 16px;
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
    margin-top: auto;
  }
</style>
