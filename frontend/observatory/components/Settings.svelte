<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { confirmed, invoke, record, type Host, type RecordData } from '../runtime/host';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AgentLogo from './AgentLogo.svelte';
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
  let updates = $state<RecordData>({});
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let motion = $state(localStorage.getItem('aegis-motion') !== 'reduce');
  let patterns = $state('');
  let ignored = $state('');
  let patternInput = $state<HTMLTextAreaElement>();
  let dirty = $derived(loaded && baseline !== snapshot());
  let alive = true;
  let previousTheme: string | null = null;
  $effect(() => {
    if (loaded && currentTheme && currentTheme !== previousTheme) {
      previousTheme = currentTheme;
      form.darkMode = currentTheme.startsWith('dark');
      contrast = currentTheme.endsWith('-hc');
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
  async function save() {
    if (mutation) throw new Error('A settings operation is already in progress');
    mutation = 'save';
    const submitted = { form: { ...form }, patterns, ignored, contrast, motion };
    try {
      const current = record(await invoke(host, 'getSettings'));
      const saved = {
        ...current,
        ...submitted.form,
        customSensitivePatterns: submitted.patterns
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        ignoredDirectories: submitted.ignored
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      };
      confirmed(await invoke(host, 'saveSettings', saved));
      if (!alive) return;
      baseline = JSON.stringify(submitted);
      onSettingsSaved?.(saved);
      localStorage.setItem(
        'aegis-theme',
        (submitted.form.darkMode ? 'dark' : 'light') + (submitted.contrast ? '-hc' : ''),
      );
      if (
        form.darkMode === submitted.form.darkMode &&
        form.uiScale === submitted.form.uiScale &&
        contrast === submitted.contrast
      ) {
        appearance(
          submitted.form.darkMode === true,
          Number(submitted.form.uiScale ?? 1),
          submitted.contrast,
        );
      }
      localStorage.setItem('aegis-motion', submitted.motion ? 'full' : 'reduce');
      if (motion === submitted.motion)
        document.documentElement.dataset.motion = submitted.motion ? 'full' : 'reduce';
    } catch (cause) {
      if (alive && cause instanceof Error && /pattern|regex/i.test(cause.message)) {
        section = 'monitoring';
        await tick();
        patternInput?.focus();
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
      if (importing) onSettingsSaved?.(saved);
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
      .catch((e) => {
        if (alive) error = String(e);
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

{#if error}<p role="alert" class="notice">{error}</p>{/if}
<div class="settings-workspace panel">
  <SectionTabs
    {tabs}
    selected={section}
    prefix={id}
    label="Settings sections"
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
      <div class="settings-section">
        <label class="setting"
          ><span>Theme</span><select
            aria-label="Theme"
            value={(form.darkMode ? 'dark' : 'light') + (contrast ? '-hc' : '')}
            onchange={(e) => {
              const theme = e.currentTarget.value;
              form.darkMode = theme.startsWith('dark');
              contrast = theme.endsWith('-hc');
              document.documentElement.dataset.theme = theme;
            }}
            ><option value="dark">Dark</option><option value="light">Light</option><option
              value="dark-hc">Dark, high contrast</option
            ><option value="light-hc">Light, high contrast</option></select
          ></label
        >
        <label class="setting range"
          ><span>Scale <output>{Math.round(Number(form.uiScale ?? 1) * 100)}%</output></span><input
            aria-label="Interface scale"
            type="range"
            min="0.8"
            max="1.5"
            step="0.05"
            value={Number(form.uiScale ?? 1)}
            oninput={(e) => {
              form.uiScale = Number(e.currentTarget.value);
              document.documentElement.style.setProperty('--ui-scale', String(form.uiScale));
            }}
          /></label
        >
        <label class="setting"
          ><span>Animations<small>Radar sweep, markers and transitions</small></span><input
            type="checkbox"
            bind:checked={motion}
            onchange={(event) => {
              document.documentElement.dataset.motion = event.currentTarget.checked
                ? 'full'
                : 'reduce';
            }}
          /></label
        >
        <div class="setting">
          <span>Language<small>English interface</small></span><span class="badge">English</span>
        </div>
      </div>
    </div>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-monitoring'}
      aria-labelledby={id + '-tab-monitoring'}
      hidden={section !== 'monitoring'}
    >
      <div class="settings-section">
        <label class="setting range"
          ><span>Scan interval <output>{String(form.scanIntervalSec ?? 10)} s</output></span><input
            aria-label="Scan interval (seconds)"
            type="range"
            min="1"
            max={Math.max(60, Number(form.scanIntervalSec ?? 10))}
            step="1"
            value={Number(form.scanIntervalSec ?? 10)}
            oninput={(e) => (form.scanIntervalSec = Number(e.currentTarget.value))}
          /></label
        >
        <div class="setting">
          <label class="switch"
            ><input
              type="checkbox"
              checked={form.notificationsEnabled === true}
              onchange={(e) => (form.notificationsEnabled = e.currentTarget.checked)}
            />Notifications</label
          ><Action action={async () => confirmed(await invoke(host, 'testNotification'))}
            ><Icon name="bell" />Test</Action
          >
        </div>
        <label class="setting"
          ><span>Exclude build folders</span><input
            type="checkbox"
            checked={form.ignoreCommonBuildDirs === true}
            onchange={(e) => (form.ignoreCommonBuildDirs = e.currentTarget.checked)}
          /></label
        >
        <label class="setting-stack"
          >Additional exclusions<textarea
            aria-label="Additional exclusions"
            rows="3"
            maxlength="10000"
            bind:value={ignored}
          ></textarea><small>One directory per line</small></label
        >
        <label class="setting-stack"
          >Sensitive paths<textarea
            bind:this={patternInput}
            aria-label="Sensitive paths"
            rows="3"
            maxlength="10000"
            bind:value={patterns}
          ></textarea><small>One regular expression per line</small></label
        >
      </div>
    </div>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-desktop'}
      aria-labelledby={id + '-tab-desktop'}
      hidden={section !== 'desktop'}
    >
      <div class="settings-section">
        <h2><Icon name="monitor" /><span>Desktop startup</span></h2>
        {#each toggles.slice(2, 5) as [key, label] (key)}<label class="setting"
            ><span>{label}</span><input
              type="checkbox"
              checked={form[key] === true}
              onchange={(e) => (form[key] = e.currentTarget.checked)}
            /></label
          >{/each}
      </div>
      <div class="settings-section">
        <h2><Icon name="refresh" /><span>Updates</span></h2>
        <label class="setting"
          ><span>Check automatically</span><input
            type="checkbox"
            checked={form.automaticUpdatesEnabled === true}
            onchange={(e) => (form.automaticUpdatesEnabled = e.currentTarget.checked)}
          /></label
        >
        <p class="muted" role="status">
          {String(updates.status ?? 'Loading')}
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
            disabled={['checking', 'downloading'].includes(String(updates.status))}
            action={() => update('checkForUpdates')}
            ><Icon name="refresh" />Check for updates</Action
          >{#if updates.status === 'available'}<Action action={() => update('downloadUpdate')}
              >Download update</Action
            >{/if}{#if updates.status === 'ready'}<Action action={() => update('installUpdate')}
              >Install and restart</Action
            >{/if}
        </div>
      </div>
    </div>
    <div
      class="settings-page"
      role="tabpanel"
      tabindex="0"
      id={id + '-panel-data'}
      aria-labelledby={id + '-tab-data'}
      hidden={section !== 'data'}
    >
      <div class="settings-section">
        <h2><AgentLogo name="Claude Code" /><span>Anthropic analysis</span></h2>
        <p class="muted">
          Connect Anthropic, review evidence and customize reports in the AI analysis workspace.
        </p>
        <div class="toolbar">
          <button class="button" onclick={() => navigate('analysis')}
            ><Icon name="shield" />Open AI analysis</button
          >
        </div>
      </div>
      <div class="settings-section">
        <h2><Icon name="settings" /><span>Configuration</span></h2>
        <p class="muted">
          Export settings without the API key. Imports are checked for valid format and values.
        </p>
        <div class="toolbar">
          <Action action={async () => confirmed(await invoke(host, 'exportConfig'))}
            ><Icon name="download" />Export</Action
          ><Action disabled={mutation !== null} action={() => replaceSettings(true)}
            ><Icon name="upload" />Import</Action
          >
        </div>
      </div>
      <div class="settings-section">
        <h2><Icon name="keyboard" /><span>Keyboard shortcuts</span></h2>
        <dl class="details-grid">
          <dt>Commands</dt>
          <dd><kbd>Ctrl K</kbd></dd>
          <dt>Views</dt>
          <dd><kbd>1</kbd> — <kbd>5</kbd></dd>
          <dt>Theme / settings</dt>
          <dd><kbd>T</kbd> / <kbd>S</kbd></dd>
          <dt>History</dt>
          <dd><kbd>Alt ←</kbd> / <kbd>Alt →</kbd></dd>
          <dt>Close dialog</dt>
          <dd><kbd>Esc</kbd></dd>
        </dl>
      </div>
    </div>
  </fieldset>
  <div class="settings-save">
    <span class="settings-draft" role="status"
      >{!loaded ? 'Loading settings…' : dirty ? 'Unsaved changes' : 'Settings saved'}</span
    >
    <Action disabled={!loaded || !dirty || mutation !== null} action={() => replaceSettings()}
      ><Icon name="close" />Discard changes</Action
    ><Action disabled={!loaded || !dirty || mutation !== null} action={save}
      ><Icon name="check" />Save settings</Action
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
    top: 0;
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
  }
  .settings-page[hidden] {
    display: none;
  }
  .setting {
    margin: 16px 0;
  }
  .settings-section {
    max-width: 860px;
  }
  .settings-section h2 {
    font-size: calc(14px * var(--ui-scale));
  }
  .settings-section + .settings-section {
    border-top: 1px solid var(--border);
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
    .settings-section {
      padding: 16px;
    }
    .setting {
      gap: 12px;
      flex-wrap: wrap;
    }
    .settings-save {
      padding: 12px 16px;
    }
  }
</style>
