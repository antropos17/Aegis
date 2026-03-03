<!--
  Sparkline.svelte — Pure SVG sparkline chart [F2.1]
  Renders a responsive polyline + optional area gradient.
  Used in AgentCard (F2.3) and Footer charts (F3.2).
-->
<script lang="ts">
  /**
   * @component Sparkline
   * Pure SVG sparkline with optional area fill gradient.
   *
   * @prop data - Array of numeric values to plot
   * @prop color - CSS color for the line (default: --fancy-accent)
   * @prop width - SVG viewBox width (default: 100)
   * @prop height - SVG viewBox height (default: 30)
   * @prop showArea - Show gradient area fill below line (default: true)
   * @prop strokeWidth - Line thickness in SVG units (default: 1.5)
   */

  import { computePoints, computeAreaPoints } from '../utils/sparkline-utils';

  interface Props {
    data: number[];
    color?: string;
    width?: number;
    height?: number;
    showArea?: boolean;
    strokeWidth?: number;
  }

  const {
    data,
    color = 'var(--fancy-accent)',
    width = 100,
    height = 30,
    showArea = true,
    strokeWidth = 1.5,
  }: Props = $props();

  /** Unique ID for gradient reference (avoids collisions with multiple instances) */
  const gradientId = `sparkline-grad-${Math.random().toString(36).slice(2, 9)}`;

  /** Padding from top/bottom so strokes aren't clipped */
  const PADDING = 2;

  /** SVG polyline points string, recomputed when data/dimensions change */
  const points = $derived(computePoints(data, width, height, PADDING));

  /** Area polygon points: line + bottom-right + bottom-left corners */
  const areaPoints = $derived(computeAreaPoints(points, width, height));
</script>

<svg class="sparkline" viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true">
  {#if showArea && points}
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity="0.3" />
        <stop offset="100%" stop-color={color} stop-opacity="0" />
      </linearGradient>
    </defs>
    <polygon points={areaPoints} fill="url(#{gradientId})" />
  {/if}

  {#if points}
    <polyline
      {points}
      fill="none"
      stroke={color}
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  {/if}
</svg>

<style>
  .sparkline {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
</style>
