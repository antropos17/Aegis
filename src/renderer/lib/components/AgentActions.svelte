<script>
  /**
   * @file AgentActions.svelte
   * @description Always-visible per-agent action row on AgentCard. Three advisory,
   *   UI-only actions — none stop, restrict, sandbox, or interfere with any
   *   process:
   *     • Add to watchlist — durable name signature (alert-only; any-PID).
   *     • View details — expands the card's detail panel.
   *     • Acknowledge — session-only triage mark keyed by stamped instanceId (C4).
   * @since v0.10.0-alpha
   */
  import { addToast } from '../stores/toast.js';
  import { acknowledgedAgents, toggleAcknowledged } from '../stores/acknowledged.js';
  import { acknowledgementInstanceId, watchlistSignature } from '../utils/agent-action-keys.ts';

  /**
   * @type {{
   *   agent: {
   *     name?: string,
   *     agent?: string,
   *     pid?: number,
   *     instanceId?: string | null,
   *   },
   *   onViewDetails: () => void,
   * }}
   */
  let { agent, onViewDetails } = $props();

  /**
   * Live acknowledgement identity — stamped instanceId only. Never name/pid.
   * Null when the agent carries no stamp (ack button stays inactive / no-op).
   */
  let ackId = $derived(acknowledgementInstanceId(agent));

  /**
   * Durable watchlist signature — display name only (main/blocklist any-PID entry).
   * Intentionally independent of ackId so same-name restarts stay watched without
   * inheriting the dead instance's acknowledgement.
   */
  let watchSig = $derived(watchlistSignature(agent));

  /** Reactive: is THIS process instance currently acknowledged? */
  let acknowledged = $derived(ackId !== null && $acknowledgedAgents.has(ackId));

  /**
   * Add this agent name to the alert-only watchlist via the existing IPC bridge.
   * Passes `pid: null` so every instance of the signature is flagged (durable).
   * @param {MouseEvent} e
   */
  async function addToWatchlist(e) {
    e.stopPropagation();
    if (!watchSig) return;
    if (!window.aegis?.blocklistAdd) return;
    const res = await window.aegis.blocklistAdd({
      signature: watchSig,
      pid: null,
      reason: 'Flagged from agent card',
    });
    if (res?.success) {
      addToast(`Added ${watchSig} to watchlist — alert only`, 'success');
    } else {
      addToast(`Could not add to watchlist: ${res?.error ?? 'unknown error'}`, 'error');
    }
  }

  /**
   * View the agent's details — expands the card's detail panel via the parent.
   * @param {MouseEvent} e
   */
  function viewDetails(e) {
    e.stopPropagation();
    onViewDetails();
  }

  /**
   * Acknowledge (or clear) this process instance — session-only, instanceId-keyed.
   * No-op when the agent has no stamped instanceId (no name/pid fallback).
   * @param {MouseEvent} e
   */
  function acknowledge(e) {
    e.stopPropagation();
    if (ackId === null) return;
    const now = toggleAcknowledged(ackId);
    const label = watchSig || ackId;
    addToast(
      now ? `Acknowledged ${label}` : `Acknowledgement cleared for ${label}`,
      'success',
      3000,
    );
  }
</script>

<div class="agent-actions">
  <button class="action-btn" type="button" onclick={addToWatchlist}>Add to watchlist</button>
  <button class="action-btn" type="button" onclick={viewDetails}>View details</button>
  <button
    class="action-btn"
    class:active={acknowledged}
    type="button"
    aria-pressed={acknowledged}
    disabled={ackId === null}
    onclick={acknowledge}
  >
    {acknowledged ? 'Acknowledged' : 'Acknowledge'}
  </button>
</div>

<style>
  .agent-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fancy-space-sm);
    margin-top: var(--fancy-space-sm);
  }
  .action-btn {
    font-family: var(--fancy-font-body);
    font-size: calc(11px * var(--aegis-ui-scale));
    font-weight: 600;
    padding: var(--fancy-space-xs) var(--fancy-space-md);
    border-radius: var(--md-sys-shape-corner-full);
    border: 1px solid var(--fancy-border);
    background: transparent;
    color: var(--fancy-text-2);
    cursor: pointer;
    transition:
      border-color var(--fancy-transition-micro) var(--fancy-ease),
      background var(--fancy-transition-micro) var(--fancy-ease),
      color var(--fancy-transition-micro) var(--fancy-ease);
  }
  .action-btn:hover,
  .action-btn:focus-visible {
    border-color: var(--fancy-border-highlight);
    color: var(--fancy-text-1);
    background: var(--fancy-surface-hover);
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .action-btn.active {
    border-color: var(--fancy-info);
    color: var(--fancy-info);
  }
</style>
