<script lang="ts">
  import { tick } from 'svelte';
  import { instances, type Host, type Telemetry, type RecordData } from '../runtime/host';
  import { scopeEvidence, type AgentScope } from '../runtime/agent-scope';
  import { radarGroups, groupRecord, riskBand } from '../runtime/radar';
  import { riskContext } from '../runtime/risk-context';
  import AgentLogo from './AgentLogo.svelte';
  import AgentPerformance from './AgentPerformance.svelte';
  import AgentEvidence from './AgentEvidence.svelte';
  import AgentProcesses from './AgentProcesses.svelte';
  import RiskExplanation from './RiskExplanation.svelte';
  import DetailSummary from './DetailSummary.svelte';
  import DetailControls from './DetailControls.svelte';
  let {
    telemetry,
    liveTelemetry,
    host,
    scope,
    change,
    inspect,
    navigate,
    paused = false,
    visible = true,
    sectionRequest,
  }: {
    telemetry: Telemetry;
    liveTelemetry: Telemetry;
    host: Host | null;
    scope: AgentScope;
    change: (_scope: AgentScope) => void;
    inspect: (_title: string, _row: RecordData) => void;
    navigate: (_view: string) => void | Promise<void>;
    paused?: boolean;
    visible?: boolean;
    sectionRequest?: { id: string; revision: number };
  } = $props();
  let all = $derived(instances(telemetry));
  let group = $derived(radarGroups(all).find((row) => row.key === scope.agent));
  let process = $derived(
    scope.instanceId
      ? all.find((row) => row.instanceId === scope.instanceId && row.agent === scope.agent)
      : undefined,
  );
  let subject = $derived<RecordData>(
    scope.instanceId
      ? process
        ? { ...process }
        : { agent: scope.agent, instanceId: scope.instanceId }
      : group
        ? groupRecord(group)
        : { agentGroupKey: scope.agent, name: scope.agent },
  );
  let riskSubject = $derived<RecordData>(
    scope.instanceId ? { agent: scope.agent, instanceId: scope.instanceId } : subject,
  );
  let risk = $derived(riskContext(riskSubject, telemetry));
  let workerCount = $derived(group?.members.filter((row) => row.pid > 0).length ?? 0);
  let files = $derived(
    scopeEvidence(telemetry.events as unknown as RecordData[], telemetry, scope),
  );
  let connections = $derived(
    scopeEvidence(telemetry.network as unknown as RecordData[], telemetry, scope),
  );
  let absent = $derived(scope.instanceId ? !process : !group);
  let riskOpen = $state(false);
  let lastRequest = -1;
  let shell: HTMLElement;
  async function jump(id: string, scroll = true) {
    if (id === 'risk') riskOpen = true;
    await tick();
    const node = shell?.querySelector<HTMLElement>('#agent-' + id);
    if (scroll) node?.scrollIntoView({ block: 'start' });
    node?.focus({ preventScroll: true });
  }
  $effect(() => {
    if (visible && sectionRequest && sectionRequest.revision !== lastRequest) {
      lastRequest = sectionRequest.revision;
      void jump(sectionRequest.id, sectionRequest.id !== 'overview');
    }
  });
</script>

