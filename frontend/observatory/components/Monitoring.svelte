<script lang="ts">
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { isAnomalyAlert } from '../../../src/renderer/lib/utils/anomaly-toast-tracker';
  import { RISK_BAND_HIGH_MIN } from '../../../src/renderer/lib/utils/trust-badge-utils';
  import AgentLogo from './AgentLogo.svelte';
  import Radar from './Radar.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import ResourceUsage from './ResourceUsage.svelte';
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
  let agents = $derived(instances(telemetry));
  let end = $derived(
    Math.max(telemetry.lastScan ?? 0, ...telemetry.events.map((e) => e.timestamp)),
  );
  let recent = $derived(telemetry.events.filter((e) => e.timestamp > end - 60000));
  let tokenTotal = $derived(
    telemetry.tokens.length && telemetry.tokens.every((t) => measured(t.totalTokens) !== null)
      ? telemetry.tokens.reduce((sum, t) => sum + Number(t.totalTokens), 0)
      : null,
  );
  let query = $state('');
  let filtered = $derived(
    agents.filter((a) =>
      `${a.name} ${a.pid} ${a.cwd ?? ''}`.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  function metric(id: string | null, key: string) {
    return id ? measured(telemetry.resources.find((r) => r.instanceId === id)?.[key]) : null;
  }
  function value(n: number | null, suffix = '') {
    return n === null ? 'Unavailable' : `${n.toFixed(1)}${suffix}`;
  }
  $effect(() => {
    if (!telemetry.stale && selected && !agents.some((a) => a.instanceId === selected))
      selected = null;
  });
</script>

<div hidden={mode !== 'overview'}>
  <div class="summary-strip">
    <div>
      <small>Agents</small><strong>{telemetry.ready ? agents.length : '—'}</strong>
      <p>Current process snapshot</p>
    </div>
    <div>
      <small>Average risk</small><strong
        >{agents.length
          ? Math.round(agents.reduce((sum, a) => sum + a.riskScore, 0) / agents.length)
          : '—'}<small>/100</small></strong
      >
      <p>Highest: {agents.length ? Math.max(...agents.map((a) => a.riskScore)) : '—'}</p>
    </div>
    <div>
      <small>Events / min</small><strong>{telemetry.ready ? recent.length : '—'}</strong>
      <p>{telemetry.events.length} retained</p>
    </div>
    <div>
      <small>Sensitive events</small><strong class="attention"
        >{String(telemetry.stats.aiSensitive ?? '—')}</strong
      >
      <p>File events · session</p>
    </div>
    <div>
      <small>Connections</small><strong>{telemetry.ready ? telemetry.network.length : '—'}</strong>
      <p>Current snapshot</p>
    </div>
    <div>
      <small>Tokens</small><strong
        >{tokenTotal === null
          ? '—'
          : Intl.NumberFormat('en', { notation: 'compact' }).format(tokenTotal)}</strong
      >
      <p>
        {tokenTotal === null ? 'No measurement' : `${telemetry.tokens.length} reported sources`}
      </p>
    </div>
  </div>
  <Radar {telemetry} bind:selected {inspect} />
  <div class="activity-grid">
    <ActivityChart
      events={telemetry.events}
      observedAt={telemetry.lastScan}
      {inspect}
    /><ResourceUsage {telemetry} {inspect} />
  </div>
</div>

<section class="panel">
  <div class="panel-head">
    <h2>Agent instances</h2>
    <input
      aria-label="Search instances"
      type="search"
      placeholder="Name, PID or project…"
      bind:value={query}
    />
  </div>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>Agent / instance</th><th>Process</th><th>Risk / anomaly</th><th>CPU</th><th
            >Memory</th
          ><th>Project</th></tr
        ></thead
      ><tbody>
        {#each filtered as agent (agent.instanceId ?? agent)}
          <tr class:selected={selected === agent.instanceId}
            ><td
              ><button
                class="agent-link"
                onclick={() => {
                  selected = agent.instanceId;
                  inspect(agent.name, agent as unknown as RecordData);
                }}><AgentLogo name={agent.name} />{agent.name}</button
              ><small class="mono">{agent.instanceId ?? 'Identity unavailable'}</small></td
            ><td>{agent.pid || 'Synthetic'}<small>{agent.process}</small></td><td
              ><span class="badge" class:high={agent.riskScore >= RISK_BAND_HIGH_MIN}
                >{agent.riskScore}/100</span
              ><small
                ><span class:anomaly-alert={isAnomalyAlert(agent.anomalyScore)}
                  >Anomaly {agent.anomalyScore}/100</span
                ></small
              ></td
            ><td>{value(metric(agent.instanceId, 'cpu'), '%')}</td><td
              >{value(metric(agent.instanceId, 'memMb'), ' MB')}</td
            ><td>{agent.projectName ?? agent.cwd ?? 'Unavailable'}</td></tr
          >
        {:else}<tr
            ><td colspan="6"
              >{telemetry.ready
                ? 'No matching instances in the last observation.'
                : 'Waiting for scan data.'}</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .activity-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr);
    gap: 12px;
    margin-bottom: 12px;
    align-items: start;
  }
  @media (max-width: 1000px) {
    .activity-grid {
      grid-template-columns: 1fr;
    }
  }
  .anomaly-alert {
    color: var(--red);
  }
  .summary-strip {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;
    margin-bottom: 14px;
    background: var(--sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .summary-strip > div {
    min-width: 0;
    padding-left: 10px;
    border-left: 1px solid var(--border);
  }
  .summary-strip > div:first-child {
    border-left: 0;
    padding-left: 0;
  }
  .summary-strip strong {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px;
    font-size: calc(23px * var(--ui-scale));
    font-weight: 500;
    line-height: 1.3;
    margin: 6px 0 3px;
  }
  .summary-strip small,
  .summary-strip p {
    font-size: calc(11px * var(--ui-scale));
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .attention {
    color: var(--amber);
  }
  .agent-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    text-align: left;
  }
  @media (max-width: 950px) {
    .summary-strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .summary-strip > div:nth-child(4) {
      border-left: 0;
      padding-left: 0;
    }
  }
</style>
