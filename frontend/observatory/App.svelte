<script lang="ts">
  import { t, language } from './runtime/i18n';

  $effect(() => {
    document.documentElement.lang = $language === 'pt' ? 'pt-BR' : 'en';
  });

  import { onMount, tick, untrack } from 'svelte';
  import { mountKeyboardPreferences, singleKeyShortcuts } from './runtime/keyboard-shortcuts';
  import { readAdvancedMode } from './runtime/interface-mode';
  import { mountFooterLayout } from './runtime/footer-layout';
  import {
    connectHost,
    emptyTelemetry,
    instances,
    invoke,
    record,
    type Host,
    type RecordData,
  } from './runtime/host';
  import SensorStatus from './components/SensorStatus.svelte';
  import AppExit from './components/AppExit.svelte';
  import WorkspaceNavigation from './components/WorkspaceNavigation.svelte';
  import WorkspaceCommands from './components/WorkspaceCommands.svelte';
  import {
    workspaces,
    workspaceGroups,
    workspaceCommands,
    navigationWorkspaces,
    workspaceLabel,
    isAdvancedWorkspace,
    isInvestigationWorkspace,
    type WorkspaceCommand,
  } from './runtime/navigation';
  import { cpuPercent } from './runtime/resources';
  import { networkSnapshotStatus } from './runtime/network-coverage';
  import { observationStatusLabel } from './runtime/observation-status';
  import Icon from './components/Icon.svelte';
  import Notifications from './components/Notifications.svelte';
  import Monitoring from './components/Monitoring.svelte';
  import InvestigationWorkbench from './components/InvestigationWorkbench.svelte';
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
  let advanced = $state(readAdvancedMode());
  let investigationMounted = $state(untrack(() => !advanced));
  $effect(() => {
    if (!advanced) investigationMounted = true;
  });
  let navigationEntries = $derived(navigationWorkspaces(advanced));

  let sectionRequests = $state<Record<string, { id: string; revision: number }>>({});
  let sectionRevision = 0;
  let commandEntries: WorkspaceCommand[] = $derived([
    ...workspaceCommands(advanced),
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
  ]);
  let scope = $state<AgentScope>({ agent: '', instanceId: '' });
  let agentSection = $state<{ id: string; revision: number }>();
  function changeScope(next: AgentScope) {
    if (next.agent !== scope.agent || next.instanceId !== scope.instanceId) evidenceRequest = null;
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
  function openAuditDelivery() {
    sectionRequests.audit = { id: 'delivery', revision: ++sectionRevision };
    void navigate('audit');
  }
  async function runCommand(entry: WorkspaceCommand) {
    if (entry.section)
      sectionRequests[entry.target] = { id: entry.section, revision: ++sectionRevision };
    await navigate(entry.target);
    commands = false;
  }
  function openInterfaceSettings() {
    scrolls.settings = 0;
    void navigate('settings');
  }
  // Host deliveries replace immutable snapshots; deep proxies multiply work per record.
  let telemetry = $state.raw(emptyTelemetry());
  let auditDelivery = $derived(record(telemetry.stats.auditDelivery));
  function auditCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  let auditDropped = $derived(auditCount(auditDelivery.droppedEntries));
  let auditPending = $derived(auditCount(auditDelivery.bufferDepth));
  let auditWriteFailed = $derived(auditDelivery.writeFailed === true);
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
  let simpleInvestigation = $derived(!advanced && isInvestigationWorkspace(view));
  let technicalWorkspace = $derived(!simpleInvestigation && isAdvancedWorkspace(view));
  let detailedMonitoring = $state(true);
  let monitoringMounted = $state(untrack(() => advanced));
  let agentWorkspaceMounted = $state(false);
  let policyRevision = $state(0);
  let policyTarget = $state<{ key: string; revision: number }>();
  function openPolicy(key: string) {
    policyTarget = { key, revision: ++sectionRevision };
    void navigate('rules');
  }
  $effect(() => {
    if (advanced && (detailedMonitoring || view === 'agents')) monitoringMounted = true;
    if (advanced && view === 'agents' && scope.agent) agentWorkspaceMounted = true;
  });
  let group = $derived(workspaces.find((entry) => entry.id === view)?.group);
  let isLiveWorkspace = $derived(
    ['overview', 'agents', 'events', 'network', 'stats'].includes(view),
  );
  let needsObservations = $derived(
    !['guide', 'local-security', 'action-control', 'settings'].includes(view),
  );
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
  let statusFooter: HTMLElement;
  let footerLayout: ReturnType<typeof mountFooterLayout> | undefined;
  let detail = $state<{ title: string; row: RecordData } | null>(null);
  let evidenceRequest = $state.raw<{ title: string; row: RecordData; agents: RecordData[] } | null>(
    null,
  );
  let evidenceReturnFocus: HTMLElement | null = null;
  let exceptionStatusRevision = $state(0);
  async function refreshExceptionStatus() {
    await connection?.refreshFalsePositives();
    exceptionStatusRevision += 1;
  }
  let activityChannelRequest = $state<{ channel: 'files' | 'connections'; revision: number }>();
  let version = $state('');
  const savedTheme = localStorage.getItem('aegis-theme');
  let dark = $state(savedTheme ? savedTheme.startsWith('dark') : false);
  let contrast = $state(localStorage.getItem('aegis-theme')?.endsWith('-hc') ?? false);
  let scale = $state(1);
  let commands = $state(false);
  let navigationRevision = 0;
  let themeChanged = false;
  function scrollFooter(event: KeyboardEvent) {
    footerLayout?.scroll(event);
  }
  let title = $derived(
    scope.agent && view === 'agents' && advanced
      ? scope.agent
      : $t(workspaceLabel(simpleInvestigation ? 'overview' : view, advanced)),
  );
  async function captureEvidence(title: string, row: RecordData, agents?: RecordData[]) {
    evidenceReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    evidenceRequest = {
      title,
      row: structuredClone($state.snapshot(row)),
      agents: structuredClone(
        $state.snapshot(agents ?? (instances(displayTelemetry) as unknown as RecordData[])),
      ),
    };
    const captured = evidenceRequest;
    await navigate('overview');
    await tick();
    if (evidenceRequest === captured && simpleInvestigation)
      document.getElementById('investigation-evidence')?.focus();
  }
  async function closeEvidence() {
    const opener = evidenceReturnFocus;
    evidenceRequest = null;
    evidenceReturnFocus = null;
    await tick();
    if (evidenceRequest || !simpleInvestigation) return;
    if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus();
    else document.getElementById('investigation-activity')?.focus();
  }
  function openFullDetails(title: string, row: RecordData) {
    detail = { title, row };
  }
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
      const destination = advanced ? 'agents' : 'overview';
      scrolls[destination] = 0;
      if (view === destination && workspace) workspace.scrollTop = 0;
      agentSection = { id: String(row.detailSection || 'overview'), revision: ++sectionRevision };
      void navigate(advanced ? 'agents' : 'overview').then(() => {
        if (scope.agent === agent) {
          document
            .getElementById(advanced ? 'agent-workspace-heading' : 'investigation-context')
            ?.focus();
        }
      });
      return;
    }
    if (!advanced && (kind === 'resource' || row.type === 'sequence-detection')) {
      captureEvidence(title, row);
      return;
    }
    openFullDetails(title, row);
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
    if (!advanced && isInvestigationWorkspace(next)) {
      if (next === 'events' || next === 'network')
        activityChannelRequest = {
          channel: next === 'network' ? 'connections' : 'files',
          revision: ++sectionRevision,
        };
      next = 'overview';
    }
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
    const stopKeyboardPreferences = mountKeyboardPreferences();
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
    footerLayout = mountFooterLayout(statusFooter);
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
      footerLayout?.destroy();
      footerLayout = undefined;
      stop();
      stopKeyboardPreferences();
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
    if (!$singleKeyShortcuts) return;
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
<div
  class="app observatory-app"
  class:simple={!advanced}
  class:paused
  class:stale={telemetry.stale}
