<script lang="ts">
  import { t, language } from '../runtime/i18n';
  import type { Telemetry } from '../runtime/host';
  import { sensorCoverage, coverageTime } from '../runtime/sensor-coverage';
  let {
    telemetry,
    navigate,
    openSensorDetails,
    openProjectSettings = () => navigate('settings'),
    preview = false,
  }: {
    telemetry: Telemetry;
    navigate: (_view: string) => void;
    openSensorDetails: () => void;
    openProjectSettings?: () => void;
    preview?: boolean;
  } = $props();
  const id = $props.id();
  let model = $derived(sensorCoverage(telemetry));
  let metrics = $derived([
    ['Mode', model.mode],
    ['Provider health', model.provider],
    ['Provider lifecycle', model.phase],
    ['Provider detail', model.reason],
    ['Mode selection reason', model.modeReason],
    ['Process watch scope', model.watch],
    ['Directory scope', model.paths],
    ['Observed loss', model.loss],
    ['Accepted native events', model.accepted],
    ['Rejected native events', model.rejected],
    ['Restart attempts used', model.restarts],
    ['Restart attempts remaining', model.remaining],
    ['Last restart', coverageTime(model.lastRestartAt, $language)],
    ['Native event rate', 'Not reported'],
  ] as const);
</script>

