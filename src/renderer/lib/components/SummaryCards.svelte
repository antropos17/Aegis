<script>
  import { events, stats } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import { tick, startTick } from '../stores/tick.ts';
  import {
    countUniqueAgents,
    averageRiskScore,
    eventsPerMinute,
    EVENTS_PER_MIN_WINDOW_MS,
    sensitiveAlertCount,
    SENSITIVE_SUMMARY_LABEL,
    formatMonitoringDuration,
    MONITORING_DURATION_LABEL,
  } from '../utils/summary-metrics.ts';
  import { getRiskInfo } from '../utils/trust-badge-utils.ts';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  /* ── Local snapshots (only update when tab is active) ── */
  // Enriched agents carry `name` (from DetectedAgent.agent) and authoritative riskScore.
  // Raw `$agents` has only `agent` and no riskScore — that caused F-W02 / F-W01.
  let localAgents = $state([]);
  let localEvents = $state([]);
  let localStats = $state({});

  $effect(() => {
    if (!active) return;
    localAgents = $enrichedAgents;
    localEvents = $events;
    localStats = $stats;
  });

  // Shared 1s clock: Events/min aging (F-W03) + monitoring duration ticks (F-W07).
  $effect(() => {
    if (!active) return;
    return startTick();
  });

  let now = $derived.by(() => {
    $tick; // reactive dependency — re-read wall clock each second
    return Date.now();
  });

  /* ── Derived metrics ── */
  // Distinct display names (enriched `name` / raw `agent`) — not instanceId count.
  let agentCount = $derived(countUniqueAgents(localAgents));

  // Mean of riskScore from the same domain AgentCard uses — never anomaly scores.
  let avgRiskScore = $derived(averageRiskScore(localAgents));

  // Rolling 60s count; `now` is explicit so aging does not require a new event.
  let eventsPerMin = $derived(eventsPerMinute(localEvents, now, EVENTS_PER_MIN_WINDOW_MS));

  // Retained sensitive activity-log events (main totalSensitive) — not distinct files.
  let sensitiveCount = $derived(sensitiveAlertCount(localStats.totalSensitive));

  // Monitoring session age from monitoringStarted + wall clock — not OS uptime,
  // not frozen stats.uptimeMs (stalls without stats pushes).
  let uptimeStr = $derived(formatMonitoringDuration(localStats.monitoringStarted, now));

  /* ── Trend tracking (compare current vs 30s-ago snapshot) ── */
  let prevAgentCount = $state(0);
  let prevRisk = $state(0);
  let prevEpm = $state(0);
  let prevSensitive = $state(0);

  // Snapshot every 30s
  $effect(() => {
    if (!active) return;
    const id = setInterval(() => {
      prevAgentCount = agentCount;
      prevRisk = avgRiskScore;
      prevEpm = eventsPerMin;
      prevSensitive = sensitiveCount;
    }, 30_000);
    // Seed initial snapshot after 1s
    const seed = setTimeout(() => {
      prevAgentCount = agentCount;
      prevRisk = avgRiskScore;
      prevEpm = eventsPerMin;
      prevSensitive = sensitiveCount;
    }, 1000);
    return () => {
      clearInterval(id);
      clearTimeout(seed);
    };
  });

  let agentTrend = $derived(agentCount - prevAgentCount);
  let riskTrend = $derived(avgRiskScore - prevRisk);
  let epmTrend = $derived(eventsPerMin - prevEpm);
  let sensitiveTrend = $derived(sensitiveCount - prevSensitive);

  /**
   * Returns trend arrow info.
   * @param {number} diff
   * @param {boolean} [inverseColor] - true = up is bad (risk)
   * @returns {{ arrow: string; cls: string }}
   */
  function trendInfo(diff, inverseColor = false) {
    if (diff === 0) return { arrow: '―', cls: 'trend-flat' };
    const up = diff > 0;
    const good = inverseColor ? !up : up;
    return {
      arrow: up ? '▲' : '▼',
      cls: good ? 'trend-good' : 'trend-bad',
    };
  }

  /* ── Animated counters ── */
  let displayAgents = $state(0);
  let displayRisk = $state(0);
  let displayEpm = $state(0);
  let displaySensitive = $state(0);

  /**
   * Animate a number from current displayed value to target.
   * Returns a cancel function to abort the animation.
   * @param {number} from
   * @param {number} to
   * @param {(v: number) => void} setter
   * @param {number} [duration]
   * @returns {() => void} cancel function
   */
  function animateCount(from, to, setter, duration = 600) {
    if (from === to) return () => {};
    const start = performance.now();
    const diff = to - from;
    let rafId = 0;
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) * (1 - t);
      setter(Math.round(from + diff * eased));
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }

  $effect(() => {
    const c1 = animateCount(displayAgents, agentCount, (v) => (displayAgents = v));
    const c2 = animateCount(displayRisk, avgRiskScore, (v) => (displayRisk = v));
    const c3 = animateCount(displayEpm, eventsPerMin, (v) => (displayEpm = v));
    const c4 = animateCount(displaySensitive, sensitiveCount, (v) => (displaySensitive = v));
    return () => {
      c1();
      c2();
      c3();
      c4();
    };
  });

  /* ── Card definitions ── */
  let agentTrendInfo = $derived(trendInfo(agentTrend));
  let riskTrendInfo = $derived(trendInfo(riskTrend, true));
  let epmTrendInfo = $derived(trendInfo(epmTrend));
  let sensitiveTrendInfo = $derived(trendInfo(sensitiveTrend, true));

  // F-W10: band colors from the single risk-band classifier (getRiskInfo).
  let riskColor = $derived(getRiskInfo(avgRiskScore).color);
