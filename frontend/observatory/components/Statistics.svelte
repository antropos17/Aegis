<script lang="ts">
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import ResourceUsage from './ResourceUsage.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import Agents from './Agents.svelte';
  import Icon from './Icon.svelte';
  import Metadata from './Metadata.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let samples = $state<{ at: number; cpu: number | null; mem: number | null }[]>([]);
  let lastAt = 0;
  let agents = $derived(instances(telemetry));
  const sum = (key: string) =>
    telemetry.resources.length && telemetry.resources.every((r) => measured(r[key]) !== null)
      ? telemetry.resources.reduce((total, r) => total + Number(r[key]), 0)
      : null;
  $effect(() => {
    if (!telemetry.stale && telemetry.resourcesAt && telemetry.resourcesAt !== lastAt) {
      lastAt = telemetry.resourcesAt;
      samples = [...samples, { at: lastAt, cpu: sum('cpu'), mem: sum('memMb') }].slice(-60);
    }
  });
</script>

<div class="dashboard-grid">
  <ActivityChart
    events={telemetry.events}
    observedAt={telemetry.lastScan}
    {inspect}
  /><ResourceUsage {telemetry} {inspect} />
</div>
<Agents {telemetry} {inspect} />
<section class="panel" style="margin-top:18px">
  <div class="panel-head">
    <div>
      <h2><Icon name="chart" />Tokens and estimated cost</h2>
      <p>From supported agent logs</p>
    </div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Source</th><th>Tokens</th><th>Estimate</th></tr></thead><tbody
        >{#each telemetry.tokens as token (token)}<tr
            ><td
              >{agents.find((a) => !!token.instanceId && a.instanceId === token.instanceId)?.name ??
                'Unattributed sample'}<small
                >{String(token.instanceId ?? 'No process identity')}</small
              ></td
            ><td
              >{measured(token.totalTokens)?.toLocaleString() ?? '—'}{measured(
                token.totalTokens,
              ) === null
                ? ''
                : token.estimated
                  ? ' (estimated)'
                  : ' (measured)'}</td
            ><td
              >{measured(token.costUsd) === null ? '—' : '$' + Number(token.costUsd).toFixed(2)}</td
            ></tr
          >{:else}<tr><td colspan="3">No token measurements are available.</td></tr>{/each}</tbody
      >
    </table>
  </div>
  <div class="notice" style="margin:15px">
    AEGIS resource usage is shown separately in the footer.
  </div>
</section>
<details class="diagnostics">
  <summary>Resource history and delivery details</summary>

  <section class="panel">
    <div class="panel-head">
      <h2>Agent resource history</h2>
      <span>Up to 60 observations · this window</span>
    </div>
    <div class="inset">
      <p class="muted">
        CPU is summed only when every returned process has a measurement. A missing bar is
        unavailable, not zero.
      </p>
      <div class="chart" aria-label="Agent CPU history">
        {#each samples as sample (sample.at)}<button
            title={`${new Date(sample.at).toLocaleTimeString()} · ${sample.cpu === null ? 'Unavailable' : sample.cpu.toFixed(1) + '% CPU'}`}
            aria-label={`${new Date(sample.at).toLocaleTimeString()}, ${sample.cpu ?? 'unavailable'} percent CPU`}
            style={`--height:${Math.min(100, sample.cpu ?? 0)}%`}
            onclick={() => inspect('Resource sample', sample)}><span></span></button
          >{:else}<p>Waiting for resource samples.</p>{/each}
      </div>
    </div>
  </section>
  <Metadata
    value={{
      ...telemetry.stats,
      rendererRetention: {
        evicted: telemetry.evicted,
        sensitiveEvicted: telemetry.retainedEvicted,
      },
      aegisProcess: telemetry.own,
      agentResources: telemetry.resources,
    }}
  />
</details>

<style>
  .diagnostics {
    margin-top: 18px;
  }
  .diagnostics > summary {
    padding: 12px 0;
    color: var(--muted);
  }
  .chart {
    height: 180px;
    display: grid;
    grid-template-columns: repeat(60, minmax(0, 1fr));
    align-items: stretch;
    gap: 3px;
  }
  .chart button {
    position: relative;
    min-width: 3px;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--border);
    padding: 0;
  }
  .chart span {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--height);
    background: var(--muted);
    border-radius: 3px 3px 0 0;
  }
</style>