<div class="coverage-workspace">
  <header>
    <div>
      <h2>{$t('Monitoring coverage')}</h2>
      <p>
        {$t('See what sensors report, where observations are missing and what remains unverified.')}
      </p>
    </div>
    <div class="toolbar">
      <button class="button" onclick={openSensorDetails}>{$t('Sensor statistics')}</button>
      <button class="button" onclick={() => navigate('action-control')}
        >{$t('Review action control')}</button
      >
    </div>
  </header>
  {#if preview}<p class="notice">{$t('Preview · simulated data')}</p>{/if}
  {#if telemetry.error}<p class="notice failure" role="alert">
      {$t('Coverage could not be refreshed. Any retained readings may be out of date.')}
    </p>
  {:else if !telemetry.ready}<p class="notice" role="status">{$t('Waiting for coverage data…')}</p>
  {:else if telemetry.stale}<p class="notice" role="status">
      {$t('Retained coverage readings. Current observation is unavailable.')}
    </p>{/if}
  <section class="panel coverage-summary" aria-labelledby={id + '-limits'}>
    <h3 id={id + '-limits'}>{$t('Coverage limits')}</h3>
    <dl class="summary-grid">
      <div>
        <dt>{$t('Action surfaces observed')}</dt>
        <dd>{$t('Not reported')}</dd>
      </div>
      <div>
        <dt>{$t('Blocking verified')}</dt>
        <dd>{$t('Not reported')}</dd>
      </div>
      <div>
        <dt>{$t('Native event delivery')}</dt>
        <dd>{$t(model.reported ? model.admission : 'Not reported')}</dd>
      </div>
    </dl>
    <p>
      {$t(
        'Sensor health describes observation. It does not verify action interception or blocking.',
      )}
    </p>
    <p class="muted">
      {$t(
        'This first coverage view includes reported sensor health. Action provenance, event rates and per-agent enforcement coverage are not reported by this data source.',
      )}
    </p>
  </section>
  <section class="panel" aria-labelledby={id + '-project'}>
    <header>
      <h3 id={id + '-project'}>{$t('Project changes')}</h3>
      <strong>{$t(model.project.paused ? 'Paused' : model.project.state)}</strong>
    </header>
    <p>{$t(model.project.detail)}</p>
    {#if model.project.paused}<p>
        {$t('Monitoring is paused. Watcher readiness does not mean events are being collected.')}
      </p>{/if}
    <button class="button" onclick={openProjectSettings}>{$t('Project folder settings')}</button>
  </section>
  <section class="panel" aria-labelledby={id + '-native'}>
    <header>
      <h3 id={id + '-native'}>{$t('Native platform sensor')}</h3>
      <span class="badge">{$t(model.platform)}</span>
    </header>
    {#if !model.reported}
      <p>
        {$t(
          model.unsupported
            ? 'The native platform sensor is unavailable on this host. Windows polling and optional Windows file capture are reported separately below.'
            : 'Native sensor status has not been delivered by this runtime.',
        )}
      </p>
    {:else}
      {#if model.paused}<p class="notice">{$t('Native sensor is paused.')}</p>{/if}
      {#if model.platform === 'macOS'}<p class="notice">
          {$t(
            'Native process identity is unavailable on macOS. A running provider does not establish agent coverage.',
          )}
        </p>{/if}
      {#if model.mode === 'Linux process polling'}<p class="notice">
          {$t(
            'Linux process polling is a reduced mode. Short-lived activity and file opens may be missed.',
          )}
        </p>{/if}
      {#if model.mode === 'Linux fanotify'}<p class="notice">
          {$t('Linux fanotify is a reduced mode. Native event delivery remains unqualified.')}
        </p>{/if}
      <dl class="metrics">
        {#each metrics as [label, value] (label)}
          <div>
            <dt>{$t(label)}</dt>
            <dd>{typeof value === 'number' ? value : $t(value ?? 'Not reported')}</dd>
          </div>
        {/each}
      </dl>
      <h4>{$t('Native event surfaces')}</h4>
      <dl class="surfaces">
        {#each model.surfaces as surface (surface.key)}<div>
            <dt>{$t(surface.label)}</dt>
            <dd>{$t(surface.state)}</dd>
          </div>{/each}
      </dl>
      <p class="muted">
        {$t(
          'Restart counters describe the current retry budget. They are not a lifetime restart total.',
        )}
      </p>
    {/if}
  </section>
  <section class="panel" aria-labelledby={id + '-host'}>
    <h3 id={id + '-host'}>{$t('Host observation sensors')}</h3>
    <p>
      {$t('Polling, file watchers and optional capture keep their own health and loss readings.')}
    </p>
    <div class="sensor-list">
      {#each model.sensors as sensor (sensor.id)}
        <article>
          <header>
            <h4>{$t(sensor.title)}</h4>
            <strong class:failure={sensor.state === 'Failed'}>{$t(sensor.state)}</strong>
          </header>
          <dl class="metrics">
            <div>
              <dt>{$t('Observed loss')}</dt>
              <dd>{sensor.loss ?? $t('Not reported')}</dd>
            </div>
            <div>
              <dt>{$t('Failures')}</dt>
              <dd>{sensor.failures ?? $t('Not reported')}</dd>
            </div>
            <div>
              <dt>{$t('Last success')}</dt>
              <dd>{$t(coverageTime(sensor.lastSuccessAt, $language))}</dd>
            </div>
            <div>
              <dt>{$t('Event rate')}</dt>
              <dd>{$t('Not reported')}</dd>
            </div>
          </dl>
          {#if sensor.detail !== 'Not reported'}<p>{$t(sensor.detail)}</p>{/if}
        </article>
      {:else}<p class="muted">{$t('Sensor health has not been delivered yet.')}</p>{/each}
    </div>
  </section>
  <section class="panel" aria-labelledby={id + '-agents'}>
    <h3 id={id + '-agents'}>{$t('Per-agent coverage')}</h3>
    <p>
      {$t(
        'A reported process identity helps match observations. It does not prove native sensor coverage or blocking.',
      )}
    </p>
    <ul class="agent-list">
      {#each model.agents as agent (agent.instanceId || agent)}
        <li>
          <div><strong>{agent.agent}</strong> · {$t('PID')} {agent.pid}</div>
          <dl class="metrics">
            <div>
              <dt>{$t('Process identity')}</dt>
              <dd>
                {$t(
                  agent.instanceId && agent.instanceIdSource === 'os'
                    ? 'OS identity reported'
                    : 'OS identity not reported',
                )}
              </dd>
            </div>
            <div>
              <dt>{$t('Action surfaces observed')}</dt>
              <dd>{$t('Not reported')}</dd>
            </div>
            <div>
              <dt>{$t('Blocking verified')}</dt>
              <dd>{$t('Not reported')}</dd>
            </div>
          </dl>
        </li>
      {:else}<li>
          {$t(
            telemetry.stale
              ? 'Agent coverage is unavailable while observation is stale.'
              : 'No agent process coverage has been reported.',
          )}
        </li>{/each}
    </ul>
  </section>
</div>

<style>
  .coverage-workspace {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    color: var(--ink);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: start;
    justify-content: space-between;
  }
  header > div {
    min-width: 0;
  }
  h2,
  h3,
  h4,
  p {
    margin: 0;
  }
  h2,
  h3 {
    font-size: var(--text-section);
  }
  h4 {
    font-size: var(--text-body);
  }
  p {
    line-height: 1.6;
  }
  .panel {
    padding: var(--panel-inset);
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    white-space: normal;
    max-width: 100%;
    margin: 0;
    min-height: var(--control-height);
  }
  .muted,
  dt {
    color: var(--muted);
  }
  dl {
    margin: 0;
  }
  dd {
    margin: var(--space-1) 0 0;
    font-variant-numeric: tabular-nums;
  }
  .summary-grid,
  .metrics,
  .surfaces {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
  }
  .summary-grid dd {
    font-weight: 600;
  }
  .surfaces {
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }
  .notice {
    font-size: var(--text-body);
    padding: var(--space-3);
    border: 1px solid var(--strong-border);
    border-left: 3px solid var(--amber);
    border-radius: var(--control-radius);
    background: var(--amber-bg);
  }
  .failure {
    color: var(--red);
  }
  p.failure {
    color: var(--ink);
    border-left-color: var(--red);
  }
  .sensor-list,
  .agent-list {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  article,
  .agent-list li {
    display: grid;
    gap: var(--space-3);
    padding-block: var(--space-3);
    border-top: 1px solid var(--border);
  }
  strong,
  dd,
  p,
  dt {
    overflow-wrap: anywhere;
  }
</style>
