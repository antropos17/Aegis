<script lang="ts">
  import { t } from '../runtime/i18n';
  import { onMount, onDestroy } from 'svelte';

  import { confirmed, invoke, type Host, type RecordData } from '../runtime/host';
  import SettingsGroup from './SettingsGroup.svelte';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  let {
    form = $bindable(),
    patterns = $bindable(),
    ignored = $bindable(),
    patternInput = $bindable(),
    intervalInput = $bindable(),
    validationId,
    host,
  }: {
    form: RecordData;
    patterns: string;
    ignored: string;
    patternInput: HTMLTextAreaElement | undefined;
    intervalInput?: HTMLInputElement;
    validationId?: string;
    host: Host | null;
  } = $props();
  const projectMessages: Record<string, string> = {
    LOADING: 'Checking saved project folder…',
    UNSELECTED: 'No external project folder is selected.',
    SELECTED: 'A project folder is selected. Check Monitoring for live coverage.',
    UNAVAILABLE:
      'The selected folder is unavailable or changed. Choose it again or clear the selection.',
    DIRECTORY_REFUSED:
      'Choose an ordinary local project folder. Home, system, app data and linked folders are unavailable.',
    STORE_UNAVAILABLE:
      'The private folder selection could not be saved. The previous selection is retained.',
    CANCELLED: 'Folder selection cancelled.',
    BUSY: 'Another folder selection is in progress.',
  };
  let project = $state({ code: 'LOADING', selected: false });
  let projectPending = $state(false),
    projectFailed = $state(false),
    projectAlive = true;
  const projectAvailable = $derived(typeof host?.controlProjectWatch === 'function');
  onMount(() => {
    if (projectAvailable) void performProject('status');
  });
  onDestroy(() => {
    projectAlive = false;
  });
  async function performProject(action: 'status' | 'select' | 'clear') {
    if (!projectAvailable || projectPending) return;
    projectPending = true;
    projectFailed = false;
    try {
      const result = confirmed(await invoke(host, 'controlProjectWatch', action));
      if (!projectAlive) return;
      const code =
        typeof result.code === 'string' && Object.hasOwn(projectMessages, result.code)
          ? result.code
          : 'STORE_UNAVAILABLE';
      project = { code, selected: result.selected === true };
      projectFailed = ['UNAVAILABLE', 'DIRECTORY_REFUSED', 'STORE_UNAVAILABLE'].includes(code);
    } catch {
      if (projectAlive) {
        projectFailed = true;
        project = { ...project, code: 'STORE_UNAVAILABLE' };
      }
    } finally {
      if (projectAlive) projectPending = false;
    }
  }
</script>

<SettingsGroup
  title={$t('Collection & notifications')}
  description={$t(
    'Control process scanning and desktop notifications. Changes apply after saving.',
  )}
