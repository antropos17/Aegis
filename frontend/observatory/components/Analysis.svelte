<script lang="ts">
  import { t } from '../runtime/i18n';

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
    keyPending = true;
    try {
      confirmed(
        await invoke(
          host,
          'saveSettings',
          { anthropicApiKey: value },
          { patch: true, ...(remove ? { clearAnthropicApiKey: true } : {}) },
        ),
      );
      if (alive) {
        keyRevision++;
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
    const selectedAgent = mode === 'agent' ? agent : null;
    const events = telemetry.events.filter(
      (event) => !selectedAgent || event.agent === selectedAgent,
    );
    const population = telemetry.agents.filter(
      (item) => !selectedAgent || item.agent === selectedAgent,
    );
    const fallbackCounts = {
      totalFiles: events.length,
      totalSensitive: events.filter((event) => event.sensitive).length,
      totalAgents: new Set(population.map((item) => item.agent).filter(Boolean)).size,
      totalNet: telemetry.network.filter((item) => !selectedAgent || item.agent === selectedAgent)
        .length,
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
    const requestCounts = record(result.counts);
    const captured = ['totalFiles', 'totalSensitive', 'totalAgents', 'totalNet'].every(
      (key) =>
        typeof requestCounts[key] === 'number' &&
        Number.isFinite(requestCounts[key]) &&
        Number(requestCounts[key]) >= 0,
    );
    const counts = captured
      ? Object.fromEntries(Object.keys(fallbackCounts).map((key) => [key, requestCounts[key]]))
      : fallbackCounts;
    report = {
      ...structured,
      title,
      scope,
      counts,
      countsSource: captured ? 'Captured analysis request' : 'Retained displayed observations',
      createdAt: new Date().toISOString(),
    };
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
        <strong>{$t('Anthropic')}</strong><span
          >{preview
            ? $t('Preview · provider calls disabled')
            : configured
              ? $t('API key saved · verified on first analysis')
              : $t('Not connected')}</span
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
          ? $t('Connection settings')
          : $t('Connect AI analysis')}</button
      >
    </div>
  </section>
  {#if showProvider}
    <EditorDialog
      title={$t('Anthropic connection')}
      caption={$t('AI analysis')}
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
            <h3>{$t('Provider connection')}</h3>
            <div class="form-grid">
              <label class="full"
                >{$t('New API key')}<input
                  disabled={preview}
                  type="password"
                  autocomplete="off"
                  bind:value={key}
                  placeholder={$t('Anthropic API key')}
                /></label
              >
            </div>
            <p class="dialog-copy">
              {$t(
                'Connection is verified when analysis runs. Saved keys are never displayed in this form.',
              )}
            </p>
            {#if !preview && !configured}<p class="dialog-copy">
                {$t(
                  'A saved key may remain when the OS keychain is locked. Remove saved key clears it.',
                )}
              </p>{/if}
          {:else}
            <h3>{$t('Analysis scope')}</h3>
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
            ><Icon name="trash" />{$t('Remove saved key')}</Action
          >{/if}
        <button
          class="button"
          onclick={() => {
            providerVisit++;
            showProvider = false;
            key = '';
          }}>{$t('Close settings')}</button
        >
        <Action disabled={preview || keyPending || !key.trim()} action={() => saveKey()}
          ><Icon name="key" />{$t('Save key')}</Action
        >
      {/snippet}
    </EditorDialog>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="analysis-layout">
    <section class="panel analysis-config">
      <div class="panel-head"><h2><Icon name="settings" />{$t('New assessment')}</h2></div>
      <div class="analysis-config-body">
        <label class="analysis-field"
          >{$t('Scope')}<select bind:value={mode}
            ><option value="session">{$t('Entire session')}</option><option value="agent"
              >{$t('Agent · all matching instances')}</option
            ></select
          ></label
        >
        {#if mode === 'agent'}<label class="analysis-field"
            >{$t('Agent')}<select bind:value={agent}
              ><option value="">{$t('Select an agent')}</option>{#each names as name (name)}<option
                  >{name}</option
                >{/each}</select
            ></label
          >{/if}
        <label class="analysis-field"
          >{$t('Report title')}<input bind:value={reportTitle} maxlength="160" /></label
        >
        <div class="scope-details analysis-field">
          <small>{$t('Evidence scope')}</small>
          <p>{$t('Recorded session metadata')}</p>
          <small>{$t('File observations, connections and agent activity supplied by AEGIS.')}</small
          >
        </div>
        <div class="provider-note">
          <Icon name="shield" />
          <p>
            {$t(
              'Analysis sends recorded activity metadata to Anthropic and may incur API charges.',
            )}
          </p>
        </div>
      </div>
      <div class="assessment-actions">
        <Action
          disabled={preview ||
            keyPending ||
            !configured ||
            (mode === 'agent' && !names.includes(agent))}
          action={analyze}><Icon name="play" />{$t('Run analysis')}</Action
        >
      </div>
    </section>
    <section class="panel analysis-output">
      <div class="subnav analysis-tabs" aria-label={$t('Report sections')}>
        {#each [['summary', 'Report', 'report'], ['evidence', 'Evidence', 'file'], ['history', 'History', 'history']] as [id, title, icon] (id)}<button
            aria-pressed={section === id}
            onclick={() => (section = id)}><Icon name={icon} />{$t(title)}</button
          >{/each}
      </div>
      <div class="analysis-body">
        <div hidden={section !== 'summary'} class="report-section">
          {#if !report}<div class="analysis-empty">
              <Icon name="report" />
              <h2>{$t('Review agent activity')}</h2>
              <p>
                {$t(
                  'Choose a scope and run an assessment. Review findings alongside their recorded evidence.',
                )}
              </p>
              <ol>
                <li><span>1</span>{$t('Choose a session or an agent')}</li>
                <li><span>2</span>{$t('Review the selected metadata')}</li>
                <li><span>3</span>{$t('Assess findings and export the report')}</li>
              </ol>
              <small
                >{preview
                  ? $t('Provider calls are disabled in this preview.')
                  : configured
                    ? $t('Ready for a new assessment.')
                    : $t('Connect Anthropic to create your first assessment.')}</small
              >
            </div>
          {:else}<article class="analysis-document">
              <div class="analysis-document-meta">
                <small>{$t('ANTHROPIC ASSESSMENT')}</small><span class="badge"
                  >{String(report.riskRating || report.riskLevel || 'Not assessed')}</span
                >
              </div>
              <h2>{String(report.title)}</h2>
              <small>{String(report.scope)} · {String(report.createdAt)}</small>
              <p class="report-text">{String(report.summary ?? 'No summary returned')}</p>
              <p>{String(report.riskJustification ?? '')}</p>
              <h3><Icon name="shield" />{$t('Findings')}</h3>
              <ol>
                {#each strings(report.findings) as item, i (i)}<li>{item}</li>{:else}<li>
                    {$t('No findings returned.')}
                  </li>{/each}
              </ol>
              <h3><Icon name="check" />{$t('Recommended checks')}</h3>
              <ol>
                {#each strings(report.recommendations) as item, i (i)}<li>{item}</li>{:else}<li>
                    {$t('No recommendations returned.')}
                  </li>{/each}
              </ol>
              <Action action={async () => confirmed(await invoke(host, 'openThreatReport', report))}
                ><Icon name="report" />{$t('Open report')}</Action
              >
            </article>{/if}
        </div>
        <div hidden={section !== 'evidence'} class="report-section inset">
          {#if report}<h2>{$t('Recorded scope')}</h2>
            <p class="muted">
              {String(report.countsSource)} · {String(report.scope)}{$t(
                '. Agents counts distinct products.',
              )}
            </p>
            <Metadata value={record(report.counts)} />{:else}<div class="analysis-empty">
              <Icon name="file" />
              <h2>{$t('No assessment yet')}</h2>
              <p>{$t('Evidence information appears after an analysis completes.')}</p>
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
              <h2>{$t('No assessments yet')}</h2>
              <p>{$t('Your completed assessments will appear here.')}</p>
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
