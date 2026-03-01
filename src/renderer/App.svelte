<script>
  import Header from './lib/components/Header.svelte';
  import Footer from './lib/components/Footer.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import ShieldTab from './lib/components/ShieldTab.svelte';
  import ActivityTab from './lib/components/ActivityTab.svelte';
  import RulesTab from './lib/components/RulesTab.svelte';
  import ReportsTab from './lib/components/ReportsTab.svelte';
  import { theme, uiScale, toggleTheme } from './lib/stores/theme.js';
  import Toast from './lib/components/Toast.svelte';
  import { addToast } from './lib/stores/toast.js';
  import { agents, anomalies } from './lib/stores/ipc.js';

  const TAB_IDS = ['shield', 'activity', 'rules', 'reports'];

  let activeTab = $state('shield');
  let optionsOpen = $state(false);

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
      const tag = document.activeElement?.tagName;
      const isInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

      if (isInput && e.key !== 'Escape') return;

      switch (e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
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
  let prevAnomalyKeys = $state(new Set());
  $effect(() => {
    const scores = $anomalies;
    if (!scores || typeof scores !== 'object') return;
    for (const [agent, score] of Object.entries(scores)) {
      if (typeof score === 'number' && score >= 50 && !prevAnomalyKeys.has(agent)) {
        addToast(`Anomaly: ${agent} score ${score}`, 'warning');
        prevAnomalyKeys = new Set([...prevAnomalyKeys, agent]);
      }
    }
  });
</script>

<Header bind:optionsOpen />

<div class="app-shell">
  <nav class="app-nav">
    <TabBar bind:activeTab />
  </nav>

  <main class="app-content">
    {#key activeTab}
      <div
        class="tab-content"
        id="tabpanel-{activeTab}"
        role="tabpanel"
        aria-labelledby="tab-{activeTab}"
      >
        {#if activeTab === 'shield'}
          <ShieldTab />
        {:else if activeTab === 'activity'}
          <ActivityTab />
        {:else if activeTab === 'rules'}
          <RulesTab />
        {:else if activeTab === 'reports'}
          <ReportsTab />
        {/if}
      </div>
    {/key}
  </main>
</div>

<Footer />
<Toast />

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
    padding: var(--aegis-space-8) var(--aegis-space-9);
    min-height: 0;
    overflow: hidden;
  }

  .tab-content {
    height: 100%;
    animation: tabFadeIn 200ms var(--md-sys-motion-easing-standard);
  }

  @keyframes tabFadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tab-content {
      animation: none;
    }
  }
</style>
