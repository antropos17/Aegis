<script>
  /** @type {{ agent: { name: string, pids: Array<{pid: number, process: string}>, riskScore: number, trustGrade: string, parentChain: string, sessionStart: number, fileCount: number, networkCount: number } }} */
  let { agent } = $props();

  let expanded = $state(false);

  function gradeToColor(grade) {
    if (['A+', 'A', 'B'].includes(grade)) return 'var(--md-sys-color-tertiary)';
    if (grade === 'C') return 'var(--md-sys-color-secondary)';
    return 'var(--md-sys-color-error)';
  }

  let gradeColor = $derived(gradeToColor(agent.trustGrade));

  let sessionDuration = $derived.by(() => {
    if (!agent.sessionStart) return null;
    const ms = Date.now() - agent.sessionStart;
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
  });

  let pidSummary = $derived(
    agent.pids?.length === 1
      ? `PID ${agent.pids[0].pid}`
      : `${agent.pids?.length || 0} PIDs`
  );

  function toggle() { expanded = !expanded; }

  async function pidAction(e, pid, method) {
    e.stopPropagation();
    if (window.aegis) await window.aegis[method](pid);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="agent-card" class:expanded onclick={toggle}>
  <div class="agent-header">
    <div class="agent-info">
      <span class="agent-name">{agent.name}</span>
      <span class="agent-pid">{pidSummary}</span>
    </div>
    <span class="trust-badge" style:background={gradeColor}>
      {agent.trustGrade}
    </span>
  </div>

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

  <div class="expand-body">
    {#if agent.parentChain}
      <div class="detail-row">
        <span class="detail-label">Parent</span>
        <span class="detail-value">{agent.parentChain}</span>
      </div>
    {/if}

    {#if sessionDuration}
      <div class="detail-row">
        <span class="detail-label">Session</span>
        <span class="detail-value">{sessionDuration}</span>
      </div>
    {/if}

    {#if agent.fileCount != null}
      <div class="detail-row">
        <span class="detail-label">Files</span>
        <span class="detail-value">{Math.round(agent.fileCount)}</span>
      </div>
    {/if}

    {#if agent.networkCount != null}
      <div class="detail-row">
        <span class="detail-label">Network</span>
        <span class="detail-value">{agent.networkCount}</span>
      </div>
    {/if}

    {#if agent.pids?.length}
      <div class="pid-list">
        {#each agent.pids as p (p.pid)}
          <div class="pid-row">
            <span class="pid-info">PID {p.pid}{p.process ? ` \u2014 ${p.process}` : ''}</span>
            <div class="pid-actions">
              <button class="action-btn kill" onclick={(e) => pidAction(e, p.pid, 'killProcess')}>Kill</button>
              <button class="action-btn suspend" onclick={(e) => pidAction(e, p.pid, 'suspendProcess')}>Suspend</button>
              <button class="action-btn resume" onclick={(e) => pidAction(e, p.pid, 'resumeProcess')}>Resume</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</article>

<style>
  .agent-card {
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .agent-card:hover {
    border-color: rgba(255, 255, 255, 0.15);
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

  /* ── Expand / collapse ── */
  .expand-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    transition:
      max-height var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard),
      opacity var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
  }

  .agent-card.expanded .expand-body {
    max-height: 400px;
    opacity: 1;
  }

  .detail-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .detail-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: 52px;
  }

  .detail-value {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── PID list ── */
  .pid-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 6px;
  }

  .pid-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .pid-info {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pid-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .action-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: 4px 12px;
    border: none;
    border-radius: var(--md-sys-shape-corner-full);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }

  .action-btn:hover { opacity: 0.8; }

  .action-btn.kill {
    background: var(--md-sys-color-error);
    color: var(--md-sys-color-on-error);
  }

  .action-btn.suspend {
    background: var(--md-sys-color-secondary);
    color: var(--md-sys-color-surface);
  }

  .action-btn.resume {
    background: var(--md-sys-color-tertiary);
    color: var(--md-sys-color-surface);
  }
</style>
