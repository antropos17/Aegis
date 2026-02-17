<script>
  let auditStats = $state(null);
  let loading = $state(true);

  if (window.aegis) {
    window.aegis.getAuditStats().then(data => {
      auditStats = data;
      loading = false;
    }).catch(() => { loading = false; });
  } else {
    loading = false;
  }

  let dateRange = $derived.by(() => {
    if (!auditStats?.firstEntry || !auditStats?.lastEntry) return 'N/A';
    const fmt = (ts) => new Date(ts).toLocaleDateString();
    return `${fmt(auditStats.firstEntry)} — ${fmt(auditStats.lastEntry)}`;
  });

  let fileSize = $derived.by(() => {
    const bytes = auditStats?.totalSize || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
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
  .audit-section { display: flex; flex-direction: column; gap: 12px; }

  .section-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface); margin: 0;
  }

  .audit-loading {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .audit-cards { display: flex; gap: 12px; flex-wrap: wrap; }

  .audit-card {
    display: flex; flex-direction: column; gap: 4px;
    padding: 14px 20px;
    background: var(--md-sys-color-surface-container);
    border-radius: var(--md-sys-shape-corner-medium);
    flex: 1; min-width: 140px;
  }

  .audit-value {
    font: var(--md-sys-typescale-headline-medium); font-weight: 700;
    color: var(--md-sys-color-on-surface);
    font-family: 'DM Mono', monospace;
  }

  .audit-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .audit-actions { display: flex; gap: 10px; flex-wrap: wrap; }

  .audit-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    padding: 7px 18px;
    background: transparent;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .audit-btn:hover {
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-on-surface-variant);
  }
</style>
