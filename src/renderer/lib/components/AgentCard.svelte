<script>
  import { events, focusedAgentPid } from '../stores/ipc.js';

  /** @type {{ agent: { name: string, pid: number, process: string, parentEditor: string|null, cwd: string|null, projectName: string|null, riskScore: number, trustGrade: string, parentChain: string, sessionStart: number, fileCount: number, networkCount: number }, expandedPid: number|null }} */
  let { agent, expandedPid = $bindable(null) } = $props();

  let blinking = $state(false);
  let cardEl = $state(null);

  let expanded = $derived(expandedPid === agent.pid);

  // React to timeline dot clicks
  $effect(() => {
    const pid = $focusedAgentPid;
    if (pid === null) return;
    if (pid === agent.pid) {
      expandedPid = agent.pid;
      blinking = true;
      // Scroll into view
      if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Stop blink after 3 cycles (each cycle is 400ms via CSS)
      setTimeout(() => { blinking = false; }, 1200);
      // Clear the store so clicking the same dot again works
      setTimeout(() => { focusedAgentPid.set(null); }, 50);
    }
  });

  function gradeToColor(grade) {
    if (['A+', 'A', 'B'].includes(grade)) return 'var(--md-sys-color-tertiary)';
    if (grade === 'C') return 'var(--md-sys-color-secondary)';
    return 'var(--md-sys-color-error)';
  }

  let gradeColor = $derived(gradeToColor(agent.trustGrade));

  let displayName = $derived.by(() => {
    if (agent.projectName) return `${agent.name} \u2014 ${agent.projectName}`;
    if (agent.parentEditor) return `${agent.name} via ${agent.parentEditor}`;
    return agent.name;
  });

  let agentEvents = $derived.by(() => {
    return $events.flat()
      .filter((ev) => ev.pid === agent.pid)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 50);
  });

  let lastFile = $derived.by(() => {
    const ev = agentEvents.find((e) => e.file);
    if (!ev) return null;
    const parts = ev.file.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : ev.file;
  });

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function shortenPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
  }

  let sessionDuration = $derived.by(() => {
    if (!agent.sessionStart) return null;
    const ms = Date.now() - agent.sessionStart;
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
  });

  function toggle() {
    expandedPid = expanded ? null : agent.pid;
  }

  async function pidAction(e, method) {
    e.stopPropagation();
    if (window.aegis) await window.aegis[method](agent.pid);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="agent-card" class:expanded class:blinking bind:this={cardEl} onclick={toggle}>
  <div class="compact-row">
    <span class="agent-name">{displayName}</span>
    <span class="stat">PID {agent.pid}</span>
    {#if agent.fileCount != null}
      <span class="stat">{Math.round(agent.fileCount)}f</span>
    {/if}
    {#if agent.networkCount != null}
      <span class="stat">{agent.networkCount}n</span>
    {/if}
    <span class="risk-score" style:color={gradeColor}>{agent.riskScore}</span>
    <span class="trust-badge" style:background={gradeColor}>{agent.trustGrade}</span>
  </div>

  {#if lastFile}
    <div class="activity-hint">Last: {lastFile}</div>
  {/if}

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

      {#if agent.cwd}
        <div class="detail-row">
          <span class="detail-label">CWD</span>
          <span class="detail-value">{agent.cwd}</span>
        </div>
      {/if}

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

      {#if agentEvents.length > 0}
        <div class="event-log">
          <span class="log-heading">Activity ({agentEvents.length})</span>
          <div class="log-list">
            {#each agentEvents as ev, i (`${ev.timestamp}-${i}`)}
              <div class="log-row" class:sensitive={ev.sensitive}>
                <span class="log-time">{formatTime(ev.timestamp)}</span>
                <span class="log-action">{ev.action || 'access'}</span>
                <span class="log-path" title={ev.file}>{shortenPath(ev.file)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="pid-actions-row">
        <span class="pid-info">PID {agent.pid}{agent.process ? ` \u2014 ${agent.process}` : ''}</span>
        <div class="pid-actions">
          <button class="action-btn kill" onclick={(e) => pidAction(e, 'killProcess')}>Kill</button>
          <button class="action-btn suspend" onclick={(e) => pidAction(e, 'suspendProcess')}>Suspend</button>
          <button class="action-btn resume" onclick={(e) => pidAction(e, 'resumeProcess')}>Resume</button>
        </div>
      </div>
    </div>
  </div>
</article>

<style>
  .agent-card {
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--aegis-card-border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    padding: var(--aegis-space-4) var(--aegis-space-6);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .agent-card:hover {
    background: var(--aegis-card-hover-bg);
  }

  /* -- Compact row -- */
  .compact-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
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
    padding: var(--aegis-space-1) calc(7px * var(--aegis-ui-scale));
    border-radius: var(--md-sys-shape-corner-full);
    flex-shrink: 0;
    letter-spacing: 0.5px;
  }

  /* -- Activity hint -- */
  .activity-hint {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.7;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* -- Expand / collapse -- */
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
    gap: var(--aegis-space-3);
  }
  .agent-card.expanded .expand-inner {
    margin-top: var(--aegis-space-4);
  }

  .risk-bar-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
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
    gap: var(--aegis-space-4);
  }
  .detail-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    width: var(--aegis-col-time);
  }
  .detail-value {
    font: var(--md-sys-typescale-body-medium);
    color: var(--md-sys-color-on-surface);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* -- Event log -- */
  .event-log {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-2);
    margin-top: var(--aegis-space-2);
    border-top: 1px solid var(--md-sys-color-outline-variant);
    padding-top: var(--aegis-space-3);
  }
  .log-heading {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .log-list {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-1);
    max-height: calc(160px * var(--aegis-ui-scale));
    overflow-y: auto;
  }
  .log-row {
    display: flex;
    align-items: baseline;
    gap: var(--aegis-space-3);
    padding: var(--aegis-space-1) 0;
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
  }
  .log-row.sensitive {
    color: var(--md-sys-color-error);
  }
  .log-time {
    flex-shrink: 0;
    opacity: 0.6;
  }
  .log-action {
    flex-shrink: 0;
    min-width: 44px;
  }
  .log-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* -- PID actions -- */
  .pid-actions-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--aegis-space-4);
    margin-top: var(--aegis-space-2);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: var(--aegis-space-3);
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
    gap: var(--aegis-space-3);
    flex-shrink: 0;
  }

  .action-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-2) var(--aegis-space-6);
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

  /* Blink animation — 3 pulses with primary highlight */
  .agent-card.blinking {
    animation: card-blink 400ms ease 3;
  }

  @keyframes card-blink {
    0%, 100% { background: var(--md-sys-color-surface-container-low); }
    50% { background: var(--md-sys-color-primary-container); }
  }
</style>
