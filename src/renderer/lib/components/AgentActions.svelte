<script>
  /**
   * @file AgentActions.svelte
   * @description Always-visible per-agent action row on AgentCard. Three advisory,
   *   UI-only actions — none stop, restrict, sandbox, or interfere with any
   *   process:
   *     • Add to watchlist — flags the agent so a future scan raises an alert when
   *       it reappears (alert-only; never acts at the OS level).
   *     • View details — expands the card's detail panel.
   *     • Acknowledge — a session-only "I have seen this" triage mark.
   * @since v0.10.0-alpha
   */
  import { addToast } from '../stores/toast.js';
  import { acknowledgedAgents, toggleAcknowledged } from '../stores/acknowledged.js';

  /**
   * @type {{
   *   agent: { name?: string, agent?: string, pid?: number },
   *   onViewDetails: () => void,
   * }}
   */
  let { agent, onViewDetails } = $props();

  /** Stable key for this agent — its display name (falls back to pid). */
  let agentKey = $derived(agent.name || agent.agent || String(agent.pid ?? ''));

  /** Reactive: is this agent currently acknowledged? */
  let acknowledged = $derived($acknowledgedAgents.has(agentKey));

  /**
   * Add this agent to the alert-only watchlist via the existing IPC bridge.
   * Passes `pid: null` so the signature (every instance of the agent) is flagged.
   * Alert-only — this raises an alert if the agent reappears and nothing more.
   * @param {MouseEvent} e
   */
  async function addToWatchlist(e) {
    e.stopPropagation();
    if (!agentKey) return;
    if (!window.aegis?.blocklistAdd) return;
    const res = await window.aegis.blocklistAdd({
      signature: agentKey,
      pid: null,
      reason: 'Flagged from agent card',
    });
    if (res?.success) {
      addToast(`Added ${agentKey} to watchlist — alert only`, 'success');
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
   * Acknowledge (or clear) this agent — a session-only renderer-side triage mark.
   * @param {MouseEvent} e
   */
  function acknowledge(e) {
    e.stopPropagation();
    const now = toggleAcknowledged(agentKey);
    addToast(
      now ? `Acknowledged ${agentKey}` : `Acknowledgement cleared for ${agentKey}`,
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
  .action-btn.active {
    border-color: var(--fancy-info);
    color: var(--fancy-info);
  }
</style>
