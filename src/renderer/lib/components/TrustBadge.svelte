<!--
  TrustBadge.svelte — Visual risk level indicator [F2.2]
  Displays a colored badge with score and optional label.
  Used in AgentCard (F2.3) and agent detail views.
-->
<script lang="ts">
  /**
   * @component TrustBadge
   * Visual indicator of agent trust/risk level with color-coded glow.
   *
   * @prop score - Risk score 0–100
   * @prop size - Badge size: 'sm' | 'md' | 'lg' (default: 'md')
   * @prop showLabel - Whether to show the risk label text (default: false)
   */

  import { getRiskInfo, clampScore, getBadgeDimension } from '../utils/trust-badge-utils';
  import type { BadgeSize } from '../utils/trust-badge-utils';

  interface Props {
    score: number;
    size?: BadgeSize;
    showLabel?: boolean;
  }

  const { score, size = 'md', showLabel = false }: Props = $props();

  /** Clamped display score */
  const displayScore = $derived(clampScore(score));

  /** Risk info (level, label, color, glow) derived from score */
  const risk = $derived(getRiskInfo(score));

  /** Badge diameter in px */
  const dim = $derived(getBadgeDimension(size));

  /** Font size scales with badge dimension */
  const fontSize = $derived(Math.round(dim * 0.4));
</script>

<span
  class="trust-badge trust-badge--{size}"
  role="status"
  aria-label="Risk score {displayScore}: {risk.label}"
  style:--badge-color={risk.color}
  style:--badge-glow={risk.glowColor}
  style:--badge-dim="{dim}px"
  style:--badge-font="{fontSize}px"
>
  <span class="trust-badge__score">{displayScore}</span>
  {#if showLabel}
    <span class="trust-badge__label">{risk.label}</span>
  {/if}
</span>

<style>
  .trust-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--fancy-space-xs);
    height: var(--badge-dim);
    padding: 0 var(--fancy-space-sm);
    border-radius: var(--fancy-radius-sm);

    background: color-mix(in srgb, var(--badge-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--badge-color) 25%, transparent);

    filter: drop-shadow(0 0 6px var(--badge-glow));

    transition:
      filter var(--fancy-transition-normal) var(--fancy-ease),
      background var(--fancy-transition-normal) var(--fancy-ease),
      border-color var(--fancy-transition-normal) var(--fancy-ease);
  }

  .trust-badge__score {
    font-family: var(--fancy-font-mono);
    font-size: var(--badge-font);
    font-weight: 700;
    line-height: 1;
    color: var(--badge-color);

    transition: color var(--fancy-transition-normal) var(--fancy-ease);
  }

  .trust-badge__label {
    font-family: var(--fancy-font-body);
    font-size: calc(var(--badge-font) - 2px);
    font-weight: 500;
    line-height: 1;
    color: var(--badge-color);
    opacity: 0.85;
    white-space: nowrap;

    transition:
      color var(--fancy-transition-normal) var(--fancy-ease),
      opacity var(--fancy-transition-normal) var(--fancy-ease);
  }
</style>
