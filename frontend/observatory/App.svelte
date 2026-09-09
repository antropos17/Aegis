<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    connectHost,
    emptyTelemetry,
    invoke,
    record,
    type Host,
    type RecordData,
  } from './runtime/host';
  import SensorStatus from './components/SensorStatus.svelte';
  import { cpuPercent } from './runtime/resources';
  import Icon from './components/Icon.svelte';
  import Notifications from './components/Notifications.svelte';
  import Monitoring from './components/Monitoring.svelte';
  import Events from './components/Events.svelte';
  import Rules from './components/Rules.svelte';
  import Catalog from './components/Catalog.svelte';
  import Analysis from './components/Analysis.svelte';
  import Reports from './components/Reports.svelte';
  import Settings from './components/Settings.svelte';
  import Statistics from './components/Statistics.svelte';
  import Details from './components/Details.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const views = [
    ['overview', 'Monitoring', 'radar'],
    ['agents', 'Agents', 'agents'],
    ['events', 'Events', 'activity'],
    ['network', 'Network', 'network'],
    ['rules', 'Rules & permissions', 'shield'],
    ['database', 'Agent catalog', 'database'],
    ['analysis', 'AI analysis', 'spark'],
    ['reports', 'Reports', 'report'],
    ['audit', 'Audit', 'history'],
    ['stats', 'Statistics', 'chart'],
    ['settings', 'Settings', 'settings'],
  ];
  let telemetry = $state(emptyTelemetry());
  let connection: ReturnType<typeof connectHost> | null = null;
  let ownCpu = $state<number | null>(null);
  let previousOwn: RecordData = {};
  let previousOwnAt = 0;
  $effect(() => {
    const next = telemetry.own;
    if (next === previousOwn) return;
    const now = Date.now();
    ownCpu = previousOwnAt ? cpuPercent(previousOwn, next, now - previousOwnAt) : null;
    previousOwn = next;
    previousOwnAt = now;
  });
  let selected = $state<string | null>(null);
  let view = $state('overview');
  let tabs = $state(['overview']);
  let history = $state(['overview']);
  let historyIndex = $state(0);
  let scrolls: Record<string, number> = {};
  let workspace: HTMLElement;
  let detail = $state<{ title: string; row: RecordData } | null>(null);
  let version = $state('');
  const savedTheme = localStorage.getItem('aegis-theme');
  let dark = $state(savedTheme ? savedTheme.startsWith('dark') : true);
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let scale = $state(1);
  let commands = $state(false);
  let commandQuery = $state('');
  let commandDialog: HTMLDialogElement;
  let navigationRevision = 0;
  $effect(() => {
    if (commands && !commandDialog?.open) commandDialog?.showModal();
    else if (!commands && commandDialog?.open) commandDialog.close();
  });
  let title = $derived(views.find((row) => row[0] === view)?.[1] ?? 'Monitoring');
  function inspect(title: string, row: RecordData) {
    detail = { title, row };
  }
  function appearance(nextDark: boolean, nextScale: number, highContrast = contrast) {
    contrast = highContrast;
    dark = nextDark;
    scale = nextScale;
  }
  $effect(() => {
    const theme = (dark ? 'dark' : 'light') + (contrast ? '-hc' : '');
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('aegis-theme', theme);
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  });
  async function navigate(next: string, remember = true) {
    if (!views.some((row) => row[0] === next)) return;
    if (workspace) scrolls[view] = workspace.scrollTop;
    if (!tabs.includes(next)) tabs = [...tabs, next];
    if (remember && next !== view) {
      history = [...history.slice(0, historyIndex + 1), next];
      historyIndex = history.length - 1;
    }
    view = next;
    commands = false;
    const ticket = ++navigationRevision;
    await tick();
    if (ticket === navigationRevision) workspace.scrollTop = scrolls[next] ?? 0;
  }
  function back(delta: number) {
    const next = historyIndex + delta;
    if (next >= 0 && next < history.length) {
      historyIndex = next;
      void navigate(history[next], false);
    }
  }
  onMount(() => {
    document.documentElement.dataset.motion = localStorage.getItem('aegis-motion') ?? 'full';
    let alive = true;
    const stop = connectHost(host, (value) => {
      telemetry = value;
    });
    connection = stop;
    const unsubscribe = host?.onToggleTheme
      ? Reflect.apply(host.onToggleTheme, host, [() => (dark = !dark)])
      : undefined;
    invoke(host, 'getAppVersion')
      .then((value) => {
        if (alive) version = String(value);
      })
      .catch(() => {});
    invoke(host, 'getSettings')
      .then((value) => {
        if (alive) {
          const settings = record(value);
          appearance(
            savedTheme ? savedTheme.startsWith('dark') : settings.darkMode === true,
            Number(settings.uiScale ?? 1),
          );
        }
      })
      .catch(() => {});
    const initial = new URL(location.href).searchParams.get('view');
    if (initial) void navigate(initial);
    return () => {
      alive = false;
      stop();
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  });
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      commands = false;
      selected = null;
      return;
    }
    if (detail || (commands && event.key.toLowerCase() !== 'k')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      commands = !commands;
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      back(-1);
      return;
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      back(1);
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      (event.target.matches('input, textarea, select') || event.target.isContentEditable)
    )
      return;
    if (event.key === 's') void navigate('settings');
    if (event.key === 't') dark = !dark;
    const keys: Record<string, string> = {
      '1': 'overview',
      '2': 'events',
      '3': 'rules',
      '4': 'reports',
      '5': 'stats',
    };
    if (keys[event.key]) void navigate(keys[event.key]);
  }
