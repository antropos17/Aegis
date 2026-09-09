<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { transitionSurface } from './runtime/motion';
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
    ['analysis', 'AI analysis', 'shield'],
    ['reports', 'Reports', 'report'],
    ['audit', 'Audit', 'history'],
    ['stats', 'Statistics', 'chart'],
    ['settings', 'Settings', 'settings'],
  ];
  let telemetry = $state(emptyTelemetry());
  let paused = $state(false);
  let held = $state(emptyTelemetry());
  let displayTelemetry = $derived(paused ? held : telemetry);
  const agentCount = $derived(new Set(displayTelemetry.agents.map((agent) => agent.agent)).size);
  const healthCaption = $derived(
    record(telemetry.stats.appHealth).state === 'HEALTHY'
      ? 'Monitoring available'
      : telemetry.stale
        ? 'Observation unavailable'
        : 'Check sensor details',
  );
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
  let dark = $state(savedTheme ? savedTheme.startsWith('dark') : false);
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let scale = $state(1);
  let commands = $state(false);
  let commandQuery = $state('');
  let commandDialog: HTMLDialogElement;
  let navigationRevision = 0;
  let themeChanged = false;
  $effect(() => {
    if (commands && !commandDialog?.open) commandDialog?.showModal();
    else if (!commands && commandDialog?.open) commandDialog.close();
  });
  let title = $derived(views.find((row) => row[0] === view)?.[1] ?? 'Monitoring');
  function inspect(title: string, row: RecordData) {
    detail = { title, row };
  }
  function appearance(nextDark: boolean, nextScale: number, highContrast = contrast) {
    themeChanged = true;
    contrast = highContrast;
    dark = nextDark;
    scale = nextScale;
  }
  function toggleTheme() {
    themeChanged = true;
    dark = !dark;
    contrast = false;
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
    const ticket = ++navigationRevision;
    await transitionSurface('workspace', async () => {
      if (ticket !== navigationRevision) return;
      view = next;
      commands = false;
      await tick();
      if (ticket === navigationRevision) {
        workspace.scrollTop = scrolls[next] ?? 0;
        workspace.classList.add('has-navigated');
        document
          .querySelector('.workspace-tabs > .active')
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
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
    let initialSelectionMade = false;
    const stop = connectHost(host, (value) => {
      telemetry = value;
      if (!initialSelectionMade && value.ready && !value.stale) {
        const first = value.agents.find((agent) => agent.instanceId);
        if (first?.instanceId) {
          selected = first.instanceId;
          initialSelectionMade = true;
        }
      }
    });
    connection = stop;
    const unsubscribe = host?.onToggleTheme
      ? Reflect.apply(host.onToggleTheme, host, [toggleTheme])
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
          if (!themeChanged) {
            dark = savedTheme ? savedTheme.startsWith('dark') : settings.darkMode === true;
            scale = Number(settings.uiScale ?? 1);
          }
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
      if (detail || document.querySelector('dialog[open]')) return;
      commands = false;
      selected = null;
      return;
    }
    if (
      detail ||
      (!commands && document.querySelector('dialog[open]')) ||
      (commands && event.key.toLowerCase() !== 'k')
    )
      return;
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
    if (event.key === 't') toggleTheme();
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
<div class="app observatory-app" class:paused>
  <aside class="sidebar">
    <a class="brand" href="#main"
      ><img class="brand-symbol" src="assets/aegis.svg" alt="" width="28" height="28" />AEGIS<span
        class="version">{version}</span
      ></a
    >
    <div class="machine">
      <Icon name="monitor" />
      <div>
        <strong>Workstation</strong><small>{preview ? 'Preview / local' : 'Desktop / local'}</small>
      </div>
      <span class="status-indicator"><Icon name="check" /></span>
    </div>
    <nav aria-label="Main navigation">
      {#each views.filter((row) => row[0] !== 'settings') as [id, label, icon] (id)}
        {#if id === 'rules' || id === 'analysis'}<div class="nav-divider"></div>{/if}<button
          class="nav"
          aria-label={label}
          class:active={view === id}
          aria-current={view === id ? 'page' : undefined}
          onclick={() => navigate(id)}
          ><Icon name={icon} /><span>{label}</span>{#if id === 'agents'}<small class="count"
              >{displayTelemetry.ready ? agentCount : '—'}</small
            >{/if}</button
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
        ><span class="sensor-indicator"><Icon name="shield" /></span><span
          >Sensors<small>{healthCaption}</small></span
        ><Icon name="chevron" /></button
      >
      <button
        class="nav"
        class:active={view === 'settings'}
        aria-current={view === 'settings' ? 'page' : undefined}
        onclick={() => navigate('settings')}><Icon name="settings" /><span>Settings</span></button
      >
      <div class="sidebar-foot">{preview ? 'Preview · simulated data' : 'Local observations'}</div>
    </div>
  </aside>
  <div class="shell">
    <header class="topbar">
      <div class="breadcrumb">Workstation<span>/</span><strong>{title}</strong></div>
      <div class="top-actions">
        <button class="command-trigger" onclick={() => (commands = !commands)}
          ><Icon name="search" />Commands<kbd>Ctrl K</kbd></button
        ><button class="icon-button" aria-label="Toggle theme" onclick={toggleTheme}
          ><Icon name="sun" /></button
        >
        <button class="icon-button" aria-label="Open settings" onclick={() => navigate('settings')}
          ><Icon name="settings" /></button
        >
      </div>
    </header>
    <div class="workspace-navigation">
      <div class="history-controls">
        <button
          class="history-arrow"
          aria-label="Back"
          disabled={historyIndex === 0}
          onclick={() => back(-1)}><Icon name="arrowLeft" /></button
        ><button
          class="history-arrow"
          aria-label="Forward"
          disabled={historyIndex >= history.length - 1}
          onclick={() => back(1)}><Icon name="chevron" /></button
        >
      </div>
      <div class="workspace-tabs" role="tablist" aria-label="Open workspaces">
        {#each tabs as tab (tab)}<div class="workspace-tab" class:active={view === tab}>
            <button
              role="tab"
              aria-selected={view === tab}
              tabindex={view === tab ? 0 : -1}
              onkeydown={async (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const index = tabs.indexOf(tab);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                await navigate(tabs[next]);
                document
                  .querySelector<HTMLButtonElement>('.workspace-tabs [aria-selected="true"]')
                  ?.focus({ preventScroll: true });
              }}
              onclick={() => navigate(tab)}
              ><Icon name={views.find((row) => row[0] === tab)?.[2] ?? 'file'} />{views.find(
                (row) => row[0] === tab,
              )?.[1]}</button
            >{#if tab !== 'overview'}<button
                class="tab-close"
                aria-label={`Close ${tab}`}
                onclick={() => {
                  tabs = tabs.filter((item) => item !== tab);
                  if (view === tab) void navigate('overview');
                }}><Icon name="close" /></button
              >{/if}
          </div>{/each}
      </div>
    </div>
    <main class:analysis-view={view === 'analysis'} id="main" tabindex="-1" bind:this={workspace}>
      <div class="page-head">
        <div class="page-title">
          <h1 id="page-title">
            <Icon name={views.find((row) => row[0] === view)?.[2] ?? 'file'} />{title}
          </h1>
          <span class="live-badge"
            ><Icon name="activity" />{paused
              ? 'View paused'
              : preview
                ? 'Demo stream'
                : telemetry.stale
                  ? 'Observation unavailable / stale'
                  : telemetry.scanning
                    ? 'Scanning'
                    : 'Live'}</span
          >
        </div>
        <div class="page-actions">
          <button class="button" disabled title="This backend has no manual scan command"
            ><Icon name="refresh" />Scan now</button
          >
          <button
            class="button"
            title="Pause the displayed observations; backend monitoring continues"
            onclick={() => {
              if (!paused) held = telemetry;
              paused = !paused;
            }}
            ><Icon name={paused ? 'play' : 'pause'} />{paused
              ? 'Resume view'
              : 'Pause view'}</button
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
      <div id="content" class:analysis-view={view === 'analysis'}>
        <div hidden={view !== 'overview' && view !== 'agents'}>
          <Monitoring telemetry={displayTelemetry} bind:selected {inspect} mode={view} />
        </div>
        {#if tabs.includes('events')}<div hidden={view !== 'events'}>
            <Events showPause={false} telemetry={displayTelemetry} {inspect} />
          </div>{/if}
        {#if tabs.includes('network')}<div hidden={view !== 'network'}>
            <Events showPause={false} telemetry={displayTelemetry} network {inspect} />
          </div>{/if}
        {#if tabs.includes('rules')}<div hidden={view !== 'rules'}>
            <Rules {host} {telemetry} />
          </div>{/if}
        {#if tabs.includes('database')}<div hidden={view !== 'database'}>
            <Catalog {host} {inspect} />
          </div>{/if}
        {#if tabs.includes('analysis')}<div class="analysis-container" hidden={view !== 'analysis'}>
            <Analysis {host} {telemetry} visible={view === 'analysis'} {preview} />
          </div>{/if}
        {#if tabs.includes('reports')}<div hidden={view !== 'reports'}>
            <Reports {host} {inspect} telemetry={displayTelemetry} {navigate} />
          </div>{/if}
        {#if tabs.includes('audit')}<div hidden={view !== 'audit'}>
            <Reports {host} audit {inspect} telemetry={displayTelemetry} {navigate} />
          </div>{/if}
        {#if tabs.includes('settings')}<div hidden={view !== 'settings'}>
            <Settings
              {host}
              {appearance}
              {navigate}
              currentTheme={(dark ? 'dark' : 'light') + (contrast ? '-hc' : '')}
            />
          </div>{/if}
        <div hidden={view !== 'stats'}><Statistics telemetry={displayTelemetry} {inspect} /></div>
      </div>
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
