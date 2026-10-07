<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick } from 'svelte';
  import { confirmed, invoke, record, type Host, type RecordData } from '../runtime/host';
  import {
    admitAuditPage,
    admitAuditStats,
    advanceAuditPage,
    emptyAuditPage,
    type AuditReadState,
    type AuditRequest,
  } from '../runtime/audit-read-state';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AuditContext from './AuditContext.svelte';
  import AgentLogo from './AgentLogo.svelte';
  import { instances, type Telemetry } from '../runtime/host';
  import Metadata from './Metadata.svelte';
  import { radarGroups, groupRecord, groupEvidence } from '../runtime/radar';
  import ObservationTable from './ObservationTable.svelte';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  let {
    host,
    audit = false,
    inspect,
    telemetry,
    sectionRequest,
  }: {
    host: Host | null;
    telemetry: Telemetry;
    navigate: (_view: string) => void;
    audit?: boolean;
    sectionRequest?: { id: string; revision: number };
    inspect: (_title: string, _row: RecordData) => void;
  } = $props();
  let groups = $derived(radarGroups(instances(telemetry)));
  let grouping = $state<'resource' | 'agent' | 'none'>('resource');
  let stats = $state<RecordData>({});
  let page = $state(emptyAuditPage(new Date().toISOString()));
  let rows = $derived(page.rows);
  let pageRead = $state<AuditReadState>('idle');
  let admissionRevision = $state(0);
  let statsRead = $state<AuditReadState>('idle');
  let statsLoaded = $state(false);
  let statsFresh = $state(false);
  let failedRequest = $state<AuditRequest | null>(null);
  let retryHistoryButton = $state<HTMLButtonElement>();
  let refreshButton = $state<HTMLButtonElement>();
  let alive = true;
  let type = $state('');
  let generation = 0;
  let statsGeneration = 0;
  let pageLoading = $state(false);
  let statsLoading = $state(false);
  let loading = $derived(pageLoading || statsLoading);
  let query = $state('');
  let auditSection = $state('entries');
  async function openAuditSection(section: 'entries' | 'delivery') {
    auditSection = section;
    await tick();
    const tab = document.getElementById('audit-panel-' + section);
    if (alive && tab?.isConnected && !tab.closest('[hidden], [inert]')) {
      tab.focus({ preventScroll: true });
      tab.scrollIntoView?.({ block: 'nearest' });
    }
  }
  let appliedType = $derived(page.appliedType);
  let displayStats = $derived(
    !statsFresh
      ? Object.fromEntries(
          Object.entries(stats).filter(
            ([key]) => !['totalSize', 'currentSize', 'storageReadState'].includes(key),
          ),
        )
      : stats,
  );
  let details = $derived({
    ...displayStats,
    ...(stats.index
      ? {
          index: {
            ...record(stats.index),
            ...(record(stats.index).lastError
              ? { lastError: $t('Audit index details unavailable.') }
              : {}),
          },
        }
      : {}),
  });
  $effect(() => {
    if (!sectionRequest) return;
    sectionRequest.revision;
    if (audit && ['entries', 'delivery'].includes(sectionRequest.id))
      void openAuditSection(sectionRequest.id as 'entries' | 'delivery');
    if (!audit && ['summary', 'export'].includes(sectionRequest.id))
      void tick().then(() => {
        const panel = document.getElementById('reports-panel-' + sectionRequest!.id);
        if (alive && panel?.isConnected && !panel.closest('[hidden], [inert]')) {
          panel.focus({ preventScroll: true });
          panel.scrollIntoView?.({ block: 'nearest' });
        }
      });
  });
  let filtered = $derived(
    rows.filter((row) => {
      const info = describeObservation(row, instances(telemetry) as unknown as RecordData[]);
      return [
        info.path,
        info.resource,
        info.actor,
        info.context,
        row.type,
        row.action,
        row.pid,
        row.reason,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase());
    }),
  );
  async function refresh(reset = false, retry?: AuditRequest) {
    if (loading) return;
    const request = retry ?? {
      reset,
      before: reset ? new Date().toISOString() : page.cursor,
      boundaryOffset: reset ? 0 : page.boundaryOffset,
      requestedType: type,
    };
    const retryHadFocus = retryHistoryButton === document.activeElement;
    const ticket = generation + 1;
    await Promise.all([readHistory(request), readStats()]);
    if (!alive || ticket !== generation) return;
    if (pageRead === 'ready') failedRequest = null;
    await tick();
    if (alive && ticket === generation && retryHadFocus && document.activeElement === document.body)
      refreshButton?.focus({ preventScroll: true });
  }
  async function readHistory(request: AuditRequest) {
    const ticket = ++generation;
    pageLoading = true;
    pageRead = 'loading';
    try {
      const reply = await invoke(
        host,
        'getAuditEntriesBefore',
        request.before,
        100,
        request.requestedType ? [request.requestedType] : undefined,
        request.boundaryOffset,
      );
      if (!alive || ticket !== generation) return;
      page = advanceAuditPage(page, admitAuditPage(reply), request);
      admissionRevision += 1;
      type = request.requestedType;
      pageRead = 'ready';
    } catch {
      if (alive && ticket === generation) {
        pageRead = 'failed';
        failedRequest = { ...request };
        type = page.appliedType;
      }
    } finally {
      if (alive && ticket === generation) pageLoading = false;
    }
  }
  async function readStats() {
    const ticket = ++statsGeneration;
    statsLoading = true;
    statsRead = 'loading';
    try {
      const reply = await invoke(host, 'getAuditStats');
      if (!alive || ticket !== statsGeneration) return;
      stats = admitAuditStats(reply);
      statsLoaded = true;
      statsFresh = true;
      statsRead = 'ready';
    } catch {
      if (alive && ticket === statsGeneration) {
        statsFresh = false;
        statsRead = 'failed';
      }
    } finally {
      if (alive && ticket === statsGeneration) statsLoading = false;
    }
  }
  onMount(() => {
    if (audit) void refresh(true);
    return () => {
      alive = false;
      generation++;
      statsGeneration++;
    };
  });
  const exports = [
    ['exportLog', 'JSON activity log'],
    ['exportCsv', 'CSV activity log'],
    ['generateReport', 'HTML session report'],
    ['exportZip', 'Diagnostic ZIP'],
    ['exportFullAudit', 'Retained audit records'],
  ] as const;
