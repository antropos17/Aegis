<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick, untrack } from 'svelte';
  import { confirmed, invoke, record, type Host, type RecordData } from '../runtime/host';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import SettingsGroup from './SettingsGroup.svelte';
  import SettingsAppearance from './SettingsAppearance.svelte';
  import SettingsMonitoring from './SettingsMonitoring.svelte';
  import SettingsSaveBar from './SettingsSaveBar.svelte';
  import SettingsKeyboard from './SettingsKeyboard.svelte';
  import SettingsExperience from './SettingsExperience.svelte';
  import { revealSettingsFocus } from '../runtime/settings-focus';
  import SectionNavigation from './SectionNavigation.svelte';
  const id = $props.id();
  const tabs = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'desktop', label: 'Desktop & updates' },
    { id: 'data', label: 'Data & help' },
  ];
  let section = $state('appearance');
  let workspace = $state<HTMLDivElement>();
  let lastSectionRequest = -1;
  async function revealSection(value: string): Promise<void> {
    section = value;
    await tick();
    if (!alive) return;
    const heading = document.getElementById(id + '-heading-' + value);
    if (!heading || !workspace?.contains(heading)) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }
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
    advanced = true,
    onAdvancedChange,
  }: {
    host: Host | null;
    appearance: (dark: boolean, scale: number, contrast?: boolean) => void;
    navigate: (view: string) => void;
    currentTheme?: string | null;
    sectionRequest?: { id: string; revision: number };
    onSettingsSaved?: (_settings: RecordData) => void;
    advanced?: boolean;
    onAdvancedChange?: (_advanced: boolean) => void;
  } = $props();
  $effect(() => {
    if (
      sectionRequest &&
      sectionRequest.revision !== lastSectionRequest &&
      tabs.some((tab) => tab.id === sectionRequest.id)
    ) {
      lastSectionRequest = sectionRequest.revision;
      void revealSection(sectionRequest.id);
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
  let intervalInput = $state<HTMLInputElement>();
  const validationId = id + '-validation';
  async function fixValidation() {
    section = 'monitoring';
    await tick();
    intervalInput?.focus({ preventScroll: true });
    intervalInput?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  }
  let dirty = $derived(loaded && baseline !== snapshot());
  let validation = $derived(
    !loaded
      ? ''
      : !Number.isFinite(Number(form.scanIntervalSec ?? 10)) ||
          Number(form.scanIntervalSec ?? 10) <= 0
        ? 'Scan interval must be a positive number of seconds.'
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
      const saved = untrack(() => JSON.parse(baseline) as { form: RecordData; contrast: boolean });
      const themeClean = untrack(
        () => form.darkMode === saved.form.darkMode && contrast === saved.contrast,
      );
      previousTheme = currentTheme;
      if (!themeClean) return;
      const dark = currentTheme.startsWith('dark');
      const highContrast = currentTheme.endsWith('-hc');
      form.darkMode = dark;
      contrast = highContrast;
      saved.form.darkMode = dark;
      saved.contrast = highContrast;
      baseline = JSON.stringify(saved);
    }
  });
  async function load() {
    const settings = record(await invoke(host, 'getSettings'));
    if (!alive) return;
    // The provider key never enters the generic settings form or history.
    const { anthropicApiKey: _key, ...safe } = settings;
    const editable = ['darkMode', 'uiScale', 'scanIntervalSec', ...toggles.map(([key]) => key)];
    form = Object.fromEntries(editable.map((key) => [key, safe[key]]));
    // The renderer uses a fixed 100% layout without silently rewriting saved preferences.
    form.uiScale = 1;
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
    const motionChanged = submitted.motion !== previous.motion;
    const preview = {
      theme: document.documentElement.dataset.theme,
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
        themeChanged &&
        form.darkMode === submitted.form.darkMode &&
        contrast === submitted.contrast &&
        document.documentElement.dataset.theme === preview.theme
      ) {
        // An earlier save must not replace a newer theme draft.
        appearance(savedTheme.startsWith('dark'), 1, savedTheme.endsWith('-hc'));
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
      }}><Icon name="refresh" />{$t('Retry loading')}</Action
    >
  </div>{/if}
{#if refreshWarning}<p role="status" class="notice">{refreshWarning}</p>{/if}
<div class="settings-workspace" bind:this={workspace} use:revealSettingsFocus>
  <div class="settings-intro">
    <div>
      <h2>{$t('Application preferences')}</h2>
      <p>
        {$t('Preferences are grouped on this page. Your draft stays until you save or discard it.')}
      </p>
    </div>
    <span class="badge">{$t('Local settings')}</span>
  </div>
  <div class="settings-composition">
    <fieldset class="settings-layout" disabled={!loaded || mutation === 'replace'}>
      <section
        class="settings-page"
        id={id + '-panel-appearance'}
        aria-labelledby={id + '-heading-appearance'}
        onfocusin={() => (section = 'appearance')}
      >
        <h2 id={id + '-heading-appearance'} tabindex="-1">{$t('Appearance')}</h2>
        <SettingsAppearance bind:form bind:contrast bind:motion />
      </section>
      <section
        class="settings-page"
        id={id + '-panel-monitoring'}
        aria-labelledby={id + '-heading-monitoring'}
        onfocusin={() => (section = 'monitoring')}
      >
        <h2 id={id + '-heading-monitoring'} tabindex="-1">{$t('Monitoring')}</h2>
        <SettingsMonitoring
          bind:form
          bind:patterns
          bind:ignored
          bind:patternInput
          bind:intervalInput
          validationId={validation.startsWith('Scan interval') ? validationId : undefined}
          {host}
        />
      </section>
      <section
        class="settings-page"
        id={id + '-panel-desktop'}
        aria-labelledby={id + '-heading-desktop'}
        onfocusin={() => (section = 'desktop')}
      >
        <h2 id={id + '-heading-desktop'} tabindex="-1">{$t('Desktop & updates')}</h2>
        <SettingsGroup
          title={$t('Desktop startup')}
          description={$t('Choose how AEGIS starts and renders its interface.')}
        >
          <p class="muted">
            {$t(
              'Closing the window keeps AEGIS running in the system tray. Use Quit AEGIS to stop monitoring and exit.',
            )}
          </p>
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
                ><Icon name="download" />{$t('Download update')}</Action
              >{/if}{#if updates.status === 'ready'}<Action action={() => update('installUpdate')}
                ><Icon name="refresh" />{$t('Install and restart')}</Action
              >{/if}
          </div>
        </SettingsGroup>
      </section>
      <section
        class="settings-page"
        id={id + '-panel-data'}
        aria-labelledby={id + '-heading-data'}
        onfocusin={() => (section = 'data')}
      >
        <h2 id={id + '-heading-data'} tabindex="-1">{$t('Data & help')}</h2>
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
          <SettingsKeyboard />
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
      </section>
    </fieldset>
    <aside class="settings-navigation">
      <SectionNavigation
        {tabs}
        selected={section}
        change={(value) => revealSection(value)}
        prefix={id}
        label={$t('Settings sections')}
        controls
      />
      <div class="settings-interface">
        <SettingsExperience
          {advanced}
          onAdvancedChange={(value) => {
            advanced = value;
            onAdvancedChange?.(value);
          }}
        />
      </div>
    </aside>
  </div>
  <SettingsSaveBar
    {loaded}
    {dirty}
    {mutation}
    {validation}
    {validationId}
    fix={fixValidation}
    {save}
    discard={() => replaceSettings()}
  />
</div>

<style>
  .settings-workspace {
    min-width: 0;
  }
  .settings-composition {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 184px;
    align-items: start;
    gap: var(--space-4);
  }
  .settings-navigation {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .settings-interface {
    min-width: 0;
  }
  .settings-interface :global(.interface-preference) {
    margin-bottom: 0;
  }
  .settings-interface :global(.setting) {
    align-items: start;
    gap: var(--space-2);
  }
  .settings-layout {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .settings-page {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
    padding: 0;
    align-content: start;
    scroll-margin-top: calc(var(--workspace-sticky-offset, 70px) + 12px);
  }
  .settings-page > h2 {
    margin: 0;
    padding: var(--space-3) var(--panel-inset);
    border-left: 3px solid var(--accent);
    border-bottom: 1px solid var(--strong-border);
    background: var(--hover);
    font-size: var(--text-section);
    scroll-margin-top: calc(var(--workspace-sticky-offset, 70px) + 12px);
  }
  .settings-intro {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--panel-inset);
    margin-bottom: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
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

  .toolbar {
    margin-top: 12px;
  }
  @media (max-width: 700px) {
    .settings-composition {
      grid-template-columns: minmax(0, 1fr);
    }
    .settings-navigation {
      grid-row: 1;
    }
    .settings-intro {
      flex-wrap: wrap;
    }
  }
</style>
