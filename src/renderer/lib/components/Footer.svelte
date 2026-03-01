<script>
  import { resourceUsage } from '../stores/ipc.js';
  import { t } from '../i18n/index.js';

  let lastCpuUser = 0;
  let lastCpuSystem = 0;
  let lastCpuTime = 0;
  let cpuPct = $state('--');
  let memMB = $state('--');
  let heapMB = $state('--');
  let scanInterval = $state('--');
  let appVersion = $state('v0.3.0-alpha');

  const appStart = Date.now();
  let uptimeMs = $state(0);

  $effect(() => {
    const id = setInterval(() => {
      uptimeMs = Date.now() - appStart;
    }, 1000);
    return () => clearInterval(id);
  });

  $effect(() => {
    const u = $resourceUsage;
    if (!u || !u.cpuUser) return;

    const now = Date.now();
    const elapsed = (now - lastCpuTime) * 1000;
    if (elapsed > 0 && lastCpuTime > 0) {
      const delta = u.cpuUser - lastCpuUser + (u.cpuSystem - lastCpuSystem);
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
      window.aegis.getSettings().then((s) => {
        scanInterval = s.scanIntervalSec ?? '--';
      });
      window.aegis.getAppVersion().then((v) => {
        if (v) appVersion = `v${v}`;
      });
    }
  });

  function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }

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
  <span class="footer-version">{$t('brand.name')} {appVersion}</span>

  <div class="footer-stats">
    <div class="footer-item">
      <span class="footer-label">{$t('footer.cpu')}</span>
      <span class="footer-value {cpuClass(cpuPct)}"
        >{cpuPct}{typeof cpuPct === 'number' ? '%' : ''}</span
      >
    </div>

    <div class="footer-item">
      <span class="footer-label">{$t('footer.mem')}</span>
      <span class="footer-value {memClass(memMB)}"
        >{memMB}{typeof memMB === 'number' ? ' MB' : ''}</span
      >
    </div>

    <div class="footer-item">
      <span class="footer-label">{$t('footer.heap')}</span>
      <span class="footer-value">{heapMB}{typeof heapMB === 'number' ? ' MB' : ''}</span>
    </div>

    <div class="footer-item">
      <span class="footer-label">{$t('footer.scan')}</span>
      <span class="footer-value">{scanInterval}{typeof scanInterval === 'number' ? 's' : ''}</span>
    </div>

    <div class="footer-item">
      <span class="footer-label">{$t('footer.up')}</span>
      <span class="footer-value">{formatUptime(uptimeMs)}</span>
    </div>
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
    gap: var(--aegis-space-9);
    padding: var(--aegis-space-3) var(--aegis-space-9);
    background: var(--aegis-footer-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-top: var(--aegis-footer-border);
  }

  .footer-version {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
  }

  .footer-stats {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-8);
    margin-left: auto;
  }

  .footer-item {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
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
