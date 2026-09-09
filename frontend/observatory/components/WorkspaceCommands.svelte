<script lang="ts">
  import { tick } from 'svelte';
  import { findCommands, type WorkspaceCommand } from '../runtime/navigation';
  import Icon from './Icon.svelte';
  let {
    open,
    close,
    entries,
    choose,
  }: {
    open: boolean;
    close: () => void;
    entries: WorkspaceCommand[];
    choose: (_entry: WorkspaceCommand) => void | Promise<void>;
  } = $props();
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state('');
  let active = $state(0);
  let filtered = $derived(findCommands(entries, query));
  let trigger: HTMLElement | null = null;
  $effect(() => {
    if (open && !dialog.open) {
      trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      query = '';
      active = 0;
      dialog.showModal();
      void tick().then(() => input.focus());
    } else if (!open && dialog.open) {
      dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  });
  function move(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active =
        (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
        Math.max(1, filtered.length);
      document.getElementById('command-result-' + active)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && filtered[active]) {
      event.preventDefault();
      void choose(filtered[active]);
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="command-panel workspace-command-panel"
  aria-labelledby="command-title"
  onclose={close}
>
  <div class="command-head">
    <div>
      <h2 id="command-title">Go to workspace or section</h2>
      <p>Find related information without leaving a trail of open tabs.</p>
    </div>
    <button class="icon-button" aria-label="Close commands" onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  <label class="command-search"
    ><Icon name="search" />
    <input
      bind:this={input}
      type="search"
      bind:value={query}
      oninput={() => (active = 0)}
      role="combobox"
      aria-label="Find a workspace or action"
      aria-expanded="true"
      aria-controls="command-results"
      aria-autocomplete="list"
      aria-activedescendant={filtered[active] ? 'command-result-' + active : undefined}
      placeholder="Workspace, chart, settings…"
      onkeydown={move}
    />
  </label>
  <div id="command-results" role="listbox" aria-label="Destinations" class="command-results">
    {#each filtered as entry, index (entry.id)}
      <button
        role="option"
        id={'command-result-' + index}
        aria-selected={index === active}
        class="command-result"
        onclick={() => choose(entry)}
      >
        <span><strong>{entry.label}</strong><small>{entry.caption}</small></span><Icon
          name="chevron"
        />
      </button>
    {:else}<p class="inset muted">No matching destination.</p>{/each}
  </div>
  <div class="command-foot"><span>↑ ↓ to choose · Enter to open</span><kbd>Esc</kbd></div>
</dialog>

<style>
  .workspace-command-panel {
    padding: 0;
    overflow: hidden;
    width: min(640px, calc(100vw - 36px));
    top: 18px;
    max-height: calc(100dvh - 36px);
  }
  .workspace-command-panel[open] {
    display: flex;
    flex-direction: column;
  }
  .command-head {
    display: flex;
    align-items: start;
    gap: 18px;
    padding: 18px 20px;
  }
  .command-head > div {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: calc(17px * var(--ui-scale));
    margin: 0 0 8px;
  }
  p {
    font-size: calc(12px * var(--ui-scale));
    color: var(--muted);
    margin: 0;
  }
  .command-panel .command-search {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0 20px 14px;
    margin: 0;
  }
  input {
    width: 100%;
    min-width: 0;
  }
  .command-results {
    overflow: auto;
    min-height: 0;
    padding: 4px 10px 10px;
    border-top: 1px solid var(--border);
  }
  .command-result {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 12px;
    padding: 12px;
    text-align: left;
    border-radius: 8px;
  }
  .command-result > span {
    flex: 1;
    min-width: 0;
  }
  .command-result strong {
    font-size: calc(13px * var(--ui-scale));
    display: block;
  }
  .command-result small {
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
    display: block;
    margin-top: 4px;
  }
  .command-result[aria-selected='true'],
  .command-result:hover {
    background: var(--raised);
  }
  .command-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
  }
</style>
