<script>
  import { events, network } from '../stores/ipc.js';
  import { enrichedAgents } from '../stores/risk.js';
  import { openThreatReport } from '../utils/threat-report.js';

  let loading = $state(false);
  let result = $state(null);
  let error = $state(null);
  let selectedAgent = $state('');
  let mode = $state('session');

  async function runAnalysis() {
    if (!window.aegis) return;
    loading = true;
    error = null;
    result = null;
    try {
      const res = mode === 'session'
        ? await window.aegis.analyzeSession()
        : await window.aegis.analyzeAgent(selectedAgent);
      if (res.success) {
        result = mode === 'session' ? res : (res.structured || res);
      } else {
        error = res.error || 'Analysis failed';
      }
    } catch (e) {
      error = e.message || 'Analysis failed';
    }
    loading = false;
  }

  function findingClass(text) {
    const t = text.toLowerCase();
    if (t.includes('critical') || t.includes('danger') || t.includes('malicious')) return 'finding-critical';
    if (t.includes('sensitive') || t.includes('suspicious') || t.includes('warning')) return 'finding-warn';
    if (t.includes('normal') || t.includes('expected') || t.includes('safe')) return 'finding-safe';
    return '';
  }

  function ratingColor(rating) {
    if (rating === 'CLEAR' || rating === 'LOW') return 'var(--md-sys-color-tertiary)';
    if (rating === 'MEDIUM') return 'var(--md-sys-color-secondary)';
    return 'var(--md-sys-color-error)';
  }

  function handleReport() {
    if (!result) return;
    const allEvents = $events.flat();
    openThreatReport(result, {
      totalFiles: allEvents.length,
      totalSensitive: allEvents.filter(e => e.sensitive).length,
      totalAgents: new Set(allEvents.map(e => e.agent)).size,
      totalNet: $network.length,
    });
  }
</script>

<div class="ta-section">
  <h3 class="section-title">AI Threat Analysis</h3>

  <div class="ta-controls">
    <div class="mode-row">
      <label class="mode-label">
        <input type="radio" name="ta-mode" value="session" bind:group={mode} /> Analyze Session
      </label>
      <label class="mode-label">
        <input type="radio" name="ta-mode" value="agent" bind:group={mode} /> Analyze Agent
      </label>
    </div>

    {#if mode === 'agent'}
      <select class="agent-select" bind:value={selectedAgent}>
        <option value="">Select an agent...</option>
        {#each $enrichedAgents as agent (agent.pid)}
          <option value={agent.name}>{agent.name}</option>
        {/each}
      </select>
    {/if}

    <button
      class="analyze-btn"
      class:analyzing={loading}
      disabled={loading || (mode === 'agent' && !selectedAgent)}
      onclick={runAnalysis}
    >
      {#if loading}Analyzing...{:else}Run Analysis{/if}
    </button>
  </div>

  {#if error}
    <div class="ta-error">{error}</div>
  {/if}

  {#if result}
    <div class="ta-results">
      <div class="ta-hero" style:border-left-color={ratingColor(result.riskRating)}>
        <span class="ta-rating" style:color={ratingColor(result.riskRating)}>
          {result.riskRating || 'UNKNOWN'}
        </span>
        <span class="ta-rating-label">Threat Assessment</span>
        {#if result.riskJustification}
          <p class="ta-reason">{result.riskJustification}</p>
        {/if}
      </div>

      <div class="ta-block">
        <div class="ta-block-title">Summary</div>
        <p class="ta-body">{result.summary || 'No summary available'}</p>
      </div>

      {#if result.findings?.length}
        <div class="ta-block">
          <div class="ta-block-title">Findings</div>
          <ul class="ta-list">
            {#each result.findings as f, i (i)}
              <li class={findingClass(f)}>{f}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if result.recommendations?.length}
        <div class="ta-block">
          <div class="ta-block-title">Recommendations</div>
          <ol class="ta-list">
            {#each result.recommendations as r, i (i)}
              <li>{r}</li>
            {/each}
          </ol>
        </div>
      {/if}

      <button class="report-btn" onclick={handleReport}>Open Full Report</button>
    </div>
  {/if}
</div>

<style>
  .ta-section { display: flex; flex-direction: column; gap: 12px; }
  .section-title { font: var(--md-sys-typescale-headline-medium); color: var(--md-sys-color-on-surface); margin: 0; }
  .ta-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .mode-row { display: flex; gap: 14px; }
  .mode-label { font: var(--md-sys-typescale-label-medium); font-weight: 500; color: var(--md-sys-color-on-surface-variant); display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .agent-select { font: var(--md-sys-typescale-body-medium); padding: 5px 10px; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline); border-radius: var(--md-sys-shape-corner-medium); color: var(--md-sys-color-on-surface); min-width: 180px; }
  .analyze-btn { font: var(--md-sys-typescale-label-medium); font-weight: 600; padding: 7px 20px; border: none; border-radius: var(--md-sys-shape-corner-full); background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); cursor: pointer; transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard); }
  .analyze-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .analyze-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .analyze-btn.analyzing { animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  .ta-error { font: var(--md-sys-typescale-body-medium); color: var(--md-sys-color-error); padding: 10px 14px; background: var(--md-sys-color-error-container); border-radius: var(--md-sys-shape-corner-medium); }
  .ta-results { display: flex; flex-direction: column; gap: 12px; }
  .ta-hero { padding: 14px 18px; background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-corner-medium); border-left: 3px solid; }
  .ta-rating { font: var(--md-sys-typescale-headline-medium); font-weight: 800; letter-spacing: 1.5px; display: block; }
  .ta-rating-label { font: var(--md-sys-typescale-label-medium); color: var(--md-sys-color-on-surface-variant); text-transform: uppercase; letter-spacing: 1px; }
  .ta-reason { font: var(--md-sys-typescale-body-medium); color: var(--md-sys-color-on-surface-variant); margin: 6px 0 0; }
  .ta-block { padding: 12px 16px; background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-corner-medium); }
  .ta-block-title { font: var(--md-sys-typescale-label-medium); font-weight: 600; color: var(--md-sys-color-on-surface-variant); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .ta-body { font: var(--md-sys-typescale-body-medium); color: var(--md-sys-color-on-surface); margin: 0; line-height: 1.5; }
  .ta-list { margin: 0; padding-left: 20px; }
  .ta-list li { font: var(--md-sys-typescale-body-medium); color: var(--md-sys-color-on-surface); margin: 4px 0; line-height: 1.4; }
  .ta-list .finding-critical { color: var(--md-sys-color-error); }
  .ta-list .finding-warn { color: var(--md-sys-color-secondary); }
  .ta-list .finding-safe { color: var(--md-sys-color-tertiary); }
  .report-btn { font: var(--md-sys-typescale-label-medium); font-weight: 600; padding: 7px 18px; align-self: flex-start; background: transparent; border: 1px solid var(--md-sys-color-outline); border-radius: var(--md-sys-shape-corner-full); color: var(--md-sys-color-on-surface-variant); cursor: pointer; transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard); }
  .report-btn:hover { background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); border-color: var(--md-sys-color-on-surface-variant); }
</style>
