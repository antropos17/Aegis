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
  import EditorDialog from './EditorDialog.svelte';
  let {
    host,
    telemetry,
    visible = true,
    preview = false,
  }: { host: Host | null; telemetry: Telemetry; visible?: boolean; preview?: boolean } = $props();
  let mode = $state('session');
  let agent = $state('');
  let key = $state('');
  let keyPending = $state(false);
  let providerVisit = 0;
  let keyRevision = 0;
  $effect(() => {
    if (!visible) {
      providerVisit++;
      key = '';
      showProvider = false;
    }
  });
  let configured = $state(false);
  let report = $state<RecordData | null>(null);
  let history = $state<RecordData[]>([]);
  let error = $state('');
  let alive = true;
  let generation = 0;
  let section = $state('summary');
  let showProvider = $state(false);
  let providerSection = $state('connection');
  let reportTitle = $state('Activity assessment');
  let names = $derived([...new Set(telemetry.agents.map((a) => a.agent))]);
  onMount(() => {
    const ticket = keyRevision;
    invoke(host, 'getSettings')
      .then((value) => {
        if (alive && ticket === keyRevision) configured = Boolean(record(value).anthropicApiKey);
      })
      .catch((e) => {
        if (alive && ticket === keyRevision) error = String(e);
      });
    return () => {
      alive = false;
      generation++;
      key = '';
    };
  });
  async function saveKey(remove = false) {
    if (preview || keyPending) throw new Error('Provider settings cannot be changed now');
    const submittedDraft = key;
    const value = remove ? '' : submittedDraft.trim();
    if (!remove && !value) throw new Error('Enter an API key');
    const visit = providerVisit;
    keyRevision++;
    keyPending = true;
    try {
      const current = record(await invoke(host, 'getSettings'));
      if (alive) configured = Boolean(current.anthropicApiKey);
      confirmed(
        await invoke(
          host,
          'saveSettings',
          { ...current, anthropicApiKey: value },
          ...(remove ? [{ clearAnthropicApiKey: true }] : []),
        ),
      );
      if (alive) {
        configured = !remove;
        if (providerVisit === visit && key === submittedDraft) key = '';
      }
    } finally {
      if (alive) keyPending = false;
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
    section = 'summary';
  }
  function strings(value: unknown) {
    return Array.isArray(value) ? value.map(String) : [];
  }
</script>

<div class="analysis-workspace">
  <section class="panel analysis-provider">
    <div class="analysis-provider-name">
      <AgentLogo name="Claude Code" size={32} />
      <div>
        <strong>Anthropic</strong><span
          >{preview
            ? 'Preview · provider calls disabled'
            : configured
              ? 'API key saved · verified on first analysis'
              : 'Not connected'}</span
        >
      </div>
    </div>
    <div class="toolbar">
      <button
        class="button"
        onclick={() => {
          providerVisit++;
          providerSection = 'connection';
          showProvider = true;
        }}
        ><Icon name="settings" />{configured
          ? 'Connection settings'
          : 'Connect AI analysis'}</button
      >
    </div>
  </section>
  {#if showProvider}
    <EditorDialog
      title="Anthropic connection"
      caption="AI analysis"
      tabs={[
        { id: 'connection', label: 'Connection' },
        { id: 'usage', label: 'Usage' },
      ]}
      bind:selected={providerSection}
      close={() => {
        providerVisit++;
        showProvider = false;
        key = '';
      }}
    >
      {#snippet children(section)}
        <section class="detail-section">
          {#if section === 'connection'}
            <h3>Provider connection</h3>
            <div class="form-grid">
              <label class="full"
                >New API key<input
                  disabled={preview}
                  type="password"
                  autocomplete="off"
                  bind:value={key}
                  placeholder="Anthropic API key"
                /></label
              >
            </div>
            <p class="dialog-copy">
              Connection is verified when analysis runs. Saved keys are never displayed in this
              form.
            </p>
            {#if !preview && !configured}<p class="dialog-copy">
                A saved key may remain when the OS keychain is locked. Remove saved key clears it.
              </p>{/if}
          {:else}
            <h3>Analysis scope</h3>
            <Metadata
              value={{
                Provider: 'Anthropic',
                'Data sent': 'Recorded agent activity and observations',
                'File contents': 'Excluded',
                Billing: 'Provider charges may apply',
                'Connection check': 'When analysis runs',
              }}
            />
          {/if}
        </section>
      {/snippet}
      {#snippet actions()}
        {#if !preview}<Action disabled={keyPending} action={() => saveKey(true)}
            >Remove saved key</Action
          >{/if}
        <button
          class="button"
          onclick={() => {
            providerVisit++;
            showProvider = false;
            key = '';
          }}>Close settings</button
        >
        <Action disabled={preview || keyPending || !key.trim()} action={() => saveKey()}
          >Save key</Action
        >
      {/snippet}
    </EditorDialog>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="analysis-layout">
    <section class="panel analysis-config">
      <div class="panel-head"><h2><Icon name="settings" />New assessment</h2></div>
      <div class="analysis-config-body">
        <label class="analysis-field"
          >Scope<select bind:value={mode}
            ><option value="session">Entire session</option><option value="agent"
              >Agent · all matching instances</option
            ></select
          ></label
        >
        {#if mode === 'agent'}<label class="analysis-field"
            >Agent<select bind:value={agent}
              ><option value="">Select an agent</option>{#each names as name (name)}<option
                  >{name}</option
                >{/each}</select
            ></label
          >{/if}
        <label class="analysis-field"
          >Report title<input bind:value={reportTitle} maxlength="160" /></label
        >
        <div class="scope-details analysis-field">
          <small>Evidence scope</small>
          <p>Recorded session metadata</p>
          <small>File observations, connections and agent activity supplied by AEGIS.</small>
        </div>
        <div class="provider-note">
          <Icon name="shield" />
          <p>Analysis sends recorded activity metadata to Anthropic and may incur API charges.</p>
        </div>
      </div>
      <div class="assessment-actions">
        <Action
          disabled={preview ||
            keyPending ||
            !configured ||
            (mode === 'agent' && !names.includes(agent))}
          action={analyze}><Icon name="play" />Run analysis</Action
        >
      </div>
    </section>
    <section class="panel analysis-output">
      <div class="subnav analysis-tabs" aria-label="Report sections">
        {#each [['summary', 'Report', 'report'], ['evidence', 'Evidence', 'file'], ['history', 'History', 'history']] as [id, title, icon] (id)}<button
            aria-pressed={section === id}
            onclick={() => (section = id)}><Icon name={icon} />{title}</button
          >{/each}
      </div>
      <div class="analysis-body">
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
                  : configured
                    ? 'Ready for a new assessment.'
                    : 'Connect Anthropic to create your first assessment.'}</small
              >
            </div>
          {:else}<article class="analysis-document">
              <div class="analysis-document-meta">
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
              class="analysis-history-row"
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
  .assessment-actions {
    flex: 0 0 auto;
    padding: 14px 18px;
    border-top: 1px solid var(--border);
  }
  .assessment-actions :global(.action-control) {
    width: 100%;
  }
  .assessment-actions :global(button) {
    width: 100%;
    justify-content: center;
  }
  .analysis-provider {
    padding: 12px 16px;
  }
  .analysis-provider-name {
    gap: 12px;
  }
  .analysis-config .panel-head h2 {
    font-size: calc(14px * var(--ui-scale));
  }
  .analysis-workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .scope-details {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .scope-details small,
  .provider-note {
    color: var(--muted);
    font-size: 12px;
  }
  .provider-note {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .analysis-history-row {
    display: flex;
    width: 100%;
    padding: 14px 18px;
    gap: 14px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .analysis-history-row > span {
    flex: 1;
  }
  .analysis-history-row strong,
  .analysis-history-row small {
    display: block;
  }
  .analysis-document li {
    margin: 8px 0;
    color: var(--muted);
  }
</style>
