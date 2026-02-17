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
      <span class="pill-label">Shield</span>
      <span class="pill-value">{shieldScore}</span>
    </div>

    <div class="pill">
      <span class="pill-label">Agents</span>
      <span class="pill-value">{agentCount}</span>
    </div>

    <div class="pill">
      <span class="pill-label">Files</span>
      <span class="pill-value">{filesMonitored}</span>
    </div>

    <div class="pill">
      <span class="pill-label">Uptime</span>
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
    background: rgba(20, 20, 22, 0.82);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .header-brand {
    font-family: 'Outfit', system-ui, sans-serif;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--text, #e8e6e2);
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
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    font-size: 0.75rem;
    color: var(--text, #e8e6e2);
    white-space: nowrap;
  }

  .pill-label {
    opacity: 0.5;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
  }

  .pill-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .pill-value.mono {
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
  }

  .pill-warn {
    border-color: rgba(237, 137, 54, 0.3);
  }
  .pill-warn .pill-value {
    color: #ed8936;
  }

  .pill-danger {
    border-color: rgba(229, 62, 62, 0.3);
  }
  .pill-danger .pill-value {
    color: #e53e3e;
  }
</style>
