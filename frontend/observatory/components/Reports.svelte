<script lang="ts">
  import { onMount } from 'svelte';
  import { confirmed, invoke, record, records, type Host, type RecordData } from '../runtime/host';
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
  let rows = $state<RecordData[]>([]);
  let cursor = $state(new Date().toISOString());
  let exhausted = $state(false);
  let boundaryOffset = $state(0);
  let error = $state('');
  let alive = true;
  let type = $state('');
  let generation = 0;
  let loading = $state(false);
  let query = $state('');
  let auditSection = $state('entries');
  let reportSection = $state('summary');
  let appliedType = $state('');
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
  async function refresh(reset = false) {
    error = '';
    loading = true;
    try {
      await load(reset);
    } catch (e) {
      if (alive) {
        error = e instanceof Error ? e.message : String(e);
        type = appliedType;
      }
      throw e;
    } finally {
      if (alive) loading = false;
    }
  }
  async function load(reset = false) {
    const ticket = ++generation;
    const before = reset ? new Date().toISOString() : cursor;
    const [summary, page] = await Promise.all([
      invoke(host, 'getAuditStats'),
      invoke(
        host,
        'getAuditEntriesBefore',
        before,
        100,
        type ? [type] : undefined,
        reset ? 0 : boundaryOffset,
      ),
    ]);
    if (!alive || ticket !== generation) return;
    stats = record(summary);
    appliedType = type;
    const incoming = records(page);
    rows = reset ? incoming : [...incoming, ...rows];
    exhausted = incoming.length < 100;
    const times = incoming
      .map((row) => String(row.timestamp ?? ''))
      .filter(Boolean)
      .sort();
    if (times[0]) {
      const countAtBoundary = incoming.filter((row) => row.timestamp === times[0]).length;
      boundaryOffset = countAtBoundary + (!reset && times[0] === cursor ? boundaryOffset : 0);
      cursor = times[0];
    }
  }
  onMount(() => {
    if (audit) void refresh(true).catch(() => {});
    return () => {
      alive = false;
      generation++;
    };
  });
  const exports = [
    ['exportLog', 'JSON activity log'],
    ['exportCsv', 'CSV activity log'],
    ['generateReport', 'HTML session report'],
    ['exportZip', 'Diagnostic ZIP'],
    ['exportFullAudit', 'Complete audit export'],
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
    label="Audit sections"
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
          aria-label="Search audit entries"
          placeholder="Resource, agent, action or PID"
          bind:value={query}
        /></label
      >
      <label
        >Type<select
          bind:value={type}
          disabled={loading}
          onchange={(event) => {
            type = event.currentTarget.value;
            void refresh(true).catch(() => {});
          }}
          ><option value="">All entries</option
          >{#each ['file-access', 'config-access', 'network-connection', 'agent-enter', 'agent-exit', 'anomaly-alert', 'sequence-detection', 'observation-gap', 'permission-deny'] as name (name)}<option
              >{name}</option
            >{/each}</select
        ></label
      ><label
        >Grouping<select aria-label="Audit grouping" bind:value={grouping}
          ><option value="resource">By resource</option><option value="agent"
            >By agent / context</option
          ><option value="none">Every observation</option></select
        ></label
      ><button
        class="button"
        disabled={loading}
        aria-busy={loading}
        onclick={() => void refresh(true).catch(() => {})}>Refresh</button
      ><span class="spacer"></span><Action
        action={async () => confirmed(await invoke(host, 'openAuditLogDir'))}
        ><Icon name="folder" />Audit folder</Action
      ><Action action={async () => confirmed(await invoke(host, 'exportFullAudit'))}
        ><Icon name="download" />Export full audit</Action
      >
    </div>
    {#if error}<p role="alert" class="notice">{error}</p>{/if}
    <p class="entity-note" role="status">
      {loading
        ? 'Loading audit entries…'
        : filtered.length + ' of ' + rows.length + ' loaded entries'}{#if query}
        · search covers loaded entries{/if}
    </p>
    <ObservationTable
      rows={filtered}
      {telemetry}
      {inspect}
      {grouping}
      resetKey={JSON.stringify([appliedType, query])}
    />
    <div class="pagination">
      <span>{rows.length} audit entries loaded</span><button
        class="button"
        disabled={exhausted || loading}
        aria-busy={loading}
        onclick={() => void refresh().catch(() => {})}>Load older entries</button
      >
    </div>
  </div>
  <div
    role="tabpanel"
    id="audit-panel-delivery"
    aria-labelledby="audit-tab-delivery"
    hidden={auditSection !== 'delivery'}
  >
    <section class="panel">
      <div class="inline-stats">
        <div>
          <strong>{String(stats.persistedEntries ?? '—')}</strong><span>persisted entries</span>
        </div>
        <div><strong>{String(stats.bufferDepth ?? '—')}</strong><span>queued</span></div>
        <div><strong>{String(stats.droppedEntries ?? '—')}</strong><span>dropped</span></div>
        <div>
          <strong
            >{typeof stats.totalSize === 'number'
              ? (stats.totalSize / 1024).toFixed(1) + ' KB'
              : '—'}</strong
          ><span>stored history</span>
        </div>
      </div>
    </section>

    <section class="panel delivery-fields">
      <h2>Audit delivery details</h2>
      <p class="entity-note">Storage and delivery counters describe retained audit history.</p>
      <Metadata
        value={Object.fromEntries(
          Object.entries(stats).filter(
            ([key]) =>
              !['persistedEntries', 'bufferDepth', 'droppedEntries', 'totalSize'].includes(key),
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
    label="Report sections"
  />
  <div class="report-content">
    <div
      class="panel"
      role="tabpanel"
      id="reports-panel-summary"
      aria-labelledby="reports-tab-summary"
      hidden={reportSection !== 'summary'}
    >
      <div class="panel-head"><h2><Icon name="report" />Session summary</h2></div>
      <div class="inline-stats">
        <div>
          <strong>{String(telemetry.stats.totalFiles ?? '—')}</strong><span>file observations</span>
        </div>
        <div>
          <strong>{String(telemetry.stats.aiSensitive ?? '—')}</strong><span>sensitive</span>
        </div>
        <div>
          <strong>{telemetry.ready ? groups.length : '—'}</strong><span>agents</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Processes</th><th>Highest risk</th><th>Files</th></tr></thead
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
              >{:else}<tr><td colspan="4">No observed agents.</td></tr>{/each}</tbody
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
      <div class="panel-head"><h2><Icon name="download" />Export</h2></div>
      <div class="export-grid">
        {#each exports as [method, label] (method)}<Action
            action={async () => confirmed(await invoke(host, method))}
            ><Icon name="download" />{label}</Action
          >{/each}
      </div>
      <div class="notice" style="margin:0 20px 20px">
        <Icon name="file" />Exports exclude watched file contents and API keys.
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
