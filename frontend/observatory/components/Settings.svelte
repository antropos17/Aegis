<script lang="ts">
  import { onMount } from 'svelte';
  import { confirmed, invoke, record, type Host, type RecordData } from '../runtime/host';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AgentLogo from './AgentLogo.svelte';
  let {
    host,
    appearance,
    navigate,
    currentTheme = null,
  }: {
    host: Host | null;
    appearance: (dark: boolean, scale: number, contrast?: boolean) => void;
    navigate: (view: string) => void;
    currentTheme?: string | null;
  } = $props();
  let form = $state<RecordData>({});
  let loaded = $state(false);
  let error = $state('');
  let updates = $state<RecordData>({});
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let motion = $state(localStorage.getItem('aegis-motion') !== 'reduce');
  let patterns = $state('');
  let ignored = $state('');
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
    loaded = true;
  }
  async function save() {
    const current = record(await invoke(host, 'getSettings'));
    confirmed(
      await invoke(host, 'saveSettings', {
        ...current,
        ...form,
        customSensitivePatterns: patterns
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        ignoredDirectories: ignored
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    );
    if (alive) {
      appearance(form.darkMode === true, Number(form.uiScale ?? 1), contrast);
      localStorage.setItem('aegis-motion', motion ? 'full' : 'reduce');
      document.documentElement.dataset.motion = motion ? 'full' : 'reduce';
      await load();
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
<div class="settings-layout">
  <section class="panel">
    <div class="settings-section">
      <h2><Icon name="sun" /><span>Appearance</span></h2>
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
        /></label
      >
      <div class="setting">
        <span>Language<small>English interface</small></span><span class="badge">English</span>
      </div>
    </div>
    <div class="settings-section">
      <h2><Icon name="radar" /><span>Monitoring</span></h2>
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
        >Additional exclusions<textarea rows="3" maxlength="10000" bind:value={ignored}
        ></textarea><small>One directory per line</small></label
      >
      <label class="setting-stack"
        >Sensitive paths<textarea rows="3" maxlength="10000" bind:value={patterns}></textarea><small
          >One regular expression per line</small
        ></label
      >
    </div>
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
  </section>
  <div class="settings-secondary">
    <section class="panel">
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
    </section>
    <section class="panel">
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
    </section>
    <section class="panel">
      <div class="settings-section">
        <h2><Icon name="settings" /><span>Configuration</span></h2>
        <p class="muted">
          Export settings without the API key. Imports are checked for valid format and values.
        </p>
        <div class="toolbar">
          <Action action={async () => confirmed(await invoke(host, 'exportConfig'))}
            ><Icon name="download" />Export</Action
          ><Action
            action={async () => {
              confirmed(await invoke(host, 'importConfig'));
              await load();
              appearance(form.darkMode === true, Number(form.uiScale ?? 1), contrast);
            }}><Icon name="upload" />Import</Action
          >
        </div>
      </div>
    </section>
    <section class="panel">
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
    </section>
  </div>
</div>
<div class="settings-save">
  <Action
    action={async () => {
      await load();
      contrast = localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false;
      motion = localStorage.getItem('aegis-motion') !== 'reduce';
      appearance(form.darkMode === true, Number(form.uiScale ?? 1), contrast);
    }}><Icon name="close" />Discard changes</Action
  ><Action disabled={!loaded} action={save}><Icon name="check" />Save settings</Action>
</div>

<style>
  .settings-secondary {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .toolbar {
    margin-top: 12px;
  }
  .settings-save {
    z-index: 2;
  }
</style>
