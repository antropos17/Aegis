<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import { instances, type Host, type RecordData, type Telemetry } from '../runtime/host';
  import { isScopedProcess, type AgentScope } from '../runtime/agent-scope';
  import { riskContext } from '../runtime/risk-context';
  import { riskBand } from '../runtime/radar';
  import { scopeStatistics } from '../runtime/statistics-scope';
  import { completeStatisticsTotal, statisticsValue } from '../runtime/statistics-metrics';
  import AgentLogo from './AgentLogo.svelte';
  import DetailControls from './DetailControls.svelte';
  import RiskExplanation from './RiskExplanation.svelte';

  let {
    telemetry,
    liveTelemetry,
    host,
    scope,
    change,
    inspect,
    paused = false,
  }: {
    telemetry: Telemetry;
    liveTelemetry: Telemetry;
    host: Host | null;
    scope: AgentScope;
    change: (_scope: AgentScope) => void;
    inspect: (_title: string, _row: RecordData) => void;
    paused?: boolean;
  } = $props();
  const workers = $derived(
    instances(telemetry).filter((row) => row.agent === scope.agent && isScopedProcess(row)),
  );
  const process = $derived(workers.find((row) => row.instanceId === scope.instanceId));
  const liveProcess = $derived(
    liveTelemetry.agents.find(
      (row) => row.agent === scope.agent && row.instanceId === scope.instanceId,
    ),
  );
  const selectedKey = $derived(JSON.stringify([scope.agent, scope.instanceId]));
  let retained = $state<{ key: string; row: RecordData } | null>(null);
  $effect(() => {
    const key = selectedKey;
    const observed = process;
    untrack(() => {
      if (observed) retained = { key, row: { ...observed } };
      else if (retained?.key !== key) retained = null;
    });
  });
  const selected = $derived<RecordData | undefined>(
    process ? { ...process } : retained?.key === selectedKey ? retained.row : undefined,
  );
  const riskSubject = $derived<RecordData>(
    scope.instanceId
      ? { agent: scope.agent, instanceId: scope.instanceId }
      : { agentGroupKey: scope.agent, name: scope.agent },
  );
  const risk = $derived(riskContext(riskSubject, telemetry));
  const resources = $derived(scopeStatistics(telemetry, scope));
  const cpu = $derived(completeStatisticsTotal(resources, resources.resources, 'cpu'));
  const memory = $derived(completeStatisticsTotal(resources, resources.resources, 'memMb'));
  const assessedProcess = $derived(
    !liveTelemetry.stale && typeof risk.subject?.instanceId === 'string'
      ? liveTelemetry.agents.find(
          (row) =>
            row.agent === scope.agent &&
            row.instanceId === risk.subject?.instanceId &&
            isScopedProcess(row) &&
            row.generationWitness === risk.subject?.generationWitness &&
            row.generationWitnessSource === risk.subject?.generationWitnessSource,
        )
      : undefined,
  );
  const observedState = $derived(
    paused
      ? 'View paused'
      : !telemetry.ready
        ? 'Waiting for observed agents'
        : telemetry.stale || liveTelemetry.stale || liveProcess?.discoveryObservation?.stale
          ? 'Last reliable observation'
          : scope.instanceId
            ? liveProcess
              ? 'Observed now'
              : 'Not currently observed'
            : workers.length || !scope.agent
              ? 'Observed now'
              : 'Not currently observed',
  );
  const reason = $derived(
    !risk.subject
      ? 'Current assessment unavailable'
      : !risk.subject.instanceId
        ? 'Process identity not recorded'
        : (risk.contributions[0]?.label ?? 'No scored activity'),
  );
  function workerLabel(row: RecordData) {
    return `${$t('PID')} ${String(row.pid ?? '—')} · ${String(row.cwd || row.path || $t('Project unavailable'))} · ${String(row.process || $t('Process'))}`;
  }
  function choose(id: string) {
    if (!id || workers.some((row) => row.instanceId === id))
      change({ agent: scope.agent, instanceId: id });
  }
  function chooseAssessed() {
    if (assessedProcess?.instanceId)
      change({ agent: scope.agent, instanceId: assessedProcess.instanceId });
  }
</script>