>
  <aside class="sidebar">
    <a class="brand" href="#main"
      ><img class="brand-symbol" src="assets/aegis.svg" alt="" width="28" height="28" />{$t(
        'AEGIS',
      )}<span class="version">{version}</span></a
    >
    {#if advanced}<div class="machine">
        <Icon name="monitor" />
        <div>
          <strong>{$t('Workstation')}</strong><small
            >{preview ? $t('Preview / local') : $t('Desktop / local')}</small
          >
        </div>
        <span class="status-indicator"><Icon name="check" /></span>
      </div>{/if}
    <nav aria-label={$t('Main navigation')}>
      {#each advanced ? workspaceGroups : [{ id: 'simple', label: 'Simple' }] as category (category.id)}
        <div class="nav-group">
          {#if advanced}<span class="nav-group-label">{$t(category.label)}</span>{/if}
          {#each navigationEntries.filter((entry) => !advanced || entry.group === category.id) as entry (entry.id)}
            <button
              class="nav"
              aria-label={$t(entry.label)}
              class:active={view === entry.id || (simpleInvestigation && entry.id === 'overview')}
              aria-current={view === entry.id || (simpleInvestigation && entry.id === 'overview')
                ? 'page'
                : undefined}
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
      {#if advanced}<button class="sensor-mini" onclick={openSensors}
          ><span class="sensor-indicator"><Icon name="shield" /></span><span
            >{$t('Sensors')}<small>{$t(healthCaption)}</small></span
          ><Icon name="chevron" /></button
        >{/if}
      <div class="sidebar-foot">
        {preview ? $t('Preview · simulated data') : $t('Local observations')}
      </div>
      <AppExit {host} {preview} />
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
        {$t(
          advanced
            ? (workspaceGroups.find((entry) => entry.id === group)?.label ?? '')
            : technicalWorkspace
              ? 'Advanced'
              : 'Simple',
        )}<span>/</span><strong>{title}</strong>
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
          {#if technicalWorkspace}<span class="badge">{$t('Advanced')}</span>{/if}
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
      {#if view === 'overview' && advanced}
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
      {#if technicalWorkspace && !advanced}
        <div class="advanced-workspace-note">
          <p>
            {$t(
              'This technical workspace remains available in Simple. Show every workspace from Settings.',
            )}
          </p>
          <button class="button" onclick={openInterfaceSettings}
            >{$t('Interface settings')}<Icon name="chevron" /></button
          >
        </div>
      {/if}
      {#if isLiveWorkspace && view !== 'overview' && !simpleInvestigation}<AgentContext
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
      {#if auditDropped !== null && auditDropped > 0}
        <p role="alert" class="health-banner audit-loss-banner">
          {$t('Audit records lost from the buffer in this session: {value0}.', {
            value0: auditDropped,
          })}
          {#if auditPending !== null && auditPending > 0}
            {$t('Records still pending disk write: {value0}.', { value0: auditPending })}
          {/if}
          {#if auditWriteFailed}
            {$t('The last audit write failed; pending records may be lost if AEGIS stops.')}
          {/if}
        </p>
      {:else if auditWriteFailed}
        <p role="alert" class="health-banner">
          {$t('The last audit write failed; pending records may be lost if AEGIS stops.')}
        </p>
      {/if}
      <SensorStatus health={record(telemetry.stats.appHealth)} />
      <div id="workspace-content" role="region" aria-labelledby="page-title">
        <div id="content" class:analysis-view={view === 'analysis'}>
          {#if tabs.includes('guide')}<div hidden={view !== 'guide'}>
              <TaskGuide {host} {preview} {navigate} />
            </div>{/if}
          {#if investigationMounted}<div hidden={!simpleInvestigation}>
              <InvestigationWorkbench
                telemetry={displayTelemetry}
                liveTelemetry={telemetry}
                {host}
                {scope}
                change={changeScope}
                {inspect}
                capture={captureEvidence}
                request={evidenceRequest}
                {closeEvidence}
                fullDetails={openFullDetails}
                refreshFalsePositives={refreshExceptionStatus}
                statusRevision={exceptionStatusRevision}
                inspectorVisible={simpleInvestigation && detail === null}
                channelRequest={activityChannelRequest}
                {paused}
                visible={simpleInvestigation}
              />
            </div>{/if}
          <div hidden={!advanced || view !== 'overview' || detailedMonitoring}>
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
              hidden={!advanced ||
                ((view !== 'overview' || !detailedMonitoring) &&
                  (view !== 'agents' || scope.agent !== ''))}
            >
              <Monitoring
                {advanced}
                liveTelemetry={telemetry}
                telemetry={displayTelemetry}
                bind:selected
                {inspect}
                mode={view}
                {openStatistics}
                openAgent={(agent) => inspect(agent, { agentGroupKey: agent, name: agent })}
                paused={paused || !advanced || view !== 'overview' || !detailedMonitoring}
                navigate={(target) => {
                  changeScope({ agent: '', instanceId: '' });
                  return navigate(target);
                }}
              />
            </div>{/if}
          {#if agentWorkspaceMounted}<div hidden={!advanced || view !== 'agents' || !scope.agent}>
              <AgentWorkspace
                telemetry={displayTelemetry}
                liveTelemetry={telemetry}
                {host}
                {scope}
                advanced={true}
                change={changeScope}
                {inspect}
                {navigate}
                {openInterfaceSettings}
                {paused}
                sectionRequest={agentSection}
                visible={advanced && view === 'agents'}
              />
            </div>{/if}
          {#if tabs.includes('events')}<div hidden={!advanced || view !== 'events'}>
              <Events
                {advanced}
                combined={!advanced}
                visible={advanced && view === 'events'}
                viewPaused={paused}
                showPause={false}
                telemetry={displayTelemetry}
                {scope}
                {inspect}
              />
            </div>{/if}
          {#if tabs.includes('network')}<div hidden={!advanced || view !== 'network'}>
              <Events
                visible={advanced && view === 'network'}
                viewPaused={paused}
                showPause={false}
                telemetry={displayTelemetry}
                {scope}
                network
                {inspect}
                {openSensors}
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
                {advanced}
                onAdvancedChange={(value) => (advanced = value)}
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
    <footer bind:this={statusFooter}>
      <button
        onfocus={(event) =>
          event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
        onkeydown={scrollFooter}
        onclick={openSensors}
        ><Icon name="shield" />{$t(
          observationStatusLabel(record(telemetry.stats.appHealth).state),
        )}</button
      >{#if advanced}<span
          >{$t('AEGIS CPU')} <b>{ownCpu === null ? '—' : ownCpu.toFixed(1)}%</b>
          {$t('· RAM')}
          <b>{String(telemetry.own.memMB ?? '—')} {$t('MB')}</b>
          {$t('· heap')}
          <b>{String(telemetry.own.heapMB ?? '—')} {$t('MB')}</b></span
        >{/if}<button
        class="audit-delivery"
        class:audit-loss={auditDropped !== null && auditDropped > 0}
        class:audit-write-failed={auditWriteFailed}
        onfocus={(event) =>
          event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
        onkeydown={scrollFooter}
        onclick={openAuditDelivery}
        ><Icon name="history" />{$t('Audit delivery')}
        {#if auditDropped === null || auditPending === null}
          {$t('status unavailable')}
        {:else}
          {$t('{value0} lost this session · {value1} pending write', {
            value0: auditDropped,
            value1: auditPending,
          })}
          {#if auditWriteFailed}{$t('· Last write failed')}{/if}
        {/if}</button
      ><span
        >{telemetry.lastScan
          ? $t('Observed {value0}', { value0: new Date(telemetry.lastScan).toLocaleTimeString() })
          : $t('No reliable scan yet')}</span
      >
    </footer>
  </div>
</div>
<WorkspaceCommands
  {advanced}
  open={commands}
  close={() => (commands = false)}
  entries={commandEntries}
  choose={runCommand}
/>
<Notifications {telemetry} {host} onInspect={inspect} />
<Details
  {host}
  {telemetry}
  refreshFalsePositives={refreshExceptionStatus}
  statusRevision={exceptionStatusRevision}
  request={detail}
  openAgent={inspect}
  close={() => (detail = null)}
/>

<style>
  .app.simple {
    grid-template-columns: 165px minmax(0, 1fr);
  }
  .simple .brand {
    font-size: calc(18px * var(--ui-scale));
    flex-wrap: wrap;
    gap: 6px;
  }
  .simple .nav span {
    white-space: normal;
  }
  .advanced-workspace-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--panel-inset);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
  }
  .advanced-workspace-note p {
    flex: 1 1 240px;
    margin: 0;
    color: var(--muted);
    font-size: var(--text-body);
    line-height: 1.5;
  }
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
  .audit-loss-banner {
    border-color: var(--red);
  }
  footer .audit-delivery.audit-loss {
    color: var(--red);
  }
  footer .audit-delivery.audit-write-failed:not(.audit-loss) {
    color: var(--amber);
  }
</style>
