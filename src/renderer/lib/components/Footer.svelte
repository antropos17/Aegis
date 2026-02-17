<script>
  import { stats, resourceUsage } from '../stores/ipc.js';

  let lastCpuUser = 0;
  let lastCpuSystem = 0;
  let lastCpuTime = 0;
  let cpuPct = $state('--');
  let memMB = $state('--');
  let heapMB = $state('--');
  let scanInterval = $state('--');

  $effect(() => {
    const u = $resourceUsage;
    if (!u || !u.cpuUser) return;

    const now = Date.now();
    const elapsed = (now - lastCpuTime) * 1000;
    if (elapsed > 0 && lastCpuTime > 0) {
      const delta = (u.cpuUser - lastCpuUser) + (u.cpuSystem - lastCpuSystem);
      cpuPct = Math.min(100, Math.round((delta / elapsed) * 100));
    }
    lastCpuUser = u.cpuUser;
    lastCpuSystem = u.cpuSystem;
    lastCpuTime = now;

    memMB = u.memMB ?? '--';
    heapMB = u.heapMB ?? '--';
  });

  $effect(() => {
    if (window.aegis) {
      window.aegis.getSettings().then(s => {
        scanInterval = s.scanIntervalSec ?? '--';
      });
    }
  });

  function cpuClass(val) {
    if (typeof val !== 'number') return '';
    if (val > 50) return 'high';
    if (val > 25) return 'warn';
    return '';
  }

  function memClass(val) {
    if (typeof val !== 'number') return '';
    if (val > 300) return 'high';
    if (val > 150) return 'warn';
    return '';
  }
</script>

<footer class="footer">
  <div class="footer-item">
    <span class="footer-label">CPU</span>
    <span class="footer-value {cpuClass(cpuPct)}">{cpuPct}{typeof cpuPct === 'number' ? '%' : ''}</span>
  </div>

  <div class="footer-item">
    <span class="footer-label">memory</span>
    <span class="footer-value {memClass(memMB)}">{memMB}{typeof memMB === 'number' ? ' MB' : ''}</span>
  </div>

  <div class="footer-item">
    <span class="footer-label">heap</span>
    <span class="footer-value">{heapMB}{typeof heapMB === 'number' ? ' MB' : ''}</span>
  </div>

  <div class="footer-item">
    <span class="footer-label">interval</span>
    <span class="footer-value">{scanInterval}{typeof scanInterval === 'number' ? 's' : ''}</span>
  </div>
</footer>

<style>
  .footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 6px 20px;
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid var(--md-sys-color-outline);
  }

  .footer-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .footer-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .footer-value {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    font-variant-numeric: tabular-nums;
    color: var(--md-sys-color-on-surface);
  }

  .footer-value.warn {
    color: var(--md-sys-color-secondary);
  }

  .footer-value.high {
    color: var(--md-sys-color-error);
  }
</style>