<section class="investigation-header" aria-label={$t('Agent investigation')}>
  <div class="identity-row">
    {#if scope.agent}<AgentLogo name={scope.agent} size={26} />{/if}
    <div class="identity">
      <h2>{scope.agent || $t('All agents')}</h2>
      {#if scope.agent}<p class="project">
          {scope.instanceId
            ? String(selected?.cwd || selected?.path || $t('Project unavailable'))
            : `${workers.length} ${$t(workers.length === 1 ? 'worker process' : 'worker processes')}`}
        </p>{/if}
    </div>
    <span class="badge observed-state">{$t(observedState)}</span>
  </div>
  {#if scope.agent}
    <label class="worker-choice">
      <span>{$t('Worker process')}</span>
      <select value={scope.instanceId} onchange={(event) => choose(event.currentTarget.value)}>
        <option value="">{$t('All worker processes')}</option>
        {#if scope.instanceId && !process}<option value={scope.instanceId}
            >{$t('Not currently observed')} · {selected
              ? workerLabel(selected)
              : scope.instanceId}</option
          >{/if}
        {#each workers as worker (worker.instanceId)}<option value={worker.instanceId}
            >{workerLabel(worker as unknown as RecordData)}</option
          >{/each}
      </select>
    </label>
    <section class="risk-controls" aria-label={$t('Observed risk and process controls')}>
      <div class="risk-summary">
        <div class="risk-line">
          <h3>{$t('Observed risk')}</h3>
          <strong class={risk.score === null ? '' : riskBand(risk.score)}
            >{risk.score ?? '—'}<small>/100</small></strong
          >
        </div>
        <p class="risk-reason">{$t(reason)}</p>
        <p class="risk-scope">
          <span>{scope.instanceId ? $t('This process') : $t('Highest process score')}</span>
          {#if risk.subject?.pid}
            · {$t('PID')} {String(risk.subject.pid)}{/if}
        </p>
        {#if !scope.instanceId && risk.subject?.instanceId}<button
            class="text-button"
            disabled={!assessedProcess}
            onclick={chooseAssessed}>{$t('Select assessed process')}</button
          >{/if}
      </div>
      <dl class="resource-readings">
        <div>
          <dt>{$t('CPU')}</dt>
          <dd>{statisticsValue(cpu, '%')}</dd>
        </div>
        <div>
          <dt>{$t('RAM')}</dt>
          <dd>{statisticsValue(memory, 'MB')}</dd>
        </div>
      </dl>
      {#if scope.instanceId}<div class="process-controls">
          {#key selectedKey}<DetailControls
              row={selected ?? { agent: scope.agent, instanceId: scope.instanceId }}
              telemetry={liveTelemetry}
              {host}
              simple
              compact
            />{/key}
        </div>{:else}<p class="control-choice">
          {$t('Choose a worker process to pause, resume or stop.')}
        </p>{/if}
    </section>
    <section class="risk-details" aria-label={$t('Why this score?')}>
      <h3>{$t('Why this score?')}</h3>
      <RiskExplanation row={riskSubject} {telemetry} navigate={inspect} />
    </section>
  {/if}
</section>

<style>
  .investigation-header {
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--raised);
  }
  .identity-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .identity {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: var(--text-body);
  }
  h3 {
    font-size: var(--text-caption);
    color: var(--muted);
  }
  .project,
  .risk-scope,
  .control-choice,
  .worker-choice > span {
    color: var(--muted);
    font-size: var(--text-caption);
    overflow-wrap: anywhere;
  }
  .worker-choice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-block: var(--space-2);
    min-width: 0;
  }
  .worker-choice select {
    width: auto;
    flex: 1;
    min-width: 0;
    max-width: 100%;
  }
  .risk-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-2) var(--space-4);
    min-width: 0;
  }
  .risk-summary {
    flex: 1 1 12em;
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1) var(--space-2);
  }
  .risk-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
  .risk-line strong {
    font-size: var(--text-body);
    font-variant-numeric: tabular-nums;
  }
  .risk-line small {
    font-size: var(--text-caption);
    color: var(--muted);
    margin-left: var(--space-1);
  }
  .risk-reason {
    grid-column: 1 / -1;
    grid-row: 2;
    font-size: var(--text-body);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .risk-scope {
    grid-column: 2;
    grid-row: 1;
    align-self: baseline;
    justify-self: end;
  }
  .risk-summary .text-button {
    grid-column: 1 / -1;
    margin-top: var(--space-1);
  }
  .low {
    color: var(--green);
  }
  .medium {
    color: var(--amber);
  }
  .high {
    color: var(--red);
  }
  .resource-readings {
    display: flex;
    gap: var(--space-3);
    margin: 0;
  }
  .resource-readings dt {
    font-size: var(--text-caption);
    color: var(--muted);
  }
  .resource-readings dd {
    font-size: var(--text-body);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    margin: 0;
  }
  .process-controls {
    min-width: 0;
    max-width: 100%;
  }
  .control-choice {
    flex: 1 1 14em;
  }
  .risk-details {
    margin-top: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--strong-border);
    font-size: var(--text-caption);
    display: grid;
    gap: var(--space-2);
  }
  @media (max-width: 980px) {
    .investigation-header {
      padding: var(--space-2);
    }
  }
  .risk-details > h3 {
    color: var(--ink);
    font-weight: 600;
  }
  .observed-state {
    white-space: normal;
  }
</style>
