<script>
  let auditStats = $state(null);
  let loading = $state(true);

  if (window.aegis) {
    window.aegis
      .getAuditStats()
      .then((data) => {
        auditStats = data;
        loading = false;
      })
      .catch(() => {
        loading = false;
      });
  } else {
    loading = false;
  }

  let dateRange = $derived.by(() => {
    if (!auditStats?.firstEntry || !auditStats?.lastEntry) return 'N/A';
    const fmt = (ts) => new Date(ts).toLocaleDateString();
    return `${fmt(auditStats.firstEntry)} — ${fmt(auditStats.lastEntry)}`;
  });

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes < 1099511627776) return `${(bytes / 1073741824).toFixed(1)} GB`;
    return `${(bytes / 1099511627776).toFixed(1)} TB`;
  }

  let fileSize = $derived.by(() => {
    const current = auditStats?.currentSize || 0;
    const total = auditStats?.totalSize || 0;
    return `${formatBytes(current)} (${formatBytes(total)})`;
  });
</script>

<div class="audit-section">
  <h3 class="section-title">Audit Log</h3>

  {#if loading}
    <span class="audit-loading">Loading audit data...</span>
  {:else if auditStats}
    <div class="audit-cards">
      <div class="audit-card">
        <span class="audit-value">{auditStats.totalEntries?.toLocaleString() || '0'}</span>
        <span class="audit-label">Total Entries</span>
      </div>
      <div class="audit-card">
        <span class="audit-value">{fileSize}</span>
        <span class="audit-label">Log Size</span>
      </div>
      <div class="audit-card">
        <span class="audit-value">{dateRange}</span>
        <span class="audit-label">Date Range</span>
      </div>
    </div>
  {:else}
    <span class="audit-loading">No audit data available</span>
  {/if}

  <div class="audit-actions">
    <button class="audit-btn" onclick={() => window.aegis?.openAuditLogDir()}>
      View Logs Directory
    </button>
    <button class="audit-btn" onclick={() => window.aegis?.exportFullAudit()}>
      Export Full Audit
    </button>
  </div>
</div>

<style>
  .audit-section {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-6);
  }

  .section-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0;
  }

  .audit-loading {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .audit-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--aegis-space-5);
  }

  .audit-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--aegis-space-2);
    padding: var(--aegis-space-7) var(--aegis-space-6);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow-card), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
  }

  .audit-value {
    font-family: 'DM Mono', monospace;
    font-size: calc(24px * var(--aegis-ui-scale));
    font-weight: 700;
    color: var(--md-sys-color-on-surface);
  }

  .audit-label {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
  }

  .audit-actions {
    display: flex;
    gap: var(--aegis-space-5);
    flex-wrap: wrap;
  }

  .audit-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-3) var(--aegis-space-7);
    background: transparent;
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.3s var(--ease-glass);
  }

  .audit-btn:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--md-sys-color-on-surface);
    border-color: rgba(255, 255, 255, 0.15);
  }
</style>
