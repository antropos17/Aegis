<script lang="ts">
  import { t } from '../runtime/i18n';

  import SectionTabs from './SectionTabs.svelte';
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
  const prefix = $props.id();
  let section = $state('risk');
  let riskOpen = $state(true);
  let tabs = $derived([
    { id: 'risk', label: 'Risk' },
    { id: 'resources', label: 'Resources' },
    { id: 'activity', label: 'Activity', count: files.length + connections.length },
    { id: 'processes', label: 'Processes' },
  ]);
  let lastRequest = -1;
  function selectSection(id: string) {
    section = tabs.some((tab) => tab.id === id) ? id : 'risk';
    if (section === 'risk') riskOpen = true;
  }
  $effect(() => {
    if (visible && sectionRequest && sectionRequest.revision !== lastRequest) {
      lastRequest = sectionRequest.revision;
      selectSection(sectionRequest.id);
    }
  });
</script>

<div class="agent-workspace">
  <section id="agent-overview" tabindex="-1" class="agent-intro" aria-label={$t('Agent overview')}>
    <AgentLogo name={scope.agent} size={34} />
    <div class="agent-description">
      <h2>{scope.instanceId ? $t('Process overview') : $t('Agent overview')}</h2>
      <p>
        {scope.instanceId
          ? 'PID ' + String(process?.pid ?? scope.instanceId.split(':')[0])
          : String(workerCount) + (workerCount === 1 ? ' worker process' : ' worker processes')} · {paused
          ? $t('View paused')
          : telemetry.stale
            ? $t('Last reliable observation')
            : absent
              ? $t('Not currently observed')
              : $t('Observed now')}
      </p>
    </div>
    <button class="button" onclick={() => navigate('stats')}>{$t('Detailed statistics')}</button>
  </section>
  <SectionTabs
    {tabs}
    selected={section}
    change={selectSection}
    {prefix}
    label={$t('Agent sections')}
  />
  {#if absent}<p class="notice" role="status">
      {$t(
        'This selection is no longer observed. Its retained activity stays visible; AEGIS will not switch to another process with the same PID.',
      )}
    </p>{/if}
  <div
    id={prefix + '-panel-risk'}
    role="tabpanel"
    aria-labelledby={prefix + '-tab-risk'}
    tabindex="0"
    hidden={section !== 'risk'}
    class="agent-risk panel"
  >
    <details bind:open={riskOpen}>
      <summary
        ><span class="risk-heading"
          >{$t('Observed risk')}
          <strong class={risk.score === null ? '' : riskBand(risk.score)}
            >{risk.score ?? '—'}<small>/100</small></strong
          ></span
        >
        <span class="risk-reason"
          >{!risk.subject
            ? $t('Current assessment unavailable')
            : !risk.subject.instanceId
              ? $t('Process identity not recorded')
              : (risk.contributions[0]?.label ?? $t('No scored activity'))}<small
            >{scope.instanceId ? $t('This process') : $t('Highest process score')} · {riskOpen
              ? $t('Collapse explanation')
              : $t('Expand explanation')}</small
          ></span
        >
      </summary>
      <div class="risk-content">
        <RiskExplanation row={riskSubject} {telemetry} navigate={inspect} />
      </div>
    </details>
  </div>
  <div
    id={prefix + '-panel-resources'}
    role="tabpanel"
    aria-labelledby={prefix + '-tab-resources'}
    tabindex="0"
    hidden={section !== 'resources'}
  >
    <AgentPerformance {telemetry} {scope} {paused} />
  </div>
  <div
    id={prefix + '-panel-activity'}
    role="tabpanel"
    aria-labelledby={prefix + '-tab-activity'}
    tabindex="0"
    hidden={section !== 'activity'}
    class="agent-activity"
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
  </div>
  <div
    id={prefix + '-panel-processes'}
    role="tabpanel"
    aria-labelledby={prefix + '-tab-processes'}
    tabindex="0"
    hidden={section !== 'processes'}
    class="agent-process-panel"
  >
    <AgentProcesses {telemetry} {scope} {change} />
    {#if process}
      <details class="process-information panel">
        <summary>{$t('Process attributes and controls')}</summary>
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
  [role='tabpanel'][hidden] {
    display: none;
  }
  [role='tabpanel'] {
    min-width: 0;
    outline-offset: 4px;
  }
  .agent-process-panel {
    display: grid;
    gap: var(--space-4);
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
    .agent-activity {
      grid-template-columns: minmax(0, 1fr);
    }
    .agent-intro {
      flex-wrap: wrap;
    }
  }
</style>
