<script>
  import Reports from './Reports.svelte';
  import AuditLog from './AuditLog.svelte';
  import ThreatAnalysis from './ThreatAnalysis.svelte';
  import { isDemoMode } from '../stores/ipc.js';
  import { t } from '../i18n/index.js';
  import { addToast } from '../stores/toast.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let subTab = $state('overview');
  let exporting = $state(false);

  /** Export audit + activity + config as ZIP. */
  async function handleExportAll() {
    if (!window.aegis?.exportZip || exporting) return;
    exporting = true;
    try {
      const result = await window.aegis.exportZip();
      if (result.success) addToast('Data exported successfully', 'success');
    } finally {
      exporting = false;
    }
  }
</script>

<div class="reports-tab">
  <div class="reports-toolbar">
    <div class="sub-toggle">
      <button
        class="sub-btn"
        class:active={subTab === 'overview'}
        onclick={() => {
          subTab = 'overview';
        }}>{$t('reports.tabs.overview')}</button
      >
      <button
        class="sub-btn"
        class:active={subTab === 'audit'}
        onclick={() => {
          subTab = 'audit';
        }}>{$t('reports.tabs.audit_log')}</button
      >
      <button
        class="sub-btn"
        class:active={subTab === 'threat'}
        onclick={() => {
          subTab = 'threat';
        }}>{$t('reports.tabs.threat_analysis')}</button
      >
    </div>

    <button
      class="export-btn"
      onclick={handleExportAll}
      disabled={exporting || isDemoMode}
      title={isDemoMode ? 'Desktop app only' : ''}
    >
      <svg
        class="export-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M8 2v8M5 7l3 3 3-3" /><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
      </svg>
      {exporting ? 'Exporting\u2026' : 'Export All'}
    </button>
  </div>

  <div class="reports-body">
    {#if subTab === 'overview'}
      <Reports {active} />
    {:else if subTab === 'audit'}
      <AuditLog />
    {:else}
      <ThreatAnalysis />
    {/if}
  </div>
</div>

<style>
  .reports-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: var(--aegis-space-8);
    padding: var(--aegis-space-8);
  }

  .reports-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--aegis-space-8);
    flex-shrink: 0;
  }

  .sub-toggle {
    display: flex;
    gap: var(--aegis-space-2);
    padding: calc(3px * var(--aegis-ui-scale));
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-full);
  }

  .sub-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-3) var(--aegis-space-8);
    border: none;
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .sub-btn:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-outline-variant);
  }

  .sub-btn.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary);
    box-shadow: 0 2px 12px rgba(42, 58, 78, 0.4);
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--aegis-space-3);
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-3) var(--aegis-space-8);
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-full);
    background: var(--md-sys-color-surface-container);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    color: var(--md-sys-color-on-surface);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .export-btn:hover:not(:disabled) {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary);
    box-shadow: 0 2px 12px rgba(42, 58, 78, 0.4);
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .export-icon {
    width: calc(14px * var(--aegis-ui-scale));
    height: calc(14px * var(--aegis-ui-scale));
    flex-shrink: 0;
  }

  .reports-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
