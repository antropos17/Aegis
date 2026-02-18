<script>
  import Header from './lib/components/Header.svelte';
  import Footer from './lib/components/Footer.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import ShieldTab from './lib/components/ShieldTab.svelte';
  import ActivityTab from './lib/components/ActivityTab.svelte';
  import RulesTab from './lib/components/RulesTab.svelte';
  import ReportsTab from './lib/components/ReportsTab.svelte';
  import Settings from './lib/components/Settings.svelte';
  import { theme } from './lib/stores/theme.js';

  let activeTab = $state('shield');
  let settingsOpen = $state(false);

  $effect(() => {
    document.documentElement.dataset.theme = $theme;
  });
</script>

<Header onSettingsClick={() => { settingsOpen = true; }} />
<Settings bind:open={settingsOpen} />

<div class="app-shell">
  <nav class="app-nav">
    <TabBar bind:activeTab />
  </nav>

  <main class="app-content">
    {#if activeTab === 'shield'}
      <ShieldTab />
    {:else if activeTab === 'activity'}
      <ActivityTab />
    {:else if activeTab === 'rules'}
      <RulesTab />
    {:else if activeTab === 'reports'}
      <ReportsTab />
    {/if}
  </main>
</div>

<Footer />

<style>
  .app-shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding-top: 48px;
    padding-bottom: 32px;
    overflow: hidden;
  }

  .app-nav {
    display: flex;
    justify-content: center;
    padding: 12px 20px 0;
    flex-shrink: 0;
  }

  .app-content {
    flex: 1;
    padding: 16px 20px;
    min-height: 0;
    overflow: hidden;
  }
</style>
