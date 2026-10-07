<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../runtime/i18n';

  import { instances, type Host, type Telemetry, type RecordData } from '../runtime/host';
  import { scopeEvidence, type AgentScope } from '../runtime/agent-scope';
  import { radarGroups, groupRecord, riskBand } from '../runtime/radar';
  import { riskContext } from '../runtime/risk-context';
  import AgentLogo from './AgentLogo.svelte';
  import AgentContextSummary from './AgentContextSummary.svelte';
  import AgentPerformance from './AgentPerformance.svelte';
  import AgentEvidence from './AgentEvidence.svelte';
  import AgentProcesses from './AgentProcesses.svelte';
  import RiskExplanation from './RiskExplanation.svelte';
  import DetailSummary from './DetailSummary.svelte';
  import DetailControls from './DetailControls.svelte';
  import SimpleAgentView from './SimpleAgentView.svelte';
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
    advanced = true,
    sectionRequest,
    openInterfaceSettings,
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
    advanced?: boolean;
    sectionRequest?: { id: string; revision: number };
    openInterfaceSettings?: () => void | Promise<void>;
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
  // Keep a visited composition mounted so changing mode preserves its filters.
  let simpleMounted = $state(untrack(() => !advanced));
  let advancedMounted = $state(untrack(() => advanced));
  $effect(() => {
    if (advanced) advancedMounted = true;
    else simpleMounted = true;
  });

  let lastRequest = -1;
  function selectSection(id: string) {
    if (!visible || !advanced) return;
    // Overview navigation restores scroll and focuses its heading in App.
    if (!['risk', 'resources', 'activity', 'processes', 'process-controls'].includes(id)) return;
    const panel = document.getElementById(prefix + '-panel-' + id);
    if (!panel?.isConnected || panel.closest('[hidden], [inert]')) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView?.({ block: 'nearest' });
  }
  $effect(() => {
    if (visible && advanced && sectionRequest && sectionRequest.revision !== lastRequest) {
      lastRequest = sectionRequest.revision;
      selectSection(sectionRequest.id);
    }
  });
</script>

