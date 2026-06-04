<!--
  RiskIndex.svelte — Fleet-wide risk index [presentational]
  Aggregates an array of monitored agents into one worst-case index number
  plus a low/medium/high band distribution. Pure props-in: no IPC, no stores,
  no bridge coupling. Mounted by the caller.
-->
<script lang="ts">
  /**
   * @component RiskIndex
   * Fleet-wide risk index. Takes the live agent objects (same shape AgentCard
   * consumes) and renders a single worst-case index score with a per-band
   * count breakdown. Purely presentational — it reads pre-computed riskScore
   * values and aggregates for display; it never scores anything itself.
   *
   * Thresholds and colors come from one source — getRiskInfo (C-21). This file
   * introduces zero new threshold constants.
   *
   * @prop agents - Live agent objects, each optionally carrying riskScore (default [])
   * @prop title - Heading text (default 'Risk Index')
   * @prop showBreakdown - Show the low/med/high band counts (default true)
   */

  import { getRiskInfo, clampScore } from '../utils/trust-badge-utils';

  /** Minimal shape this component reads — matches the live agent objects. */
  interface AgentLike {
    riskScore?: number;
    agent?: string;
    pid?: number;
  }

  interface Props {
    agents?: AgentLike[];
    title?: string;
    showBreakdown?: boolean;
  }

  const { agents = [], title = 'Risk Index', showBreakdown = true }: Props = $props();

  /** Clamped per-agent scores; missing riskScore is treated as 0. */
  const scores = $derived(agents.map((a) => clampScore(a?.riskScore ?? 0)));

  /** Number of monitored agents. */
  const total = $derived(agents.length);

  /** Explicit empty branch — never Math.max(...[]) → -Infinity. */
  const isEmpty = $derived(total === 0);

  /**
   * Headline index = worst-case (max). For an EDR this is the honest posture:
   * one high-risk agent compromises the fleet, and a mean would mask it.
   */
  const index = $derived(isEmpty ? 0 : Math.max(...scores));

  /** Risk info (level, label, color, glow) for the headline — single source. */
  const risk = $derived(getRiskInfo(index));

  /** Per-band counts. Banding routes through getRiskInfo.level (never inline >=66). */
  const counts = $derived.by(() => {
    const acc = { low: 0, medium: 0, high: 0 };
    for (const s of scores) acc[getRiskInfo(s).level] += 1;
    return acc;
  });

  /**
   * Band display rows, worst-first. Colors are read from getRiskInfo at a
   * representative in-band sample point (100/50/0) — same single source, not a
   * new threshold. Counts come from the tally above.
   */
  const bands = $derived([
    { key: 'high', label: 'High', count: counts.high, color: getRiskInfo(100).color },
    { key: 'medium', label: 'Med', count: counts.medium, color: getRiskInfo(50).color },
    { key: 'low', label: 'Low', count: counts.low, color: getRiskInfo(0).color },
  ]);
</script>

<section class="risk-index" aria-label="Fleet risk index">
  <header class="risk-index__head">
    <span class="risk-index__title">{title}</span>
    <span class="risk-index__total">{total} {total === 1 ? 'agent' : 'agents'}</span>
  </header>

  {#if isEmpty}
    <div class="risk-index__empty" role="status">
      <span class="risk-index__empty-dash">—</span>
      <span class="risk-index__empty-text">No agents monitored</span>
    </div>
  {:else}
    <div
      class="risk-index__headline"
      role="meter"
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Worst-case fleet risk {index}: {risk.label}"
      style:--idx-color={risk.color}
      style:--idx-glow={risk.glowColor}
    >
      <span class="risk-index__score">{index}</span>
      <span class="risk-index__label">{risk.label}</span>
    </div>

    {#if showBreakdown}
      <ul class="risk-index__bands">
        {#each bands as band (band.key)}
          <li class="risk-index__band" style:--band-color={band.color}>
            <span class="risk-index__band-count">{band.count}</span>
            <span class="risk-index__band-label">{band.label}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .risk-index {
    display: flex;
    flex-direction: column;
    gap: var(--fancy-space-md);

    padding: var(--fancy-space-md);
    background: var(--fancy-panel-bg);
    border: var(--fancy-panel-border);
    border-radius: var(--fancy-panel-radius);
    box-shadow: var(--fancy-panel-shadow);
    backdrop-filter: blur(var(--fancy-panel-blur));
  }

  /* ── Header ── */
  .risk-index__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fancy-space-sm);
  }

  .risk-index__title {
    font-family: var(--fancy-font-title);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--fancy-text-1);
  }

  .risk-index__total {
    font-family: var(--fancy-font-mono);
    font-size: 0.75rem;
    color: var(--fancy-text-2);
  }

  /* ── Empty state ── */
  .risk-index__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--fancy-space-xs);
    padding: var(--fancy-space-md) 0;
  }

  .risk-index__empty-dash {
    font-family: var(--fancy-font-mono);
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1;
    color: var(--fancy-text-2);
  }

  .risk-index__empty-text {
    font-family: var(--fancy-font-body);
    font-size: 0.8rem;
    color: var(--fancy-text-2);
  }

  /* ── Headline index ── */
  .risk-index__headline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--fancy-space-xs);

    filter: drop-shadow(0 0 10px var(--idx-glow));
    transition: filter var(--fancy-transition-normal) var(--fancy-ease);
  }

  .risk-index__score {
    font-family: var(--fancy-font-mono);
    font-size: 3rem;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--idx-color);
    transition: color var(--fancy-transition-normal) var(--fancy-ease);
  }

  .risk-index__label {
    font-family: var(--fancy-font-body);
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--idx-color);
    opacity: 0.85;
    transition:
      color var(--fancy-transition-normal) var(--fancy-ease),
      opacity var(--fancy-transition-normal) var(--fancy-ease);
  }

  /* ── Band breakdown ── */
  .risk-index__bands {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--fancy-space-sm);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .risk-index__band {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;

    padding: var(--fancy-space-sm) 0;
    border-radius: var(--fancy-radius-sm);
    background: color-mix(in srgb, var(--band-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--band-color) 22%, transparent);
  }

  .risk-index__band-count {
    font-family: var(--fancy-font-mono);
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1;
    color: var(--band-color);
  }

  .risk-index__band-label {
    font-family: var(--fancy-font-body);
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fancy-text-2);
  }
</style>
