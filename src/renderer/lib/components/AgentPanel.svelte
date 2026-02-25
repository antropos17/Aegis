<script>
  import { enrichedAgents } from '../stores/risk.js';
  import AgentCard from './AgentCard.svelte';

  let expandedPid = $state(null);
</script>

<section class="agent-panel">
  {#if $enrichedAgents.length === 0}
    <div class="empty-state">
      <span>No AI agents detected</span>
    </div>
  {:else}
    <div class="agent-list">
      {#each $enrichedAgents as agent (agent.pid)}
        <AgentCard {agent} bind:expandedPid />
      {/each}
    </div>
  {/if}
</section>

<style>
  .agent-panel {
    height: 100%;
    overflow-y: auto;
    padding: var(--aegis-space-2) var(--aegis-space-6) var(--aegis-space-2) var(--aegis-space-2);
    min-width: var(--aegis-size-panel-min);
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-4);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }
</style>