</script>

{#if audit}
  <AuditContext section={auditSection} select={openAuditSection} />
  <div class="audit-composition">
    <section
      class="audit-entries panel"
      id="audit-panel-entries"
      tabindex="-1"
      aria-labelledby="audit-heading-entries"
      onfocusin={() => (auditSection = 'entries')}
    >
      <h2 id="audit-heading-entries">{$t('Entries')}</h2>
      <div class="filterbar audit-filters">
        <label class="search-field"
          ><Icon name="search" /><input
            type="search"
            aria-label={$t('Search audit entries')}
            placeholder={$t('Resource, agent, action or PID')}
            bind:value={query}
          /></label
        >
        <div class="audit-filter-fields">
          <label
            >{$t('Type')}<select
              aria-label={$t('Type')}
              bind:value={type}
              disabled={loading}
              onchange={(event) => {
                type = event.currentTarget.value;
                void refresh(true).catch(() => {});
              }}
              ><option value="">{$t('All entries')}</option
              >{#each ['file-access', 'config-access', 'network-connection', 'agent-enter', 'agent-exit', 'anomaly-alert', 'sequence-detection', 'observation-gap', 'permission-deny'] as name (name)}<option
                  >{name}</option
                >{/each}</select
            ></label
          ><label
            >{$t('Grouping')}<select aria-label={$t('Audit grouping')} bind:value={grouping}
              ><option value="resource">{$t('By resource')}</option><option value="agent"
                >{$t('By agent / context')}</option
              ><option value="none">{$t('Every observation')}</option></select
            ></label
          >
        </div>
        <div class="audit-filter-actions">
          <button
            bind:this={refreshButton}
            class="button"
            disabled={loading}
            aria-busy={loading}
            onclick={() => void refresh(true).catch(() => {})}
            ><Icon name="refresh" />{$t('Refresh')}</button
          ><Action action={async () => confirmed(await invoke(host, 'openAuditLogDir'))}
            ><Icon name="folder" />{$t('Audit folder')}</Action
          ><Action action={async () => confirmed(await invoke(host, 'exportFullAudit'))}
            ><Icon name="download" />{$t('Export retained audit records')}</Action
          >
        </div>
      </div>
      {#if pageRead === 'failed'}<p role="alert" class="notice">
          {$t(
            page.loaded
              ? 'Audit history unavailable. Showing previously loaded entries.'
              : 'Audit history unavailable. Retry reading.',
          )}
        </p>{/if}
      {#if failedRequest}<button
          bind:this={retryHistoryButton}
          class="button"
          aria-disabled={loading}
          aria-busy={loading}
          onclick={() => {
            if (failedRequest) void refresh(false, failedRequest);
          }}><Icon name="refresh" />{$t('Retry history')}</button
        >{/if}
      <p class="entity-note" role="status">
        {pageLoading
          ? $t('Loading audit entries…')
          : page.loaded
            ? $t('{visible} of {loaded} loaded entries', {
                visible: filtered.length,
                loaded: rows.length,
              })
            : $t('Audit history has not been loaded.')}{#if query && page.loaded}
          {$t('· search covers loaded entries')}{/if}
      </p>
      {#if page.loaded && rows.length}<ObservationTable
          rows={filtered}
          {telemetry}
          {inspect}
          {grouping}
          live={false}
          {admissionRevision}
          resetKey={JSON.stringify([appliedType, query])}
        />{:else if page.loaded}<p class="entity-note">
          {$t('No entries in this history page.')}
        </p>{/if}
      <div class="pagination">
        <span
          >{#if page.loaded}{rows.length} {$t('audit entries loaded')}{:else}{$t(
              'Loaded history is unknown',
            )}{/if}</span
        ><button
          class="button"
          disabled={!page.loaded || page.exhausted || loading}
          aria-busy={loading}
          onclick={() => void refresh().catch(() => {})}
          ><Icon name="history" />{$t('Load older entries')}</button
        >
      </div>
    </section>
    <section
      class="audit-delivery"
      id="audit-panel-delivery"
      tabindex="-1"
      aria-labelledby="audit-heading-delivery"
      onfocusin={() => (auditSection = 'delivery')}
    >
      <h2 id="audit-heading-delivery">{$t('Delivery')}</h2>
      {#if statsRead === 'failed'}<p role="alert" class="notice">
          {$t(
            statsLoaded
              ? 'Delivery counters unavailable. Showing last loaded values.'
              : 'Delivery counters unavailable. Retry reading.',
          )}
        </p>
      {:else if statsLoading}<p role="status" class="entity-note">
          {$t(statsLoaded ? 'Updating delivery counters…' : 'Loading delivery counters…')}
        </p>{/if}
      {#if stats.storageReadState === 'unavailable'}<p class="notice">
          {$t('Storage measurements unavailable. Delivery counters are separate observations.')}
        </p>
      {:else if stats.storageReadState === 'uninitialized'}<p class="notice">
          {$t('Audit journal has not been initialized.')}
        </p>{/if}
      {#if stats.historyReadState === 'building'}<p role="status" class="entity-note">
          {$t('Historical audit counters are still loading.')}
        </p>
      {:else if stats.historyReadState === 'unavailable'}<p class="notice">
          {$t(
            'Historical audit counters unavailable. Live queue and loss observations remain separate.',
          )}
        </p>{/if}
      <button
        class="button"
        aria-disabled={loading}
        aria-busy={statsLoading}
        onclick={() => {
          if (!loading) void readStats();
        }}><Icon name="refresh" />{$t('Refresh delivery counters')}</button
      >
      <section class="panel">
        <div class="inline-stats">
          <div>
            <strong>{String(stats.persistedEntries ?? '—')}</strong><span
              >{$t('persisted entries')}</span
            >
          </div>
          <div>
            <strong>{String(stats.bufferDepth ?? '—')}</strong><span>{$t('queued')}</span>
          </div>
          <div>
            <strong>{String(stats.droppedEntries ?? '—')}</strong><span>{$t('dropped')}</span>
          </div>
          <div>
            <strong
              >{typeof displayStats.totalSize === 'number'
                ? (displayStats.totalSize / 1024).toFixed(1) + ' KB'
                : '—'}</strong
            ><span>{$t('stored history')}</span>
          </div>
        </div>
      </section>

      <section class="panel delivery-fields">
        <h2>{$t('Audit delivery details')}</h2>
        <p class="entity-note">
          {$t('Delivery counters do not confirm that the history can be read.')}
        </p>
        <Metadata
          value={Object.fromEntries(
            Object.entries(details).filter(
              ([key]) =>
                ![
                  'persistedEntries',
                  'bufferDepth',
                  'droppedEntries',
                  'totalSize',
                  'storageReadState',
                ].includes(key),
            ),
          )}
        />
      </section>
    </section>
  </div>
{:else}
  <div class="report-content">
    <div
      class="panel"
      role="region"
      tabindex="-1"
      id="reports-panel-summary"
      aria-labelledby="reports-heading-summary"
    >
      <div class="panel-head">
        <h2 id="reports-heading-summary"><Icon name="report" />{$t('Session summary')}</h2>
      </div>
      <div class="inline-stats">
        <div>
          <strong>{String(telemetry.stats.totalFiles ?? '—')}</strong><span
            >{$t('retained file observations')}</span
          >
        </div>
        <div>
          <strong
            >{telemetry.ready
              ? telemetry.events.filter((event) => event.sensitive === true).length
              : '—'}</strong
          ><span>{$t('retained sensitive events')}</span>
        </div>
        <div>
          <strong>{telemetry.ready ? groups.length : '—'}</strong><span>{$t('agents')}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead
            ><tr
              ><th>{$t('Agent')}</th><th>{$t('Processes')}</th><th>{$t('Highest risk')}</th><th
                >{$t('Files')}</th
              ></tr
            ></thead
          >
          <tbody
            >{#each groups as group (group.key)}<tr class="report-agent-group"
                ><td
                  ><button
                    class="table-agent"
                    onclick={() => inspect(group.name, groupRecord(group))}
                    ><AgentLogo name={group.name} />{group.name}</button
                  ></td
                ><td>{group.members.length}</td><td>{group.risk}/100</td><td
                  >{groupEvidence(group, telemetry).files}</td
                ></tr
              >{:else}<tr><td colspan="4">{$t('No observed agents.')}</td></tr>{/each}</tbody
          >
        </table>
      </div>
    </div>
    <div
      class="panel"
      role="region"
      tabindex="-1"
      id="reports-panel-export"
      aria-labelledby="reports-heading-export"
    >
      <div class="panel-head">
        <h2 id="reports-heading-export"><Icon name="download" />{$t('Export')}</h2>
      </div>
      <div class="export-grid">
        {#each exports as [method, label] (method)}<Action
            action={async () => confirmed(await invoke(host, method))}
            ><Icon name="download" />{$t(label)}</Action
          >{/each}
      </div>
      <div class="notice export-notice">
        <Icon name="file" />{$t(
          'Exports omit watched file contents and the configured Anthropic API key. Paths, agent names and endpoints remain.',
        )}
      </div>
    </div>
  </div>
{/if}

<style>
  .audit-composition,
  .report-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
    gap: var(--space-4);
    align-items: start;
  }
  .audit-entries {
    padding: var(--panel-inset);
    container-type: inline-size;
    container-name: audit-entries;
  }
  .audit-entries > .pagination {
    padding: var(--space-3) 0;
  }
  .audit-entries > h2,
  .audit-delivery > h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-body);
    font-weight: 700;
  }
  .audit-delivery {
    min-width: 0;
    padding: var(--panel-inset);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--raised);
  }
  .audit-delivery > .panel {
    margin-top: var(--space-3);
  }
  .audit-composition > *,
  .report-content > * {
    min-width: 0;
  }
  @media (max-width: 800px) {
    .audit-composition,
    .report-content {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .audit-filters {
    display: grid;
    margin-top: var(--space-4);
    gap: var(--space-3);
  }
  .audit-filters > .search-field {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .audit-filters > .search-field input {
    flex: 1 1 0;
    width: 100%;
    min-width: 0;
  }
  .audit-filter-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .audit-filter-fields > label {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .audit-filters :global(select) {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }
  .audit-filter-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-2);
    min-width: 0;
  }
  .audit-filter-actions :global(.action-control) {
    min-width: 0;
  }
  .audit-filter-actions :global(.button) {
    max-width: 100%;
    white-space: normal;
    text-align: left;
  }
  .report-content {
    margin-top: 0;
  }
  .delivery-fields {
    padding: var(--panel-inset);
  }
  .delivery-fields h2 {
    font-size: calc(14px * var(--ui-scale));
    margin: 0;
  }
  @container audit-entries (max-width: 280px) {
    .audit-filter-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .export-grid {
    padding: var(--panel-inset);
    gap: var(--space-3);
  }
  .export-notice {
    margin: 0 var(--panel-inset) var(--panel-inset);
  }
  .export-grid :global(.action-control) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .export-grid :global(.button) {
    width: 100%;
    min-height: calc(var(--control-height) + var(--space-3));
    justify-content: flex-start;
    text-align: left;
    line-height: 1.5;
  }
  .export-grid :global(.icon) {
    flex-shrink: 0;
  }
</style>
