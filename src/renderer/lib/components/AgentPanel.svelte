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

  /**
   * Group agents by name — pick the representative (highest risk) per name,
   * aggregate totals, and attach process count.
   */
  let grouped = $derived.by(() => {
    /** @type {Map<string, any[]>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byName = new Map();
    for (const a of localAgents) {
      let arr = byName.get(a.name);
      if (!arr) {
        arr = [];
        byName.set(a.name, arr);
      }
      arr.push(a);
    }
    return [...byName.values()].map((instances) => {
      const rep = instances.reduce((best, cur) =>
        (cur.riskScore || 0) > (best.riskScore || 0) ? cur : best,
      );
      return {
        ...rep,
        fileCount: instances.reduce((s, a) => s + (a.fileCount || 0), 0),
        networkCount: instances.reduce((s, a) => s + (a.networkCount || 0), 0),
        _processCount: instances.length,
      };
    });
  });
</script>

<section class="agent-panel">
  {#if grouped.length === 0}
    <div class="empty-state">
      <span>{$t('agents.no_agents')}</span>
    </div>
  {:else}
    <div class="agent-list">
      {#each grouped as agent (agent.name)}
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
