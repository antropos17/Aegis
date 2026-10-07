<script lang="ts">
  import { t } from '../runtime/i18n';
  import { instances, type Host, type RecordData, type Telemetry } from '../runtime/host';
  import type { AgentScope } from '../runtime/agent-scope';
  import { riskContext } from '../runtime/risk-context';
  import { riskBand } from '../runtime/radar';
  import { scopeStatistics } from '../runtime/statistics-scope';
  import { completeStatisticsTotal, statisticsValue } from '../runtime/statistics-metrics';
  import Events from './Events.svelte';
  import RiskExplanation from './RiskExplanation.svelte';
  import DetailControls from './DetailControls.svelte';
  import Icon from './Icon.svelte';

  let {
    telemetry,
    liveTelemetry,
    host,
    scope,
    subject,
    riskSubject,
    inspect,
    navigate,
    openInterfaceSettings,
    paused = false,
    visible = true,
  }: {
    telemetry: Telemetry;
    liveTelemetry: Telemetry;
    host: Host | null;
    scope: AgentScope;
    subject: RecordData;
    riskSubject: RecordData;
    inspect: (_title: string, _row: RecordData) => void;
    navigate: (_view: string) => void | Promise<void>;
    openInterfaceSettings?: () => void | Promise<void>;
    paused?: boolean;
    visible?: boolean;
  } = $props();
  const prefix = $props.id();
  const risk = $derived(riskContext(riskSubject, telemetry));
  const workers = $derived(
    instances(telemetry).filter((row) => row.agent === scope.agent && row.pid > 0),
  );
  const process = $derived(workers.find((row) => row.instanceId === scope.instanceId));
  const resources = $derived(scopeStatistics(telemetry, scope));
  const cpu = $derived(completeStatisticsTotal(resources, resources.resources, 'cpu'));
  const memory = $derived(completeStatisticsTotal(resources, resources.resources, 'memMb'));
</script>

<div class="simple-agent-view">
  <div class="activity-column">
    <section class="agent-live-activity" aria-label={$t('Agent activity')}>
      <h3><Icon name="activity" />{$t('Recent activity')}</h3>
      <Events
        {telemetry}
        {scope}
        {inspect}
        combined
        advanced={false}
        showPause={false}
        viewPaused={paused}
        {visible}
      />
    </section>
    <div class="extra-tools">
      <button class="text-button" onclick={() => navigate('stats')}
        ><Icon name="chart" />{$t('Detailed statistics')}</button
      >
      <button
        class="text-button"
        onclick={() => (openInterfaceSettings ? openInterfaceSettings() : navigate('settings'))}
        >{$t('More tools in Advanced mode')}</button
      >
    </div>
  </div>
  <aside class="context-column" aria-label={$t('Agent details')}>
    <section class="panel agent-status" aria-labelledby={prefix + '-risk'}>
      <div class="status-summary">
        <div>
          <h3 id={prefix + '-risk'}>{$t('Observed risk')}</h3>
          <p class="risk-value">
            <strong class={risk.score === null ? '' : riskBand(risk.score)}
              >{risk.score ?? '—'}</strong
            ><span>/100</span>
          </p>
          <p class="risk-reason">
            {!risk.subject
              ? $t('Current assessment unavailable')
              : !risk.subject.instanceId
                ? $t('Process identity not recorded')
                : risk.contributions[0]?.label
                  ? $t(risk.contributions[0].label)
                  : $t('No scored activity')}
          </p>
          <p class="muted">
            {scope.instanceId
              ? $t('This process')
              : $t('Highest process score')}{#if risk.subject?.pid}
              · {$t('PID')} {String(risk.subject.pid)}{/if}
          </p>
        </div>
        <dl class="readings">
          <div>
            <dt>{$t('CPU')}</dt>
            <dd>{statisticsValue(cpu, '%')}</dd>
          </div>
          <div>
            <dt>{$t('RAM')}</dt>
            <dd>{statisticsValue(memory, 'MB')}</dd>
          </div>
        </dl>
      </div>
      <section class="risk-explanation-section" aria-label={$t('Why this score?')}>
        <h3>{$t('Why this score?')}</h3>
        <RiskExplanation row={riskSubject} {telemetry} navigate={inspect} />
      </section>
    </section>

    <section class="process-actions" aria-label={$t('Process actions')}>
      {#if process && scope.instanceId}
        {#key scope.instanceId}<DetailControls
            row={subject}
            telemetry={liveTelemetry}
            {host}
            simple
          />{/key}
      {:else}<div class="panel process-choice">
          <h3>{$t('Process controls')}</h3>
          <p class="muted">{$t('Choose a worker process to pause, resume or stop.')}</p>
        </div>{/if}
    </section>
  </aside>
</div>

<style>
  .simple-agent-view {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 0.62fr);
    gap: var(--space-4);
    min-width: 0;
    align-items: start;
  }
  .activity-column,
  .context-column {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .context-column {
    padding: var(--panel-inset);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--raised);
  }
  .agent-status,
  .process-choice {
    padding: var(--panel-inset);
  }
  .status-summary {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: var(--space-4);
  }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .risk-value {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    font-variant-numeric: tabular-nums;
  }
  .risk-value strong {
    font-size: calc(28px * var(--ui-scale));
  }
  .risk-value span,
  .muted {
    color: var(--muted);
  }
  .risk-reason {
    font-weight: 600;
  }
  .readings {
    display: flex;
    gap: var(--space-4);
    margin: 0;
  }
  .readings dt {
    color: var(--muted);
  }
  .readings dd {
    margin: var(--space-1) 0 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .risk-explanation-section {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--strong-border);
    display: grid;
    gap: var(--space-2);
  }
  .process-actions {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .agent-live-activity {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .extra-tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  @media (max-width: 760px) {
    .simple-agent-view {
      grid-template-columns: minmax(0, 1fr);
    }
    .context-column {
      grid-row: 1;
    }
    .status-summary {
      flex-wrap: wrap;
    }
  }
</style>
