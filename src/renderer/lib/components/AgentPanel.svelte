<script>
  import { enrichedAgents } from '../stores/risk.js';
  import AgentCard from './AgentCard.svelte';

  let grouped = $derived.by(() => {
    const map = new Map();
    for (const a of $enrichedAgents) {
      if (!map.has(a.name)) {
        map.set(a.name, { ...a, pids: [] });
      }
      const g = map.get(a.name);
      g.pids.push({ pid: a.pid, process: a.process });
      if (a.riskScore > g.riskScore) {
        g.riskScore = a.riskScore;
        g.trustGrade = a.trustGrade;
      }
    }
    return [...map.values()];
  });
</script>

<section class="agent-panel">
  {#if grouped.length === 0}
    <div class="empty-state">
      <span>No AI agents detected</span>
    </div>
  {:else}
    <div class="agent-list">
      {#each grouped as agent (agent.name)}
        <AgentCard {agent} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .agent-panel {
    height: 100%;
    overflow-y: auto;
    padding: 4px;
    min-width: 280px;
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
