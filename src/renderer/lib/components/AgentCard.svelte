<script>
  /**
   * @file AgentCard.svelte
   * @description Fancy agent card — glassmorphism panel with sparkline,
   *   trust badge, spotlight hover, and expandable details. [F2.3]
   * @since v0.5.0
   */
  import { focusedAgentPid } from '../stores/ipc.js';
  import { eventsByPid } from '../stores/events-index.ts';
  import AgentCardDetails from './AgentCardDetails.svelte';
  import Sparkline from './Sparkline.svelte';
  import TrustBadge from './TrustBadge.svelte';
  import { getRiskInfo } from '../utils/trust-badge-utils';
  import { addToast } from '../stores/toast.js';
  import { t } from '../i18n/index.js';

  /** @type {{ agent: Object, expandedPid: number|null }} */
  let { agent, expandedPid = $bindable(null) } = $props();

  let blinking = $state(false);
  let threatFlash = $state(false);
  let _prevRiskScore = -1;
  let cardEl = $state(null);
  let expanded = $derived(expandedPid === agent.pid);

  /** Risk info (color, label) derived from agent score */
  let risk = $derived(getRiskInfo(agent.riskScore ?? 0));

  /** Sparkline color: match the risk color */
  let sparkColor = $derived(risk.color);

  /** Risk history: use agent.riskHistory if available, else empty */
  let riskHistory = $derived(agent.riskHistory ?? []);

  /** Danger border when risk >= 70 */
  let isDanger = $derived((agent.riskScore ?? 0) >= 70);

  $effect(() => {
    const score = agent.riskScore ?? 0;
    if (_prevRiskScore !== -1 && score >= 70 && _prevRiskScore < 70) {
      threatFlash = true;
      const timer = setTimeout(() => {
        threatFlash = false;
      }, 1000);
      _prevRiskScore = score;
      return () => clearTimeout(timer);
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
      const t1 = setTimeout(() => {
        blinking = false;
      }, 1200);
      const t2 = setTimeout(() => {
        focusedAgentPid.set(null);
      }, 50);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  });

  let displayName = $derived.by(() => {
    if (agent.projectName) return `${agent.name} \u2014 ${agent.projectName}`;
    if (agent.parentEditor) return `${agent.name} via ${agent.parentEditor}`;
    return agent.name;
  });

  let agentEvents = $derived($eventsByPid.get(agent.pid) || []);

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

  /** Spotlight hover — track mouse position relative to card */
  function handleMouseMove(e) {
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    cardEl.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    cardEl.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="agent-card"
  class:expanded
  class:blinking
  class:threat-flash={threatFlash}
  class:danger={isDanger}
  bind:this={cardEl}
  onclick={toggle}
  onmousemove={handleMouseMove}
>
  <div class="header-row">
    <span class="agent-name">{displayName}</span>
    {#if agent.hasApiCalls}<span class="api-badge" title="Making API calls">API</span>{/if}
    <TrustBadge score={agent.riskScore ?? 0} size="sm" />
  </div>

  {#if riskHistory.length > 1}
    <div class="sparkline-row">
      <Sparkline data={riskHistory} color={sparkColor} width={100} height={28} />
    </div>
  {/if}

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
        gradeColor={risk.color}
        {agentEvents}
        {sessionDuration}
        onPidAction={pidAction}
      />
    </div>
  </div>
</article>

<style>
  .agent-card {
    background: var(--fancy-surface);
    backdrop-filter: blur(var(--fancy-panel-blur));
    -webkit-backdrop-filter: blur(var(--fancy-panel-blur));
    border: 1px solid var(--fancy-border);
    border-radius: var(--fancy-radius-md);
    padding: var(--fancy-space-md);
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition:
      transform var(--fancy-transition-normal) var(--fancy-ease),
      box-shadow var(--fancy-transition-normal) var(--fancy-ease),
      border-color var(--fancy-transition-normal) var(--fancy-ease),
      background var(--fancy-transition-normal) var(--fancy-ease);
  }

  /* Spotlight hover pseudo-element */
  .agent-card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
      rgba(255, 255, 255, 0.06),
      transparent 40%
    );
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--fancy-transition-micro) var(--fancy-ease);
  }
  .agent-card:hover::before {
    opacity: 1;
  }

  .agent-card:hover {
    background: var(--fancy-surface-hover);
    border-color: var(--fancy-border-highlight);
    transform: translateY(-2px);
    box-shadow:
      var(--glass-highlight),
      0 8px 24px rgba(0, 0, 0, 0.3);
  }

  /* Danger left border for high-risk agents */
  .agent-card.danger {
    border-left: 3px solid var(--fancy-danger);
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: var(--fancy-space-sm);
  }
  .agent-name {
    font-family: var(--fancy-font-title);
    font-size: calc(14px * var(--aegis-ui-scale));
    font-weight: 600;
    color: var(--fancy-text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .api-badge {
    font-family: var(--fancy-font-mono);
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: var(--fancy-space-xs) var(--fancy-space-sm);
    border-radius: var(--md-sys-shape-corner-full);
    background: rgba(120, 160, 220, 0.15);
    color: var(--fancy-info);
    flex-shrink: 0;
  }

  .sparkline-row {
    height: 28px;
    margin: var(--fancy-space-sm) 0;
  }

  .stats-row {
    display: flex;
    align-items: center;
    gap: var(--fancy-space-sm);
    margin-top: var(--fancy-space-sm);
    flex-wrap: wrap;
  }
  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--fancy-space-xs);
    padding: var(--fancy-space-xs) var(--fancy-space-sm);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--fancy-border);
    border-radius: var(--fancy-radius-sm);
    cursor: default;
    transition: border-color var(--fancy-transition-micro) var(--fancy-ease);
  }
  button.stat-chip {
    cursor: copy;
  }
  button.stat-chip:hover {
    border-color: var(--fancy-border-highlight);
  }
  .stat-label {
    font-family: var(--fancy-font-body);
    font-size: calc(10px * var(--aegis-ui-scale));
    font-weight: 500;
    color: var(--fancy-text-2);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .stat-value {
    font-family: var(--fancy-font-mono);
    font-size: calc(11px * var(--aegis-ui-scale));
    font-weight: 600;
    color: var(--fancy-text-1);
  }

  .activity-hint {
    font-family: var(--fancy-font-mono);
    font-size: calc(11px * var(--aegis-ui-scale));
    color: var(--fancy-text-2);
    opacity: 0.7;
    margin-top: var(--fancy-space-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .expand-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 200ms var(--fancy-ease);
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
    gap: var(--fancy-space-sm);
  }
  .agent-card.expanded .expand-inner {
    margin-top: var(--fancy-space-md);
  }

  .agent-card.blinking {
    animation: card-blink 400ms ease 3;
  }
  @keyframes card-blink {
    0%,
    100% {
      background: var(--fancy-surface);
    }
    50% {
      background: rgba(0, 255, 136, 0.08);
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
      outline-color: var(--fancy-danger);
    }
  }
</style>
