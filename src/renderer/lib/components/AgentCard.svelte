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
    agent.pids?.length === 1 ? `PID ${agent.pids[0].pid}` : `${agent.pids?.length || 0} PIDs`,
  );

  function toggle() {
    expanded = !expanded;
  }

  async function pidAction(e, pid, method) {
    e.stopPropagation();
    if (window.aegis) await window.aegis[method](pid);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="agent-card" class:expanded onclick={toggle}>
  <div class="compact-row">
    <span class="agent-name">{agent.name}</span>
    <span class="stat">{pidSummary}</span>
    {#if agent.fileCount != null}
      <span class="stat">{Math.round(agent.fileCount)}f</span>
    {/if}
    {#if agent.networkCount != null}
      <span class="stat">{agent.networkCount}n</span>
    {/if}
    <span class="risk-score" style:color={gradeColor}>{agent.riskScore}</span>
    <span class="trust-badge" style:background={gradeColor}>{agent.trustGrade}</span>
  </div>

  <div class="expand-body">
    <div class="expand-inner">
      <div class="risk-bar-row">
        <span class="bar-label">Risk</span>
        <div class="risk-bar">
          <div
            class="risk-fill"
            style:width="{Math.min(agent.riskScore, 100)}%"
            style:background={gradeColor}
          ></div>
        </div>
      </div>

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

      {#if agent.pids?.length}
        <div class="pid-list">
          {#each agent.pids as p (p.pid)}
            <div class="pid-row">
              <span class="pid-info">PID {p.pid}{p.process ? ` \u2014 ${p.process}` : ''}</span>
              <div class="pid-actions">
                <button class="action-btn kill" onclick={(e) => pidAction(e, p.pid, 'killProcess')}
                  >Kill</button
                >
                <button
                  class="action-btn suspend"
                  onclick={(e) => pidAction(e, p.pid, 'suspendProcess')}>Suspend</button
                >
                <button
                  class="action-btn resume"
                  onclick={(e) => pidAction(e, p.pid, 'resumeProcess')}>Resume</button
                >
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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
    padding: 8px 12px;
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .agent-card:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }

  /* ── Compact row ── */
  .compact-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .agent-name {
    font: var(--md-sys-typescale-label-large);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .stat {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
  }
  .risk-score {
    font: var(--md-sys-typescale-label-large);
    font-family: 'DM Mono', monospace;
    font-weight: 700;
    flex-shrink: 0;
    margin-left: auto;
  }
  .trust-badge {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 700;
    color: var(--md-sys-color-surface);
    padding: 1px 7px;
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
    letter-spacing: 0.5px;
  }

  /* ── Expand / collapse ── */
  .expand-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 200ms var(--md-sys-motion-easing-standard);
    overflow: hidden;
  }
  .agent-card.expanded .expand-body {
    grid-template-rows: 1fr;
  }
  .expand-inner {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .agent-card.expanded .expand-inner {
    margin-top: 8px;
  }

  .risk-bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .bar-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: 28px;
  }
  .risk-bar {
    flex: 1;
    height: 6px;
    background: var(--md-sys-color-surface-container-highest);
    border-radius: var(--md-sys-shape-corner-full);
    overflow: hidden;
  }
  .risk-fill {
    height: 100%;
    border-radius: var(--md-sys-shape-corner-full);
    transition: width var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-standard);
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
  .action-btn:hover {
    opacity: 0.8;
  }
  .action-btn:active {
    transform: scale(0.97);
  }
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
