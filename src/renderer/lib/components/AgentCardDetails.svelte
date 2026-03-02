<script>
  /**
   * @file AgentCardDetails.svelte
   * @description Expandable detail body for AgentCard — risk bar, CWD, parent
   *   chain, session duration, event log, and PID actions.
   *   Extracted from AgentCard.svelte.
   * @since v0.3.0
   */

  import { falsePositives } from '../stores/ipc.js';
  import { addToast } from '../stores/toast.js';

  let { agent, gradeColor, agentEvents, sessionDuration, onPidAction } = $props();

  async function markFalsePositive(ev) {
    const entry = { agentName: agent.name || agent.agent, pattern: ev.file, timestamp: Date.now() };
    if (window.aegis?.addFalsePositive) {
      await window.aegis.addFalsePositive(entry);
      falsePositives.update((arr) => [...arr, entry]);
      addToast(
        'Marked as false positive. Future similar events will have reduced risk.',
        'success',
      );
    }
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function shortenPath(p) {
    if (!p) return '';
    const parts = p.split(/[/\\]/);
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
  }
</script>

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
          {#if ev.sensitive}
            <button
              class="fp-btn"
              title="Mark as false positive"
              onclick={() => markFalsePositive(ev)}>FP</button
            >
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<div class="pid-actions-row">
  <span class="pid-info">PID {agent.pid}{agent.process ? ` \u2014 ${agent.process}` : ''}</span>
  <div class="pid-actions">
    <button class="action-btn kill" onclick={(e) => onPidAction(e, 'killProcess')}>Kill</button>
    <button class="action-btn suspend" onclick={(e) => onPidAction(e, 'suspendProcess')}
      >Suspend</button
    >
    <button class="action-btn resume" onclick={(e) => onPidAction(e, 'resumeProcess')}
      >Resume</button
    >
  </div>
</div>

<style>
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
  .fp-btn {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 700;
    padding: 0 var(--aegis-space-2);
    border-radius: var(--md-sys-shape-corner-full);
    border: 1px solid var(--md-sys-color-outline);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity 0.15s ease,
      background 0.15s ease;
  }
  .log-row:hover .fp-btn {
    opacity: 0.7;
  }
  .fp-btn:hover {
    opacity: 1;
    background: var(--md-sys-color-surface-container);
  }
  .pid-actions-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--aegis-space-4);
    margin-top: var(--aegis-space-2);
    border-top: 1px solid var(--md-sys-color-outline);
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
</style>
