<script lang="ts">
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { isAnomalyAlert } from '../../../src/renderer/lib/utils/anomaly-toast-tracker';
  import { RISK_BAND_HIGH_MIN } from '../../../src/renderer/lib/utils/trust-badge-utils';
  import AgentLogo from './AgentLogo.svelte';
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
  let agents = $derived(instances(telemetry));
  let chosen = $derived(selected ? agents.find((a) => a.instanceId === selected) : undefined);
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
  function position(index: number) {
    const ring = index < 8 ? Math.min(8, agents.length) : Math.min(4, agents.length - 8);
    const angle = ((index < 8 ? index : index - 8) / ring) * Math.PI * 2 - Math.PI / 2;
    const radius = index < 8 ? 142 : 68;
    return (
      'left:calc(50% + ' +
      Math.cos(angle) * radius +
      'px);top:calc(50% + ' +
      Math.sin(angle) * radius +
      'px)'
    );
  }
  $effect(() => {
    if (!telemetry.stale && selected && !agents.some((a) => a.instanceId === selected))
      selected = null;
  });
</script>

<div hidden={mode !== 'overview'}>
  <div class="summary-strip">
    <div>
      <small>Observed instances</small><strong>{telemetry.ready ? agents.length : '—'}</strong>
    </div>
    <div>
      <small>File observations · session</small><strong
        >{String(telemetry.stats.totalFiles ?? '—')}</strong
      >
    </div>
    <div>
      <small>Sensitive · session</small><strong>{String(telemetry.stats.aiSensitive ?? '—')}</strong
      >
    </div>
    <div>
      <small>Network · snapshot</small><strong
        >{telemetry.ready ? telemetry.network.length : '—'}</strong
      >
    </div>
  </div>
  <div class="monitor-grid">
    <section class="panel radar-panel">
      <div class="panel-head">
        <h2>Agent radar</h2>
        <span>{telemetry.stale ? 'Last observation · stale' : 'Live observations'}</span>
      </div>
      <div class="radar-stage" class:stale={telemetry.stale}>
        <button
          class="radar-empty"
          aria-label="Clear radar selection"
          onclick={() => (selected = null)}
        ></button>
        <div class="radar-dial" aria-hidden="true">
          <div class="dial-grid"></div>
          <div class="dial-ticks"></div>
          <div class="dial-sweep"></div>
          <div class="radar-center"><Icon name="shield" /></div>
        </div>
        {#each agents.filter((a) => a.instanceId).slice(0, 12) as agent, index (agent.instanceId)}
          <button
            class="radar-point"
            class:selected={selected === agent.instanceId}
            style={position(index)}
            aria-label={`Select ${agent.name}, PID ${agent.pid}`}
            aria-pressed={selected === agent.instanceId}
            onclick={() => (selected = agent.instanceId)}
            onkeydown={(event) => {
              if (event.key === 'Escape') selected = null;
            }}
          >
            <AgentLogo name={agent.name} /><small>PID {agent.pid}</small>
          </button>
        {/each}
        {#if !agents.length}<p class="radar-message">
            {telemetry.ready
              ? 'No agents in the last reliable scan'
              : 'Waiting for the first reliable scan'}
          </p>{/if}
      </div>
      <div class="inset muted">
        Showing up to 12 instances. All observed processes appear in the table below. Distance does
        not represent risk.
      </div>
    </section>
    <section class="panel inspector">
      <div class="panel-head"><h2>Instance inspector</h2></div>
      <div class="inset">
        {#if chosen}<div class="identity">
            <AgentLogo name={chosen.name} />
            <h3>{chosen.name}</h3>
          </div>
          <p class="mono">{chosen.instanceId}</p>
          <dl>
            <dt>Exposure risk</dt>
            <dd>{chosen.riskScore}/100 · {chosen.trustGrade}</dd>
            <dt>Behaviour anomaly</dt>
            <dd>{chosen.anomalyScore}/100</dd>
            <dt>CPU / memory</dt>
            <dd>
              {value(metric(chosen.instanceId, 'cpu'), '%')} / {value(
                metric(chosen.instanceId, 'memMb'),
                ' MB',
              )}
            </dd>
            <dt>Working directory</dt>
            <dd>{chosen.cwd ?? 'Unavailable'}</dd>
          </dl>
          <button
            class="button"
            onclick={() => inspect(chosen.name, chosen as unknown as RecordData)}
            >Open instance details</button
          >{:else}<Icon name="agents" />
          <h3>Select an instance</h3>
          <p class="muted">
            Choose a radar marker or a row below to inspect its observations and available actions.
          </p>{/if}
      </div>
    </section>
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
  .anomaly-alert {
    color: var(--red);
  }
  .summary-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .summary-strip > div {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
  }
  .summary-strip strong {
    display: block;
    font-size: 28px;
    font-weight: 550;
  }
  .summary-strip small {
    color: var(--muted);
  }
  .monitor-grid > .panel {
    margin-top: 0;
  }
  .monitor-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(230px, 30%);
    gap: 12px;
    margin-bottom: 12px;
  }
  .radar-stage {
    position: relative;
    min-height: 380px;
    height: 380px;
    overflow: hidden;
  }
  .radar-empty {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    width: 100%;
  }
  .radar-dial {
    pointer-events: none;
  }
  .dial-sweep {
    animation: sweep 12s linear infinite;
  }
  .stale .dial-sweep {
    animation-play-state: paused;
  }
  .radar-point {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    gap: 4px;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--ink);
    padding: 4px;
    max-width: 78px;
    flex-direction: column;
  }
  .radar-point.selected {
    border-color: var(--strong-border);
    background: var(--raised);
  }
  .radar-message {
    position: absolute;
    bottom: 12px;
    text-align: center;
    width: 100%;
    pointer-events: none;
    color: var(--muted);
  }
  .identity,
  .agent-link {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .agent-link {
    background: transparent;
    color: var(--ink);
    border: 0;
    padding: 0;
    text-align: left;
  }
  dt {
    color: var(--muted);
    margin-top: 12px;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mono {
    overflow-wrap: anywhere;
  }
  @keyframes sweep {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dial-sweep {
      animation: none;
    }
  }
  @media (max-width: 1080px) {
    .monitor-grid > .panel {
      margin-top: 0;
    }
    .monitor-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .summary-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