</script>

<div class="summary-cards">
  <!-- Card 1: Total Agents -->
  <div class="card">
    <span class="card-label">Total Agents</span>
    <span class="card-value">{displayAgents}</span>
    <span class="card-trend {agentTrendInfo.cls}">
      {agentTrendInfo.arrow}
      {#if agentTrend !== 0}
        <span class="trend-num">{Math.abs(agentTrend)}</span>
      {/if}
    </span>
  </div>

  <!-- Card 2: Avg Risk Score -->
  <div class="card">
    <span class="card-label">Avg Risk Score</span>
    <span class="card-value" style="color: {riskColor};">{displayRisk}</span>
    <span class="card-trend {riskTrendInfo.cls}">
      {riskTrendInfo.arrow}
      {#if riskTrend !== 0}
        <span class="trend-num">{Math.abs(riskTrend)}</span>
      {/if}
    </span>
  </div>

  <!-- Card 3: Events / min -->
  <div class="card">
    <span class="card-label">Events / min</span>
    <span class="card-value">{displayEpm}</span>
    <span class="card-trend {epmTrendInfo.cls}">
      {epmTrendInfo.arrow}
      {#if epmTrend !== 0}
        <span class="trend-num">{Math.abs(epmTrend)}</span>
      {/if}
    </span>
  </div>

  <!-- Card 4: Sensitive Alerts (retained sensitive log events, not distinct files) -->
  <div class="card">
    <span class="card-label">{SENSITIVE_SUMMARY_LABEL}</span>
    <span class="card-value card-value-sensitive">{displaySensitive}</span>
    <span class="card-trend {sensitiveTrendInfo.cls}">
      {sensitiveTrendInfo.arrow}
      {#if sensitiveTrend !== 0}
        <span class="trend-num">{Math.abs(sensitiveTrend)}</span>
      {/if}
    </span>
  </div>

  <!-- Card 5: Monitoring Duration (scanner.monitoringStarted session age) -->
  <div class="card">
    <span class="card-label">{MONITORING_DURATION_LABEL}</span>
    <span class="card-value card-value-uptime">{uptimeStr}</span>
    <span class="card-trend trend-flat">●</span>
  </div>
</div>

<style>
  /* ── Summary Cards Grid (F1.3) ── */
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--fancy-space-sm);
    width: 100%;
    height: 100%;
    padding: var(--fancy-space-sm);
    align-content: stretch;
  }

  /* ── Individual card: glassmorphism ── */
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--fancy-space-xs);
    position: relative;
    padding: var(--fancy-space-md) var(--fancy-space-sm);

    background: #0d0d10;
    border: 1px solid var(--fancy-border);
    border-radius: var(--fancy-radius-md);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 4px 12px rgba(0, 0, 0, 0.3);

    transition:
      border-color var(--fancy-transition-normal) var(--fancy-ease),
      transform var(--fancy-transition-normal) var(--fancy-ease);

    cursor: default;
    overflow: hidden;
    min-width: 0;
  }

  /* Spotlight hover glow */
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(
      300px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
      rgba(255, 255, 255, 0.06),
      transparent 60%
    );
    opacity: 0;
    transition: opacity var(--fancy-transition-normal) var(--fancy-ease);
    pointer-events: none;
  }

  .card:hover::before {
    opacity: 1;
  }

  .card:hover {
    border-color: var(--fancy-border-highlight);
    transform: translateY(-2px);
  }

  /* ── Label (top) ── */
  .card-label {
    font-family: var(--fancy-font-body);
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    color: #9ea3ac;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    order: -1;
  }

  /* ── Number (center) ── */
  .card-value {
    font-family: var(--fancy-font-mono);
    font-size: 28px;
    font-weight: 600;
    line-height: 1;
    color: var(--fancy-text-1);
    letter-spacing: -0.02em;
  }

  .card-value-sensitive {
    color: var(--fancy-danger);
  }

  .card-value-uptime {
    font-size: clamp(16px, 3.5vw, 22px);
    letter-spacing: 0.04em;
    white-space: nowrap;
    min-width: 0;
  }

  /* ── Trend arrow ── */
  .card-trend {
    font-family: var(--fancy-font-mono);
    font-size: 11px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 2px;
    line-height: 1;
  }

  .trend-good {
    color: var(--fancy-accent);
  }

  .trend-bad {
    color: var(--fancy-danger);
  }

  .trend-flat {
    color: var(--fancy-text-2);
    opacity: 0.7;
  }

  .trend-num {
    font-size: 10px;
  }

  /* ── Responsive: 5 → 3 → 2 → 1 ── */
  @media (max-width: 1100px) {
    .summary-cards {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 900px) {
    .summary-cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 500px) {
    .summary-cards {
      grid-template-columns: 1fr;
      padding: var(--fancy-space-xs);
      gap: var(--fancy-space-xs);
    }

    .card-value {
      font-size: 22px;
    }

    .card-value-uptime {
      font-size: clamp(14px, 4vw, 18px);
    }
  }
</style>
