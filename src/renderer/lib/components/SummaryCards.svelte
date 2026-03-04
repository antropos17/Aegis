<script>
  import { agents, events, anomalies, stats } from '../stores/ipc.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  /* ── Local snapshots (only update when tab is active) ── */
  let localAgents = $state([]);
  let localEvents = $state([]);
  let localAnomalies = $state({});
  let localStats = $state({});

  $effect(() => {
    if (!active) return;
    localAgents = $agents;
  });
  $effect(() => {
    if (!active) return;
    localEvents = $events;
  });
  $effect(() => {
    if (!active) return;
    localAnomalies = $anomalies;
  });
  $effect(() => {
    if (!active) return;
    localStats = $stats;
  });

  /* ── Derived metrics ── */
  let agentCount = $derived(localAgents.length);

  let avgRiskScore = $derived.by(() => {
    const scores = Object.values(localAnomalies).filter((s) => typeof s === 'number');
    if (scores.length === 0) return 0;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  });

  let eventsPerMin = $derived.by(() => {
    const cutoff = Date.now() - 60_000;
    return localEvents.filter(
      (ev) => typeof ev === 'object' && ev !== null && ev.timestamp >= cutoff,
    ).length;
  });

  let sensitiveCount = $derived(localStats.totalSensitive || 0);

  let uptimeStr = $derived.by(() => {
    const ms = localStats.uptimeMs || 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  });

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
   * @param {number} from
   * @param {number} to
   * @param {(v: number) => void} setter
   * @param {number} [duration]
   */
  function animateCount(from, to, setter, duration = 600) {
    if (from === to) return;
    const start = performance.now();
    const diff = to - from;
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - t) * (1 - t);
      setter(Math.round(from + diff * eased));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  $effect(() => {
    animateCount(displayAgents, agentCount, (v) => (displayAgents = v));
  });
  $effect(() => {
    animateCount(displayRisk, avgRiskScore, (v) => (displayRisk = v));
  });
  $effect(() => {
    animateCount(displayEpm, eventsPerMin, (v) => (displayEpm = v));
  });
  $effect(() => {
    animateCount(displaySensitive, sensitiveCount, (v) => (displaySensitive = v));
  });

  /* ── Card definitions ── */
  let agentTrendInfo = $derived(trendInfo(agentTrend));
  let riskTrendInfo = $derived(trendInfo(riskTrend, true));
  let epmTrendInfo = $derived(trendInfo(epmTrend));
  let sensitiveTrendInfo = $derived(trendInfo(sensitiveTrend, true));

  /** Risk color by score */
  let riskColor = $derived(
    avgRiskScore >= 65
      ? 'var(--fancy-danger)'
      : avgRiskScore >= 35
        ? 'var(--fancy-warning)'
        : 'var(--fancy-accent)',
  );
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

  <!-- Card 4: Sensitive Files -->
  <div class="card">
    <span class="card-label">Sensitive Files</span>
    <span class="card-value card-value-sensitive">{displaySensitive}</span>
    <span class="card-trend {sensitiveTrendInfo.cls}">
      {sensitiveTrendInfo.arrow}
      {#if sensitiveTrend !== 0}
        <span class="trend-num">{Math.abs(sensitiveTrend)}</span>
      {/if}
    </span>
  </div>

  <!-- Card 5: System Uptime -->
  <div class="card">
    <span class="card-label">System Uptime</span>
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

    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--fancy-border);
    border-radius: var(--fancy-radius-md);
    backdrop-filter: blur(var(--fancy-panel-blur));
    -webkit-backdrop-filter: blur(var(--fancy-panel-blur));
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
