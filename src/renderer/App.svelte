<script>
  import Header from './lib/components/Header.svelte';
  import Footer from './lib/components/Footer.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import ShieldTab from './lib/components/ShieldTab.svelte';
  import ActivityTab from './lib/components/ActivityTab.svelte';
  import RulesTab from './lib/components/RulesTab.svelte';
  import ReportsTab from './lib/components/ReportsTab.svelte';
  import AgentStatsPanel from './lib/components/AgentStatsPanel.svelte';
  import { theme, uiScale, toggleTheme, setTheme } from './lib/stores/theme.js';
  import Toast from './lib/components/Toast.svelte';
  import CommandPalette from './lib/components/CommandPalette.svelte';
  import { commandPalette } from './lib/stores/command-palette.svelte.ts';
  import { addToast } from './lib/stores/toast.js';
  import { agents, anomalies, isDemoMode } from './lib/stores/ipc.js';
  import DemoBanner from './lib/components/DemoBanner.svelte';
  import {
    getSlideDirection,
    SLIDE_OFFSET_PX,
    TRANSITION_DURATION_MS,
  } from './lib/utils/tab-transitions.js';
  import { SvelteSet } from 'svelte/reactivity';

  const TAB_IDS = ['shield', 'activity', 'rules', 'reports', 'stats'];

  let activeTab = $state('shield');
  let prevTab = $state('shield');
  let slideDir = $state(1);
  let optionsOpen = $state(false);

  $effect(() => {
    if (activeTab !== prevTab) {
      slideDir = getSlideDirection(prevTab, activeTab);
      prevTab = activeTab;
    }
  });

  $effect(() => {
    document.documentElement.dataset.theme = $theme;
  });

  $effect(() => {
    const cleanup = window.aegis?.onToggleTheme?.(() => toggleTheme());
    return () => cleanup?.();
  });

  $effect(() => {
    document.documentElement.style.setProperty('--aegis-ui-scale', String($uiScale));
  });

  $effect(() => {
    /** @param {KeyboardEvent} e */
    function handleKeydown(e) {
      // Ctrl+K / Cmd+K: toggle command palette
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        commandPalette.toggle();
        return;
      }

      // When palette is open, let it handle all keys
      if (commandPalette.open) return;

      // Ctrl+1-5: switch tabs (works even from inputs)
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < TAB_IDS.length) {
          e.preventDefault();
          activeTab = TAB_IDS[idx];
          return;
        }
      }

      const tag = document.activeElement?.tagName;
      const isInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

      if (isInput && e.key !== 'Escape') return;

      switch (e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          activeTab = TAB_IDS[parseInt(e.key) - 1];
          break;
        case 's':
        case 'S':
          optionsOpen = true;
          break;
        case 't':
        case 'T':
          toggleTheme();
          break;
        case 'Escape':
          optionsOpen = false;
          break;
        case '/': {
          e.preventDefault();
          /** @type {HTMLInputElement | null} */
          const input = document.querySelector('input[type="search"], input[type="text"]');
          input?.focus();
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  // ── Toast: scan complete ──
  let prevAgentCount = $state(-1);
  $effect(() => {
    const count = $agents.length;
    if (prevAgentCount === -1) {
      prevAgentCount = count;
      return;
    }
    if (count !== prevAgentCount) {
      addToast(`Scan complete: ${count} agent${count !== 1 ? 's' : ''} detected`, 'success');
      prevAgentCount = count;
    }
  });

  // ── Toast: anomaly detected ──
  let prevAnomalyKeys = new SvelteSet();
  $effect(() => {
    const scores = $anomalies;
    if (!scores || typeof scores !== 'object') return;
    const currentKeys = new SvelteSet();
    for (const [agent, score] of Object.entries(scores)) {
      if (typeof score === 'number' && score >= 50) {
        currentKeys.add(agent);
        if (!prevAnomalyKeys.has(agent)) {
          addToast(`Anomaly: ${agent} score ${score}`, 'warning');
        }
      }
    }
    prevAnomalyKeys = currentKeys;
  });

  // ── Command palette: execute actions ──
  $effect(() => {
    const cmd = commandPalette.lastExecuted;
    if (!cmd) return;

    switch (cmd.id) {
      // Navigation
      case 'nav:shield':
        activeTab = 'shield';
        break;
      case 'nav:activity':
        activeTab = 'activity';
        break;
      case 'nav:rules':
        activeTab = 'rules';
        break;
      case 'nav:reports':
        activeTab = 'reports';
        break;
      case 'nav:stats':
        activeTab = 'stats';
        break;
      case 'nav:settings':
        optionsOpen = !optionsOpen;
        break;
      case 'nav:search': {
        /** @type {HTMLInputElement | null} */
        const input = document.querySelector('input[type="search"], input[type="text"]');
        input?.focus();
        break;
      }
      // Theme
      case 'theme:toggle':
        toggleTheme();
        break;
      case 'theme:dark':
        setTheme('dark');
        break;
      case 'theme:light':
        setTheme('light');
        break;
      case 'theme:dark-hc':
        setTheme('dark-hc');
        break;
      case 'theme:light-hc':
        setTheme('light-hc');
        break;
      // Actions
      case 'action:test-notification':
        addToast('Test notification', 'success');
        break;
      case 'action:toggle-demo':
        console.log('TODO: toggle demo mode (isDemoMode is compile-time const)');
        break;
      case 'action:analyze-session':
        console.log('TODO: analyze session');
        break;
      // Export
      case 'export:json':
      case 'export:csv':
      case 'export:html':
      case 'export:zip':
      case 'export:audit':
      case 'export:config':
      case 'export:agent-db':
        console.log('TODO: export', cmd.id);
        break;
      default:
        console.log('Unknown command:', cmd.id);
    }
  });
</script>

<Header bind:optionsOpen />

<div class="app-shell">
  <nav class="app-nav">
    <TabBar bind:activeTab />
  </nav>

  <main
    class="app-content"
    style:--slide-offset="{SLIDE_OFFSET_PX}px"
    style:--slide-dir={slideDir}
    style:--tab-dur="{TRANSITION_DURATION_MS}ms"
  >
    {#each TAB_IDS as tabId (tabId)}
      {@const isActive = activeTab === tabId}
      <div
        class="tab-panel"
        class:tab-active={isActive}
        class:tab-inactive={!isActive}
        id="tabpanel-{tabId}"
        role="tabpanel"
        aria-labelledby="tab-{tabId}"
        aria-hidden={!isActive}
      >
        {#if tabId === 'shield'}
          <ShieldTab active={isActive} />
        {:else if tabId === 'activity'}
          <ActivityTab active={isActive} />
        {:else if tabId === 'rules'}
          <RulesTab active={isActive} />
        {:else if tabId === 'reports'}
          <ReportsTab active={isActive} />
        {:else if tabId === 'stats'}
          <AgentStatsPanel active={isActive} />
        {/if}
      </div>
    {/each}
  </main>
</div>

{#if isDemoMode}
  <DemoBanner />
{/if}

<Footer />
<Toast />
<CommandPalette />

<style>
  .app-shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding-top: var(--aegis-size-header);
    padding-bottom: var(--aegis-size-footer);
    overflow: hidden;
  }

  .app-nav {
    display: flex;
    justify-content: center;
    padding: var(--aegis-space-6) var(--aegis-space-9) 0;
    flex-shrink: 0;
  }

  .app-content {
    flex: 1;
    position: relative;
    padding: var(--aegis-space-8) var(--aegis-space-9);
    min-height: 0;
    overflow: hidden;
  }

  .tab-panel {
    position: absolute;
    inset: 0;
    padding: inherit;
    will-change: transform, opacity;
    transition:
      opacity var(--tab-dur, 220ms) var(--ease-glass),
      transform var(--tab-dur, 220ms) var(--ease-glass);
  }

  .tab-active {
    opacity: 1;
    transform: translateX(0);
    z-index: 1;
    pointer-events: auto;
  }

  .tab-inactive {
    opacity: 0;
    transform: translateX(calc(var(--slide-offset, 24px) * var(--slide-dir, 1) * -1));
    z-index: 0;
    pointer-events: none;
    visibility: hidden;
    transition:
      opacity var(--tab-dur, 220ms) var(--ease-glass),
      transform var(--tab-dur, 220ms) var(--ease-glass),
      visibility 0s var(--tab-dur, 220ms);
  }
</style>
