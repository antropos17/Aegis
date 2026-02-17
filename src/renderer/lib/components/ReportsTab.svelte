<script>
  import Reports from './Reports.svelte';
  import AuditLog from './AuditLog.svelte';
  import ThreatAnalysis from './ThreatAnalysis.svelte';

  let subTab = $state('overview');
</script>

<div class="reports-tab">
  <div class="sub-toggle">
    <button class="sub-btn" class:active={subTab === 'overview'}
      onclick={() => { subTab = 'overview'; }}>Overview</button>
    <button class="sub-btn" class:active={subTab === 'audit'}
      onclick={() => { subTab = 'audit'; }}>Audit Log</button>
    <button class="sub-btn" class:active={subTab === 'threat'}
      onclick={() => { subTab = 'threat'; }}>Threat Analysis</button>
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
    gap: 20px;
    padding: 20px;
  }

  .sub-toggle {
    display: flex; gap: 4px; padding: 3px; align-self: flex-start;
    background: var(--md-sys-color-surface-container);
    border-radius: var(--md-sys-shape-corner-full);
  }

  .sub-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    padding: 6px 16px; border: none;
    border-radius: var(--md-sys-shape-corner-full);
    background: transparent; color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .sub-btn:hover { color: var(--md-sys-color-on-surface); }

  .sub-btn.active {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-surface);
  }
</style>
