<script>
  /**
   * @file CommandPalette.svelte — Modal command palette with fuzzy search
   * @module renderer/components/CommandPalette
   */

  import { SvelteMap } from 'svelte/reactivity';
  import { commandPalette } from '../stores/command-palette.svelte.ts';

  /**
   * Splits label into segments with highlight flags based on match indices.
   * @param {string} label - The command label text
   * @param {number[]} indices - Character positions that matched the query
   * @returns {{ char: string, highlighted: boolean }[]}
   */
  function highlightMatch(label, indices) {
    const indexSet = new Set(indices);
    /** @type {{ char: string, highlighted: boolean }[]} */
    const segments = [];
    for (let i = 0; i < label.length; i++) {
      segments.push({ char: label[i], highlighted: indexSet.has(i) });
    }
    return segments;
  }

  /**
   * Groups scored commands by category, preserving insertion order.
   * @param {import('../../../../shared/types').ScoredCommand[]} items
   * @returns {Map<string, import('../../../../shared/types').ScoredCommand[]>}
   */
  function groupByCategory(items) {
    /** @type {Map<string, import('../../../../shared/types').ScoredCommand[]>} */
    const groups = new SvelteMap();
    for (const item of items) {
      const list = groups.get(item.category);
      if (list) {
        list.push(item);
      } else {
        groups.set(item.category, [item]);
      }
    }
    return groups;
  }

  /** @type {HTMLInputElement | undefined} */
  let inputRef = $state(undefined);

  /** Flat index counter for tracking selected state across groups */
  let flatIndex = $derived.by(() => {
    /** @type {Map<string, number>} */
    const map = new SvelteMap();
    let idx = 0;
    for (const item of commandPalette.filteredItems) {
      map.set(item.id, idx++);
    }
    return map;
  });

  const grouped = $derived(groupByCategory(commandPalette.filteredItems));

  $effect(() => {
    if (commandPalette.open && inputRef) {
      inputRef.focus();
    }
  });

  /**
   * Handles keyboard navigation on svelte:window
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (!commandPalette.open) return;

    if (e.key === 'Escape') {
      commandPalette.close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandPalette.moveSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandPalette.moveSelection(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commandPalette.executeSelected();
      return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if commandPalette.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cp-overlay" onmousedown={commandPalette.close}>
    <div
      class="cp-dialog"
      role="dialog"
      aria-label="Command palette"
      tabindex="-1"
      onmousedown={(e) => e.stopPropagation()}
    >
      <div class="cp-search">
        <span class="cp-search-icon" aria-hidden="true">&#x1F50D;</span>
        <input
          bind:this={inputRef}
          class="cp-input"
          type="text"
          placeholder="Type a command..."
          value={commandPalette.query}
          oninput={(e) => commandPalette.setQuery(e.currentTarget.value)}
        />
      </div>

      <div class="cp-results">
        {#if commandPalette.filteredItems.length === 0}
          <div class="cp-empty">No results</div>
        {:else}
          {#each [...grouped] as [category, items] (category)}
            <div class="cp-category">{category}</div>
            {#each items as item (item.id)}
              {@const idx = flatIndex.get(item.id) ?? -1}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="cp-item"
                class:cp-item-selected={idx === commandPalette.selectedIndex}
                onmousedown={() => {
                  commandPalette.moveSelection(idx - commandPalette.selectedIndex);
                  commandPalette.executeSelected();
                }}
                onmouseenter={() => {
                  commandPalette.moveSelection(idx - commandPalette.selectedIndex);
                }}
              >
                {#if item.icon}
                  <span class="cp-item-icon" aria-hidden="true">{item.icon}</span>
                {/if}
                <span class="cp-item-label">
                  {#each highlightMatch(item.label, item.matchIndices) as seg, i (i)}
                    {#if seg.highlighted}<mark>{seg.char}</mark>{:else}{seg.char}{/if}
                  {/each}
                </span>
                {#if item.shortcut}
                  <span class="cp-item-shortcut">{item.shortcut}</span>
                {/if}
              </div>
            {/each}
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Overlay ── */
  .cp-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--md-sys-color-scrim);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 20vh;
    opacity: 1;
    animation: cp-fade-in var(--fancy-transition-micro) ease-out;
  }

  /* ── Dialog ── */
  .cp-dialog {
    max-width: 560px;
    width: 90%;
    max-height: 420px;
    display: flex;
    flex-direction: column;
    background: var(--fancy-panel-bg);
    backdrop-filter: blur(var(--fancy-panel-blur));
    -webkit-backdrop-filter: blur(var(--fancy-panel-blur));
    border: 1px solid var(--fancy-border);
    border-radius: var(--fancy-panel-radius);
    box-shadow: var(--fancy-panel-shadow);
    overflow: hidden;
    animation: cp-scale-in var(--fancy-transition-micro) ease-out;
  }

  /* ── Search bar ── */
  .cp-search {
    display: flex;
    align-items: center;
    padding: 0 var(--fancy-space-md);
    border-bottom: 1px solid var(--fancy-border);
  }

  .cp-search-icon {
    flex-shrink: 0;
    font-size: 14px;
    opacity: 0.5;
    margin-right: var(--fancy-space-sm);
  }

  .cp-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fancy-text-1);
    font-family: var(--fancy-font-body);
    font-size: 14px;
    padding: var(--fancy-space-md) 0;
    line-height: 1.4;
  }

  .cp-input::placeholder {
    color: var(--fancy-text-2);
  }

  /* ── Results list ── */
  .cp-results {
    overflow-y: auto;
    flex: 1;
    padding: var(--fancy-space-xs) 0;
  }

  /* ── Category header ── */
  .cp-category {
    text-transform: uppercase;
    font-size: 11px;
    color: var(--fancy-text-2);
    font-family: var(--fancy-font-mono);
    padding: var(--fancy-space-xs) var(--fancy-space-md);
    letter-spacing: 0.05em;
    margin-top: var(--fancy-space-xs);
  }

  .cp-category:first-child {
    margin-top: 0;
  }

  /* ── Item row ── */
  .cp-item {
    display: flex;
    align-items: center;
    gap: var(--fancy-space-sm);
    padding: var(--fancy-space-sm) var(--fancy-space-md);
    cursor: pointer;
    border-radius: 0;
    margin: 0 var(--fancy-space-xs);
    transition: background var(--fancy-transition-micro) ease;
  }

  .cp-item:hover,
  .cp-item-selected {
    background: var(--fancy-surface-hover);
    border-radius: var(--fancy-radius-sm);
  }

  .cp-item-icon {
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    font-size: 14px;
  }

  .cp-item-label {
    flex: 1;
    font-family: var(--fancy-font-body);
    color: var(--fancy-text-1);
    font-size: 13px;
    min-width: 0;
  }

  .cp-item-label mark {
    color: var(--fancy-accent);
    background: transparent;
    font-weight: 600;
  }

  .cp-item-shortcut {
    flex-shrink: 0;
    font-family: var(--fancy-font-mono);
    font-size: 12px;
    color: var(--fancy-text-2);
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 8px;
    border-radius: 4px;
    line-height: 1.4;
  }

  /* ── Empty state ── */
  .cp-empty {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: var(--fancy-space-md);
    color: var(--fancy-text-2);
    font-family: var(--fancy-font-body);
    font-size: 13px;
  }

  /* ── Animations (GPU only) ── */
  @keyframes cp-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes cp-scale-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cp-overlay,
    .cp-dialog {
      animation: none;
    }
  }
</style>
