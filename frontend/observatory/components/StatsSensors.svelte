<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../runtime/i18n';

  import { measured, record, records, type Telemetry, type RecordData } from '../runtime/host';
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
      title: 'WSL guest processes',
      description: 'Guest-process detection is unavailable during passive WSL observation.',
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
    'wsl-process-coverage-unavailable':
      'Automatic guest-process checks are off to avoid starting stopped WSL distributions.',
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
        if (detail === 'rm-owns-observation') return 'Covered elsewhere';
        return detail === 'wsl-process-coverage-unavailable' ? 'Not inspected' : 'Unsupported';
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
  let skippedProcessTicks = $derived(
    measured(record(telemetry.stats.scanCadence).skippedProcessTicks),
  );
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
  function displayableDistroName(name: string): boolean {
    return [...name].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 && !(code >= 0x202a && code <= 0x202e);
    });
  }
  function runningDistroNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const names: unknown[] = value;
    return [
      ...new Set(
        names.filter(
          (name): name is string =>
            typeof name === 'string' &&
            name.length > 0 &&
            name.length <= 256 &&
            displayableDistroName(name),
        ),
      ),
    ].slice(0, 128);
  }
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  function wslInventoryState(status: unknown, stale: boolean, observedAt: unknown): string {
    if (stale && typeof observedAt === 'number' && Number.isFinite(observedAt)) return 'Retained';
    if (status === 'ready' && !stale) return 'Observed';
    if (status === 'pending') return 'Pending';
    return 'Unavailable';
  }
  let wslInventory = $derived(record(telemetry.stats.wslInventory));
  let runningDistros = $derived(runningDistroNames(wslInventory.distributions));
  let wslInventoryStale = $derived.by(() => {
    const observedAt = wslInventory.observedAt;
    if (wslInventory.stale === true || typeof observedAt !== 'number') return true;
    const age = Math.max(now, Date.now()) - observedAt;
    return !Number.isFinite(age) || age < 0 || age >= 90000;
  });
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
  <section class="wsl-inventory" aria-labelledby="running-wsl-distributions">
    <div class="wsl-heading">
      <div>
        <h4 id="running-wsl-distributions">{$t('Running WSL distributions')}</h4>
        <p>{$t('Host-side inventory only. Agent processes inside WSL are not inspected.')}</p>
      </div>
      <span class="sensor-state"
        >{$t(
          wslInventoryState(wslInventory.status, wslInventoryStale, wslInventory.observedAt),
        )}</span
      >
    </div>
    {#if runningDistros.length > 0}
      <ul>
        {#each runningDistros as distro (distro)}<li>{distro}</li>{/each}
      </ul>
      {#if typeof wslInventory.observedAt === 'number'}
        <p>{$t('Last observed')}: {time(wslInventory.observedAt)}</p>
      {/if}
    {:else if wslInventory.status === 'ready' && !wslInventoryStale && Array.isArray(wslInventory.distributions) && wslInventory.distributions.length === 0}
      <p>{$t('No running WSL distributions observed.')}</p>
    {:else if wslInventory.status === 'pending'}
      <p>{$t('Waiting for WSL inventory.')}</p>
    {:else}
      <p>{$t('Running WSL state is unknown.')}</p>
    {/if}
  </section>
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
        {#if sensor.id === 'process' && skippedProcessTicks !== null && skippedProcessTicks > 0}
          <p class="sensor-note">
            {$t('Process scan intervals skipped in this app session: {count}. Last at {time}.', {
              count: skippedProcessTicks,
              time: time(record(telemetry.stats.scanCadence).lastSkippedAt),
            })}
            {$t('Agent changes may have appeared late during those overruns.')}
          </p>
        {/if}
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
    padding: var(--panel-inset);
  }
  header {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
    align-items: start;
    margin-bottom: var(--space-4);
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 550;
  }
  header p {
    color: var(--muted);
    font-size: 11px;
    margin: var(--space-1) 0 0;
    line-height: 1.5;
  }
  .sensor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: var(--space-3);
  }
  .watch-coverage {
    border: 1px solid var(--amber);
    border-radius: 8px;
    background: var(--amber-bg);
    padding: var(--panel-inset);
    margin-bottom: var(--space-3);
  }
  .watch-coverage h4 {
    color: var(--amber);
  }
  .watch-coverage p {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
    margin: var(--space-1) 0 var(--space-3);
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
    gap: var(--space-1) var(--space-3);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--border);
    font-size: 11px;
  }
  .watch-state {
    color: var(--amber);
  }
  .wsl-inventory {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .wsl-heading {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    align-items: start;
  }
  .wsl-inventory p {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
    margin: var(--space-1) 0 0;
  }
  .wsl-inventory ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
  }
  .wsl-inventory li {
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: var(--space-1) var(--space-2);
    font-size: 11px;
    overflow-wrap: anywhere;
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
    margin: var(--space-1) 0 0;
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
