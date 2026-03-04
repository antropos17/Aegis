<script>
  import { events, isDemoMode } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import { t } from '../i18n/index.js';

  /** @type {{ active?: boolean }} */
  let { active = true } = $props();

  /** @type {any[][]} */
  let cachedEvents = $state([]);
  /** @type {any[]} */
  let cachedAgents = $state([]);

  $effect(() => {
    if (!active) return;
    cachedEvents = $events;
  });

  $effect(() => {
    if (!active) return;
    cachedAgents = $enrichedAgents;
  });

  let avgRisk = $derived.by(() => {
    const list = cachedAgents;
    if (!list.length) return 0;
    const sum = list.reduce((acc, a) => acc + (a.riskScore || 0), 0);
    return Math.round(sum / list.length);
  });

  /** Group by name: sum events, take max risk */
  let topAgents = $derived.by(() => {
    /** @type {Map<string, {name:string, fileCount:number, networkCount:number, riskScore:number, trustGrade:string}>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byName = new Map();
    for (const a of cachedAgents) {
      const prev = byName.get(a.name);
      if (!prev) {
        byName.set(a.name, {
          name: a.name,
          fileCount: a.fileCount || 0,
          networkCount: a.networkCount || 0,
          riskScore: a.riskScore || 0,
          trustGrade: a.trustGrade || '?',
        });
      } else {
        prev.fileCount += a.fileCount || 0;
        prev.networkCount += a.networkCount || 0;
        if ((a.riskScore || 0) > prev.riskScore) {
          prev.riskScore = a.riskScore;
          prev.trustGrade = a.trustGrade || '?';
        }
      }
    }
    return [...byName.values()]
      .sort((a, b) => b.fileCount + b.networkCount - (a.fileCount + a.networkCount))
      .slice(0, 10);
  });

  function gradeColor(grade) {
    if (grade === 'A+' || grade === 'A') return 'var(--md-sys-color-tertiary)';
    if (grade === 'B+' || grade === 'B') return 'var(--md-sys-color-primary)';
    if (grade === 'C') return 'var(--md-sys-color-secondary)';
    return 'var(--md-sys-color-error)';
  }
</script>

<div class="reports-section">
  <h3 class="section-title">{$t('reports.overview.summary')}</h3>

  <div class="stat-cards">
    <div class="stat-card">
      <span class="stat-value">{cachedEvents.length}</span>
      <span class="stat-label">{$t('reports.overview.total_events')}</span>
    </div>
    <div class="stat-card">
      <span class="stat-value val-sensitive"
        >{cachedAgents.reduce((s, a) => s + (a.sensitiveFiles || 0), 0)}</span
      >
      <span class="stat-label">{$t('reports.overview.sensitive')}</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{new Set(cachedAgents.map((a) => a.name)).size}</span>
      <span class="stat-label">{$t('reports.overview.agents')}</span>
    </div>
    <div class="stat-card">
      <span class="stat-value val-shield">{100 - avgRisk}</span>
      <span class="stat-label">{$t('reports.overview.shield')}</span>
    </div>
  </div>

  <h3 class="section-title">{$t('reports.overview.most_active')}</h3>

  <div class="table-scroll">
    <table class="activity-table">
      <thead>
        <tr>
          <th>{$t('reports.overview.columns.name')}</th>
          <th>{$t('reports.overview.columns.events')}</th>
          <th>{$t('reports.overview.columns.risk_score')}</th>
          <th>{$t('reports.overview.columns.grade')}</th>
        </tr>
      </thead>
      <tbody>
        {#each topAgents as agent (agent.name)}
          <tr>
            <td class="td-name">{agent.name}</td>
            <td class="td-num">{Math.round(agent.fileCount + agent.networkCount)}</td>
            <td class="td-num">{agent.riskScore}</td>
            <td>
              <span class="grade" style:color={gradeColor(agent.trustGrade)}>
                {agent.trustGrade}
              </span>
            </td>
          </tr>
        {:else}
          <tr><td colspan="4" class="td-empty">{$t('reports.overview.no_agents')}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h3 class="section-title">{$t('reports.overview.export')}</h3>

  <div class="export-row">
    <button
      class="export-btn"
      disabled={isDemoMode}
      title={isDemoMode ? 'Desktop app only' : ''}
      onclick={() => window.aegis?.exportLog()}>{$t('reports.overview.export_json')}</button
    >
    <button
      class="export-btn"
      disabled={isDemoMode}
      title={isDemoMode ? 'Desktop app only' : ''}
      onclick={() => window.aegis?.exportCsv()}>{$t('reports.overview.export_csv')}</button
    >
    <button
      class="export-btn"
      disabled={isDemoMode}
      title={isDemoMode ? 'Desktop app only' : ''}
      onclick={() => window.aegis?.generateReport()}>{$t('reports.overview.export_html')}</button
    >
  </div>
</div>

<style>
  .reports-section {
    display: flex;
    flex-direction: column;
    gap: var(--aegis-space-8);
  }

  .section-title {
    font: var(--md-sys-typescale-headline-medium);
    color: var(--md-sys-color-on-surface);
    margin: 0;
  }

  .stat-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--aegis-space-5);
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--aegis-space-2);
    padding: var(--aegis-space-7) var(--aegis-space-6);
    background: var(--md-sys-color-surface-container-low);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: var(--glass-border);
    box-shadow: var(--glass-shadow-card), var(--glass-highlight);
    border-radius: var(--md-sys-shape-corner-medium);
  }

  .stat-value {
    font-family: var(--fancy-font-mono);
    font-size: calc(24px * var(--aegis-ui-scale));
    font-weight: 700;
    color: var(--md-sys-color-on-surface);
  }

  .val-sensitive {
    color: var(--md-sys-color-error);
  }
  .val-shield {
    color: var(--md-sys-color-tertiary);
  }

  .stat-label {
    font-size: calc(9px * var(--aegis-ui-scale));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
  }

  .table-scroll {
    overflow: auto;
    max-height: calc(320px * var(--aegis-ui-scale));
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-medium);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--glass-shadow-card);
  }

  .activity-table {
    width: 100%;
    border-collapse: collapse;
  }
  .activity-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .activity-table th {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container);
    padding: var(--aegis-space-4) var(--aegis-space-6);
    text-align: left;
    border-bottom: 1px solid var(--md-sys-color-outline);
  }

  .activity-table td {
    font: var(--md-sys-typescale-body-medium);
    padding: var(--aegis-space-3) var(--aegis-space-6);
    color: var(--md-sys-color-on-surface);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }

  .activity-table tbody tr:hover td {
    background: var(--md-sys-color-surface-container-low);
  }
  .td-name {
    font-weight: 500;
  }
  .td-num {
    font-family: var(--fancy-font-mono);
  }
  .td-empty {
    text-align: center;
    padding: calc(30px * var(--aegis-ui-scale));
    color: var(--md-sys-color-on-surface-variant);
  }

  .grade {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 700;
  }

  .export-row {
    display: flex;
    gap: var(--aegis-space-5);
    flex-wrap: wrap;
  }

  .export-btn {
    font: var(--md-sys-typescale-label-medium);
    font-weight: 600;
    padding: var(--aegis-space-3) var(--aegis-space-7);
    background: transparent;
    border: var(--glass-border);
    border-radius: var(--md-sys-shape-corner-full);
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.3s var(--ease-glass);
  }

  .export-btn:hover:not(:disabled) {
    background: var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface);
    border-color: var(--aegis-border-hover);
  }

  .export-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
