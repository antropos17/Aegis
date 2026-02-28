<script>
  import { stats } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import OptionsPanel from './OptionsPanel.svelte';

  let optionsOpen = $state(false);

  let shieldScore = $derived.by(() => {
    const list = $enrichedAgents;
    if (!list.length) return '--';
    const avg = list.reduce((sum, a) => sum + a.riskScore, 0) / list.length;
    return Math.max(0, Math.round(100 - avg));
  });

  let agentCount = $derived($enrichedAgents.length);
  let filesMonitored = $derived($stats.totalFiles ?? '--');

  function getScoreClass(score) {
    if (typeof score !== 'number') return '';
    if (score < 40) return 'danger';
    if (score < 70) return 'warn';
    return '';
  }

  let scoreClass = $derived(getScoreClass(shieldScore));
</script>

<header class="header">
  <div class="header-brand">AEGIS</div>

  <div class="header-stats">
    <span class="shield-score {scoreClass}">{shieldScore}</span>
    <span class="stat-sep">&middot;</span>
    <span class="stat-text">{agentCount} {agentCount === 1 ? 'agent' : 'agents'}</span>
    <span class="stat-sep">&middot;</span>
    <span class="stat-text">{filesMonitored} files</span>
  </div>

  <button
    class="icon-btn"
    aria-label="Settings"
    onclick={() => {
      optionsOpen = true;
    }}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6.5.5h3l.4 2 1.3.7 1.8-1 2.1 2.1-1 1.8.7 1.3 2 .4v3l-2 .4-.7 1.3 1 1.8-2.1 2.1-1.8-1-1.3.7-.4 2h-3l-.4-2-1.3-.7-1.8 1L.9 13.3l1-1.8-.7-1.3-2-.4v-3l2-.4.7-1.3-1-1.8L2.9.9l1.8 1 1.3-.7z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2" />
    </svg>
  </button>
</header>

<OptionsPanel bind:open={optionsOpen} />

<style>
  .header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
    padding: var(--aegis-space-5) var(--aegis-space-9);
    background: var(--aegis-color-header-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-bottom: 1px solid var(--aegis-color-header-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .header-brand {
    font: var(--md-sys-typescale-title-medium);
    font-size: calc(16px * var(--aegis-ui-scale));
    letter-spacing: 0.12em;
    color: var(--aegis-color-brand);
    flex-shrink: 0;
  }

  .header-stats {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
    margin-left: auto;
  }

  .shield-score {
    font: var(--md-sys-typescale-label-large);
    font-family: 'DM Mono', monospace;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--md-sys-color-on-surface);
  }

  .shield-score.warn {
    color: var(--md-sys-color-secondary);
  }

  .shield-score.danger {
    color: var(--md-sys-color-error);
  }

  .stat-sep {
    color: var(--md-sys-color-outline);
  }

  .stat-text {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    font-variant-numeric: tabular-nums;
  }

  .icon-btn {
    flex-shrink: 0;
    padding: var(--aegis-space-3);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
    transition: all 0.3s var(--ease-glass);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container);
    border-color: rgba(255, 255, 255, 0.15);
  }
</style>
