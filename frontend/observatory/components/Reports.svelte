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
  import AgentLogo from './AgentLogo.svelte';
  import { instances, type Telemetry } from '../runtime/host';
  import Metadata from './Metadata.svelte';
  import { radarGroups, groupRecord, groupEvidence } from '../runtime/radar';
  import ObservationTable from './ObservationTable.svelte';
  import SectionTabs from './SectionTabs.svelte';
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
  let reportSection = $state('summary');
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
      auditSection = sectionRequest.id;
    if (!audit && ['summary', 'export'].includes(sectionRequest.id))
      reportSection = sectionRequest.id;
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
  <SectionTabs
    tabs={[
      { id: 'entries', label: 'Entries' },
      { id: 'delivery', label: 'Delivery' },
    ]}
    selected={auditSection}
    change={(id) => {
      auditSection = id;
    }}
    prefix="audit"
    label={$t('Audit sections')}
  />
  <div
    role="tabpanel"
    id="audit-panel-entries"
    aria-labelledby="audit-tab-entries"
    hidden={auditSection !== 'entries'}
  >
    <div class="filterbar audit-filters">
      <label class="search-field"
        ><Icon name="search" /><input
          type="search"
          aria-label={$t('Search audit entries')}
          placeholder={$t('Resource, agent, action or PID')}
          bind:value={query}
        /></label
      >
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
      ><button
        bind:this={refreshButton}
        class="button"
        disabled={loading}
        aria-busy={loading}
        onclick={() => void refresh(true).catch(() => {})}
        ><Icon name="refresh" />{$t('Refresh')}</button
      ><span class="spacer"></span><Action
        action={async () => confirmed(await invoke(host, 'openAuditLogDir'))}
        ><Icon name="folder" />{$t('Audit folder')}</Action
      ><Action action={async () => confirmed(await invoke(host, 'exportFullAudit'))}
        ><Icon name="download" />{$t('Export retained audit records')}</Action
      >
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
  </div>
  <div
    role="tabpanel"
    id="audit-panel-delivery"
    aria-labelledby="audit-tab-delivery"
    hidden={auditSection !== 'delivery'}
  >
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
        <div><strong>{String(stats.bufferDepth ?? '—')}</strong><span>{$t('queued')}</span></div>
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
  </div>
{:else}
  <SectionTabs
    tabs={[
      { id: 'summary', label: 'Session summary' },
      { id: 'export', label: 'Export' },
    ]}
    selected={reportSection}
    change={(id) => {
      reportSection = id;
    }}
    prefix="reports"
    label={$t('Report sections')}
  />
  <div class="report-content">
    <div
      class="panel"
      role="tabpanel"
      id="reports-panel-summary"
      aria-labelledby="reports-tab-summary"
      hidden={reportSection !== 'summary'}
    >
      <div class="panel-head"><h2><Icon name="report" />{$t('Session summary')}</h2></div>
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
      role="tabpanel"
      id="reports-panel-export"
      aria-labelledby="reports-tab-export"
      hidden={reportSection !== 'export'}
    >
      <div class="panel-head"><h2><Icon name="download" />{$t('Export')}</h2></div>
      <div class="export-grid">
        {#each exports as [method, label] (method)}<Action
            action={async () => confirmed(await invoke(host, method))}
            ><Icon name="download" />{$t(label)}</Action
          >{/each}
      </div>
      <div class="notice" style="margin:0 20px 20px">
        <Icon name="file" />{$t(
          'Exports omit watched file contents and the configured Anthropic API key. Paths, agent names and endpoints remain.',
        )}
      </div>
    </div>
  </div>
{/if}

<style>
  [role='tabpanel'][hidden] {
    display: none;
  }
  [role='tabpanel'] {
    min-width: 0;
  }
  .audit-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    margin-top: 16px;
    gap: 12px;
  }
  .audit-filters > .search-field {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 8px;
    flex: 1 1 240px;
    min-width: 180px;
  }
  .audit-filters > .search-field input {
    flex: 1 1 0;
    width: 100%;
    min-width: 0;
  }
  .audit-filters > label {
    min-width: 0;
  }
  .audit-filters :global(select) {
    max-width: 100%;
  }
  .report-content {
    margin-top: 16px;
  }
  .delivery-fields {
    margin-top: 16px;
    padding: 20px;
  }
  .delivery-fields h2 {
    font-size: calc(14px * var(--ui-scale));
    margin: 0;
  }
  @media (max-width: 1050px) {
    .audit-filters > .search-field {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      gap: 8px;
      flex-basis: 100%;
    }
  }
  .export-grid :global(.action-control) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .export-grid :global(.button) {
    width: 100%;
    justify-content: center;
  }
</style>
