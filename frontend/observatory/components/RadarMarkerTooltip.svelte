<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { RadarGroup } from '../runtime/radar';

  let {
    id,
    group,
    x,
    y,
    onenter,
    onexit,
  }: {
    id: string;
    group: RadarGroup;
    x: number;
    y: number;
    onenter: () => void;
    onexit: (_event: MouseEvent) => void;
  } = $props();
</script>

<div class="tooltip-anchor" style:left={`${x}%`} style:top={`${y}%`}>
  <span
    {id}
    role="tooltip"
    class="marker-tooltip"
    class:align-left={x < 35}
    class:align-right={x > 65}
    class:below={y < 50}
    onmouseenter={onenter}
    onmouseleave={onexit}
  >
    {$t('{value0} · {value1} processes · risk {value2}/100', {
      value0: group.name,
      value1: group.members.length,
      value2: group.risk,
    })}
  </span>
</div>

<style>
  .tooltip-anchor {
    position: absolute;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
    z-index: 2;
    pointer-events: none;
  }
  .marker-tooltip {
    position: absolute;
    z-index: 4;
    pointer-events: auto;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: 140px;
    padding: var(--space-2);
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    background: var(--panel);
    color: var(--ink);
    font-size: var(--text-caption);
    font-weight: 400;
    line-height: 1.5;
    text-align: start;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .align-left {
    left: 0;
    transform: none;
  }
  .align-right {
    left: auto;
    right: 0;
    transform: none;
  }
  .below {
    bottom: auto;
    top: 100%;
  }
</style>
