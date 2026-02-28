<script>
  /**
   * @file AgentCard.svelte
   * @description Agent card — compact summary row with expandable details.
   *   Detail body in AgentCardDetails.svelte.
   * @since v0.1.0
   */
  import { events, focusedAgentPid } from '../stores/ipc.js';
  import AgentCardDetails from './AgentCardDetails.svelte';

  /** @type {{ agent: Object, expandedPid: number|null }} */
  let { agent, expandedPid = $bindable(null) } = $props();

  let blinking = $state(false);
  let cardEl = $state(null);
  let expanded = $derived(expandedPid === agent.pid);

  $effect(() => {
    const pid = $focusedAgentPid;
    if (pid === null) return;
    if (pid === agent.pid) {
      expandedPid = agent.pid;
      blinking = true;
      if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => {
        blinking = false;
      }, 1200);
      setTimeout(() => {
        focusedAgentPid.set(null);
      }, 50);
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
    return $events
      .flat()
      .filter((ev) => ev.pid === agent.pid)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 50);
  });

  let lastFile = $derived.by(() => {
    const ev = agentEvents.find((e) => e.file);
    if (!ev) return null;
    const parts = ev.file.split(/[/\\]/);
    return parts.length > 2 ? parts.slice(-2).join('/') : ev.file;
  });

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
    {#if agent.fileCount != null}<span class="stat">{Math.round(agent.fileCount)}f</span>{/if}
    {#if agent.networkCount != null}<span class="stat">{agent.networkCount}n</span>{/if}
    <span class="risk-score" style:color={gradeColor}>{agent.riskScore}</span>
    <span class="trust-badge" style:background={gradeColor}>{agent.trustGrade}</span>
  </div>

  {#if lastFile}<div class="activity-hint">Last: {lastFile}</div>{/if}

  <div class="expand-body">
    <div class="expand-inner">
      <AgentCardDetails
        {agent}
        {gradeColor}
        {agentEvents}
        {sessionDuration}
        onPidAction={pidAction}
      />
    </div>
  </div>
</article>

<style>
  .agent-card {
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--aegis-card-border);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.12),
      var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
    padding: var(--aegis-space-4) var(--aegis-space-6);
    cursor: pointer;
    transition: all 0.3s var(--ease-glass);
  }
  .agent-card:hover {
    background: var(--aegis-card-hover-bg);
  }
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
  .agent-card.blinking {
    animation: card-blink 400ms ease 3;
  }
  @keyframes card-blink {
    0%,
    100% {
      background: var(--md-sys-color-surface-container-low);
    }
    50% {
      background: var(--md-sys-color-primary-container);
    }
  }
</style>
