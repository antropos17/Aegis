<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick, untrack } from 'svelte';
  import { confirmed, invoke, record, type Host, type RecordData } from '../runtime/host';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsAppearance from './SettingsAppearance.svelte';
  import SettingsMonitoring from './SettingsMonitoring.svelte';
  import SectionTabs from './SectionTabs.svelte';
  const id = $props.id();
  const tabs = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'desktop', label: 'Desktop & updates' },
    { id: 'data', label: 'Data & help' },
  ];
  let section = $state('appearance');
  let baseline = $state('');
  function snapshot(): string {
    return JSON.stringify({ form, patterns, ignored, contrast, motion });
  }
  let {
    host,
    appearance,
    navigate,
    currentTheme = null,
    sectionRequest,
    onSettingsSaved,
  }: {
    host: Host | null;
    appearance: (dark: boolean, scale: number, contrast?: boolean) => void;
    navigate: (view: string) => void;
    currentTheme?: string | null;
    sectionRequest?: { id: string; revision: number };
    onSettingsSaved?: (_settings: RecordData) => void;
  } = $props();
  $effect(() => {
    if (sectionRequest && tabs.some((tab) => tab.id === sectionRequest.id)) {
      void sectionRequest.revision;
      section = sectionRequest.id;
    }
  });
  let form = $state<RecordData>({});
  let loaded = $state(false);
  let mutation = $state<'save' | 'replace' | null>(null);
  let error = $state('');
  let refreshWarning = $state('');
  let updates = $state<RecordData>({});
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let motion = $state(localStorage.getItem('aegis-motion') !== 'reduce');
  let patterns = $state('');
  let ignored = $state('');
  let patternInput = $state<HTMLTextAreaElement>();
  let dirty = $derived(loaded && baseline !== snapshot());
  let validation = $derived(
    !loaded
      ? ''
      : !Number.isFinite(Number(form.scanIntervalSec ?? 10)) ||
          Number(form.scanIntervalSec ?? 10) <= 0
        ? 'Scan interval must be a positive number of seconds.'
        : !Number.isFinite(Number(form.uiScale ?? 1)) ||
            Number(form.uiScale ?? 1) < 0.5 ||
            Number(form.uiScale ?? 1) > 3
          ? 'Interface scale must be between 50% and 300%.'
          : '',
  );
  const updateLabels: Record<string, string> = {
    idle: 'Ready to check for updates',
    checking: 'Checking for updates...',
    available: 'An update is available',
    'up-to-date': 'You are up to date',
    downloading: 'Downloading update...',
    ready: 'Update ready to install',
    installing: 'Installing update...',
    unsupported: 'Automatic updates are unavailable in this build',
    error: 'Update could not be completed',
  };
  const startupHelp: Record<string, string> = {
    startMinimized: 'Open in the system tray instead of showing the window.',
    autoStartWithWindows: 'Launch AEGIS when you sign in to Windows.',
    hardwareAcceleration:
      'Use the GPU to draw the interface. Restart AEGIS after changing this setting.',
  };
  let alive = true;
  let previousTheme: string | null = null;
  $effect(() => {
    if (loaded && currentTheme && currentTheme !== previousTheme) {
      const clean = untrack(() => baseline === snapshot());
      previousTheme = currentTheme;
      form.darkMode = currentTheme.startsWith('dark');
      contrast = currentTheme.endsWith('-hc');
      if (clean) baseline = untrack(snapshot);
    }
  });
  async function load() {
    const settings = record(await invoke(host, 'getSettings'));
    if (!alive) return;
    // The provider key never enters the generic settings form or history.
    const { anthropicApiKey: _key, ...safe } = settings;
    const editable = ['darkMode', 'uiScale', 'scanIntervalSec', ...toggles.map(([key]) => key)];
    form = Object.fromEntries(editable.map((key) => [key, safe[key]]));
    const theme = localStorage.getItem('aegis-theme');
    if (theme) form.darkMode = theme.startsWith('dark');
    patterns = Array.isArray(safe.customSensitivePatterns)
      ? safe.customSensitivePatterns.join('\n')
      : '';
    ignored = Array.isArray(safe.ignoredDirectories) ? safe.ignoredDirectories.join('\n') : '';
    contrast = localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false;
    motion = localStorage.getItem('aegis-motion') !== 'reduce';
    loaded = true;
    baseline = snapshot();
    return settings;
  }
  function lines(value: string): string[] {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  function publishSettings(settings: RecordData) {
    const keys = ['darkMode', 'uiScale', 'scanIntervalSec', ...toggles.map(([key]) => key)];
    onSettingsSaved?.(Object.fromEntries(keys.map((key) => [key, settings[key]])));
  }
  async function save() {
    if (mutation) throw new Error('A settings operation is already in progress');
    if (validation) throw new Error(validation);
    mutation = 'save';
    refreshWarning = '';
    const submitted = { form: { ...form }, patterns, ignored, contrast, motion };
    const previous = JSON.parse(baseline) as typeof submitted;
    const themeChanged =
      submitted.form.darkMode !== previous.form.darkMode ||
      submitted.contrast !== previous.contrast;
    const scaleChanged = submitted.form.uiScale !== previous.form.uiScale;
    const motionChanged = submitted.motion !== previous.motion;
    const preview = {
      theme: document.documentElement.dataset.theme,
      scale: document.documentElement.style.getPropertyValue('--ui-scale'),
      motion: document.documentElement.dataset.motion,
    };
    const patch: RecordData = Object.fromEntries(
      Object.entries(submitted.form).filter(([key, value]) => value !== previous.form[key]),
    );
    if (JSON.stringify(lines(submitted.patterns)) !== JSON.stringify(lines(previous.patterns)))
      patch.customSensitivePatterns = lines(submitted.patterns);
    if (JSON.stringify(lines(submitted.ignored)) !== JSON.stringify(lines(previous.ignored)))
      patch.ignoredDirectories = lines(submitted.ignored);
    try {
      confirmed(await invoke(host, 'saveSettings', patch, { patch: true }));
      if (!alive) return;
      baseline = JSON.stringify(submitted);
      const savedTheme =
        (submitted.form.darkMode ? 'dark' : 'light') + (submitted.contrast ? '-hc' : '');
      if (themeChanged) localStorage.setItem('aegis-theme', savedTheme);
      if (
        (themeChanged || scaleChanged) &&
        form.darkMode === submitted.form.darkMode &&
        form.uiScale === submitted.form.uiScale &&
        contrast === submitted.contrast &&
        document.documentElement.dataset.theme === preview.theme &&
        document.documentElement.style.getPropertyValue('--ui-scale') === preview.scale
      ) {
        // A combined appearance callback must keep the other window's unchanged fields.
        const theme = themeChanged
          ? savedTheme
          : (preview.theme ?? localStorage.getItem('aegis-theme') ?? savedTheme);
        appearance(
          theme.startsWith('dark'),
          Number(
            scaleChanged ? submitted.form.uiScale : preview.scale || submitted.form.uiScale || 1,
          ),
          theme.endsWith('-hc'),
        );
      }
      if (motionChanged) {
        localStorage.setItem('aegis-motion', submitted.motion ? 'full' : 'reduce');
        if (
          motion === submitted.motion &&
          document.documentElement.dataset.motion === preview.motion
        )
          document.documentElement.dataset.motion = submitted.motion ? 'full' : 'reduce';
      }
      try {
        const saved = record(await invoke(host, 'getSettings'));
        if (alive) publishSettings(saved);
      } catch {
        if (alive)
          refreshWarning =
            'Settings saved. Could not refresh the current settings; reload AEGIS to retry.';
      }
    } catch (cause) {
      if (alive && cause instanceof Error && /pattern|regex/i.test(cause.message)) {
        section = 'monitoring';
        await tick();
        patternInput?.focus({ preventScroll: true });
      }
      throw cause;
    } finally {
      if (alive) mutation = null;
    }
  }
  async function replaceSettings(importing = false) {
    if (mutation) throw new Error('A settings operation is already in progress');
    mutation = 'replace';
    try {
      if (importing) confirmed(await invoke(host, 'importConfig'));
      const saved = await load();
      if (!alive || !saved) return;
      appearance(form.darkMode === true, Number(form.uiScale ?? 1), contrast);
      document.documentElement.dataset.motion = motion ? 'full' : 'reduce';
      refreshWarning = '';
      if (importing) publishSettings(saved);
    } finally {
      if (alive) mutation = null;
    }
  }
  onMount(() => {
    load().catch((e) => {
      if (alive) error = String(e);
    });
    let revision = 0;
    const cleanup = host?.onUpdateStatus
      ? Reflect.apply(host.onUpdateStatus, host, [
          (value: unknown) => {
            revision++;
            if (alive) updates = record(value);
          },
        ])
      : undefined;
    invoke(host, 'getUpdateStatus')
      .then((value) => {
        if (alive && revision === 0) updates = record(value);
      })
      .catch(() => {
        if (alive)
          updates = { status: 'error', error: 'Could not read update status. Try checking again.' };
      });
    return () => {
      alive = false;
      if (typeof cleanup === 'function') cleanup();
    };
  });
  async function update(method: string) {
    const result = record(await invoke(host, method));
    if (alive) updates = result;
    if (result.status === 'error') throw new Error(String(result.error));
  }
  const toggles = [
    ['notificationsEnabled', 'Desktop notifications'],
    ['ignoreCommonBuildDirs', 'Ignore common build directories'],
    ['startMinimized', 'Start minimized'],
    ['autoStartWithWindows', 'Start with Windows'],
    ['hardwareAcceleration', 'Hardware acceleration (restart required)'],
    ['automaticUpdatesEnabled', 'Check for updates automatically'],
  ] as const;
</script>

{#if error}<div class="notice">
    <p role="alert">{error}</p>
    <Action
      action={async () => {
        await load();
        if (alive) error = '';
      }}>{$t('Retry loading')}</Action
    >
  </div>{/if}
{#if refreshWarning}<p role="status" class="notice">{refreshWarning}</p>{/if}
<div class="settings-workspace panel">
  <div class="settings-intro">
    <div>
      <h2>{$t('Application preferences')}</h2>
      <p>{$t('Configure this workstation. Your draft stays here when you switch sections.')}</p>
    </div>
    <span class="badge">{$t('Local settings')}</span>
  </div>
  <SectionTabs
    {tabs}
    selected={section}
    prefix={id}
    label={$t('Settings sections')}
    change={(value) => {
      section = value;
    }}
  />
  <fieldset class="settings-layout" disabled={!loaded || mutation === 'replace'}>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-appearance'}
      aria-labelledby={id + '-tab-appearance'}
      hidden={section !== 'appearance'}
    >
      <SettingsAppearance bind:form bind:contrast bind:motion />
    </div>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-monitoring'}
      aria-labelledby={id + '-tab-monitoring'}
      hidden={section !== 'monitoring'}
    >
      <SettingsMonitoring bind:form bind:patterns bind:ignored bind:patternInput {host} />
    </div>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-desktop'}
      aria-labelledby={id + '-tab-desktop'}
      hidden={section !== 'desktop'}
    >
      <SettingsGroup
        title={$t('Desktop startup')}
        description={$t('Choose how AEGIS starts and renders its interface.')}
      >
        {#each toggles.slice(2, 5) as [key, label] (key)}<label class="setting"
            ><span>{$t(label)}<small>{$t(startupHelp[key])}</small></span><input
              type="checkbox"
              aria-label={$t(label)}
              checked={form[key] === true}
              onchange={(e) => (form[key] = e.currentTarget.checked)}
            /></label
          >{/each}
      </SettingsGroup>
      <SettingsGroup
        title={$t('Updates')}
        description={$t('Check for releases and choose when to install them.')}
      >
        <label class="setting"
          ><span
            >{$t('Check automatically')}<small
              >{$t('Look for available releases in the background.')}</small
            ></span
          ><input
            type="checkbox"
            checked={form.automaticUpdatesEnabled === true}
            onchange={(e) => (form.automaticUpdatesEnabled = e.currentTarget.checked)}
          /></label
        >
        <p class="muted" role="status">
          {$t(updateLabels[String(updates.status)] ?? 'Update status unavailable')}
          {String(updates.version ?? '')}
        </p>
        {#if updates.notes}<p class="muted">{String(updates.notes)}</p>{/if}{#if updates.error}<p
            role="alert"
          >
            {String(updates.error)}
          </p>{/if}{#if updates.status === 'downloading'}<progress
            max="100"
            value={Number(updates.progress ?? 0)}
          ></progress>{/if}
        <div class="toolbar">
          <Action
            disabled={['checking', 'downloading', 'installing', 'unsupported'].includes(
              String(updates.status),
            )}
            action={() => update('checkForUpdates')}
            ><Icon name="refresh" />{$t('Check for updates')}</Action
          >{#if updates.status === 'available'}<Action action={() => update('downloadUpdate')}
              >{$t('Download update')}</Action
            >{/if}{#if updates.status === 'ready'}<Action action={() => update('installUpdate')}
              >{$t('Install and restart')}</Action
            >{/if}
        </div>
      </SettingsGroup>
    </div>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-data'}
      aria-labelledby={id + '-tab-data'}
      hidden={section !== 'data'}
    >
      <SettingsGroup
        title={$t('Anthropic analysis')}
        description={$t(
          'Manage the provider connection and analysis options in their dedicated workspace.',
        )}
      >
        <p class="muted">
          {$t(
            'Connect Anthropic, review evidence and customize reports in the AI analysis workspace.',
          )}
        </p>
        <div class="toolbar">
          <button class="button" onclick={() => navigate('analysis')}
            ><Icon name="shield" />{$t('Open AI analysis')}</button
          >
        </div>
      </SettingsGroup>
      <SettingsGroup
        title={$t('Configuration')}
        description={$t('Back up saved preferences or restore them from a configuration file.')}
      >
        <p class="muted">
          {$t(
            'Export contains saved settings without the API key. Import replaces saved preferences and the current draft; imported values are validated.',
          )}
        </p>
        <div class="toolbar">
          <Action action={async () => confirmed(await invoke(host, 'exportConfig'))}
            ><Icon name="download" />{$t('Export')}</Action
          ><Action disabled={mutation !== null} action={() => replaceSettings(true)}
            ><Icon name="upload" />{$t('Import')}</Action
          >
        </div>
      </SettingsGroup>
      <SettingsGroup
        title={$t('Keyboard shortcuts')}
        description={$t('Navigate AEGIS without leaving the keyboard.')}
      >
        <dl class="details-grid">
          <dt>{$t('Commands')}</dt>
          <dd><kbd>{$t('Ctrl K')}</kbd></dd>
          <dt>{$t('Views')}</dt>
          <dd><kbd>1</kbd> — <kbd>5</kbd></dd>
          <dt>{$t('Theme / settings')}</dt>
          <dd><kbd>{$t('T')}</kbd> / <kbd>{$t('S')}</kbd></dd>
          <dt>{$t('History')}</dt>
          <dd><kbd>{$t('Alt ←')}</kbd> / <kbd>{$t('Alt →')}</kbd></dd>
          <dt>{$t('Close dialog')}</dt>
          <dd><kbd>{$t('Esc')}</kbd></dd>
        </dl>
      </SettingsGroup>
    </div>
  </fieldset>
  {#if validation}<p class="notice" role="alert">{$t(validation)}</p>{/if}
  <div class="settings-save">
    <span class="settings-draft" role="status"
      >{!loaded
        ? $t('Loading settings…')
        : mutation === 'save'
          ? $t('Saving changes…')
          : mutation === 'replace'
            ? $t('Reloading settings…')
            : dirty
              ? $t('Unsaved changes')
              : $t('Settings saved')}</span
    >
    <Action disabled={!loaded || !dirty || mutation !== null} action={() => replaceSettings()}
      ><Icon name="close" />{$t('Discard changes')}</Action
    ><Action disabled={!loaded || !dirty || mutation !== null || !!validation} action={save}
      ><Icon name="check" />{$t('Save settings')}</Action
    >
  </div>
</div>

<style>
  .settings-workspace {
    min-width: 0;
    overflow: clip;
  }
  .settings-workspace :global(.section-tabs) {
    position: sticky;
    top: var(--workspace-sticky-offset, 70px);
    z-index: 3;
    background: var(--panel);
  }
  .settings-layout {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: block;
  }
  .settings-page {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
    padding: var(--panel-inset);
    min-height: 420px;
    align-content: start;
  }
  .settings-intro {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--panel-inset);
  }
  .settings-intro h2 {
    margin: 0;
    font-size: var(--text-section);
  }
  .settings-intro p {
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--text-body);
    line-height: 1.5;
  }
  .settings-intro .badge {
    flex-shrink: 0;
  }
  .settings-page[hidden] {
    display: none;
  }

  .settings-save {
    position: sticky;
    bottom: 0;
    z-index: 2;
    margin: 0;
    padding: 14px 20px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
  }
  .settings-draft {
    margin-right: auto;
    font-size: calc(12px * var(--ui-scale));
    color: var(--muted);
  }
  .toolbar {
    margin-top: 12px;
  }
  @media (max-width: 700px) {
    .settings-intro {
      flex-wrap: wrap;
    }
    .settings-save {
      padding: var(--space-3) var(--panel-inset);
    }
  }
  .settings-save :global(.action-control:last-child .button:not(:disabled)) {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }
</style>
