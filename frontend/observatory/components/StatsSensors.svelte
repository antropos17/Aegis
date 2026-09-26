<script lang="ts">
  import { t } from '../runtime/i18n';

  import { record, records, type Telemetry, type RecordData } from '../runtime/host';
  import { statisticsValue } from '../runtime/statistics-metrics';
  import { fieldLabel } from '../runtime/detail-fields';
  import Icon from './Icon.svelte';
  const sensorPresentation: Record<string, { title: string; description: string; icon: string }> = {
    process: {
      title: 'Agent processes',
      description: 'Finds running agents and process identities.',
      icon: 'cpu',
    },
    'fs-chokidar': {
      title: 'File changes',
      description: 'Watches configured folders for file activity.',
      icon: 'folder',
    },
    'fs-handle': {
      title: 'Open files',
      description: 'Checks which processes hold files open.',
      icon: 'fileSearch',
    },
    'fs-rm': {
      title: 'Windows file owners',
      description: 'Uses Resource Manager to attribute open files.',
      icon: 'folderSearch',
    },
    network: {
      title: 'Network connections',
      description: 'Observes agent-owned TCP connections.',
      icon: 'network',
    },
    'ide-extension': {
      title: 'IDE extensions',
      description: 'Finds AI extensions in supported editors.',
      icon: 'fileCode',
    },
    wsl: {
      title: 'WSL agents',
      description: 'Finds agents inside Windows Subsystem for Linux.',
      icon: 'terminal',
    },
    'llm-lmstudio': {
      title: 'LM Studio',
      description: 'Checks for a local LM Studio runtime.',
      icon: 'server',
    },
    'llm-ollama': {
      title: 'Ollama',
      description: 'Checks for a local Ollama runtime.',
      icon: 'server',
    },
    'proc-snapshot': {
      title: 'Process snapshot',
      description: 'Collects process details for attribution.',
      icon: 'agents',
    },
    'etw-file': {
      title: 'Windows file events',
      description: 'Optional diagnostic file-event capture.',
      icon: 'activity',
    },
  };
  const detailLabels: Record<string, string> = {
    'rm-owns-observation': 'Resource Manager is handling this observation.',
    'diagnostic-opt-in-required': 'Optional diagnostic capture is off.',
    class5: 'Windows process snapshot provider is active.',
    'cim-fallback': 'Using a fallback process snapshot provider.',
    'windows-only': 'Available on Windows only.',
    'deployment-gates-pending': 'Diagnostic capture is unavailable in this build.',
  };
  function stateLabel(value: unknown, detail?: unknown): string {
    switch (value) {
      case 'HEALTHY':
        return 'Healthy';
      case 'DEGRADED':
        return 'Degraded';
      case 'FAILED':
        return 'Failed';
      case 'DISABLED':
        return 'Off';
      case 'UNSUPPORTED':
        return detail === 'rm-owns-observation' ? 'Covered elsewhere' : 'Unsupported';
      case 'STARTING':
        return 'Starting';
      case 'SENSORS_STARTING':
        return 'Sensors starting';
      default:
        return 'Unavailable';
    }
  }
  let { telemetry }: { telemetry: Telemetry } = $props();
  let health = $derived(record(telemetry.stats.appHealth));
  let sensors = $derived(
    Object.entries(record(record(health.sensors).byId)).map(
      ([id, value]): RecordData & { id: string } => ({
        id,
        ...record(value),
      }),
    ),
  );
  let unavailableGroups = $derived(records(record(health.watchPlan).unavailableGroups));
  function watchGroupLabel(id: unknown): string {
    switch (id) {
      case 'credential-dirs':
        return 'Credential directories';
      case 'agent-config-dirs':
        return 'Agent configuration directories';
      case 'project-dir':
        return 'Application directory';
      case 'env-files':
        return 'Home environment files';
      default:
        return 'Other file watch group';
    }
  }
  function watchStateLabel(state: unknown): string {
    switch (state) {
      case 'registration-failed':
        return 'Registration failed';
      case 'not-attempted':
        return 'Not attempted';
      case 'errored':
        return 'Watcher error';
      default:
        return 'Unavailable';
    }
  }
  function time(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? new Date(value).toLocaleTimeString()
      : 'Not observed';
  }
