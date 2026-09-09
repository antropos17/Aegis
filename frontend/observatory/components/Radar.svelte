<script lang="ts">
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { activityBins } from '../runtime/activity';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    selected = $bindable(null),
    inspect,
  }: {
    telemetry: Telemetry;
    selected: string | null;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let agents = $derived(instances(telemetry));
  let plotted = $derived(agents.filter((a) => a.instanceId).slice(0, 12));
  let chosen = $derived(selected ? agents.find((a) => a.instanceId === selected) : undefined);
  let layer = $state('radar');
  let end = $derived(
    Math.max(telemetry.lastScan ?? 0, ...telemetry.events.map((e) => e.timestamp)) + 1,
  );
  let chosenEvents = $derived(
    selected ? telemetry.events.filter((e) => e.instanceId === selected) : [],
  );
  let latest = $derived([...chosenEvents].sort((a, b) => b.timestamp - a.timestamp)[0]);
  let linked = $derived(
    (layer === 'files' ? telemetry.events : telemetry.network)
      .filter((e) => !selected || e.instanceId === selected)
      .slice(0, 2) as unknown as RecordData[],
  );
  function resource(id: string | null, key: string) {
    return id ? measured(telemetry.resources.find((r) => r.instanceId === id)?.[key]) : null;
  }
  function value(n: number | null, suffix = '') {
    return n === null ? '—' : `${n.toFixed(1)}${suffix}`;
  }
  function position(index: number) {
    const angle = (index / Math.max(4, plotted.length)) * Math.PI * 2 - Math.PI * 0.7;
    return { x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 };
  }
  function band(score: number) {
    return score >= 66 ? 'High' : score >= 35 ? 'Medium' : 'Low';
  }
  function openChosen() {
    if (chosen) inspect(chosen.name, chosen as unknown as RecordData);
  }
</script>

<div class="overview-grid">
  <section class="panel radar-panel">
    <div class="panel-head">
      <div>
        <h2><Icon name="radar" />Agent radar</h2>
        <p>Risk and active instances</p>
      </div>
      <div class="segmented" aria-label="Radar layer">
        {#each [['radar', 'Radar', 'radar'], ['files', 'Files', 'folder'], ['network', 'Network', 'network']] as [id, title, icon] (id)}<button
            aria-pressed={layer === id}
            onclick={() => (layer = id)}><Icon name={icon} />{title}</button
          >{/each}
      </div>
    </div>
    <div class="radar-body">
      <div class="radar-workspace">
        <div class="radar-stage" class:stale={telemetry.stale}>
          <button
            class="radar-empty"
            aria-label="Clear radar selection"
            onclick={() => (selected = null)}
          ></button>
          <div class="radar-coordinate">
            {telemetry.stale ? 'Observation unavailable' : 'Processes visible'}<br />Local
            monitoring
          </div>
          <div class="radar-dial">
            <div class="dial-grid"></div>
            <div class="dial-ticks"></div>
            <div class="dial-sweep"></div>
            <span class="bearing north">0°</span><span class="bearing east">90°</span><span
              class="bearing south">180°</span
            ><span class="bearing west">270°</span>
            <div class="radar-center"><Icon name="shield" /></div>
            {#each plotted as agent, index (agent.instanceId)}{@const point = position(index)}
              <button
                class="radar-point"
                class:label-left={point.x < 50}
                class:dense={plotted.length > 6}
                aria-pressed={selected === agent.instanceId}
                style={`left:${point.x}%;top:${point.y}%`}
                aria-label={`Select ${agent.name}, PID ${agent.pid}`}
                onclick={() => (selected = agent.instanceId)}
                onkeydown={(e) => {
                  if (e.key === 'Escape') selected = null;
                }}
              >
                <AgentLogo name={agent.name} size={18} /><span
                  ><strong>{agent.name}</strong><small
                    >{plotted.length > 6 ? `PID ${agent.pid}` : `${agent.riskScore} / 100`}</small
                  ></span
                >
              </button>
            {/each}
          </div>
          {#if !agents.length}<p class="radar-message">
              {telemetry.ready
                ? 'No agents in the last reliable scan'
                : 'Waiting for the first reliable scan'}
            </p>{/if}
          {#if layer !== 'radar'}<div class="layer-resources">
              {#each linked as row (row)}<button
                  class="button"
                  onclick={() =>
                    inspect(layer === 'files' ? 'File observation' : 'Network observation', row)}
                  ><Icon name={layer === 'files' ? 'file' : 'network'} /><span
                    >{String(row.file ?? row.domain ?? row.remoteIp ?? 'Observation')}</span
                  ></button
                >{:else}<small
                  >No {layer === 'files' ? 'file observations' : 'connections'} for this selection.</small
                >{/each}
            </div>{/if}
        </div>
        <div class="radar-cards" aria-label="Agent activity">
          {#each plotted as agent (agent.instanceId)}{@const events = telemetry.events.filter(
              (e) => e.instanceId === agent.instanceId,
            )}{@const bins = activityBins(events, end, 300000, 10)}{@const max = Math.max(
              1,
              ...bins.map((bin) => bin.events.length),
            )}
            <article class="radar-agent-card">
              <button
                class="radar-agent-title"
                aria-pressed={selected === agent.instanceId}
                onclick={() => (selected = agent.instanceId)}
                ><AgentLogo name={agent.name} size={20} /><span>{agent.name}</span><b
                  >{agent.riskScore}</b
                ></button
              >
              <div class="radar-agent-metrics">
                <span>CPU <b>{value(resource(agent.instanceId, 'cpu'), '%')}</b></span><span
                  >RAM <b>{value(resource(agent.instanceId, 'memMb'), ' MB')}</b></span
                >
              </div>
              <button
                class="radar-mini-chart"
                aria-label={`Recent activity for ${agent.name}, PID ${agent.pid}`}
                onclick={() =>
                  inspect('Activity interval', {
                    instanceId: agent.instanceId,
                    observations: bins.flatMap((bin) => bin.events),
                  })}
              >
                <svg viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true"
                  >{#each bins as bin, i (i)}<rect
                      x={i * 20}
                      y={24 - (bin.events.length / max) * 24}
                      width="14"
                      height={Math.max(1, (bin.events.length / max) * 24)}
                      rx="1"
                    />{/each}</svg
                >
                <small>{bins.reduce((sum, bin) => sum + bin.events.length, 0)} events · 5 min</small
                >
              </button>
              <button
                class="text-link radar-agent-foot"
                onclick={() => inspect(agent.name, agent as unknown as RecordData)}
                ><Icon name="cpu" />PID {agent.pid}</button
              >
            </article>
          {/each}
        </div>
      </div>
    </div>
    <div class="radar-bottom">
      <span>Up to 12 instances · distance does not encode risk</span><button
        disabled={!chosen}
        onclick={openChosen}>Open selected agent</button
      >
    </div>
  </section>
  <section class="panel inspector">
    <div class="inspector-title">
      <span>Selected instance</span><button
        disabled={!chosen}
        aria-label="Open selected instance"
        onclick={openChosen}><Icon name="chevron" /></button
      >
    </div>
    {#if chosen}
      <div class="agent-identity">
        <AgentLogo name={chosen.name} size={32} />
        <div>
          <button class="text-link" onclick={openChosen}>{chosen.name}</button><small
            >PID {chosen.pid}</small
          >
        </div>
      </div>
      <div class="inspector-risk">
        <div>
          <small>Risk</small><span
            class="badge"
            class:high={chosen.riskScore >= 66}
            class:medium={chosen.riskScore >= 35 && chosen.riskScore < 66}
            >{band(chosen.riskScore)}</span
          >
        </div>
        <strong>{chosen.riskScore}<small>/100</small></strong>
      </div>
      <div class="risk-track">
        <i
          style={`transform:scaleX(${chosen.riskScore / 100});background:var(--${chosen.riskScore >= 66 ? 'red' : chosen.riskScore >= 35 ? 'amber' : 'muted'})`}
        ></i>
      </div>
      <div class="inspector-metrics">
        <div>
          <strong>{value(resource(chosen.instanceId, 'cpu'), '%')}</strong><small>CPU</small>
        </div>
        <div>
          <strong>{value(resource(chosen.instanceId, 'memMb'))}</strong><small>RAM, MB</small>
        </div>
        <div><strong>{chosenEvents.length}</strong><small>events</small></div>
      </div>
      {#if latest}<div class="finding">
          <small
            ><Icon name="file" />{latest.sensitive ? 'Needs review' : 'Latest observation'} · {new Date(
              latest.timestamp,
            ).toLocaleTimeString()}</small
          ><button
            class="text-link"
            onclick={() => inspect('File observation', latest as unknown as RecordData)}
            >{latest.file.split(/[/\\]/).pop()}</button
          >
          <p>{latest.action ?? 'File observation'}</p>
        </div>
        <p class="attribution">
          Attribution: {String(latest.attribution?.status ?? 'unavailable')}. {latest.attribution
            ?.status === 'confirmed'
            ? 'See observation details for evidence.'
            : 'A specific process action is unconfirmed.'}
        </p>{:else}<p class="muted">No retained file observations for this instance.</p>{/if}
      <dl>
        <dt>Behaviour anomaly</dt>
        <dd>{chosen.anomalyScore}/100</dd>
        <dt>Working directory</dt>
        <dd>{chosen.cwd ?? 'Unavailable'}</dd>
      </dl>
      <div class="toolbar">
        <button class="button" onclick={openChosen}>Process details</button>{#if latest}<button
            class="button"
            onclick={() => inspect('File observation', latest as unknown as RecordData)}
            >Review event</button
          >{/if}
      </div>
    {:else}<div class="radar-no-selection">
        <Icon name="agents" />
        <h3>Select an instance</h3>
        <p>
          Choose a radar marker or an activity card to inspect its observations and available
          actions.
        </p>
      </div>{/if}
  </section>
</div>

<style>
  .overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(240px, 24vw, 300px);
    gap: 12px;
    margin-bottom: 12px;
  }
  .overview-grid > .panel {
    margin-top: 0;
  }
  .radar-panel {
    display: flex;
    flex-direction: column;
    height: calc(640px + (var(--ui-scale) - 1) * 340px);
  }
  .radar-body {
    flex: 1;
    min-height: 0;
    container-type: inline-size;
  }
  .radar-workspace {
    height: 100%;
    display: grid;
    grid-template-rows: minmax(240px, 1fr) auto;
  }
  .radar-stage {
    min-height: 0;
    container-type: size;
  }
  .radar-dial {
    width: min(300px, calc(100cqh - 72px), calc(100cqw - 120px));
    height: min(300px, calc(100cqh - 72px), calc(100cqw - 120px));
    pointer-events: none;
  }
  .dial-sweep {
    animation: sweep 9s linear infinite;
  }
  .stale .dial-sweep {
    animation-play-state: paused;
  }
  .radar-empty {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .radar-coordinate {
    left: 12px;
    top: 7px;
    font-size: calc(10px * var(--ui-scale));
  }
  .bearing {
    font-size: 9px;
  }
  .radar-point {
    pointer-events: auto;
    position: absolute;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--bg);
    transform: translate(-14px, -50%);
    text-align: left;
    white-space: nowrap;
  }
  .radar-point.label-left {
    flex-direction: row-reverse;
    text-align: right;
    transform: translate(calc(-100% + 14px), -50%);
  }
  .radar-point strong,
  .radar-point small {
    display: block;
    font-size: calc(10px * var(--ui-scale));
  }
  .radar-point small {
    color: var(--muted);
  }
  .radar-point[aria-pressed='true'],
  .radar-agent-title[aria-pressed='true'] {
    background: var(--selection);
    border-color: var(--selection-border);
  }
  .radar-point.dense span {
    display: none;
  }
  .radar-point.dense:hover span,
  .radar-point.dense:focus span {
    display: block;
  }
  .radar-message {
    position: absolute;
    bottom: 12px;
    width: 100%;
    text-align: center;
    pointer-events: none;
    font-size: 12px;
  }
  .radar-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 300px;
    overflow: auto;
    background: var(--panel);
    border-top: 1px solid var(--border);
  }
  .radar-agent-card {
    min-width: 0;
    padding: 12px 10px;
    border-bottom: 1px solid var(--border);
  }
  .radar-agent-card:nth-child(even) {
    border-left: 1px solid var(--border);
  }
  .radar-agent-title {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: calc(11px * var(--ui-scale));
    text-align: left;
  }
  .radar-agent-title > span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .radar-agent-metrics {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px;
    color: var(--muted);
    margin-top: 8px;
    font-size: calc(10px * var(--ui-scale));
  }
  .radar-agent-metrics b {
    color: var(--ink);
  }
  .radar-mini-chart {
    width: 100%;
    padding: 6px 0 0;
    color: var(--muted);
    text-align: left;
  }
  .radar-mini-chart svg {
    display: block;
    width: 100%;
    height: 24px;
  }
  .radar-mini-chart rect {
    fill: currentColor;
    opacity: 0.65;
  }
  .radar-mini-chart small,
  .radar-agent-foot {
    font-size: calc(10px * var(--ui-scale));
  }
  .radar-agent-foot {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
  }
  .layer-resources {
    position: absolute;
    inset: auto 12px 8px;
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .layer-resources button {
    max-width: 48%;
  }
  .layer-resources span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .radar-bottom {
    flex-wrap: wrap;
    padding: 8px 12px;
  }
  .inspector {
    padding: 12px;
    height: calc(640px + (var(--ui-scale) - 1) * 340px);
    overflow: auto;
    background: var(--inspector);
  }
  .inspector-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 10px;
    margin-bottom: 16px;
    font-size: calc(11px * var(--ui-scale));
    color: var(--muted);
  }
  .agent-identity {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .agent-identity small {
    display: block;
    color: var(--muted);
    margin-top: 4px;
  }
  .inspector-risk {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .inspector-risk small {
    display: block;
    color: var(--muted);
  }
  .inspector-risk strong {
    font-size: 20px;
  }
  .inspector-risk strong small {
    display: inline;
  }
  .risk-track {
    height: 3px;
    background: var(--border);
    margin: 8px 0 14px;
  }
  .risk-track i {
    display: block;
    height: 100%;
    transform-origin: left;
  }
  .inspector-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }
  .inspector-metrics strong,
  .inspector-metrics small {
    display: block;
  }
  .inspector-metrics small {
    color: var(--muted);
  }
  .finding {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
  }
  .finding small {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .finding p,
  .attribution {
    font-size: calc(11px * var(--ui-scale));
    color: var(--muted);
    margin: 8px 0;
  }
  dl {
    font-size: calc(11px * var(--ui-scale));
  }
  dt {
    color: var(--muted);
    margin-top: 10px;
  }
  dd {
    margin: 3px 0 0;
    overflow-wrap: anywhere;
  }
  .radar-no-selection {
    margin: 28px 0;
    color: var(--muted);
  }
  .radar-no-selection h3 {
    margin: 14px 0 8px;
    color: var(--ink);
  }
  .radar-no-selection p {
    font-size: calc(12px * var(--ui-scale));
  }
  @container (min-width: 760px) {
    .radar-workspace {
      grid-template-columns: minmax(180px, 1fr) minmax(360px, 2fr);
      grid-template-rows: 1fr;
    }
    .radar-cards {
      grid-template-columns: 1fr;
      max-height: none;
      border-top: 0;
      border-left: 1px solid var(--border);
    }
    .radar-agent-card:nth-child(even) {
      border-left: 0;
    }
  }
  @media (max-width: 950px) {
    .overview-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .inspector {
      height: auto;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dial-sweep {
      animation: none;
    }
  }
  @keyframes sweep {
    to {
      transform: rotate(360deg);
    }
  }
</style>
