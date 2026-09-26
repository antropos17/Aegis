<script lang="ts">
  import { t, language } from './runtime/i18n';

  $effect(() => {
    document.documentElement.lang = $language === 'pt' ? 'pt-BR' : 'en';
  });

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
  import WorkspaceNavigation from './components/WorkspaceNavigation.svelte';
  import WorkspaceCommands from './components/WorkspaceCommands.svelte';
  import {
    workspaces,
    workspaceGroups,
    workspaceCommands,
    type WorkspaceCommand,
  } from './runtime/navigation';
  import { cpuPercent } from './runtime/resources';
  import { networkSnapshotStatus } from './runtime/network-coverage';
  import Icon from './components/Icon.svelte';
  import Notifications from './components/Notifications.svelte';
  import Monitoring from './components/Monitoring.svelte';
  import ProtectionOverview from './components/ProtectionOverview.svelte';
  import Events from './components/Events.svelte';
  import Rules from './components/Rules.svelte';
  import Catalog from './components/Catalog.svelte';
  import Analysis from './components/Analysis.svelte';
  import ActionCoverage from './components/ActionCoverage.svelte';
  import TaskGuide from './components/TaskGuide.svelte';
  import { guidedTasks, moreTasks } from './runtime/task-guide';
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
          processes: 'cpu ram memory processes load',
          activity: 'events network files activity',
          tokens: 'tokens cost input output',
          sensors: 'sensors health aegis',
        } as Record<string, string>
      )[id],
      target: 'stats',
      section: id,
    })),
    ...[
      ['settings', 'appearance', 'Appearance', 'theme scale motion animations'],
      ['settings', 'monitoring', 'Monitoring settings', 'sensors scan retention monitoring'],
      ['settings', 'desktop', 'Desktop & updates', 'updates notifications'],
      ['settings', 'data', 'Data & help', 'import export help data'],
      ['reports', 'export', 'Export reports', 'download report export'],
      ['audit', 'delivery', 'Audit delivery', 'audit diagnostics delivery'],
    ].map(([target, section, label, keywords]) => ({
      id: target + '-' + section,
      label,
      caption: workspaces.find((entry) => entry.id === target)!.label,
      keywords,
      target,
      section,
    })),
    ...[...guidedTasks, ...moreTasks].map((task) => ({
      id: 'task-' + task.target,
      label: task.title,
      caption: task.description,
      keywords: task.description,
      target: task.target,
    })),
  ];
  let scope = $state<AgentScope>({ agent: '', instanceId: '' });
  let agentSection = $state<{ id: string; revision: number }>();
  function changeScope(next: AgentScope) {
    scope = next;
    if (!next.agent) selected = null;
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
  // Host deliveries replace immutable snapshots; deep proxies multiply work per record.
  let telemetry = $state.raw(emptyTelemetry());
  let paused = $state(false);
  let held = $state.raw(emptyTelemetry());
  let displayTelemetry = $derived(paused ? held : telemetry);
  let networkStatus = $derived(networkSnapshotStatus(telemetry));
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
  let detailedMonitoring = $state(true);
  let monitoringMounted = $state(true);
  let policyRevision = $state(0);
  let policyTarget = $state<{ key: string; revision: number }>();
  function openPolicy(key: string) {
    policyTarget = { key, revision: ++sectionRevision };
    void navigate('rules');
  }
  $effect(() => {
    if (detailedMonitoring || view === 'agents') monitoringMounted = true;
  });
  let group = $derived(workspaces.find((entry) => entry.id === view)?.group);
  let isLiveWorkspace = $derived(
    ['overview', 'agents', 'events', 'network', 'stats'].includes(view),
  );
  let needsObservations = $derived(!['guide', 'local-security', 'action-control'].includes(view));
  let requestedView = 'overview';
  let renderedView = 'overview';
  let tabs = $state(['overview']);
  let localSecurityModule = $state.raw<Promise<
    typeof import('./components/LocalSecurity.svelte')
  > | null>(null);
  function loadLocalSecurity() {
    localSecurityModule ??= import('./components/LocalSecurity.svelte');
  }
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
    scope.agent && view === 'agents'
      ? scope.agent
      : $t(views.find((row) => row[0] === view)?.[1] ?? 'Monitoring'),
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
      scrolls.agents = 0;
      if (view === 'agents' && workspace) workspace.scrollTop = 0;
      agentSection = { id: String(row.detailSection || 'overview'), revision: ++sectionRevision };
      void navigate('agents').then(() => {
        if (view === 'agents' && scope.agent === agent) {
          document.getElementById('agent-workspace-heading')?.focus({ preventScroll: true });
        }
      });
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
  async function navigate(next: string, remember = true) {
    if (!views.some((row) => row[0] === next)) return;
    if (next === requestedView) {
      const fromCommands = commands;
      const ticket = navigationRevision;
      commands = false;
      if (fromCommands) {
        await tick();
        if (ticket === navigationRevision) workspace.focus({ preventScroll: true });
      }
      return;
    }
    requestedView = next;
    if (workspace) scrolls[renderedView] = workspace.scrollTop;
    if (next === 'local-security') loadLocalSecurity();
    if (!tabs.includes(next)) tabs = [...tabs, next];
    if (remember) {
      history = [...history.slice(0, historyIndex + 1), next];
      historyIndex = history.length - 1;
    }
    const ticket = ++navigationRevision;
    view = next;
    commands = false;
    await tick();
    if (ticket === navigationRevision) {
      workspace.scrollTop = scrolls[next] ?? 0;
      renderedView = next;
      workspace.focus({ preventScroll: true });
    }
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
    const stopNavigation = host?.onNavigateView
      ? Reflect.apply(host.onNavigateView, host, [
          (view: unknown) => {
            if (typeof view === 'string' && view === 'settings') void navigate(view);
          },
        ])
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
      if (typeof stopNavigation === 'function') stopNavigation();
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
<a href="#main" class="skip">{$t('Skip to content')}</a>
<div class="app observatory-app" class:paused class:stale={telemetry.stale}>
  <aside class="sidebar">
    <a class="brand" href="#main"
      ><img class="brand-symbol" src="assets/aegis.svg" alt="" width="28" height="28" />{$t(
        'AEGIS',
      )}<span class="version">{version}</span></a
    >
    <div class="machine">
      <Icon name="monitor" />
      <div>
        <strong>{$t('Workstation')}</strong><small
          >{preview ? $t('Preview / local') : $t('Desktop / local')}</small
        >
      </div>
      <span class="status-indicator"><Icon name="check" /></span>
    </div>
    <nav aria-label={$t('Main navigation')}>
      {#each workspaceGroups as category (category.id)}
        <div class="nav-group">
          <span class="nav-group-label">{$t(category.label)}</span>
          {#each workspaces.filter((entry) => entry.group === category.id) as entry (entry.id)}
            <button
              class="nav"
              aria-label={$t(entry.label)}
              class:active={view === entry.id}
              aria-current={view === entry.id ? 'page' : undefined}
              onclick={() => navigate(entry.id)}
            >
              <Icon name={entry.icon} /><span>{$t(entry.label)}</span>
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
          >{$t('Sensors')}<small>{$t(healthCaption)}</small></span
        ><Icon name="chevron" /></button
      >
      <div class="sidebar-foot">
        {preview ? $t('Preview · simulated data') : $t('Local observations')}
      </div>
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
        {$t(workspaceGroups.find((entry) => entry.id === group)?.label ?? '')}<span>/</span><strong
          >{title}</strong
        >
      </div>
      <div class="top-actions">
        <button class="command-trigger" onclick={() => (commands = !commands)}
          ><Icon name="search" />{$t('Commands')}<kbd>{$t('Ctrl K')}</kbd></button
        ><button class="icon-button" aria-label={$t('Toggle theme')} onclick={toggleTheme}
          ><Icon name="sun" /></button
        >
      </div>
    </header>

    <main
      class:analysis-view={view === 'analysis'}
      id="main"
      aria-labelledby="page-title"
      tabindex="-1"
      bind:this={workspace}
    >
      <div class="page-head" bind:this={pageHead}>
        <div class="page-title">
          <h1 id="page-title">
            <Icon name={views.find((row) => row[0] === view)?.[2] ?? 'file'} />{title}
          </h1>
          {#if isLiveWorkspace}<span class="live-badge"
              ><Icon name="activity" />{paused
                ? $t('View paused')
                : preview
                  ? $t('Demo stream')
                  : telemetry.stale
                    ? $t('Observation unavailable / stale')
                    : view === 'network'
                      ? $t(
                          networkStatus === 'latest'
                            ? 'Latest connection snapshot'
                            : networkStatus === 'retained'
                              ? 'Retained network snapshot'
                              : 'Network observation unavailable',
                        )
                      : telemetry.scanning
                        ? $t('Scanning')
                        : $t('Live')}</span
            >{:else if view !== 'guide'}<span class="workspace-caption"
              >{view === 'analysis' || view === 'reports'
                ? $t('Review and share recorded activity')
                : $t('Configuration and recorded evidence')}</span
            >{/if}
        </div>
        {#if isLiveWorkspace}<div class="page-actions">
            <button
              class="button"
              title={$t('Pause the displayed observations; backend monitoring continues')}
              onclick={() => {
                if (!paused) held = telemetry;
                paused = !paused;
              }}
              ><Icon name={paused ? 'play' : 'pause'} />{paused
                ? $t('Resume view')
                : $t('Pause view')}</button
            >
          </div>{/if}
      </div>
      {#if view === 'overview'}
        <div class="monitoring-view-switch" role="group" aria-label={$t('Monitoring')}>
          <button
            class="button"
            aria-pressed={detailedMonitoring}
            onclick={() => (detailedMonitoring = true)}
            ><Icon name="radar" /><span>{$t('Detailed monitoring')}</span></button
          >
          <button
            class="button"
            aria-pressed={!detailedMonitoring}
            onclick={() => (detailedMonitoring = false)}
            ><Icon name="shield" /><span>{$t('Protection overview')}</span></button
          >
        </div>
      {/if}
      {#if isLiveWorkspace && view !== 'overview'}<AgentContext
          telemetry={displayTelemetry}
          {scope}
          change={changeScope}
        />{/if}
      {#if needsObservations && telemetry.error}<p role="alert" class="health-banner">
          {telemetry.error}
        </p>{/if}
      {#if needsObservations && telemetry.stale}<p class="health-banner">
          {telemetry.ready
            ? $t(
                'Showing the last reliable population. Process actions are unavailable until observation recovers.',
              )
            : $t(
                'Waiting for a reliable process observation. An empty screen does not establish that no agents are running.',
              )}
        </p>{/if}
      <SensorStatus health={record(telemetry.stats.appHealth)} />
      <div id="workspace-content" role="region" aria-labelledby="page-title">
        <div id="content" class:analysis-view={view === 'analysis'}>
          {#if tabs.includes('guide')}<div hidden={view !== 'guide'}>
              <TaskGuide {host} {preview} {navigate} />
            </div>{/if}
          <div hidden={view !== 'overview' || detailedMonitoring}>
            <ProtectionOverview
              {host}
              liveTelemetry={telemetry}
              telemetry={displayTelemetry}
              {inspect}
              {openPolicy}
              {policyRevision}
              navigate={(target) => {
                changeScope({ agent: '', instanceId: '' });
                return navigate(target);
              }}
            />
          </div>
          {#if monitoringMounted}<div
              hidden={(view !== 'overview' || !detailedMonitoring) &&
                (view !== 'agents' || scope.agent !== '')}
            >
              <Monitoring
                liveTelemetry={telemetry}
                telemetry={displayTelemetry}
                bind:selected
                {inspect}
                mode={view}
                {openStatistics}
                openAgent={(agent) => inspect(agent, { agentGroupKey: agent, name: agent })}
                paused={paused || view !== 'overview' || !detailedMonitoring}
                navigate={(target) => {
                  changeScope({ agent: '', instanceId: '' });
                  return navigate(target);
                }}
              />
            </div>{/if}
          {#if scope.agent}<div hidden={view !== 'agents'}>
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
                visible={view === 'agents'}
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
              <Rules
                {host}
                {telemetry}
                targetRequest={policyTarget}
                onPermissionsChanged={() => policyRevision++}
              />
            </div>{/if}
          {#if tabs.includes('database')}<div hidden={view !== 'database'}>
              <Catalog {host} {inspect} />
            </div>{/if}
          {#if tabs.includes('local-security')}<div hidden={view !== 'local-security'}>
              {#if localSecurityModule}
                {#await localSecurityModule}
                  <section
                    class="panel lazy-workspace-state"
                    role="status"
                    aria-label={$t('Loading local security')}
                  >
                    <p>{$t('Loading local security…')}</p>
                  </section>
                {:then module}
                  <module.default {host} {preview} />
                {:catch}
                  <section
                    class="panel lazy-workspace-state"
                    role="alert"
                    aria-label={$t('Local security could not be loaded')}
                  >
                    <h2>{$t('Local security could not be loaded')}</h2>
                    <p>{$t('Reload the app to try again.')}</p>
                    <button class="button" onclick={() => location.reload()}
                      >{$t('Reload app')}</button
                    >
                  </section>
                {/await}
              {/if}
            </div>{/if}
          {#if tabs.includes('action-control')}<div hidden={view !== 'action-control'}>
              <ActionCoverage {host} {preview} {navigate} />
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
        >{$t('AEGIS CPU')} <b>{ownCpu === null ? '—' : ownCpu.toFixed(1)}%</b>
        {$t('· RAM')}
        <b>{String(telemetry.own.memMB ?? '—')} {$t('MB')}</b>
        {$t('· heap')}
        <b>{String(telemetry.own.heapMB ?? '—')} {$t('MB')}</b></span
      ><span
        >{telemetry.lastScan
          ? $t('Observed {value0}', { value0: new Date(telemetry.lastScan).toLocaleTimeString() })
          : $t('No reliable scan yet')}</span
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

<style>
  .lazy-workspace-state {
    padding: var(--panel-inset);
  }
  .lazy-workspace-state h2 {
    font-size: var(--text-section);
    margin: 0 0 var(--space-2);
  }
  .lazy-workspace-state p {
    color: var(--muted);
    margin: 0 0 var(--space-3);
  }
</style>
