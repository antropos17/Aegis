<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { RecordData } from '../runtime/host';
  let {
    rows,
    layer,
    inspect,
  }: {
    rows: { row: RecordData; group: string | null }[];
    layer: string;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let svg: SVGSVGElement;
  let stage: HTMLElement | null = null;
  function align(): void {
    if (!stage || !svg) return;
    const bounds = stage.getBoundingClientRect();
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
    svg.setCurrentTime?.(svg.getCurrentTime?.() || 0);
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
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => {
      const frozen =
        media.matches ||
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
    media.addEventListener('change', syncMotion);
    align();
    syncMotion();
    return () => {
      resize?.disconnect();
      observer.disconnect();
      media.removeEventListener('change', syncMotion);
      stage = null;
    };
  });
</script>

<svg bind:this={svg} class="radar-links" aria-hidden="true" data-routes="pending">
  {#each rows as entry, i (entry.row)}<g
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
{#each rows as entry, i (entry.row)}<button
    class="resource-node"
    data-route-index={i}
    title={String(entry.row.file ?? entry.row.domain ?? entry.row.remoteIp ?? '')}
    onclick={() =>
      inspect(layer === 'files' ? 'File observation' : 'Network observation', entry.row)}
    >{String(entry.row.file ?? entry.row.domain ?? entry.row.remoteIp ?? 'Observation')
      .split(/[/\\]/)
      .pop()}</button
  >{:else}<p class="resource-empty">
    No {layer === 'files' ? 'file observations' : 'connections'} for this selection
  </p>{/each}

<style>
  .resource-empty {
    position: absolute;
    bottom: 12px;
    padding: 0 12px;
    width: 100%;
    text-align: center;
    font-size: 11px;
    color: var(--muted);
    pointer-events: none;
  }
</style>
