<script lang="ts">
  import { onMount } from 'svelte';
  import {
    confirmed,
    invoke,
    record,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AgentLogo from './AgentLogo.svelte';
  import Metadata from './Metadata.svelte';
  let {
    host,
    telemetry,
    visible = true,
    preview = false,
  }: { host: Host | null; telemetry: Telemetry; visible?: boolean; preview?: boolean } = $props();
  let mode = $state('session');
  let agent = $state('');
  let key = $state('');
  $effect(() => {
    if (!visible) key = '';
  });
  let configured = $state(false);
  let report = $state<RecordData | null>(null);
  let history = $state<RecordData[]>([]);
  let error = $state('');
  let alive = true;
  let generation = 0;
  let section = $state('summary');
  let showProvider = $state(false);
  let reportTitle = $state('Activity assessment');
  let names = $derived([...new Set(telemetry.agents.map((a) => a.agent))]);
  onMount(() => {
    invoke(host, 'getSettings')
      .then((value) => {
        if (alive) configured = Boolean(record(value).anthropicApiKey);
      })
      .catch((e) => {
        if (alive) error = String(e);
      });
    return () => {
      alive = false;
      generation++;
      key = '';
    };
  });
  async function saveKey(remove = false) {
    const current = record(await invoke(host, 'getSettings'));
    confirmed(
      await invoke(host, 'saveSettings', { ...current, anthropicApiKey: remove ? '' : key.trim() }),
    );
    if (alive) {
      configured = !remove;
      key = '';
    }
  }
  async function analyze() {
    const ticket = ++generation;
    const scope = mode === 'agent' ? agent : 'Session';
    const counts = {
      totalFiles: telemetry.stats.totalFiles,
      totalSensitive: telemetry.stats.aiSensitive,
      totalAgents: telemetry.stats.currentAgents,
      totalNet: telemetry.network.length,
    };
    const title = reportTitle.trim() || 'Activity assessment';
    const result = confirmed(
      await invoke(
        host,
        mode === 'agent' ? 'analyzeAgent' : 'analyzeSession',
        ...(mode === 'agent' ? [agent] : []),
      ),
    );
    if (!alive || ticket !== generation) return;
    let structured = record(result.structured);
    if (!Object.keys(structured).length && typeof result.analysis === 'string') {
      try {
        structured = record(
          JSON.parse(result.analysis.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()),
        );
      } catch {
        structured = { summary: result.analysis };
      }
    }
    if (!Object.keys(structured).length) structured = result;
    report = { ...structured, title, scope, counts, createdAt: new Date().toISOString() };
    history = [report, ...history].slice(0, 20);
  }
  function strings(value: unknown) {
    return Array.isArray(value) ? value.map(String) : [];
  }
</script>

<div class="analysis-workspace">
  <section class="panel analysis-provider">
    <div class="provider-name">
      <AgentLogo name="Claude Code" size={32} />
      <div>
        <strong>Anthropic</strong><small
          >{preview
            ? 'Preview · provider calls disabled'
            : configured
              ? 'API key saved · verified on first analysis'
              : 'Not connected'}</small
        >
      </div>
    </div>
    <div class="toolbar">
      <button class="button" onclick={() => (showProvider = !showProvider)}
        ><Icon name="settings" />{configured
          ? 'Connection settings'
          : 'Connect AI analysis'}</button
      ><Action disabled={preview || !configured || (mode === 'agent' && !agent)} action={analyze}
        ><Icon name="play" />Run analysis</Action
      >
    </div>
  </section>
  {#if showProvider}<section class="panel inset provider-settings">
      <label
        >New API key<input
          disabled={preview}
          type="password"
          autocomplete="off"
          bind:value={key}
          placeholder="Anthropic API key"
        /></label
      >
      <div class="toolbar">
        <Action disabled={preview || !key.trim()} action={() => saveKey()}>Save key</Action
        >{#if configured}<Action action={() => saveKey(true)}>Remove key</Action>{/if}<button
          class="button"
          onclick={() => {
            showProvider = false;
            key = '';
          }}>Close settings</button
        >
      </div>
      <small>Connection is verified when analysis runs.</small>
    </section>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="analysis-layout">
    <section class="panel analysis-config">
      <div class="panel-head"><h2><Icon name="settings" />New assessment</h2></div>
      <div class="config-body form-stack">
        <label
          >Scope<select bind:value={mode}
            ><option value="session">Entire session</option><option value="agent"
              >Agent · all matching instances</option
            ></select
          ></label
        >
        {#if mode === 'agent'}<label
            >Agent<select bind:value={agent}
              ><option value="">Select an agent</option>{#each names as name (name)}<option
                  >{name}</option
                >{/each}</select
            ></label
          >{/if}
        <div class="scope-details">
          <small>Evidence scope</small>
          <p>Recorded session metadata</p>
          <small>File observations, connections and agent activity supplied by AEGIS.</small>
        </div>
        <label>Report title<input bind:value={reportTitle} maxlength="160" /></label>
        <p class="muted">Changes apply to the next run.</p>
        <div class="provider-note">
          <Icon name="shield" />
          <p>Analysis sends recorded activity metadata to Anthropic and may incur API charges.</p>
        </div>
      </div>
    </section>
    <section class="panel analysis-report">
      <div class="report-tabs" aria-label="Report sections">
        {#each [['summary', 'Report', 'report'], ['evidence', 'Evidence', 'file'], ['history', 'History', 'history']] as [id, title, icon] (id)}<button
            aria-pressed={section === id}
            onclick={() => (section = id)}><Icon name={icon} />{title}</button
          >{/each}
      </div>
      <div class="report-body">
        <div hidden={section !== 'summary'} class="report-section">
          {#if !report}<div class="analysis-empty">
              <Icon name="report" />
              <h2>Review agent activity</h2>
              <p>
                Choose a scope and run an assessment. Review findings alongside their recorded
                evidence.
              </p>
              <ol>
                <li><span>1</span>Choose a session or an agent</li>
                <li><span>2</span>Review the selected metadata</li>
                <li><span>3</span>Assess findings and export the report</li>
              </ol>
              <small
                >{preview
                  ? 'Provider calls are disabled in this preview.'
                  : 'Connect Anthropic to create your first assessment.'}</small
              >
            </div>
          {:else}<article class="analysis-document">
              <div class="document-meta">
                <small>ANTHROPIC ASSESSMENT</small><span class="badge"
                  >{String(report.riskRating ?? report.riskLevel ?? 'UNKNOWN')}</span
                >
              </div>
              <h2>{String(report.title)}</h2>
              <small>{String(report.scope)} · {String(report.createdAt)}</small>
              <p class="report-text">{String(report.summary ?? 'No summary returned')}</p>
              <p>{String(report.riskJustification ?? '')}</p>
              <h3><Icon name="shield" />Findings</h3>
              <ol>
                {#each strings(report.findings) as item, i (i)}<li>{item}</li>{:else}<li>
                    No findings returned.
                  </li>{/each}
              </ol>
              <h3><Icon name="check" />Recommended checks</h3>
              <ol>
                {#each strings(report.recommendations) as item, i (i)}<li>{item}</li>{:else}<li>
                    No recommendations returned.
                  </li>{/each}
              </ol>
              <Action action={async () => confirmed(await invoke(host, 'openThreatReport', report))}
                ><Icon name="report" />Open report</Action
              >
            </article>{/if}
        </div>
        <div hidden={section !== 'evidence'} class="report-section inset">
          {#if report}<h2>Recorded scope</h2>
            <p class="muted">Counters captured when this assessment was requested.</p>
            <Metadata value={record(report.counts)} />{:else}<div class="analysis-empty">
              <Icon name="file" />
              <h2>No assessment yet</h2>
              <p>Evidence information appears after an analysis completes.</p>
            </div>{/if}
        </div>
        <div hidden={section !== 'history'} class="report-section inset">
          {#each history as previous (previous)}<button
              class="history-row"
              onclick={() => {
                report = previous;
                section = 'summary';
              }}
              ><Icon name="report" /><span
                ><strong>{String(previous.title)}</strong><small
                  >{String(previous.scope)} · {String(previous.createdAt)}</small
                ></span
              ><Icon name="chevron" /></button
            >{:else}<div class="analysis-empty">
              <Icon name="history" />
              <h2>No assessments yet</h2>
              <p>Your completed assessments will appear here.</p>
            </div>{/each}
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .analysis-workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .analysis-workspace > .panel {
    margin-top: 0;
  }
  .analysis-provider {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    flex-shrink: 0;
  }
  .provider-name {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .provider-name small {
    display: block;
    margin-top: 3px;
    color: var(--muted);
  }
  .provider-settings {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .provider-settings label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .analysis-layout {
    display: grid;
    grid-template-columns: minmax(calc(240px * var(--ui-scale)), 0.75fr) minmax(0, 2fr);
    gap: 12px;
    flex: 1;
    min-height: 0;
  }
  .analysis-layout > .panel {
    margin-top: 0;
    min-height: 0;
  }
  .analysis-config,
  .analysis-report {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-head {
    flex-shrink: 0;
  }
  .config-body {
    padding: 14px;
    overflow: auto;
    min-height: 0;
    font-size: calc(12px * var(--ui-scale));
  }
  .config-body label {
    font-weight: 600;
  }
  .config-body input,
  .config-body select {
    font-weight: 400;
  }
  .scope-details {
    border-block: 1px solid var(--border);
    padding-block: 12px;
  }
  .scope-details small {
    color: var(--muted);
  }
  .provider-note {
    display: flex;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    color: var(--muted);
  }
  .report-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .report-tabs button {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: calc(12px * var(--ui-scale));
    color: var(--muted);
  }
  .report-tabs button[aria-pressed='true'] {
    background: var(--selection);
    border-color: var(--selection-border);
    color: var(--ink);
  }
  .report-body {
    display: flex;
    min-height: 0;
    flex: 1;
  }
  .report-section {
    overflow: auto;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .analysis-empty,
  .analysis-document {
    padding: 20px;
  }
  .analysis-empty :global(> .icon) {
    width: 32px;
    height: 32px;
    color: var(--muted);
    margin-bottom: 24px;
  }
  .analysis-empty h2,
  .analysis-document h2 {
    font-size: calc(22px * var(--ui-scale));
    margin-bottom: 12px;
  }
  .analysis-empty p {
    max-width: 65ch;
  }
  .analysis-empty small {
    color: var(--muted);
  }
  .analysis-empty ol {
    list-style: none;
    padding: 0;
    margin: 20px 0;
  }
  .analysis-empty li {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 10px 0;
  }
  .analysis-empty li span {
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12px;
  }
  .document-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    color: var(--muted);
  }
  .report-text {
    white-space: pre-wrap;
    margin: 20px 0;
  }
  .analysis-document h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 20px 0 10px;
  }
  .analysis-document li {
    margin-block: 10px;
  }
  .history-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .history-row span {
    flex: 1;
  }
  .history-row small {
    display: block;
    color: var(--muted);
  }
  @media (max-width: 950px) {
    .analysis-layout {
      grid-template-columns: minmax(200px, 0.8fr) minmax(0, 1.5fr);
    }
    .analysis-provider {
      flex-wrap: wrap;
    }
  }
  @media (max-width: 800px) {
    .analysis-layout {
      grid-template-columns: 1fr;
      overflow: auto;
    }
    .analysis-config,
    .analysis-report {
      min-height: 350px;
    }
  }
</style>
