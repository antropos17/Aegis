<script>
  import { enrichedAgents } from '../stores/risk.js';
  import { selectedAgentInstanceId } from '../stores/ipc.js';
  import AgentCard from './AgentCard.svelte';
  import { t } from '../i18n/index.js';
  import { groupAgentsForPanel } from '../utils/agent-panel-utils.ts';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let localAgents = $state([]);

  $effect(() => {
    if (!active) return;
    localAgents = $enrichedAgents;
  });

  // F-W05: one population per card — representative (max risk) owns risk/file/net;
  // multi-instance is only via _processCount / _instances (not summed activity).
  let grouped = $derived(groupAgentsForPanel(localAgents));
</script>

<section class="agent-panel">
  {#if grouped.length === 0}
    <div class="empty-state">
      <span>{$t('agents.no_agents')}</span>
    </div>
  {:else}
    <div class="agent-list">
      {#each grouped as agent (agent.name)}
        <AgentCard {agent} bind:expandedInstanceId={$selectedAgentInstanceId} />
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