</script>

<svelte:window onkeydown={keydown} />
<a href="#main" class="skip">Skip to content</a>
<div class="app observatory-app">
  <aside class="sidebar">
    <a class="brand" href="#main"
      ><img src="assets/aegis.svg" alt="" width="28" height="28" />AEGIS<span class="version"
        >{version}</span
      ></a
    >
    <div class="machine">
      <Icon name="monitor" />
      <div>
        <strong>{preview ? 'Preview workstation' : 'Local workstation'}</strong><small
          >{preview ? 'Simulated observations' : 'Desktop monitoring'}</small
        >
      </div>
    </div>
    <nav aria-label="Main navigation">
      {#each views as [id, label, icon] (id)}<button
          class="nav"
          class:active={view === id}
          aria-current={view === id ? 'page' : undefined}
          onclick={() => navigate(id)}><Icon name={icon} /><span>{label}</span></button
        >{/each}
    </nav>
    <div class="sidebar-bottom">
      <button
        class="sensor-mini"
        onclick={() =>
          inspect('Sensor health', {
            ...record(telemetry.stats.appHealth),
            observationGap: telemetry.stats.observationGap,
          })}
        ><Icon name="shield" /><span
          >Sensors<small>{String(record(telemetry.stats.appHealth).state ?? 'Waiting')}</small
          ></span
        ></button
      >
      <div class="sidebar-foot">{preview ? 'Preview · simulated data' : 'Local observations'}</div>
    </div>
  </aside>
  <div class="shell">
    <header class="topbar">
      <div class="toolbar">
        <button
          class="icon-button"
          aria-label="Back"
          disabled={historyIndex === 0}
          onclick={() => back(-1)}>←</button
        ><button
          class="icon-button"
          aria-label="Forward"
          disabled={historyIndex >= history.length - 1}
          onclick={() => back(1)}>→</button
        ><span class="breadcrumb">Workspace / <strong>{title}</strong></span>
      </div>
      <div class="top-actions">
        <button class="command-trigger" onclick={() => (commands = !commands)}
          ><Icon name="search" />Commands<kbd>Ctrl K</kbd></button
        ><button class="icon-button" aria-label="Toggle theme" onclick={() => (dark = !dark)}
          ><Icon name="sun" /></button
        >
      </div>
    </header>
    <div class="workspace-tabs" aria-label="Open workspaces">
      {#each tabs as tab (tab)}<div class:active={view === tab}>
          <button onclick={() => navigate(tab)}>{views.find((row) => row[0] === tab)?.[1]}</button
          >{#if tab !== 'overview'}<button
              aria-label={`Close ${tab}`}
              onclick={() => {
                tabs = tabs.filter((item) => item !== tab);
                if (view === tab) void navigate('overview');
              }}>×</button
            >{/if}
        </div>{/each}
    </div>
    <main id="main" tabindex="-1" bind:this={workspace}>
      <div class="page-head">
        <div class="page-title">
          <h1>{title}</h1>
          <span class="live-badge"
            >{preview
              ? 'Demo'
              : telemetry.stale
                ? 'Observation unavailable / stale'
                : telemetry.scanning
                  ? 'Scanning'
                  : 'Monitoring'}</span
          >
        </div>
        <div class="page-actions">
          <button class="button" disabled title="This backend has no manual scan command"
            ><Icon name="refresh" />Scan now</button
          >
        </div>
      </div>
      {#if telemetry.error}<p role="alert" class="health-banner">{telemetry.error}</p>{/if}
      {#if telemetry.stale}<p class="health-banner">
          {telemetry.ready
            ? 'Showing the last reliable population. Process actions are unavailable until observation recovers.'
            : 'Waiting for a reliable process observation. An empty screen does not establish that no agents are running.'}
        </p>{/if}
      <SensorStatus health={record(telemetry.stats.appHealth)} />
      <div hidden={view !== 'overview' && view !== 'agents'}>
        <Monitoring {telemetry} bind:selected {inspect} mode={view} />
      </div>
      {#if tabs.includes('events')}<div hidden={view !== 'events'}>
          <Events {telemetry} {inspect} />
        </div>{/if}
      {#if tabs.includes('network')}<div hidden={view !== 'network'}>
          <Events {telemetry} network {inspect} />
        </div>{/if}
      {#if tabs.includes('rules')}<div hidden={view !== 'rules'}>
          <Rules {host} {telemetry} />
        </div>{/if}
      {#if tabs.includes('database')}<div hidden={view !== 'database'}>
          <Catalog {host} {inspect} />
        </div>{/if}
      {#if tabs.includes('analysis')}<div hidden={view !== 'analysis'}>
          <Analysis {host} {telemetry} visible={view === 'analysis'} {preview} />
        </div>{/if}
      {#if tabs.includes('reports')}<div hidden={view !== 'reports'}>
          <Reports {host} {inspect} />
        </div>{/if}
      {#if tabs.includes('audit')}<div hidden={view !== 'audit'}>
          <Reports {host} audit {inspect} />
        </div>{/if}
      {#if tabs.includes('settings')}<div hidden={view !== 'settings'}>
          <Settings {host} {appearance} />
        </div>{/if}
      <div hidden={view !== 'stats'}><Statistics {telemetry} {inspect} /></div>
    </main>
    <footer>
      <button onclick={() => inspect('Sensor health', record(telemetry.stats.appHealth))}
        ><Icon name="shield" />{String(
          record(telemetry.stats.appHealth).state ?? 'Unobserved',
        )}</button
      ><span
        >AEGIS CPU <b>{ownCpu === null ? '—' : ownCpu.toFixed(1)}%</b> · RAM
        <b>{String(telemetry.own.memMB ?? '—')} MB</b>
        · heap
        <b>{String(telemetry.own.heapMB ?? '—')} MB</b></span
      ><span
        >{telemetry.lastScan
          ? `Observed ${new Date(telemetry.lastScan).toLocaleTimeString()}`
          : 'No reliable scan yet'}</span
      >
    </footer>
  </div>
</div>
<dialog
  bind:this={commandDialog}
  class="command-panel"
  aria-label="Workspace commands"
  onclose={() => (commands = false)}
>
  <label
    >Find a workspace<input
      type="search"
      bind:value={commandQuery}
      aria-label="Find a workspace"
    /></label
  >{#each views.filter((row) => row[1]
      .toLowerCase()
      .includes(commandQuery.toLowerCase())) as [id, label] (id)}<button
      class="nav"
      onclick={() => navigate(id)}>{label}</button
    >{/each}<button class="button" onclick={() => (commands = false)}>Close</button>
</dialog>
<Notifications {telemetry} />
<Details
  {host}
  {telemetry}
  refreshFalsePositives={async () => {
    await connection?.refreshFalsePositives();
  }}
  request={detail}
  close={() => (detail = null)}
/>

<style>
  .observatory-app {
    height: 100dvh;
    min-height: 0;
  }
  .sidebar {
    overflow: auto;
    padding-top: 18px;
  }
  .shell {
    min-height: 0;
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .topbar,
  footer,
  .workspace-tabs {
    flex-shrink: 0;
  }
  main {
    overflow: auto;
    min-height: 0;
    flex: 1;
  }
  .workspace-tabs {
    display: flex;
    overflow-x: auto;
    gap: 6px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }
  .workspace-tabs > div {
    display: flex;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: 8px;
  }
  .workspace-tabs > div.active {
    background: var(--raised);
    border-color: var(--strong-border);
  }
  .workspace-tabs button {
    padding: 5px 8px;
    background: transparent;
    color: var(--muted);
    border: 0;
  }
  .health-banner {
    padding: 12px 16px;
    border: 1px solid var(--amber);
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .command-panel {
    position: fixed;
    z-index: 50;
    inset: 70px 24px auto auto;
    margin: 0;
    color: var(--ink);
    width: min(380px, 80vw);
    max-height: 80dvh;
    overflow: auto;
    padding: 16px;
    background: var(--panel);
    border: 1px solid var(--strong-border);
    border-radius: 12px;
    box-shadow: var(--shadow);
  }
  :global(.inset) {
    padding: 16px;
  }
  :global(.panel + .panel) {
    margin-top: 12px;
  }
  :global(.form-stack) {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  :global(.form-stack label) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  :global(input:not([type='checkbox']), select, textarea) {
    max-width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--ink);
    background: var(--bg);
  }
  :global(.table-scroll) {
    overflow: auto;
  }
  :global(td) {
    overflow-wrap: anywhere;
    max-width: 400px;
  }
  :global(td small) {
    display: block;
    color: var(--muted);
  }
  :global(.text-link) {
    color: var(--ink);
    background: transparent;
    border: 0;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 3px;
    padding: 0;
    overflow-wrap: anywhere;
  }
  :global(.button.active) {
    background: var(--raised);
    border-color: var(--strong-border);
  }
  @media (max-width: 1000px) {
    .observatory-app {
      grid-template-columns: 170px minmax(0, 1fr);
    }
    .sidebar {
      padding: 14px 8px;
    }
    .breadcrumb {
      display: none;
    }
    footer {
      flex-wrap: wrap;
    }
    .version {
      display: none;
    }
  }
</style>
