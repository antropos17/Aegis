<script>
  import { agents } from './lib/stores/ipc.js';
  import TabBar from './lib/components/TabBar.svelte';
  import ShieldTab from './lib/components/ShieldTab.svelte';
  import ActivityTab from './lib/components/ActivityTab.svelte';
  import RulesTab from './lib/components/RulesTab.svelte';
  import ReportsTab from './lib/components/ReportsTab.svelte';

  let activeTab = $state('shield');
</script>

<div class="app-shell">
  <header class="app-header">
    <h1 class="app-title">AEGIS</h1>
    <TabBar bind:activeTab />
    <span class="agent-count">{$agents.length} agents</span>
  </header>

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

<style>
  :global(body) {
    margin: 0;
    background: var(--bg, #0c0c0e);
    color: var(--text, #e8e6e2);
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .app-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    background: var(--surface-1, #141416);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .app-title {
    font-family: 'Outfit', system-ui, sans-serif;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    margin: 0;
    color: var(--text, #e8e6e2);
  }

  .agent-count {
    margin-left: auto;
    font-size: 0.8rem;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
  }

  .app-content {
    flex: 1;
    padding: 20px;
  }
</style>
