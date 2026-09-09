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
    report = { ...structured, scope, counts, createdAt: new Date().toISOString() };
    history = [report, ...history].slice(0, 20);
  }
  function strings(value: unknown) {
    return Array.isArray(value) ? value.map(String) : [];
  }
</script>

<div class="analysis-workspace">
  <section class="panel">
    <div class="panel-head">
      <h2>AI analysis</h2>
      <span>Anthropic</span>
    </div>
    <div class="inset form-stack">
      <p>
        {configured
          ? 'API key saved. Connection is verified when analysis runs.'
          : 'Add your API key to enable analysis.'}
      </p>
      {#if error}<p role="alert">{error}</p>{/if}
      <label
        >New API key<input
          disabled={preview}
          type="password"
          autocomplete="off"
          bind:value={key}
          placeholder="Never stored in browser history"
        /></label
      >
      <div class="toolbar">
        <Action disabled={preview || !key.trim()} action={() => saveKey()}>Save key</Action
        >{#if configured}<Action action={() => saveKey(true)}>Remove key</Action>{/if}
      </div>
      <label
        >Scope<select bind:value={mode}
          ><option value="session">Session</option><option value="agent"
            >Agent name · all matching instances</option
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
      <p class="muted">
        This sends recorded activity metadata to the provider and may incur API charges.
      </p>
      <Action disabled={preview || !configured || (mode === 'agent' && !agent)} action={analyze}
        >Run analysis</Action
      >
    </div>
  </section>
  <section class="panel analysis-report">
    <div class="panel-head">
      <h2>{String(report?.scope ?? 'Report')}</h2>
      <span>{String(report?.createdAt ?? '')}</span>
    </div>
    <div class="toolbar inset" aria-label="Report sections">
      {#each ['summary', 'findings', 'recommendations', 'history'] as tab (tab)}<button
          class="button"
          class:active={section === tab}
          onclick={() => (section = tab)}>{tab}</button
        >{/each}
    </div>
    <div class="inset report-body">
      {#if section === 'history'}{#each history as previous (previous)}<button
            class="history-row"
            onclick={() => {
              report = previous;
              section = 'summary';
            }}>{String(previous.scope)} · {String(previous.createdAt)}</button
          >{:else}<p>No reports in this window.</p>{/each}
      {:else if !report}<p class="muted">
          Run an analysis to review the provider's findings. No report has been generated.
        </p>
      {:else if section === 'summary'}<span class="badge"
          >{String(report.riskRating ?? report.riskLevel ?? 'UNKNOWN')}</span
        >
        <p class="report-text">{String(report.summary ?? 'No summary returned')}</p>
        <p>{String(report.riskJustification ?? '')}</p>
        <Action action={async () => confirmed(await invoke(host, 'openThreatReport', report))}
          >Open report</Action
        >
      {:else}<ul>
          {#each strings(report[section]) as item, i (i)}<li>{item}</li>{:else}<li>
              No items returned.
            </li>{/each}
        </ul>{/if}
    </div>
  </section>
</div>

<style>
  .analysis-workspace {
    display: grid;
    grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.6fr);
    gap: 12px;
    align-items: start;
  }
  .report-body {
    min-height: 280px;
    overflow-wrap: anywhere;
  }
  .report-text {
    white-space: pre-wrap;
  }
  .history-row {
    display: block;
    background: var(--panel);
    color: var(--ink);
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
  }
  @media (max-width: 1050px) {
    .analysis-workspace {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
