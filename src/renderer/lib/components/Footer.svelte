<script>
  import { resourceUsage, stats } from '../stores/ipc.js';
  import { t } from '../i18n/index.js';
  import FooterMiniCharts from './FooterMiniCharts.svelte';

  let permDenied = $derived($stats.permissionDeniedScans || 0);

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
</script>

<footer class="footer">
  <span class="footer-version">{$t('brand.name')} {appVersion}</span>

  <div class="footer-stats">
    <FooterMiniCharts />

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

    {#if permDenied > 5}
      <div
        class="footer-item"
        title="Process scanner encountered {permDenied} consecutive permission errors. Some elevated processes may not be visible. Try running AEGIS as Administrator."
      >
        <span class="footer-label">{$t('footer.perm_warn')}</span>
        <span class="footer-value high">{permDenied}</span>
      </div>
    {/if}
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

  .footer-value.high {
    color: var(--md-sys-color-error);
  }
</style>
