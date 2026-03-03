<script>
  import { agents, events, anomalies } from '../stores/ipc.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  let localAgents = $state([]);
  let localEvents = $state([]);
  let localAnomalies = $state({});

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

  /** Active agent count */
  let agentCount = $derived(localAgents.length);

  /** Events per hour — count events in the last 60 minutes */
  let eventsPerHour = $derived.by(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const recent = localEvents.filter(
      (ev) => typeof ev === 'object' && ev !== null && ev.timestamp >= cutoff,
    );
    return recent.length;
  });

  /** Max anomaly score across all agents (0–100) */
  let maxAnomalyScore = $derived.by(() => {
    const scores = Object.values(localAnomalies);
    if (scores.length === 0) return 0;
    return Math.max(...scores.filter((s) => typeof s === 'number'));
  });

  /**
   * Derive threat level label and color from the max anomaly score.
   * @param {number} score
   * @returns {{ label: string; color: string }}
   */
  function threatLevel(score) {
    if (score >= 65) return { label: 'Critical', color: 'var(--fancy-danger)' };
    if (score >= 35) return { label: 'Elevated', color: 'var(--fancy-warning)' };
    return { label: 'Normal', color: 'var(--fancy-accent)' };
  }

  let threat = $derived(threatLevel(maxAnomalyScore));
</script>

<div class="summary-cards">
  <!-- Card 1: Active Agents -->
  <div class="card">
    <span class="card-value">{agentCount}</span>
    <span class="card-label">Active Agents</span>
    <span class="card-indicator indicator-neutral"></span>
  </div>

  <!-- Card 2: Events / hr -->
  <div class="card">
    <span class="card-value">{eventsPerHour}</span>
    <span class="card-label">Events / hr</span>
    <span class="card-indicator indicator-neutral"></span>
  </div>

  <!-- Card 3: Threat Level -->
  <div class="card">
    <span class="card-value" style="color: {threat.color};">{threat.label}</span>
    <span class="card-label">Threat Level</span>
    <span
      class="card-indicator"
      style="background: {threat.color}; box-shadow: 0 0 8px {threat.color};"
    ></span>
  </div>
</div>

<style>
  /* ── Summary Cards (F1.3) ── */
  .summary-cards {
    display: flex;
    gap: var(--fancy-space-md);
    width: 100%;
    height: 100%;
    padding: var(--fancy-space-md);
    align-items: stretch;
  }

  /* ── Individual card: glass panel aesthetic ── */
  .card {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--fancy-space-xs);
    position: relative;
    padding: var(--fancy-space-md) var(--fancy-space-sm);

    background: var(--fancy-surface);
    border: 1px solid var(--fancy-border);
    border-radius: var(--fancy-radius-md);
    backdrop-filter: blur(var(--fancy-panel-blur));
    -webkit-backdrop-filter: blur(var(--fancy-panel-blur));
    box-shadow: var(--fancy-panel-shadow);

    transition:
      border-color var(--fancy-transition-normal) var(--fancy-ease),
      transform var(--fancy-transition-normal) var(--fancy-ease);

    cursor: default;
  }

  .card:hover {
    border-color: var(--fancy-border-highlight);
    transform: translateY(-2px);
  }

  /* ── Number ── */
  .card-value {
    font-family: var(--fancy-font-mono);
    font-size: 28px;
    font-weight: 600;
    line-height: 1;
    color: var(--fancy-text-1);
    letter-spacing: -0.02em;
  }

  /* ── Label ── */
  .card-label {
    font-family: var(--fancy-font-body);
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    color: var(--fancy-text-2);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── Status dot ── */
  .card-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-top: var(--fancy-space-xs);
  }

  .indicator-neutral {
    background: var(--fancy-info);
    opacity: 0.6;
  }

  /* ── Responsive: stack vertically on narrow ── */
  @media (max-width: 720px) {
    .summary-cards {
      flex-direction: column;
      padding: var(--fancy-space-sm);
      gap: var(--fancy-space-sm);
    }

    .card-value {
      font-size: 22px;
    }
  }
</style>
