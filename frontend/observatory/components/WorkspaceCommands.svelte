<script lang="ts">
  import { t } from '../runtime/i18n';

  import { tick } from 'svelte';
  import { findCommands, isAdvancedWorkspace, type WorkspaceCommand } from '../runtime/navigation';
  import Icon from './Icon.svelte';
  let {
    open,
    close,
    entries,
    choose,
    advanced = true,
  }: {
    open: boolean;
    close: () => void;
    entries: WorkspaceCommand[];
    choose: (_entry: WorkspaceCommand) => void | Promise<void>;
    advanced?: boolean;
  } = $props();
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state('');
  let active = $state(0);
  let resultStatus = $state('');
  let filtered = $derived(
    findCommands(
      entries.map((entry) => ({
        ...entry,
        label: $t(entry.label),
        caption:
          !advanced && isAdvancedWorkspace(entry.target)
            ? $t('Advanced') + ' · ' + $t(entry.caption)
            : $t(entry.caption),
        keywords: entry.keywords + ' ' + entry.label + ' ' + entry.caption,
      })),
      query,
    ),
  );
  let trigger: HTMLElement | null = null;
  let selectedDestination = false;
  $effect(() => {
    const message = filtered.length
      ? $t('{count} destinations', { count: filtered.length })
      : $t('No matching destination.');
    if (!open) {
      resultStatus = '';
      return;
    }
    const timer = setTimeout(() => (resultStatus = message), 250);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    if (open && !dialog.open) {
      trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      selectedDestination = false;
      query = '';
      active = 0;
      dialog.showModal();
      void tick().then(() => input.focus());
    } else if (!open && dialog.open) {
      dialog.close();
      if (!selectedDestination && trigger?.isConnected && !trigger.closest('[hidden], [inert]'))
        trigger.focus({ preventScroll: true });
    }
  });
  function dismiss() {
    selectedDestination = false;
    close();
  }
  function select(entry: WorkspaceCommand) {
    selectedDestination = true;
    void choose(entry);
  }
  function move(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active =
        (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
        Math.max(1, filtered.length);
      document.getElementById('command-result-' + active)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && filtered[active]) {
      event.preventDefault();
      select(filtered[active]);
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="command-panel workspace-command-panel"
  aria-labelledby="command-title"
  onclose={close}
  oncancel={(event) => {
    event.preventDefault();
    dismiss();
  }}
>
  <div class="command-head">
    <div>
      <h2 id="command-title">{$t('Go to workspace or section')}</h2>
      <p>{$t('Find related information without leaving a trail of open tabs.')}</p>
    </div>
    <button class="icon-button" aria-label={$t('Close commands')} onclick={dismiss}
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
      aria-label={$t('Find a workspace or action')}
      aria-expanded={filtered.length > 0}
      aria-controls="command-results"
      aria-autocomplete="list"
      aria-activedescendant={filtered[active] ? 'command-result-' + active : undefined}
      placeholder={$t('Workspace, chart, settings…')}
      onkeydown={move}
    />
  </label>
  <div
    id="command-results"
    role="listbox"
    tabindex="-1"
    aria-label={$t('Destinations')}
    class="command-results"
    hidden={!filtered.length}
  >
    {#each filtered as entry, index (entry.id)}
      <button
        role="option"
        aria-label={entry.label + ' · ' + entry.caption}
        tabindex="-1"
        id={'command-result-' + index}
        aria-selected={index === active}
        class="command-result"
        onclick={() => select(entry)}
      >
        <span><strong>{entry.label}</strong><small>{entry.caption}</small></span><Icon
          name="chevron"
        />
      </button>
    {/each}
  </div>
  <div class="command-feedback">
    <p role="status" aria-live="polite" aria-atomic="true">{resultStatus}</p>
    {#if !filtered.length}
      <button
        class="button"
        onclick={() => {
          query = '';
          active = 0;
          input.focus();
        }}>{$t('Clear search')}</button
      >
    {/if}
  </div>
  <div class="command-foot">
    <span>{$t('↑ ↓ to choose · Enter to open')}</span><kbd>{$t('Esc')}</kbd>
  </div>
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
  .command-results[hidden] {
    display: none;
  }
  .command-feedback {
    padding: var(--space-2) var(--space-5);
  }
  .command-feedback p {
    min-height: 1.5em;
  }
  .command-feedback .button {
    margin-top: var(--space-2);
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
