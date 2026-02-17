<script>
  import Header from './lib/components/Header.svelte';
  import Footer from './lib/components/Footer.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import ShieldTab from './lib/components/ShieldTab.svelte';
  import ActivityTab from './lib/components/ActivityTab.svelte';
  import RulesTab from './lib/components/RulesTab.svelte';
  import ReportsTab from './lib/components/ReportsTab.svelte';

  let activeTab = $state('shield');
</script>

<Header />

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
  :global(body) {
    margin: 0;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font: var(--md-sys-typescale-body-medium);
  }

  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding-top: 48px;
    padding-bottom: 32px;
  }

  .app-nav {
    display: flex;
    justify-content: center;
    padding: 12px 20px 0;
  }

  .app-content {
    flex: 1;
    padding: 16px 20px;
  }
</style>
