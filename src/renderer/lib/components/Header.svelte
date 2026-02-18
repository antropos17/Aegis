<script>
  import { stats } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import { theme, toggleTheme } from '../stores/theme.js';

  let { onSettingsClick = () => {} } = $props();

  let isDark = $derived($theme === 'dark');

  let shieldScore = $derived.by(() => {
    const list = $enrichedAgents;
    if (!list.length) return '--';
    const avg = list.reduce((sum, a) => sum + a.riskScore, 0) / list.length;
    return Math.max(0, Math.round(100 - avg));
  });

  let agentCount = $derived($enrichedAgents.length);
  let filesMonitored = $derived($stats.totalFiles ?? '--');

  let scoreClass = $derived(
    typeof shieldScore === 'number'
      ? shieldScore < 40 ? 'danger' : shieldScore < 70 ? 'warn' : ''
      : ''
  );
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

  <button class="icon-btn" aria-label="Toggle theme" onclick={toggleTheme}>
    {#if isDark}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.2"/>
        <g stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
          <line x1="8" y1="1" x2="8" y2="2.5"/><line x1="8" y1="13.5" x2="8" y2="15"/>
          <line x1="1" y1="8" x2="2.5" y2="8"/><line x1="13.5" y1="8" x2="15" y2="8"/>
          <line x1="3.05" y1="3.05" x2="4.1" y2="4.1"/><line x1="11.9" y1="11.9" x2="12.95" y2="12.95"/>
          <line x1="3.05" y1="12.95" x2="4.1" y2="11.9"/><line x1="11.9" y1="4.1" x2="12.95" y2="3.05"/>
        </g>
      </svg>
    {:else}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M13.5 9.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
    {/if}
  </button>

  <button class="icon-btn" aria-label="Settings" onclick={onSettingsClick}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6.5.5h3l.4 2 1.3.7 1.8-1 2.1 2.1-1 1.8.7 1.3 2 .4v3l-2 .4-.7 1.3 1 1.8-2.1 2.1-1.8-1-1.3.7-.4 2h-3l-.4-2-1.3-.7-1.8 1L.9 13.3l1-1.8-.7-1.3-2-.4v-3l2-.4.7-1.3-1-1.8L2.9.9l1.8 1 1.3-.7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/>
    </svg>
  </button>
</header>

<style>
  .header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 20px;
    background: rgba(5, 5, 7, 0.8);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-bottom: var(--glass-border);
  }

  .header-brand {
    font: var(--md-sys-typescale-title-medium);
    letter-spacing: 0.08em;
    color: var(--md-sys-color-on-surface);
    flex-shrink: 0;
  }

  .header-stats {
    display: flex;
    align-items: center;
    gap: 8px;
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
    flex-shrink: 0; padding: 6px; cursor: pointer;
    background: transparent; border: 1px solid transparent;
    border-radius: var(--md-sys-shape-corner-small);
    color: var(--md-sys-color-on-surface-variant);
    transition: all 0.3s var(--ease-glass);
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container);
    border-color: rgba(255, 255, 255, 0.15);
  }
</style>
