<script>
  import { events, stats } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';

  let avgRisk = $derived.by(() => {
    const list = $enrichedAgents;
    if (!list.length) return 0;
    const sum = list.reduce((acc, a) => acc + (a.riskScore || 0), 0);
    return Math.round(sum / list.length);
  });

  let uptime = $derived($stats.uptime || 0);

  let uptimeStr = $derived.by(() => {
    const s = uptime;
    if (!s) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  });

  let topAgents = $derived.by(() => {
    const copy = [...$enrichedAgents];
    copy.sort((a, b) => (b.fileCount + b.networkCount) - (a.fileCount + a.networkCount));
    return copy.slice(0, 10);
  });

  function gradeColor(grade) {
    if (grade === 'A+' || grade === 'A') return 'var(--md-sys-color-tertiary)';
    if (grade === 'B+' || grade === 'B') return 'var(--md-sys-color-primary)';
    if (grade === 'C') return 'var(--md-sys-color-secondary)';
    return 'var(--md-sys-color-error)';
  }
</script>

<div class="reports-section">
  <h3 class="section-title">Summary</h3>

  <div class="stat-cards">
    <div class="stat-card">
      <span class="stat-value">{$events.flat().length}</span>
      <span class="stat-label">Total Events</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{$enrichedAgents.length}</span>
      <span class="stat-label">Agents Detected</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{avgRisk}</span>
      <span class="stat-label">Avg Risk Score</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{uptimeStr}</span>
      <span class="stat-label">Uptime</span>
    </div>
  </div>

  <h3 class="section-title">Most Active Agents</h3>

  <div class="table-scroll">
    <table class="activity-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Events</th>
          <th>Risk Score</th>
          <th>Grade</th>
        </tr>
      </thead>
      <tbody>
        {#each topAgents as agent (agent.pid)}
          <tr>
            <td class="td-name">{agent.name}</td>
            <td class="td-num">{agent.fileCount + agent.networkCount}</td>
            <td class="td-num">{agent.riskScore}</td>
            <td>
              <span class="grade" style:color={gradeColor(agent.trustGrade)}>
                {agent.trustGrade}
              </span>
            </td>
          </tr>
        {:else}
          <tr><td colspan="4" class="td-empty">No agents detected yet</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h3 class="section-title">Export</h3>

  <div class="export-row">
    <button class="export-btn" onclick={() => window.aegis?.exportLog()}>Export JSON</button>
    <button class="export-btn" onclick={() => window.aegis?.exportCsv()}>Export CSV</button>
    <button class="export-btn" onclick={() => window.aegis?.generateReport()}>Export HTML Report</button>
  </div>
</div>

<style>
  .reports-section { display: flex; flex-direction: column; gap: 16px; }

  .section-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface); margin: 0;
  }

  .stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

  .stat-card {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 16px 12px;
    background: var(--md-sys-color-surface-container);
    border-radius: var(--md-sys-shape-corner-medium);
  }

  .stat-value {
    font: var(--md-sys-typescale-headline-medium); font-weight: 700;
    color: var(--md-sys-color-on-surface);
  }

  .stat-label {
    font: var(--md-sys-typescale-label-medium);
    color: var(--md-sys-color-on-surface-variant);
  }

  .table-scroll {
    overflow: auto; max-height: 320px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-medium);
  }

  .activity-table { width: 100%; border-collapse: collapse; }
  .activity-table thead { position: sticky; top: 0; z-index: 1; }

  .activity-table th {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container);
    padding: 8px 12px; text-align: left;
    border-bottom: 1px solid var(--md-sys-color-outline);
  }

  .activity-table td {
    font: var(--md-sys-typescale-body-medium); padding: 6px 12px;
    color: var(--md-sys-color-on-surface);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }

  .activity-table tbody tr:hover td { background: var(--md-sys-color-surface-container-low); }
  .td-name { font-weight: 500; }
  .td-num { font-family: 'DM Mono', monospace; }
  .td-empty { text-align: center; padding: 30px; color: var(--md-sys-color-on-surface-variant); }

  .grade { font: var(--md-sys-typescale-label-medium); font-weight: 700; }

  .export-row { display: flex; gap: 10px; flex-wrap: wrap; }

  .export-btn {
    font: var(--md-sys-typescale-label-medium); font-weight: 600;
    padding: 7px 18px;
    background: transparent;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant); cursor: pointer;
    transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
  }

  .export-btn:hover {
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    border-color: var(--md-sys-color-on-surface-variant);
  }

  @media (max-width: 600px) {
    .stat-cards { grid-template-columns: repeat(2, 1fr); }
  }
</style>
