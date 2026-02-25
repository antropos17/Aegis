<script>
  import Reports from './Reports.svelte';
  import AuditLog from './AuditLog.svelte';
  import ThreatAnalysis from './ThreatAnalysis.svelte';

  let subTab = $state('overview');
</script>

<div class="reports-tab">
  <div class="sub-toggle">
    <button
      class="sub-btn"
      class:active={subTab === 'overview'}
      onclick={() => {
        subTab = 'overview';
      }}>Overview</button
    >
    <button
      class="sub-btn"
      class:active={subTab === 'audit'}
      onclick={() => {
        subTab = 'audit';
      }}>Audit Log</button
    >
    <button
      class="sub-btn"
      class:active={subTab === 'threat'}
      onclick={() => {
        subTab = 'threat';
      }}>Threat Analysis</button
    >
  </div>

  {#if subTab === 'overview'}
    <Reports />
  {:else if subTab === 'audit'}
    <AuditLog />
  {:else}
    <ThreatAnalysis />
  {/if}
</div>

<style>
  .reports-tab {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-9);
    padding: var(--aegis-space-9);
  }

  .sub-toggle {
    display: flex;
    gap: var(--aegis-space-2);
    padding: calc(3px * var(--aegis-ui-scale));
    align-self: flex-start;
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
    background: rgba(255, 255, 255, 0.04);
  }

  .sub-btn.active {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    box-shadow: 0 2px 12px rgba(122, 138, 158, 0.3);
  }
</style>