</script>

<section class="panel sensor-panel">
  <header>
    <div>
      <h3>{$t('Observation sensors')}</h3>
      <p>{$t('Raw sensor state and coverage. Display retention is tracked separately.')}</p>
    </div>
    <span class="badge">{$t(stateLabel(health.state))}</span>
  </header>
  {#if unavailableGroups.length > 0}
    <section class="watch-coverage" aria-labelledby="unavailable-watch-groups" aria-live="polite">
      <h4 id="unavailable-watch-groups">{$t('Unavailable file watch groups')}</h4>
      <p>{$t('File activity may be missed in these groups.')}</p>
      <ul>
        {#each unavailableGroups as group, index (index)}
          <li>
            <span>{$t(watchGroupLabel(group.id))}</span>
            <span class="watch-state">{$t(watchStateLabel(group.state))}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
  <div class="sensor-grid">
    {#each sensors as sensor (sensor.id)}
      {@const presentation = sensorPresentation[sensor.id] ?? {
        title: fieldLabel(sensor.id),
        description: 'Observation sensor',
        icon: 'activity',
      }}
      <article>
        <div class="sensor-heading">
          <span class="sensor-icon"><Icon name={presentation.icon} /></span>
          <div class="sensor-identity">
            <h4>{$t(presentation.title)}</h4>
            <p>{$t(presentation.description)}</p>
          </div>
          <span
            class="sensor-state"
            class:healthy={sensor.state === 'HEALTHY'}
            class:failed={sensor.state === 'FAILED'}
            >{$t(stateLabel(sensor.state, sensor.detail))}</span
          >
        </div>
        <dl>
          <div>
            <dt>{$t('Last success')}</dt>
            <dd>{$t(time(sensor.lastSuccessAt))}</dd>
          </div>
          <div>
            <dt>{$t('Failures')}</dt>
            <dd>
              {statisticsValue(
                typeof sensor.consecutiveFailures === 'number' ? sensor.consecutiveFailures : null,
              )}
            </dd>
          </div>
          <div>
            <dt>{$t('Observed loss')}</dt>
            <dd>
              {statisticsValue(typeof sensor.lossCount === 'number' ? sensor.lossCount : null)}
            </dd>
          </div>
        </dl>
        {#if sensor.detail || sensor.lastError}<p class="sensor-note">
            {$t(
              detailLabels[String(sensor.detail || sensor.lastError)] ??
                String(sensor.detail || sensor.lastError),
            )}
          </p>{/if}
      </article>
    {:else}<p class="muted">{$t('Sensor health has not been delivered yet.')}</p>{/each}
  </div>
</section>

<style>
  .sensor-panel {
    padding: 18px;
  }
  header {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: start;
    margin-bottom: 18px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 550;
  }
  header p {
    color: var(--muted);
    font-size: 11px;
    margin: 6px 0 0;
    line-height: 1.5;
  }
  .sensor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 12px;
  }
  .watch-coverage {
    border: 1px solid var(--amber);
    border-radius: 8px;
    background: var(--amber-bg);
    padding: 13px;
    margin-bottom: 12px;
  }
  .watch-coverage h4 {
    color: var(--amber);
  }
  .watch-coverage p {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
    margin: 6px 0 10px;
  }
  .watch-coverage ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .watch-coverage li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 7px 0;
    border-top: 1px solid var(--border);
    font-size: 11px;
  }
  .watch-state {
    color: var(--amber);
  }
  article {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--space-4);
    min-width: 0;
  }
  .sensor-heading {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: start;
  }
  .sensor-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
  }
  .sensor-identity {
    min-width: 0;
  }
  .sensor-identity p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.45;
  }
  h4 {
    font-size: calc(12px * var(--ui-scale));
    font-weight: 650;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .sensor-state {
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
  }
  .sensor-state.healthy {
    color: var(--green);
  }
  .sensor-state.failed {
    color: var(--red);
  }
  dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    margin: var(--space-4) 0 0;
  }
  dt {
    color: var(--muted);
    font-size: 10px;
  }
  dd {
    margin: 5px 0 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .sensor-note {
    margin: var(--space-3) 0 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
</style>
