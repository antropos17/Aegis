<script lang="ts">
  import { onMount } from 'svelte';
  import { confirmed, invoke, record, type Host, type RecordData } from '../runtime/host';
  import Action from './Action.svelte';
  let {
    host,
    appearance,
  }: { host: Host | null; appearance: (dark: boolean, scale: number, contrast?: boolean) => void } =
    $props();
  let form = $state<RecordData>({});
  let loaded = $state(false);
  let error = $state('');
  let updates = $state<RecordData>({});
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let motion = $state(localStorage.getItem('aegis-motion') !== 'reduce');
  let patterns = $state('');
  let ignored = $state('');
  let alive = true;
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

{#if error}<p role="alert">{error}</p>{/if}
<div class="settings-grid">
  <section class="panel">
    <div class="panel-head"><h2>Appearance & monitoring</h2></div>
    <div class="inset form-stack">
      <label
        >Theme <select bind:value={form.darkMode}
          ><option value={true}>Dark</option><option value={false}>Light</option></select
        ></label
      >
      <label
        >Interface scale <select bind:value={form.uiScale}
          >{#each [0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5] as scale (scale)}<option
              value={scale}>{Math.round(scale * 100)}%</option
            >{/each}</select
        ></label
      >
      <label class="check-row"><input type="checkbox" bind:checked={contrast} />High contrast</label
      >
      <label class="check-row"
        ><input type="checkbox" bind:checked={motion} />Interface motion (respects system
        preference)</label
      >
      <label
        >Scan interval (seconds) <input
          type="number"
          min="1"
          max="3600"
          bind:value={form.scanIntervalSec}
        /></label
      >
      {#each toggles as [key, label] (key)}<label class="check-row"
          ><input
            type="checkbox"
            checked={form[key] === true}
            onchange={(event) => (form[key] = event.currentTarget.checked)}
          />{label}</label
        >{/each}
      <label
        >Custom sensitive patterns · one expression per line<textarea rows="4" bind:value={patterns}
        ></textarea></label
      >
      <label
        >Ignored directories · one per line<textarea rows="4" bind:value={ignored}
        ></textarea></label
      >
      <div class="toolbar">
        <Action disabled={!loaded} action={save}>Save settings</Action><Action action={load}
          >Restore saved values</Action
        >
      </div>
    </div>
  </section>
  <div class="form-stack">
    <section class="panel">
      <div class="panel-head"><h2>Application updates</h2></div>
      <div class="inset">
        <p role="status">{String(updates.status ?? 'Loading')} {String(updates.version ?? '')}</p>
        {#if updates.error}<p role="alert">
            {String(updates.error)}
          </p>{/if}{#if updates.status === 'downloading'}<progress
            max="100"
            value={Number(updates.progress ?? 0)}
          ></progress>{/if}
        <p>{String(updates.notes ?? '')}</p>
        <div class="toolbar">
          <Action
            disabled={['checking', 'downloading'].includes(String(updates.status))}
            action={() => update('checkForUpdates')}>Check for updates</Action
          >{#if updates.status === 'available'}<Action action={() => update('downloadUpdate')}
              >Download update</Action
            >{/if}{#if updates.status === 'ready'}<Action action={() => update('installUpdate')}
              >Install and restart</Action
            >{/if}
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Configuration</h2></div>
      <div class="inset form-stack">
        <Action action={async () => confirmed(await invoke(host, 'testNotification'))}
          >Send test notification</Action
        ><Action action={async () => confirmed(await invoke(host, 'exportConfig'))}
          >Export configuration</Action
        ><Action
          action={async () => {
            confirmed(await invoke(host, 'importConfig'));
            await load();
            appearance(form.darkMode === true, Number(form.uiScale ?? 1), contrast);
            localStorage.setItem('aegis-motion', motion ? 'full' : 'reduce');
            document.documentElement.dataset.motion = motion ? 'full' : 'reduce';
          }}>Import configuration</Action
        >
        <p class="muted">Configure the analysis provider in AI analysis.</p>
      </div>
    </section>
  </div>
</div>

<style>
  .settings-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(260px, 1fr);
    gap: 12px;
    align-items: start;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  @media (max-width: 1050px) {
    .settings-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
