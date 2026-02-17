<script>
  import { agents, stats } from '../stores/ipc.js';

  const appStart = Date.now();
  let uptimeMs = $state(0);

  $effect(() => {
    const id = setInterval(() => { uptimeMs = Date.now() - appStart; }, 1000);
    return () => clearInterval(id);
  });

  let shieldScore = $derived.by(() => {
    const list = $agents;
    if (!list.length) return '--';
    let totalSensitive = 0;
    for (const a of list) totalSensitive += (a.sensitiveCount || 0);
    return Math.max(0, Math.round(100 - Math.log2(1 + totalSensitive) * 8));
  });

  let agentCount = $derived($agents.length);
  let filesMonitored = $derived($stats.totalFiles ?? '--');

  function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }
</script>

<header class="header">
  <div class="header-brand">AEGIS</div>

  <div class="header-pills">
    <div class="pill" class:pill-warn={typeof shieldScore === 'number' && shieldScore < 70}
         class:pill-danger={typeof shieldScore === 'number' && shieldScore < 40}>
      <span class="pill-label">shield</span>
      <span class="pill-value">{shieldScore}</span>
    </div>

    <div class="pill">
      <span class="pill-label">{agentCount === 1 ? 'agent' : 'agents'}</span>
      <span class="pill-value">{agentCount}</span>
    </div>

    <div class="pill">
      <span class="pill-label">files</span>
      <span class="pill-value">{filesMonitored}</span>
    </div>

    <div class="pill">
      <span class="pill-label">uptime</span>
      <span class="pill-value mono">{formatUptime(uptimeMs)}</span>
    </div>
  </div>
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
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--md-sys-color-outline);
  }

  .header-brand {
    font: var(--md-sys-typescale-title-medium);
    letter-spacing: 0.08em;
    color: var(--md-sys-color-on-surface);
    margin-right: 8px;
    flex-shrink: 0;
  }

  .header-pills {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface);
    white-space: nowrap;
  }

  .pill-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .pill-value {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .pill-value.mono {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
  }

  .pill-warn {
    border-color: rgba(200, 168, 78, 0.3);
  }
  .pill-warn .pill-value {
    color: var(--md-sys-color-secondary);
  }

  .pill-danger {
    border-color: rgba(200, 122, 122, 0.3);
  }
  .pill-danger .pill-value {
    color: var(--md-sys-color-error);
  }
</style>
