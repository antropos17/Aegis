<script>
  /**
   * @file PidList.svelte
   * @description Compact, dense per-PID list for a grouped agent card. Each row
   *   shows PID + process with a hover tooltip (process / cwd / parent / risk)
   *   and muted Kill / Suspend / Resume buttons revealed on row hover — instead
   *   of three saturated full-width buttons per row.
   * @since v0.10.0-alpha
   */

  /**
   * @type {{
   *   agent: { _instances?: Array<object>, pid: number, process?: string, name?: string },
   *   onPidAction: (e: MouseEvent, method: string, pid: number) => void,
   * }}
   */
  let { agent, onPidAction } = $props();

  /**
   * Per-PID list for a grouped agent. Falls back to the single agent when the
   * card is not a group (no `_instances`), so non-grouped cards are unchanged.
   * @type {Array<{ pid: number, process?: string, cwd?: string, parentChain?: string, parentEditor?: string, riskScore?: number }>}
   */
  let instances = $derived(agent._instances?.length ? agent._instances : [agent]);

  /** Compact per-PID intervention buttons — muted, revealed on row hover. */
  const PID_ACTIONS = [
    { method: 'killProcess', glyph: '✕', label: 'Kill', cls: 'kill' },
    { method: 'suspendProcess', glyph: '⏸', label: 'Suspend', cls: 'suspend' },
    { method: 'resumeProcess', glyph: '▶', label: 'Resume', cls: 'resume' },
  ];

  /**
   * Build a multi-line hover tooltip for a PID row; absent fields are omitted
   * so the tooltip never renders the string "undefined".
   * @param {{ pid: number, process?: string, cwd?: string, parentChain?: string, parentEditor?: string, riskScore?: number }} inst
   * @returns {string}
   */
  function pidTooltip(inst) {
    const lines = [`PID ${inst.pid}`];
    if (inst.process) lines.push(`Process: ${inst.process}`);
    if (inst.cwd) lines.push(`CWD: ${inst.cwd}`);
    if (inst.parentChain) lines.push(`Parent: ${inst.parentChain}`);
    else if (inst.parentEditor) lines.push(`Parent: ${inst.parentEditor}`);
    if (typeof inst.riskScore === 'number') lines.push(`Risk: ${Math.round(inst.riskScore)}`);
    return lines.join('\n');
  }
</script>

<div class="pid-list">
  {#each instances as inst (inst.pid)}
    <div class="pid-row" title={pidTooltip(inst)}>
      <span class="pid-num">{inst.pid}</span>
      <span class="pid-proc">{inst.process || inst.name || ''}</span>
      <div class="pid-acts">
        {#each PID_ACTIONS as act (act.method)}
          <button
            class="pid-act {act.cls}"
            title={act.label}
            aria-label="{act.label} PID {inst.pid}"
            onclick={(e) => onPidAction(e, act.method, inst.pid)}>{act.glyph}</button
          >
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  /* ── Per-PID list — dense rows, muted actions revealed on hover ── */
  .pid-list {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-1);
    max-height: calc(160px * var(--aegis-ui-scale));
    overflow-y: auto;
    margin-top: var(--aegis-space-2);
    border-top: 1px solid var(--md-sys-color-outline);
    padding-top: var(--aegis-space-3);
  }
  .pid-row {
    display: flex;
    align-items: center;
    gap: var(--aegis-space-3);
    padding: var(--aegis-space-1) var(--aegis-space-2);
    border-radius: var(--md-sys-shape-corner-small);
    font: var(--md-sys-typescale-label-medium);
    font-family: var(--fancy-font-mono);
    color: var(--md-sys-color-on-surface-variant);
    transition: background var(--fancy-transition-micro) var(--fancy-ease);
  }
  .pid-row:hover {
    background: var(--md-sys-color-surface-container);
  }
  .pid-num {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
  }
  .pid-proc {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.7;
  }
  .pid-acts {
    display: flex;
    gap: var(--aegis-space-1);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--fancy-transition-micro) var(--fancy-ease);
  }
  .pid-row:hover .pid-acts,
  .pid-row:focus-within .pid-acts {
    opacity: 1;
  }
  .pid-act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(20px * var(--aegis-ui-scale));
    height: calc(20px * var(--aegis-ui-scale));
    font-size: calc(10px * var(--aegis-ui-scale));
    line-height: 1;
    border-radius: var(--md-sys-shape-corner-small);
    border: 1px solid currentColor;
    background: transparent;
    cursor: pointer;
    opacity: 0.7;
    transition: all var(--fancy-transition-micro) var(--fancy-ease);
  }
  .pid-act:hover,
  .pid-act:focus-visible {
    opacity: 1;
    background: var(--md-sys-color-surface-container-high);
  }
  .pid-act:active {
    transform: scale(0.9);
  }
  .pid-act.kill {
    color: var(--md-sys-color-error);
  }
  .pid-act.suspend {
    color: var(--md-sys-color-secondary);
  }
  .pid-act.resume {
    color: var(--md-sys-color-tertiary);
  }
</style>