<div class="agent-workspace">
  <section id="agent-overview" tabindex="-1" class="agent-intro" aria-label={$t('Agent overview')}>
    <AgentLogo name={scope.agent} size={34} />
    <div class="agent-description">
      <h2 id="agent-workspace-heading" tabindex="-1">
        {scope.instanceId ? $t('Process overview') : $t('Agent overview')}
      </h2>
      <p>
        {scope.instanceId
          ? $t('PID') + ' ' + String(process?.pid ?? scope.instanceId.split(':')[0])
          : String(workerCount) +
            ' ' +
            $t(workerCount === 1 ? 'worker process' : 'worker processes')} · {paused
          ? $t('View paused')
          : telemetry.stale
            ? $t('Last reliable observation')
            : absent
              ? $t('Not currently observed')
              : $t('Observed now')}
      </p>
    </div>
    {#if advanced}<button class="button" onclick={() => navigate('stats')}
        ><Icon name="chart" />{$t('Detailed statistics')}</button
      >{/if}
  </section>
  {#if absent}<p class="notice" role="status">
      {$t(
        'This selection is no longer observed. Its retained activity stays visible; AEGIS will not switch to another process with the same PID.',
      )}
    </p>{/if}
  {#if simpleMounted}<div hidden={advanced}>
      <SimpleAgentView
        {telemetry}
        {liveTelemetry}
        {host}
        {scope}
        {subject}
        {riskSubject}
        {inspect}
        {navigate}
        {openInterfaceSettings}
        {paused}
        visible={visible && !advanced}
      />
    </div>{/if}
  {#if advancedMounted}<div hidden={!advanced} class="advanced-agent-view">
      <AgentContextSummary
        {telemetry}
        {scope}
        {files}
        {connections}
        {workerCount}
        processObserved={!!process}
        section="risk"
        {prefix}
        select={selectSection}
        {paused}
        continuous
      />
      <div class="agent-columns">
        <div class="agent-main-column">
          <section
            id={prefix + '-panel-activity'}
            aria-labelledby={prefix + '-heading-activity'}
            tabindex="-1"
            class="agent-activity"
          >
            <h3 id={prefix + '-heading-activity'} class="section-title">
              <Icon name="activity" />{$t('Activity')}
            </h3>
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
          <section
            id={prefix + '-panel-resources'}
            aria-labelledby={prefix + '-heading-resources'}
            tabindex="-1"
            class="agent-resources panel"
          >
            <h3 id={prefix + '-heading-resources'} class="section-title">
              <Icon name="chart" />{$t('Resources')}
            </h3>
            <AgentPerformance {telemetry} {scope} paused={paused || !advanced || !visible} />
          </section>
          <section
            id={prefix + '-panel-processes'}
            aria-label={$t('Processes')}
            tabindex="-1"
            class="agent-process-panel"
          >
            <AgentProcesses {telemetry} {scope} {change} />
          </section>
        </div>
        <aside class="agent-context-column" aria-label={$t('Agent details')}>
          <section
            id={prefix + '-panel-risk'}
            aria-label={$t('Observed risk')}
            tabindex="-1"
            class="agent-risk panel"
          >
            <div class="risk-panel-head">
              <h3 id={prefix + '-heading-risk'} class="risk-heading">
                <Icon name="shield" />{$t('Observed risk')}
                <strong class={risk.score === null ? '' : riskBand(risk.score)}
                  >{risk.score ?? '—'}<small>/100</small></strong
                >
              </h3>
              <span class="risk-reason"
                >{!risk.subject
                  ? $t('Current assessment unavailable')
                  : !risk.subject.instanceId
                    ? $t('Process identity not recorded')
                    : (risk.contributions[0]?.label ?? $t('No scored activity'))}<small
                  >{scope.instanceId ? $t('This process') : $t('Highest process score')}</small
                ></span
              >
            </div>
          </section>
          <section
            id={prefix + '-panel-process-controls'}
            class="process-information panel"
            aria-labelledby={prefix + '-heading-controls'}
            tabindex="-1"
          >
            <h3 id={prefix + '-heading-controls'} class="section-title">
              <Icon name="cpu" />{$t('Process attributes and controls')}
            </h3>
            <div class="process-information-body">
              {#if process}
                {#key scope.instanceId}<DetailControls
                    row={subject}
                    telemetry={liveTelemetry}
                    {host}
                  />{/key}
              {:else}<p class="entity-note">
                  {$t('Choose a worker process to pause, resume or stop.')}
                </p>{/if}
            </div>
          </section>
          <section class="risk-content panel" aria-label={$t('Why this score')}>
            <RiskExplanation
              row={riskSubject}
              {telemetry}
              navigate={inspect}
              showAssessment={false}
            />
          </section>
          {#if process}<section class="process-attributes panel" aria-label={$t('Attributes')}>
              <DetailSummary row={subject} {telemetry} section="attributes" />
            </section>{/if}
        </aside>
      </div>
    </div>{/if}
</div>

<style>
  .agent-workspace {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .agent-workspace > :global(.agent-context) {
    margin-bottom: 0;
  }
  .advanced-agent-view:not([hidden]) {
    display: grid;
    gap: var(--space-4);
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
    margin: var(--space-1) 0 0;
    font-size: var(--text-body);
  }
  .agent-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 0.62fr);
    gap: var(--space-4);
    align-items: start;
  }
  .agent-main-column,
  .agent-context-column {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .agent-context-column {
    padding: var(--panel-inset);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--raised);
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-body);
    font-weight: 600;
  }
  .agent-resources {
    padding: var(--panel-inset);
    display: grid;
    gap: var(--space-3);
    container-type: inline-size;
  }
  .agent-columns section {
    min-width: 0;
    scroll-margin-block: var(--space-4);
    outline-offset: 4px;
  }
  .agent-process-panel {
    display: grid;
    gap: var(--space-4);
  }
  .risk-panel-head {
    display: grid;
    gap: var(--space-2);
    padding: var(--panel-inset);
  }
  .risk-heading {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-body);
    margin: 0;
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
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--text-body);
    font-weight: 600;
  }
  .risk-reason small {
    display: block;
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .risk-content {
    padding: var(--panel-inset);
  }
  .process-attributes {
    padding: var(--panel-inset);
  }
  .risk-content > :global(.detail-section),
  .process-attributes > :global(.detail-section) {
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
  }
  .agent-activity {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .process-information > .section-title {
    padding: var(--panel-inset);
    font-size: var(--text-body);
    font-weight: 600;
  }
  .process-information-body {
    display: grid;
    gap: var(--space-4);
    padding: var(--panel-inset);
    border-top: 1px solid var(--border);
  }
  .process-information-body > :global(.detail-section) {
    margin-block: 0;
  }
  @media (max-width: 1150px) {
    .agent-intro {
      flex-wrap: wrap;
    }
  }
  @container (max-width: 540px) {
    .agent-resources :global(.monitor) {
      grid-template-columns: minmax(0, 1fr);
    }
    .agent-resources :global(.metric-rail) {
      flex-direction: row;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .agent-resources :global(.metric-rail button) {
      flex: 0 0 110px;
    }
    .agent-resources :global(.monitor-detail) {
      padding: var(--space-3);
    }
  }
  @media (max-width: 760px) {
    .agent-columns {
      grid-template-columns: minmax(0, 1fr);
    }
    .agent-context-column {
      grid-row: 1;
    }
  }
</style>
