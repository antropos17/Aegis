<script>
  import { fade } from 'svelte/transition';
  import { agents } from '../stores/ipc.js';
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

  /** True once first scan batch arrives with agent data */
  let dataReady = $state(false);
  $effect(() => {
    if ($agents.length > 0) dataReady = true;
  });
</script>

<div class="bento">
  {#if dataReady}
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
    background: var(--fancy-panel-bg);
    border: var(--fancy-panel-border);
    border-radius: var(--fancy-panel-radius);
    backdrop-filter: blur(var(--fancy-panel-blur));
    -webkit-backdrop-filter: blur(var(--fancy-panel-blur));
    box-shadow: var(--fancy-panel-shadow);
    overflow: hidden;
    transition: border-color var(--fancy-transition-micro) var(--fancy-ease);
  }

  .panel:hover {
    border-color: var(--fancy-border-highlight);
  }

  .panel-title {
    display: block;
    padding: var(--fancy-space-md);
    font-family: var(--fancy-font-title);
    font-weight: 600;
    font-size: 14px;
    color: var(--fancy-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    overflow-y: auto;
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
