<script>
  /**
   * @file AgentCard.svelte
   * @description Fancy agent card — glassmorphism panel with sparkline,
   *   trust badge, spotlight hover, and expandable details. [F2.3]
   * @since v0.5.0
   */
  import { agentResourceByInstance, focusedAgentInstanceId, tokenCosts } from '../stores/ipc.js';
  import { eventsByInstance } from '../stores/events-index.ts';
  import AgentCardDetails from './AgentCardDetails.svelte';
  import AgentActions from './AgentActions.svelte';
  import Sparkline from './Sparkline.svelte';
  import TrustBadge from './TrustBadge.svelte';
  import { getRiskInfo } from '../utils/trust-badge-utils';
  import { addToast } from '../stores/toast.js';
  import { requestStop } from '../stores/process-action.js';
  import { isAgentSelected, toggleInstanceSelection } from '../utils/agent-selection.ts';
  import { isAnomalyAlert } from '../utils/anomaly-toast-tracker.ts';
  import { t } from '../i18n/index.js';

  /** @type {{ agent: Object, expandedInstanceId: string|null }} */
  let { agent, expandedInstanceId = $bindable(null) } = $props();

  let blinking = $state(false);
  let threatFlash = $state(false);
  /** The alert state on the previous run of the flash effect; `null` until the first. */
  let _prevDanger = null;
  let cardEl = $state(null);
  // Selection identity is stamped instanceId — never agent.pid (pid reuse).
  let expanded = $derived(isAgentSelected(expandedInstanceId, agent));

  /** Risk info (color, label) derived from agent score */
  let risk = $derived(getRiskInfo(agent.riskScore ?? 0));

  /** Sparkline color: match the risk color */
  let sparkColor = $derived(risk.color);

  /** Risk history: use agent.riskHistory if available, else empty */
  let riskHistory = $derived(agent.riskHistory ?? []);

  /**
   * The anomaly score the toast printed for this name: the max over the group's
   * instances. The toast is keyed by NAME and carries the max over that name's instances
   * (scan-loop.js), while the representative this card is spread from is the
   * max-riskScore instance (agent-panel-utils) — not necessarily the one the score
   * belongs to. A card rendered without a group reads its own score; no score is 0.
   */
  let cardAnomaly = $derived.by(() => {
    const list =
      Array.isArray(agent._instances) && agent._instances.length > 0 ? agent._instances : [agent];
    let max = 0;
    for (const inst of list) {
      const score = inst?.anomalyScore;
      if (typeof score === 'number' && score > max) max = score;
    }
    return max;
  });

  /**
   * Danger border: the exposure model at 70 or over, OR an anomaly at the toast gate
   * (`ANOMALY_TOAST_THRESHOLD`), read through the same `isAnomalyAlert` the toast tracker
   * gates on — so whatever toasts alerts here, and no second threshold lives in this file.
   * `riskScore` itself is not moved by the anomaly: the badge keeps its band.
   */
  let isDanger = $derived((agent.riskScore ?? 0) >= 70 || isAnomalyAlert(cardAnomaly));

  $effect(() => {
    const danger = isDanger;
    // A crossing, not a mount: the first run only records the state.
    if (_prevDanger !== null && danger && !_prevDanger) {
      threatFlash = true;
      const timer = setTimeout(() => {
        threatFlash = false;
      }, 1000);
      _prevDanger = danger;
      return () => clearTimeout(timer);
    }
    _prevDanger = danger;
  });

  $effect(() => {
    const focusId = $focusedAgentInstanceId;
    if (focusId === null) return;
    if (isAgentSelected(focusId, agent)) {
      expandedInstanceId = focusId;
      blinking = true;
      if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const t1 = setTimeout(() => {
        blinking = false;
      }, 1200);
      const t2 = setTimeout(() => {
        focusedAgentInstanceId.set(null);
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

  // Matched on the process INSTANCE, never on the pid: a recycled pid must not inherit a
  // dead instance's activity. An agent carrying no instanceId gets an empty list rather
  // than a namesake's events — stores/risk.ts `byInstance` states the policy.
  let agentEvents = $derived(agent.instanceId ? $eventsByInstance.get(agent.instanceId) || [] : []);

  /**
   * Token + cost record for this agent, from the `token-costs` push. Matched by
   * process INSTANCE when both sides carry an instanceId — a recycled pid must
   * not show a dead instance's frozen record. Pid matching is the fallback for
   * records the tracker keyed from a bare pid (no instanceId on either side).
   */
  let tokenRec = $derived(
    $tokenCosts.find((r) =>
      agent.instanceId && r.instanceId ? r.instanceId === agent.instanceId : r.pid === agent.pid,
    ),
  );

  /**
   * CPU/RAM sample for THIS instance, from the `agent-resource-usage` push. Looked up
   * strictly by `instanceId` — no pid fallback, unlike {@link tokenRec}: the resource
   * push always carries the key when the monitor could resolve one, so a pid match here
   * would only ever fire for a record that is deliberately unattributed, and would pin a
   * stranger's CPU onto this card. An agent with no key gets no figures.
   */
  let resourceRec = $derived(
    agent.instanceId ? ($agentResourceByInstance.get(agent.instanceId) ?? null) : null,
  );

  /**
   * Formatted figures, or `null` for "no measurement". `null` covers BOTH no record for
   * this instance and a record whose field the monitor could not read — the two are
   * indistinguishable to a viewer and both render as absent. A measured zero is a real
   * reading and formats normally: `0 %` means idle, not missing.
   */
  let cpuText = $derived(resourceRec && resourceRec.cpu != null ? `${resourceRec.cpu} %` : null);
  let memText = $derived(
    resourceRec && resourceRec.memMb != null ? `${resourceRec.memMb.toLocaleString()} MB` : null,
  );

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
    // Keyless agents cannot become selected (no pid/name fallback).
    expandedInstanceId = toggleInstanceSelection(expandedInstanceId, agent);
  }

  /**
   * Keyboard activation for the card (role="button"). Enter/Space toggle the
   * card, mirroring the click handler. Guarded to the article itself so that
   * Enter/Space on inner buttons (copy PID, kill/suspend/resume) does not
   * bubble up and collapse the card — those buttons stopPropagation on click,
   * not on keydown.
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  /**
   * Run a process action against a specific PID (defaults to the representative).
   * Destructive `killProcess` routes through a confirmation gate; the reversible
   * `suspendProcess`/`resumeProcess` run directly.
   */
  async function pidAction(e, method, pid = agent.pid) {
    e.stopPropagation();
    if (method === 'killProcess') {
      requestStop(pid, agent.name || agent.agent || String(pid));
      return;
    }
    if (window.aegis) await window.aegis[method](pid);
  }

  /** Copy PID to clipboard and show toast. */
  async function copyPid(e) {
    e.stopPropagation();
    await navigator.clipboard.writeText(String(agent.pid));
    addToast($t('agents.pid_copied'), 'success', 3000);
  }
</script>

<div
  class="agent-card"
  class:expanded
  class:blinking
  class:threat-flash={threatFlash}
  class:danger={isDanger}
  bind:this={cardEl}
  role="button"
  tabindex="0"
  aria-expanded={expanded}
  onclick={toggle}
  onkeydown={handleKeydown}
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
    <span class="stat-chip" title={cpuText ? $t('agents.cpu_title') : $t('agents.no_sample_title')}>
      <span class="stat-label">CPU</span>
      {#if cpuText}
        <span class="stat-value">{cpuText}</span>
      {:else}
        <span class="stat-absent">{$t('agents.not_sampled')}</span>
      {/if}
    </span>
    <span class="stat-chip" title={memText ? $t('agents.mem_title') : $t('agents.no_sample_title')}>
      <span class="stat-label">MEM</span>
      {#if memText}
        <span class="stat-value">{memText}</span>
      {:else}
        <span class="stat-absent">{$t('agents.not_sampled')}</span>
      {/if}
    </span>
    {#if tokenRec && tokenRec.totalTokens > 0}
      <span class="stat-chip">
        <span class="stat-label">{$t('agents.tokens')}</span>
        <span class="stat-value"
          >{tokenRec.totalTokens.toLocaleString()}{tokenRec.estimated
            ? ' ~$'
            : ' $'}{tokenRec.costUsd.toFixed(4)}</span
        >
      </span>
    {/if}
  </div>

  {#if lastFile}<div class="activity-hint">{$t('agents.last_file', { file: lastFile })}</div>{/if}

  <AgentActions
    {agent}
    onViewDetails={() => {
      expandedInstanceId = toggleInstanceSelection(null, agent);
    }}
  />

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
</div>

<style>
  .agent-card {
    background: var(--fancy-panel-bg-opaque);
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
  /* "No measurement" — deliberately NOT a number and NOT the mono face the figures use,
     so it cannot be misread as a reading of zero at a glance. */
  .stat-absent {
    font-family: var(--fancy-font-body);
    font-size: calc(10px * var(--aegis-ui-scale));
    font-weight: 400;
    color: var(--fancy-text-2);
    opacity: 0.7;
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
