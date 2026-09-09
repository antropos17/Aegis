<script lang="ts">
  import { measured, record, type Telemetry, type RecordData } from '../runtime/host';
  import Metadata from './Metadata.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let samples = $state<{ at: number; cpu: number | null; mem: number | null }[]>([]);
  let lastAt = 0;
  let tokenOnly = $derived(
    telemetry.tokens.filter(
      (token) =>
        typeof token.instanceId !== 'string' ||
        !telemetry.resources.some((r) => r.instanceId === token.instanceId),
    ),
  );
  let measurements: RecordData[] = $derived([
    ...telemetry.resources,
    ...tokenOnly.map((token) => ({ instanceId: token.instanceId, token })),
  ]);
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
<section class="panel">
  <div class="panel-head"><h2>Process measurements</h2></div>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>Instance</th><th>CPU %</th><th>Memory MB</th><th>GPU memory</th><th>Tokens</th><th
            >Cost USD</th
          ></tr
        ></thead
      ><tbody
        >{#each measurements as resource (resource)}{@const token =
            record(resource.token).totalTokens !== undefined
              ? record(resource.token)
              : telemetry.tokens.find(
                  (t) =>
                    typeof resource.instanceId === 'string' && t.instanceId === resource.instanceId,
                )}<tr
            ><td>{String(resource.instanceId ?? `Unattributed sample · PID ${resource.pid}`)}</td
            ><td>{measured(resource.cpu) ?? 'Unavailable'}</td><td
              >{measured(resource.memMb) ?? 'Unavailable'}</td
            ><td>{resource.gpu ? JSON.stringify(resource.gpu) : 'Unavailable'}</td><td
              >{token
                ? `${token.totalTokens} ${token.estimated ? '(estimated)' : '(measured)'}`
                : 'Unavailable'}</td
            ><td>{token ? (measured(token.costUsd) ?? 'Unavailable') : 'Unavailable'}</td></tr
          >{:else}<tr><td colspan="6">No sampled process resources.</td></tr>{/each}</tbody
      >
    </table>
  </div>
</section>
<section class="panel">
  <div class="panel-head"><h2>Monitoring counters & delivery</h2></div>
  <div class="inset">
    <Metadata
      value={{
        ...telemetry.stats,
        rendererRetention: {
          evicted: telemetry.evicted,
          sensitiveEvicted: telemetry.retainedEvicted,
        },
        aegisProcess: telemetry.own,
      }}
    />
  </div>
</section>

<style>
  .chart {
    height: 180px;
    display: flex;
    align-items: stretch;
    gap: 3px;
  }
  .chart button {
    position: relative;
    flex: 1;
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
    background: var(--green);
    border-radius: 3px 3px 0 0;
  }
</style>
