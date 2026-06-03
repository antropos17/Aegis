<script>
  import { fade } from 'svelte/transition';
  import { agents, firstScanDone } from '../stores/ipc.js';
  import { t } from '../i18n/index.js';
  import Radar from './Radar.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import FeedFilters from './FeedFilters.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import SummaryCards from './SummaryCards.svelte';
  import SkeletonLoader from './SkeletonLoader.svelte';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let agentFilter = $state('all');
  let severityFilter = $state('all');
  let typeFilter = $state('all');

  // Three render states, derived live from the stores (no latch):
  //   populated → at least one agent detected → show the bento dashboard
  //   empty     → first scan landed but found nothing → show an empty state
  //   loading   → first scan hasn't arrived yet → show skeletons
  // Deriving `populated` from the live store (rather than a one-way latch)
  // means a machine whose last agent exits correctly falls back to the empty
  // state instead of being stuck showing a populated dashboard.
  let populated = $derived($agents.length > 0);
  let empty = $derived(!populated && $firstScanDone);
</script>

<div class="bento">
  {#if populated}
    <div class="bento-radar panel" transition:fade={{ duration: 300 }}>
      <Radar {active} />
    </div>
    <div class="bento-summary panel" transition:fade={{ duration: 300 }}>
      <SummaryCards {active} />
    </div>
    <div class="bento-feed panel" transition:fade={{ duration: 300 }}>
      <FeedFilters {active} bind:agentFilter bind:severityFilter bind:typeFilter />
      <ActivityFeed {active} {agentFilter} {severityFilter} {typeFilter} />
    </div>
    <div class="bento-agents panel" transition:fade={{ duration: 300 }}>
      <AgentPanel {active} />
    </div>
  {:else if empty}
    <div class="bento-empty panel" transition:fade={{ duration: 300 }}>
      <div class="empty-card">
        <h2 class="empty-title">{$t('agents.no_agents')}</h2>
        <p class="empty-hint">{$t('agents.no_agents_hint')}</p>
      </div>
    </div>
  {:else}
    <div class="bento-radar panel">
      <SkeletonLoader lines={5} style="list" />
    </div>
    <div class="bento-summary panel">
      <SkeletonLoader lines={4} style="card" />
    </div>
    <div class="bento-feed panel">
      <SkeletonLoader lines={3} style="card" />
      <SkeletonLoader lines={3} style="card" />
    </div>
    <div class="bento-agents panel">
      <SkeletonLoader lines={3} style="card" />
      <SkeletonLoader lines={3} style="card" />
      <SkeletonLoader lines={3} style="card" />
    </div>
  {/if}
</div>

<style>
  /* ── Bento Grid (F1.2) ── */
  .bento {
    display: grid;
    grid-template-columns: 350px minmax(0, 1fr) 380px;
    grid-template-rows: 250px minmax(0, 1fr);
    gap: var(--fancy-space-md);
    height: 100%;
    padding: var(--fancy-space-md);
    overflow: hidden;
  }

  /* ── Glass panel ── */
  .panel {
    background: var(--fancy-panel-bg-opaque);
    border: var(--fancy-panel-border);
    border-radius: var(--fancy-panel-radius);
    box-shadow: var(--fancy-panel-shadow);
    overflow: hidden;
    transition: border-color var(--fancy-transition-micro) var(--fancy-ease);
  }

  .panel:hover {
    border-color: var(--fancy-border-highlight);
  }

  /* ── Radar: left column, spans 2 rows ── */
  .bento-radar {
    grid-column: 1;
    grid-row: 1 / span 2;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Summary: top center (F1.3) ── */
  .bento-summary {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }

  /* ── Feed: bottom center ── */
  .bento-feed {
    grid-column: 2;
    grid-row: 2;
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--fancy-space-sm);
    padding: var(--fancy-space-sm);
  }

  /* ── Agents: right column, spans 2 rows ── */
  .bento-agents {
    grid-column: 3;
    grid-row: 1 / span 2;
    overflow-y: auto;
    min-height: 0;
  }

  /* ── Empty state: spans the whole grid when no agents are detected ── */
  .bento-empty {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--fancy-space-md);
  }

  .empty-card {
    max-width: 420px;
    text-align: center;
  }

  .empty-title {
    margin: 0 0 var(--fancy-space-sm);
    font: var(--md-sys-typescale-title-medium);
    color: var(--md-sys-color-on-surface);
  }

  .empty-hint {
    margin: 0;
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  /* ── Responsive: 2-col at medium ── */
  @media (max-width: 1100px) {
    .bento {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 280px auto minmax(0, 1fr);
    }

    .bento-radar {
      grid-column: 1;
      grid-row: 1;
    }

    .bento-summary {
      grid-column: 2;
      grid-row: 1;
    }

    .bento-feed {
      grid-column: 1 / -1;
      grid-row: 3;
    }

    .bento-agents {
      grid-column: 1 / -1;
      grid-row: 2;
      max-height: 240px;
    }
  }

  /* ── Responsive: single-col on narrow ── */
  @media (max-width: 720px) {
    .bento {
      grid-template-columns: 1fr;
      grid-template-rows: 250px 120px 200px minmax(0, 1fr);
    }

    .bento-radar {
      grid-column: 1;
      grid-row: 1;
    }

    .bento-summary {
      grid-column: 1;
      grid-row: 2;
    }

    .bento-agents {
      grid-column: 1;
      grid-row: 3;
    }

    .bento-feed {
      grid-column: 1;
      grid-row: 4;
    }
  }
</style>
