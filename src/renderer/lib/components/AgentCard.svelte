<script>
  /**
   * @file AgentCard.svelte
   * @description Agent card — compact summary row with expandable details.
   *   Detail body in AgentCardDetails.svelte.
   * @since v0.1.0
   */
  import { events, focusedAgentPid } from '../stores/ipc.js';
  import AgentCardDetails from './AgentCardDetails.svelte';
  import { addToast } from '../stores/toast.js';
  import { t } from '../i18n/index.js';

  /** @type {{ agent: Object, expandedPid: number|null }} */
  let { agent, expandedPid = $bindable(null) } = $props();

  let blinking = $state(false);
  let threatFlash = $state(false);
  let _prevRiskScore = -1;
  let cardEl = $state(null);
  let expanded = $derived(expandedPid === agent.pid);

  $effect(() => {
    const score = agent.riskScore ?? 0;
    if (_prevRiskScore !== -1 && score >= 70 && _prevRiskScore < 70) {
      threatFlash = true;
      setTimeout(() => {
        threatFlash = false;
      }, 1000);
    }
    _prevRiskScore = score;
  });

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
    return hrs > 0
      ? $t('agents.session_hours', { h: hrs, m: rem })
      : $t('agents.session_minutes', { m: mins });
  });

  function toggle() {
    expandedPid = expanded ? null : agent.pid;
  }

  async function pidAction(e, method) {
    e.stopPropagation();
    if (window.aegis) await window.aegis[method](agent.pid);
  }

  /** Copy PID to clipboard and show toast. */
  async function copyPid(e) {
    e.stopPropagation();
    await navigator.clipboard.writeText(String(agent.pid));
    addToast($t('agents.pid_copied'), 'success', 3000);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="agent-card"
  class:expanded
  class:blinking
  class:threat-flash={threatFlash}
  bind:this={cardEl}
  onclick={toggle}
>
  <div class="header-row">
    <span class="agent-name">{displayName}</span>
    {#if agent.hasApiCalls}<span class="api-badge" title="Making API calls">API</span>{/if}
    <span class="risk-score" style:color={gradeColor}>{agent.riskScore}</span>
    <span class="trust-badge" style:background={gradeColor}>{agent.trustGrade}</span>
  </div>

  <div class="stats-row">
    <button class="stat-chip" onclick={copyPid} title={$t('agents.copy_pid')}>
      <span class="stat-label">PID</span>
      <span class="stat-value">{agent.pid}</span>
    </button>
    {#if agent._processCount > 1}
      <span class="stat-chip">
        <span class="stat-label">{$t('agents.stat_proc')}</span>
        <span class="stat-value">{agent._processCount}</span>
      </span>
    {/if}
    {#if agent.fileCount != null}
      <span class="stat-chip">
        <span class="stat-label">{$t('agents.stat_files')}</span>
        <span class="stat-value">{Math.round(agent.fileCount).toLocaleString()}</span>
      </span>
    {/if}
    {#if agent.networkCount != null}
      <span class="stat-chip">
        <span class="stat-label">{$t('agents.stat_net')}</span>
        <span class="stat-value">{agent.networkCount}</span>
      </span>
    {/if}
  </div>

  {#if lastFile}<div class="activity-hint">{$t('agents.last_file', { file: lastFile })}</div>{/if}

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
  .header-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-4);
  }
  .agent-name {
    font: var(--md-sys-typescale-title-medium);
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
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
  .api-badge {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: var(--aegis-space-1) var(--aegis-space-3);
    border-radius: var(--md-sys-shape-corner-full);
    background: rgba(120, 160, 220, 0.15);
    color: var(--md-sys-color-primary);
    flex-shrink: 0;
  }
  .stats-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
    margin-top: var(--aegis-space-3);
    flex-wrap: wrap;
  }
  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--aegis-space-2);
    padding: var(--aegis-space-1) var(--aegis-space-4);
    background: var(--md-sys-color-surface-container-high);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--md-sys-shape-corner-small);
    cursor: default;
    transition: border-color 0.15s ease;
  }
  button.stat-chip {
    cursor: copy;
  }
  button.stat-chip:hover {
    border-color: var(--md-sys-color-primary);
  }
  .stat-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .stat-value {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
  }
  .activity-hint {
    font: var(--md-sys-typescale-label-medium);
    font-family: 'DM Mono', monospace;
    color: var(--md-sys-color-on-surface-variant);
    opacity: 0.7;
    margin-top: var(--aegis-space-2);
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
  .agent-card.threat-flash {
    outline: 2px solid transparent;
    animation: threat-flash 500ms ease 2;
  }
  @keyframes threat-flash {
    0%,
    100% {
      outline-color: transparent;
    }
    50% {
      outline-color: var(--md-sys-color-error);
    }
  }
</style>
