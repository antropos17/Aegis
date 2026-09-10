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
  import WorkspaceNavigation from './components/WorkspaceNavigation.svelte';
  import WorkspaceCommands from './components/WorkspaceCommands.svelte';
  import {
    workspaces,
    workspaceGroups,
    workspaceCommands,
    type WorkspaceCommand,
  } from './runtime/navigation';
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
  import AgentContext from './components/AgentContext.svelte';
  import AgentWorkspace from './components/AgentWorkspace.svelte';
  import { detailKind } from './runtime/detail-model';
  import { isScopedProcess, type AgentScope } from './runtime/agent-scope';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const views = workspaces.map((entry) => [entry.id, entry.label, entry.icon]);

  let sectionRequests = $state<Record<string, { id: string; revision: number }>>({});
  let sectionRevision = 0;
  const commandEntries: WorkspaceCommand[] = [
    ...workspaceCommands(),
    ...['processes', 'activity', 'tokens', 'sensors'].map((id) => ({
      id: 'stats-' + id,
      label: 'Statistics · ' + id[0].toUpperCase() + id.slice(1),
      caption: 'Live monitors',
      keywords: (
        {
          processes: 'cpu ram memory processes нагрузка память процессы',
          activity: 'events network files активность события сеть',
          tokens: 'tokens cost input output токены стоимость',
          sensors: 'sensors health aegis датчики здоровье',
        } as Record<string, string>
      )[id],
      target: 'stats',
      section: id,
    })),
    ...[
      ['settings', 'appearance', 'Appearance', 'theme scale motion тема масштаб анимации'],
      ['settings', 'monitoring', 'Monitoring settings', 'sensors scan retention мониторинг'],
      ['settings', 'desktop', 'Desktop & updates', 'updates notifications обновления'],
      ['settings', 'data', 'Data & help', 'import export help данные помощь'],
      ['reports', 'export', 'Export reports', 'download report экспорт отчёт'],
      ['audit', 'delivery', 'Audit delivery', 'audit diagnostics доставка аудит'],
    ].map(([target, section, label, keywords]) => ({
      id: target + '-' + section,
      label,
      caption: workspaces.find((entry) => entry.id === target)!.label,
      keywords,
      target,
      section,
    })),
  ];
  let scope = $state<AgentScope>({ agent: '', instanceId: '' });
  let agentSection = $state<{ id: string; revision: number }>();
  function changeScope(next: AgentScope) {
    scope = next;
    if (!next.agent) selected = null;
    if (workspace) workspace.scrollTop = 0;
  }
  function openStatistics(agent: string) {
    if (scope.agent !== agent) changeScope({ agent, instanceId: '' });
    scrolls.stats = 0;
    void navigate('stats');
  }
  function openSensors() {
    sectionRequests.stats = { id: 'sensors', revision: ++sectionRevision };
    void navigate('stats');
  }
  async function runCommand(entry: WorkspaceCommand) {
    if (entry.section)
      sectionRequests[entry.target] = { id: entry.section, revision: ++sectionRevision };
    await navigate(entry.target);
    commands = false;
  }
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
  let group = $derived(workspaces.find((entry) => entry.id === view)?.group);
  let isLiveWorkspace = $derived(
    ['overview', 'agents', 'events', 'network', 'stats'].includes(view),
  );
  let requestedView = 'overview';
  let tabs = $state(['overview']);
  let history = $state(['overview']);
  let historyIndex = $state(0);
  let scrolls: Record<string, number> = {};
  let workspace: HTMLElement;
  let pageHead: HTMLDivElement;
  let detail = $state<{ title: string; row: RecordData } | null>(null);
  let version = $state('');
  const savedTheme = localStorage.getItem('aegis-theme');
  let dark = $state(savedTheme ? savedTheme.startsWith('dark') : false);
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let scale = $state(1);
  let commands = $state(false);
  let navigationRevision = 0;
  let themeChanged = false;
  let title = $derived(
    scope.agent && ['overview', 'agents'].includes(view)
      ? scope.agent
      : (views.find((row) => row[0] === view)?.[1] ?? 'Monitoring'),
  );
  function inspect(title: string, row: RecordData) {
    const kind = detailKind(row);
    const agent =
      kind === 'group'
        ? String(row.agentGroupKey)
        : kind === 'process' && typeof row.agent === 'string'
          ? row.agent
          : '';
    if (agent && (kind === 'group' || isScopedProcess(row))) {
      changeScope({ agent, instanceId: kind === 'process' ? String(row.instanceId) : '' });
      detail = null;
      agentSection = { id: String(row.detailSection || 'overview'), revision: ++sectionRevision };
      void navigate('agents');
      return;
    }
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
  async function navigate(next: string, remember = true, direction = 1) {
    if (!views.some((row) => row[0] === next)) return;
    if (next === requestedView) {
      commands = false;
      return;
    }
    requestedView = next;
    if (workspace) scrolls[view] = workspace.scrollTop;
    if (!tabs.includes(next)) tabs = [...tabs, next];
    if (remember) {
      history = [...history.slice(0, historyIndex + 1), next];
      historyIndex = history.length - 1;
    }
    const ticket = ++navigationRevision;
    await transitionSurface(
      'workspace',
      async () => {
        if (ticket !== navigationRevision) return;
        view = next;
        commands = false;
        await tick();
        if (ticket === navigationRevision) {
          workspace.scrollTop = scrolls[next] ?? 0;
          workspace.classList.add('has-navigated');
        }
      },
      direction,
    );
  }
  function back(delta: number) {
    const next = historyIndex + delta;
    if (next >= 0 && next < history.length) {
      historyIndex = next;
      void navigate(history[next], false, delta);
    }
  }
  onMount(() => {
    document.documentElement.dataset.motion = localStorage.getItem('aegis-motion') ?? 'full';
    let alive = true;
    const resizeHead = () =>
      workspace.style.setProperty(
        '--workspace-sticky-offset',
        pageHead.getBoundingClientRect().height + 'px',
      );
    const headObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resizeHead);
    headObserver?.observe(pageHead);
    resizeHead();
    const stop = connectHost(host, (value) => {
      telemetry = value;
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
      headObserver?.disconnect();
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
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
<div class="app observatory-app" class:paused class:stale={telemetry.stale}>
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
      {#each workspaceGroups as category (category.id)}
        <div class="nav-group">
          <span class="nav-group-label">{category.label}</span>
          {#each workspaces.filter((entry) => entry.group === category.id) as entry (entry.id)}
            <button
              class="nav"
              aria-label={entry.label}
              class:active={view === entry.id}
              aria-current={view === entry.id ? 'page' : undefined}
              onclick={() => navigate(entry.id)}
            >
              <Icon name={entry.icon} /><span>{entry.label}</span>
              {#if entry.id === 'agents'}<small class="count"
                  >{displayTelemetry.ready ? agentCount : '—'}</small
                >{/if}
            </button>
          {/each}
        </div>
      {/each}
    </nav>
    <div class="sidebar-bottom">
      <button class="sensor-mini" onclick={openSensors}
        ><span class="sensor-indicator"><Icon name="shield" /></span><span
          >Sensors<small>{healthCaption}</small></span
        ><Icon name="chevron" /></button
      >
      <div class="sidebar-foot">{preview ? 'Preview · simulated data' : 'Local observations'}</div>
    </div>
  </aside>
  <div class="shell">
    <header class="topbar">
      <WorkspaceNavigation
        {back}
        canBack={historyIndex > 0}
        canForward={historyIndex < history.length - 1}
      />
      <div class="breadcrumb">
        {workspaceGroups.find((entry) => entry.id === group)?.label}<span>/</span><strong
          >{title}</strong
        >
      </div>
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

    <main class:analysis-view={view === 'analysis'} id="main" tabindex="-1" bind:this={workspace}>
      <div class="page-head" bind:this={pageHead}>
        <div class="page-title">
          <h1 id="page-title">
            <Icon name={views.find((row) => row[0] === view)?.[2] ?? 'file'} />{title}
          </h1>
          {#if isLiveWorkspace}<span class="live-badge"
              ><Icon name="activity" />{paused
                ? 'View paused'
                : preview
                  ? 'Demo stream'
                  : telemetry.stale
                    ? 'Observation unavailable / stale'
                    : telemetry.scanning
                      ? 'Scanning'
                      : 'Live'}</span
            >{:else}<span class="workspace-caption"
              >{view === 'analysis' || view === 'reports'
                ? 'Review and share recorded activity'
                : 'Configuration and recorded evidence'}</span
            >{/if}
        </div>
        {#if isLiveWorkspace}<div class="page-actions">
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
          </div>{/if}
      </div>
      {#if isLiveWorkspace}<AgentContext
          telemetry={displayTelemetry}
          {scope}
          change={changeScope}
        />{/if}
      {#if telemetry.error}<p role="alert" class="health-banner">{telemetry.error}</p>{/if}
      {#if telemetry.stale}<p class="health-banner">
          {telemetry.ready
            ? 'Showing the last reliable population. Process actions are unavailable until observation recovers.'
            : 'Waiting for a reliable process observation. An empty screen does not establish that no agents are running.'}
        </p>{/if}
      <SensorStatus health={record(telemetry.stats.appHealth)} />
      <div id="workspace-content" role="region" aria-labelledby="page-title">
        <div id="content" class:analysis-view={view === 'analysis'}>
          <div hidden={scope.agent !== '' || (view !== 'overview' && view !== 'agents')}>
            <Monitoring
              telemetry={displayTelemetry}
              bind:selected
              {inspect}
              mode={view}
              {openStatistics}
              openAgent={(agent) => inspect(agent, { agentGroupKey: agent, name: agent })}
              {paused}
              {navigate}
            />
          </div>
          {#if scope.agent}<div hidden={view !== 'overview' && view !== 'agents'}>
              <AgentWorkspace
                telemetry={displayTelemetry}
                liveTelemetry={telemetry}
                {host}
                {scope}
                change={changeScope}
                {inspect}
                {navigate}
                {paused}
                sectionRequest={agentSection}
                visible={view === 'overview' || view === 'agents'}
              />
            </div>{/if}
          {#if tabs.includes('events')}<div hidden={view !== 'events'}>
              <Events
                viewPaused={paused}
                showPause={false}
                telemetry={displayTelemetry}
                {scope}
                {inspect}
              />
            </div>{/if}
          {#if tabs.includes('network')}<div hidden={view !== 'network'}>
              <Events
                viewPaused={paused}
                showPause={false}
                telemetry={displayTelemetry}
                {scope}
                network
                {inspect}
              />
            </div>{/if}
          {#if tabs.includes('rules')}<div hidden={view !== 'rules'}>
              <Rules {host} {telemetry} />
            </div>{/if}
          {#if tabs.includes('database')}<div hidden={view !== 'database'}>
              <Catalog {host} {inspect} />
            </div>{/if}
          {#if tabs.includes('analysis')}<div
              class="analysis-container"
              hidden={view !== 'analysis'}
            >
              <Analysis {host} {telemetry} visible={view === 'analysis'} {preview} />
            </div>{/if}
          {#if tabs.includes('reports')}<div hidden={view !== 'reports'}>
              <Reports
                {host}
                {inspect}
                telemetry={displayTelemetry}
                {navigate}
                sectionRequest={sectionRequests.reports}
              />
            </div>{/if}
          {#if tabs.includes('audit')}<div hidden={view !== 'audit'}>
              <Reports
                {host}
                audit
                {inspect}
                telemetry={displayTelemetry}
                {navigate}
                sectionRequest={sectionRequests.audit}
              />
            </div>{/if}
          {#if tabs.includes('settings')}<div hidden={view !== 'settings'}>
              <Settings
                {host}
                {appearance}
                {navigate}
                sectionRequest={sectionRequests.settings}
                onSettingsSaved={(settings) => connection?.applySettings(settings)}
                currentTheme={(dark ? 'dark' : 'light') + (contrast ? '-hc' : '')}
              />
            </div>{/if}
          <div hidden={view !== 'stats'}>
            <Statistics
              telemetry={displayTelemetry}
              {inspect}
              sectionRequest={sectionRequests.stats}
              {scope}
              {changeScope}
              {paused}
            />
          </div>
        </div>
      </div>
    </main>
    <footer>
      <button onclick={openSensors}
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
<WorkspaceCommands
  open={commands}
  close={() => (commands = false)}
  entries={commandEntries}
  choose={runCommand}
/>
<Notifications {telemetry} />
<Details
  {host}
  {telemetry}
  refreshFalsePositives={async () => {
    await connection?.refreshFalsePositives();
  }}
  request={detail}
  openAgent={inspect}
  close={() => (detail = null)}
/>
