<script>
  /** @type {{ agent: { name: string, pid: number, riskScore: number, trustGrade: string, parentChain: string, sessionStart: number } }} */
  let { agent } = $props();

  let gradeColor = $derived(
    ['A+', 'A', 'B'].includes(agent.trustGrade) ? 'var(--md-sys-color-tertiary)'
    : agent.trustGrade === 'C' ? 'var(--md-sys-color-secondary)'
    : 'var(--md-sys-color-error)'
  );
</script>

<article class="agent-card">
  <div class="agent-header">
    <div class="agent-info">
      <span class="agent-name">{agent.name}</span>
      <span class="agent-pid">PID {agent.pid}</span>
    </div>
    <span class="trust-badge" style:background={gradeColor}>
      {agent.trustGrade}
    </span>
  </div>

  {#if agent.parentChain}
    <span class="parent-chain">{agent.parentChain}</span>
  {/if}

  <div class="trust-bar-row">
    <span class="trust-label">Risk</span>
    <div class="trust-bar">
      <div
        class="trust-fill"
        style:width="{Math.min(agent.riskScore, 100)}%"
        style:background={gradeColor}
      ></div>
    </div>
    <span class="risk-value">{agent.riskScore}</span>
  </div>
</article>

<style>
  .agent-card {
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-medium);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .agent-card:hover {
    border-color: var(--md-sys-color-on-surface-variant);
  }

  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .agent-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .agent-name {
    font: var(--md-sys-typescale-title-medium);
    color: var(--md-sys-color-on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-pid {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .trust-badge {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 700;
    color: var(--md-sys-color-surface);
    padding: 2px 8px;
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
    letter-spacing: 0.5px;
  }

  .parent-chain {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    font-style: italic;
  }

  .trust-bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .trust-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: 28px;
  }

  .trust-bar {
    flex: 1;
    height: 6px;
    background: var(--md-sys-color-surface-container-highest);
    border-radius: var(--md-sys-shape-corner-full);
    overflow: hidden;
  }

  .trust-fill {
    height: 100%;
    border-radius: var(--md-sys-shape-corner-full);
    transition: width var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
  }

  .risk-value {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    width: 24px;
    text-align: right;
    flex-shrink: 0;
  }
</style>
