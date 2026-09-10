<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { RecordData } from '../runtime/host';
  import type { RadarResource } from '../runtime/radar-resources';
  import Icon from './Icon.svelte';
  let {
    rows,
    layer,
    inspect,
    ready,
    scoped,
  }: {
    rows: RadarResource[];
    layer: string;
    inspect: (_title: string, _row: RecordData) => void;
    ready: boolean;
    scoped: boolean;
  } = $props();
  let svg: SVGSVGElement;
  let stage: HTMLElement | null = null;
  function align(): void {
    if (!stage || !svg) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const routes = svg.querySelectorAll('g');
    stage.querySelectorAll<HTMLElement>('.resource-node').forEach((resource, index) => {
      const key = rows[index]?.group;
      const dot = key
        ? [...stage!.querySelectorAll<HTMLElement>('.radar-blip')]
            .find((el) => el.dataset.group === key)
            ?.querySelector('.blip-dot')
        : null;
      const route = routes[index];
      if (!route) return;
      route.style.display = dot ? '' : 'none';
      if (!dot) return;
      const a = dot.getBoundingClientRect(),
        b = resource.getBoundingClientRect();
      const x = a.left + a.width / 2 - bounds.left,
        y = a.top + a.height / 2 - bounds.top;
      const ex = b.left + b.width / 2 - bounds.left,
        ey = b.top + b.height / 2 - bounds.top;
      const path = `M${x} ${y} Q${(x + ex) / 2} ${y} ${ex} ${ey}`;
      route.querySelector('path')?.setAttribute('d', path);
      route.querySelector('animateMotion')?.setAttribute('path', path);
    });
    svg.dataset.routes = 'ready';
  }
  $effect(() => {
    rows;
    layer;
    void tick().then(align);
  });
  onMount(() => {
    stage = svg.parentElement;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align);
    if (stage) resize?.observe(stage);
    const app = stage?.closest('.observatory-app');
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const syncMotion = () => {
      const frozen =
        media?.matches ||
        document.documentElement.dataset.motion === 'reduce' ||
        app?.classList.contains('paused') ||
        stage?.classList.contains('stale');
      if (frozen) svg.pauseAnimations?.();
      else svg.unpauseAnimations?.();
    };
    const observer = new MutationObserver(syncMotion);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['class'] });
    if (stage) observer.observe(stage, { attributes: true, attributeFilter: ['class'] });
    media?.addEventListener('change', syncMotion);
    align();
    syncMotion();
    return () => {
      resize?.disconnect();
      observer.disconnect();
      media?.removeEventListener('change', syncMotion);
      stage = null;
    };
  });
</script>

<svg
  bind:this={svg}
  class="radar-links"
  aria-hidden="true"
  data-routes="pending"
  preserveAspectRatio="none"
>
  {#each rows as entry, i (entry.key)}<g data-resource-key={entry.key}
      ><path /><circle r="2" opacity="0"
        ><animateMotion dur={`${4 + i}s`} repeatCount="indefinite" /><animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.12;0.88;1"
          dur={`${4 + i}s`}
          repeatCount="indefinite"
        /></circle
      ></g
    >{/each}
</svg>
{#each rows as entry, i (entry.key)}<button
    class="resource-node"
    data-route-index={i}
    data-resource-key={entry.key}
    data-resource-group={entry.group}
    title={entry.address}
    onclick={() =>
      inspect(
        layer === 'files' ? 'File observation' : 'Network observation',
        entry.rows.length > 1
          ? { observationGroup: entry.label, observations: entry.rows }
          : entry.row,
      )}
    ><span class="resource-title"
      ><Icon name={layer === 'files' ? 'file' : 'network'} /><strong>{entry.label}</strong><span
        class="resource-count">{entry.count}×</span
      ></span
    >
    <span class="resource-detail">{entry.detail}</span>
    <span class="resource-owner">{entry.name} · {entry.attribution}</span></button
  >{:else}<div class="resource-empty" role="status">
    <Icon name={layer === 'files' ? 'folder' : 'network'} />
    <strong
      >{ready
        ? `No ${layer === 'files' ? 'file observations' : 'connections'}${scoped ? ' for this agent' : ' on this page'}`
        : 'Waiting for a reliable scan'}</strong
    >
    <span
      >{scoped
        ? 'Choose another agent or show all agents.'
        : layer === 'files'
          ? 'Recorded file activity will appear here.'
          : 'Observed endpoints will appear here.'}</span
    >
  </div>{/each}

<style>
  .resource-empty {
    position: absolute;
    inset: auto 16px 16px;
    padding: 14px;
    display: grid;
    justify-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    text-align: center;
    font-size: calc(11px * var(--ui-scale));
    color: var(--muted);
    pointer-events: none;
  }
  :global(.radar-stage) .resource-node {
    display: grid;
    gap: 4px;
    width: min(300px, calc(100% - 32px));
    max-width: calc(100% - 32px);
    padding: 10px 12px;
    text-align: left;
    color: var(--ink);
    border-color: var(--strong-border);
    box-shadow: 0 2px 6px #0001;
    animation: resource-arrive 220ms ease-out;
  }
  .resource-title {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .resource-title strong {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .resource-title :global(svg) {
    flex: none;
  }
  .resource-count {
    margin-left: auto;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
  }
  .resource-detail,
  .resource-owner {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
  }
  .resource-owner {
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
  @keyframes resource-arrive {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
