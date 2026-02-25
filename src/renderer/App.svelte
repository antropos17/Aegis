<script>
  import Header from './lib/components/Header.svelte';
  import Footer from './lib/components/Footer.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import ShieldTab from './lib/components/ShieldTab.svelte';
  import ActivityTab from './lib/components/ActivityTab.svelte';
  import RulesTab from './lib/components/RulesTab.svelte';
  import ReportsTab from './lib/components/ReportsTab.svelte';
  import { theme, uiScale, toggleTheme } from './lib/stores/theme.js';

  let activeTab = $state('shield');

  $effect(() => {
    document.documentElement.dataset.theme = $theme;
  });

  $effect(() => {
    if (window.aegis?.onToggleTheme) {
      window.aegis.onToggleTheme(() => toggleTheme());
    }
  });

  $effect(() => {
    document.documentElement.style.setProperty('--aegis-ui-scale', String($uiScale));
  });
</script>

<Header />

<div class="app-shell">
  <nav class="app-nav">
    <TabBar bind:activeTab />
  </nav>

  <main class="app-content">
    {#key activeTab}
      <div class="tab-content">
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
</style>