>
  <label class="setting range"
    ><span
      >{$t('Scan interval')}
      <output
        >{Number.isFinite(Number(form.scanIntervalSec ?? 10))
          ? String(form.scanIntervalSec ?? 10) + ' s'
          : '\u2014'}</output
      ><small
        >{$t(
          'Shorter intervals update processes more often and use more resources. File and network sources have their own collection timing.',
        )}</small
      ></span
    ><input
      aria-label={$t('Scan interval (seconds)')}
      type="range"
      min="1"
      max={Math.max(60, Number(form.scanIntervalSec ?? 10))}
      step="1"
      value={Number(form.scanIntervalSec ?? 10)}
      oninput={(e) => (form.scanIntervalSec = Number(e.currentTarget.value))}
    /></label
  >
  <div class="setting">
    <span>{$t('Exact interval')}<small>{$t('Enter a positive number of seconds.')}</small></span>
    <input
      class="interval-number"
      bind:this={intervalInput}
      aria-describedby={!Number.isFinite(Number(form.scanIntervalSec ?? 10)) ||
      Number(form.scanIntervalSec ?? 10) <= 0
        ? validationId
        : undefined}
      aria-label={$t('Exact scan interval (seconds)')}
      aria-invalid={!Number.isFinite(Number(form.scanIntervalSec ?? 10)) ||
        Number(form.scanIntervalSec ?? 10) <= 0}
      type="number"
      min="1"
      step="1"
      value={Number(form.scanIntervalSec ?? 10)}
      oninput={(event) => (form.scanIntervalSec = event.currentTarget.valueAsNumber)}
    />
  </div>
  <div class="presets" role="group" aria-label={$t('Scan interval presets')}>
    {#each [1, 5, 10, 30] as seconds (seconds)}<button
        class="button"
        aria-pressed={Number(form.scanIntervalSec ?? 10) === seconds}
        onclick={() => (form.scanIntervalSec = seconds)}
        >{seconds} {$t('s')}{seconds === 10 ? $t(' (default)') : ''}</button
      >{/each}
  </div>
  <div class="setting">
    <label class="switch"
      ><input
        type="checkbox"
        checked={form.notificationsEnabled === true}
        onchange={(e) => (form.notificationsEnabled = e.currentTarget.checked)}
      />{$t('Notifications')}</label
    ><Action action={async () => confirmed(await invoke(host, 'testNotification'))}
      ><Icon name="bell" />{$t('Test')}</Action
    >
  </div>
  <p class="notification-scope">
    {$t(
      'This switch controls desktop popups. Sensitive activity review remains available in the app.',
    )}
  </p>
</SettingsGroup>
<SettingsGroup
  title={$t('File coverage')}
  description={$t(
    'Choose which directories the file watcher skips and which additional paths count as sensitive.',
  )}
>
  <div class="setting-stack">
    <span>{$t('Project folder')}</span>
    <small
      >{$t(
        'Choose one folder to observe project changes up to five levels deep. Existing exclusions apply. The private selection is restored after restart; file reads require a separate source.',
      )}</small
    >
    <div class="toolbar">
      <button
        class="button"
        aria-busy={projectPending}
        disabled={!projectAvailable || projectPending}
        onclick={() => performProject('select')}
        ><Icon name="folder" />{$t('Choose project folder')}</button
      >
      <button
        class="button"
        disabled={!projectAvailable || projectPending || !project.selected}
        onclick={() => performProject('clear')}>{$t('Clear project folder')}</button
      >
      <button
        class="button"
        disabled={!projectAvailable || projectPending}
        onclick={() => performProject('status')}>{$t('Refresh folder status')}</button
      >
    </div>
    <p role={projectFailed ? 'alert' : 'status'}>
      {$t(
        projectAvailable
          ? projectMessages[project.code]
          : 'Project folder selection requires the desktop connection.',
      )}
    </p>
  </div>
  <label class="setting"
    ><span
      >{$t('Exclude build folders')}<small
        >{$t('Skip common generated folders to reduce file-event noise.')}</small
      ></span
    ><input
      type="checkbox"
      aria-label={$t('Exclude build folders')}
      checked={form.ignoreCommonBuildDirs === true}
      onchange={(e) => (form.ignoreCommonBuildDirs = e.currentTarget.checked)}
    /></label
  >
  <label class="setting-stack"
    >{$t('Additional exclusions')}<textarea
      aria-label={$t('Additional exclusions')}
      rows="3"
      maxlength="10000"
      bind:value={ignored}></textarea><small
      >{$t('One directory path per line. Empty means no additional exclusions.')}</small
    ></label
  >
  <label class="setting-stack"
    >{$t('Sensitive paths')}<textarea
      bind:this={patternInput}
      aria-label={$t('Sensitive paths')}
      rows="3"
      maxlength="10000"
      bind:value={patterns}></textarea><small
      >{$t(
        'One regular expression per line. Adds sensitive-path matches; built-in rules remain active.',
      )}</small
    ></label
  >
</SettingsGroup>

<style>
  .interval-number {
    width: 110px;
    min-width: 0;
  }
  .notification-scope {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-caption);
  }
</style>