<div class="agent-workspace" bind:this={shell}>
  <section id="agent-overview" tabindex="-1" class="agent-intro" aria-label="Agent overview">
    <AgentLogo name={scope.agent} size={34} />
    <div class="agent-description">
      <h2>{scope.instanceId ? 'Process overview' : 'Agent overview'}</h2>
      <p>
        {scope.instanceId
          ? 'PID ' + String(process?.pid ?? scope.instanceId.split(':')[0])
          : String(workerCount) + (workerCount === 1 ? ' worker process' : ' worker processes')} · {paused
          ? 'View paused'
          : telemetry.stale
            ? 'Last reliable observation'
            : absent
              ? 'Not currently observed'
              : 'Observed now'}
      </p>
    </div>
    <button class="button" onclick={() => navigate('stats')}>Detailed statistics</button>
  </section>
  <nav class="agent-jumps" aria-label="Agent sections">
    <button onclick={() => jump('risk')}>Risk</button>
    <button onclick={() => jump('resources')}>Resources</button>
    <button onclick={() => jump('activity')}
      >Activity <span>{files.length + connections.length}</span></button
    >
    <button onclick={() => jump('processes')}>Processes</button>
  </nav>
  {#if absent}<p class="notice" role="status">
      This selection is no longer observed. Its retained activity stays visible; AEGIS will not
      switch to another process with the same PID.
    </p>{/if}
  <section id="agent-risk" tabindex="-1" class="agent-risk panel" aria-label="Selected agent risk">
    <details bind:open={riskOpen}>
      <summary
        ><span class="risk-heading"
          >Observed risk <strong class={risk.score === null ? '' : riskBand(risk.score)}
            >{risk.score ?? '—'}<small>/100</small></strong
          ></span
        >
        <span class="risk-reason"
          >{!risk.subject
            ? 'Current assessment unavailable'
            : !risk.subject.instanceId
              ? 'Process identity not recorded'
              : (risk.contributions[0]?.label ?? 'No scored activity')}<small
            >{scope.instanceId ? 'This process' : 'Highest process score'} · Expand explanation</small
          ></span
        >
      </summary>
      <div class="risk-content">
        <RiskExplanation row={riskSubject} {telemetry} navigate={inspect} />
      </div>
    </details>
  </section>
  <div class="agent-live-grid">
    <section id="agent-resources" tabindex="-1" aria-label="Selected agent resources">
      <AgentPerformance {telemetry} {scope} {paused} />
    </section>
    <section
      id="agent-activity"
      tabindex="-1"
      class="agent-activity"
      aria-label="Selected agent activity"
    >
      <AgentEvidence
        agents={all as unknown as RecordData[]}
        rows={files}
        {inspect}
        more={() => navigate('events')}
      />
      <AgentEvidence
        agents={all as unknown as RecordData[]}
        rows={connections}
        network
        {inspect}
        more={() => navigate('network')}
      />
    </section>
  </div>
  <section id="agent-processes" tabindex="-1">
    <AgentProcesses {telemetry} {scope} {change} />
  </section>
  {#if process}
    <details class="process-information panel">
      <summary>Process attributes and controls</summary>
      <div class="process-information-body">
        <DetailSummary row={subject} {telemetry} section="attributes" />
        {#key scope.instanceId}<DetailControls
            row={subject}
            telemetry={liveTelemetry}
            {host}
          />{/key}
      </div>
    </details>
  {/if}
</div>

<style>
  .agent-workspace {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .agent-intro {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .agent-description {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-section);
  }
  .agent-description p {
    color: var(--muted);
    margin: 5px 0 0;
    font-size: var(--text-body);
  }
  .agent-jumps {
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .agent-jumps button {
    background: transparent;
    border: 1px solid transparent;
    color: var(--ink);
    min-height: var(--control-height);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--control-radius);
    font-size: var(--text-body);
  }
  .agent-jumps button:hover {
    background: var(--hover);
  }
  .agent-jumps span {
    color: var(--muted);
    margin-left: 5px;
  }
  section[id] {
    scroll-margin-top: calc(var(--workspace-sticky-offset, 70px) + 12px);
    outline-offset: 4px;
  }
  summary {
    cursor: pointer;
    padding: var(--panel-inset);
  }
  .agent-risk summary {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 30px;
    align-items: center;
  }
  .risk-heading {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-body);
  }
  .risk-heading strong {
    font-size: var(--text-metric);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .risk-heading small {
    font-size: var(--text-caption);
    color: var(--muted);
  }
  .risk-reason {
    font-size: var(--text-body);
  }
  .risk-reason small {
    display: block;
    margin-top: 4px;
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .risk-content {
    border-top: 1px solid var(--border);
    padding: var(--panel-inset);
  }
  .agent-live-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .agent-activity {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .process-information summary {
    font-size: var(--text-body);
    font-weight: 600;
  }
  .process-information-body {
    display: grid;
    gap: var(--space-4);
    padding: var(--panel-inset);
    border-top: 1px solid var(--border);
  }
  @media (max-width: 1150px) {
    .agent-live-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .agent-activity {
      grid-template-columns: minmax(0, 1fr);
    }
    .agent-intro {
      flex-wrap: wrap;
    }
  }
</style>
