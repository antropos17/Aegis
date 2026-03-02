<script>
  import { enrichedAgents } from '../stores/risk.js';
  import AgentCard from './AgentCard.svelte';
  import { t } from '../i18n/index.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let expandedPid = $state(null);
  let localAgents = $state([]);

  $effect(() => {
    if (!active) return;
    localAgents = $enrichedAgents;
  });
</script>

<section class="agent-panel">
  {#if localAgents.length === 0}
    <div class="empty-state">
      <span>{$t('agents.no_agents')}</span>
    </div>
  {:else}
    <div class="agent-list">
      {#each localAgents as agent (agent.pid)}
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
