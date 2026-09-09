<script lang="ts">
  import { untrack } from 'svelte';
  import { groupRecord, riskBand, type RadarGroup } from '../runtime/radar';
  import type { RecordData } from '../runtime/host';
  let {
    groups,
    inspect,
    paused = false,
  }: {
    groups: RadarGroup[];
    inspect: (_title: string, _row: RecordData) => void;
    paused?: boolean;
  } = $props();
  let page = $state(0);
  let slots = $state<Record<string, number>>({});
  let count = $derived(Math.max(1, Math.ceil(groups.length / 6)));
  let current = $derived(Math.min(page, count - 1));
  let visible = $derived(groups.slice(current * 6, current * 6 + 6));
  $effect(() => {
    const keys = visible.map((g) => g.key);
    untrack(() => {
      const next: Record<string, number> = {};
      for (const key of keys) if (slots[key] !== undefined) next[key] = slots[key];
      const used = Object.values(next);
      for (const key of keys)
        if (next[key] === undefined) {
          const preferred =
            [...key].reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0) % 6;
          let slot = preferred;
          while (used.includes(slot)) slot = (slot + 1) % 6;
          next[key] = slot;
          used.push(slot);
        }
      slots = next;
    });
  });
  function position(group: RadarGroup): { x: number; y: number } {
    const angle = (((slots[group.key] ?? 0) * 60 - 90) * Math.PI) / 180;
    const radius = 40 + Math.max(0, Math.min(100, group.risk)) * 0.44;
    return { x: 100 + Math.cos(angle) * radius, y: 100 + Math.sin(angle) * radius };
  }
</script>

<section class="panel risk-monitor">
  <header>
    <div>
      <h3>Agent risk radar</h3>
      <p>Distance from center follows each agent's highest process risk.</p>
    </div>
    <span>{paused ? 'Held observation' : 'Current assessment'}</span>
  </header>
  <div class="radar-body">
    <div class="risk-dial" aria-label="Agent risk radar, outer rings indicate higher risk">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        {#each [40, 55.4, 69.04, 84] as radius (radius)}<circle
            cx="100"
            cy="100"
            r={radius}
          />{/each}
        <path d="M 100 10 V 190 M 10 100 H 190" />
        <circle class="center" cx="100" cy="100" r="3" />
      </svg>
      {#each visible as group, index (group.key)}
        {@const point = position(group)}
        <button
          class="marker"
          class:medium={riskBand(group.risk) === 'medium'}
          class:high={riskBand(group.risk) === 'high'}
          style:left={point.x / 2 + '%'}
          style:top={point.y / 2 + '%'}
          aria-label={'Inspect ' + group.name + ', risk ' + group.risk + ' of 100'}
          title={group.name + ' · risk ' + group.risk}
          onclick={() => inspect(group.name, groupRecord(group))}>{index + 1}</button
        >
      {/each}
      {#if !groups.length}<span class="empty">Waiting for agents</span>{/if}
    </div>
    <div class="risk-list">
      {#each visible as group, index (group.key)}
        <button onclick={() => inspect(group.name, groupRecord(group))}
          ><span class="number">{index + 1}</span><span
            ><strong>{group.name}</strong><small
              >{group.members.length} processes · {riskBand(group.risk)} risk</small
            ></span
          ><b>{group.risk}</b></button
        >
      {/each}
    </div>
  </div>
  <footer>
    <span>Low &lt;35 · Medium 35–65 · High ≥66</span>{#if count > 1}<div>
        <button
          class="button"
          disabled={current === 0}
          onclick={() => (page = current - 1)}
          aria-label="Previous radar agents">←</button
        ><span>{current + 1} / {count}</span><button
          class="button"
          disabled={current >= count - 1}
          onclick={() => (page = current + 1)}
          aria-label="Next radar agents">→</button
        >
      </div>{/if}
  </footer>
</section>

<style>
  .risk-monitor {
    padding: 18px;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
  }
  h3 {
    font-size: 13px;
    font-weight: 550;
    margin: 0;
  }
  p {
    color: var(--muted);
    font-size: 11px;
    margin: 6px 0 0;
    line-height: 1.5;
  }
  header > span {
    color: var(--muted);
    font-size: 10px;
  }
  .radar-body {
    display: flex;
    gap: 18px;
    align-items: center;
    padding-top: 12px;
  }
  .risk-dial {
    width: 180px;
    height: 180px;
    flex-shrink: 0;
    position: relative;
  }
  svg {
    width: 100%;
    height: 100%;
  }
  circle,
  path {
    fill: none;
    stroke: var(--border);
    stroke-width: 1;
  }
  .center {
    fill: var(--muted);
    stroke: var(--muted);
  }
  .marker {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 19px;
    height: 19px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--green);
    background: var(--panel);
    color: var(--green);
    font-size: 10px;
    font-weight: 600;
    display: grid;
    place-items: center;
    transition:
      box-shadow 150ms,
      background 150ms;
  }
  .marker:hover,
  .marker:focus-visible {
    box-shadow: 0 0 0 4px var(--selection);
    background: var(--selection);
  }
  .marker.medium {
    border-color: var(--amber);
    color: var(--amber);
  }
  .marker.high {
    border-color: var(--red);
    color: var(--red);
  }
  .risk-list {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 6px;
  }
  .risk-list button {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    padding: 5px 0;
  }
  .risk-list button > span:nth-child(2) {
    flex: 1;
    min-width: 0;
  }
  strong {
    font-size: 11px;
    font-weight: 550;
    display: block;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 10px;
    margin-top: 4px;
  }
  b {
    font-size: 12px;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }
  .number {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--muted);
    font-size: 9px;
    flex-shrink: 0;
  }
  footer {
    border-top: 1px solid var(--border);
    padding-top: 10px;
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    font-size: 10px;
    color: var(--muted);
  }
  footer > div {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  footer .button {
    padding: 3px 7px;
    min-height: 25px;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 11px;
    color: var(--muted);
  }
  @media (max-width: 1000px) {
    .risk-dial {
      width: 140px;
      height: 140px;
    }
    .radar-body {
      gap: 12px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .marker {
      transition: none;
    }
  }
  :global(:root[data-motion='reduced']) .marker {
    transition: none;
  }
</style>
