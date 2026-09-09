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
  let {
    host,
    audit = false,
    inspect,
    telemetry,
    navigate,
  }: {
    host: Host | null;
    telemetry: Telemetry;
    navigate: (view: string) => void;
    audit?: boolean;
    inspect: (title: string, row: RecordData) => void;
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
    if (audit)
      load(true).catch((e) => {
        if (alive) error = String(e);
      });
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
        ><span>JSONL size</span>
      </div>
    </div>
  </section>
  <div class="filterbar" style="margin-top:20px">
    <label
      >Type<select bind:value={type}
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
    ><Action action={() => load(true)}>Apply filter / refresh</Action><span class="spacer"
    ></span><Action action={async () => confirmed(await invoke(host, 'openAuditLogDir'))}
      ><Icon name="folder" />Audit folder</Action
    ><Action action={async () => confirmed(await invoke(host, 'exportFullAudit'))}
      ><Icon name="download" />Export full audit</Action
    >
  </div>
  {#if error}<p role="alert" class="notice">{error}</p>{/if}
  <ObservationTable {rows} {telemetry} {inspect} {grouping} resetKey={type} />
  <div class="pagination">
    <span>{rows.length} audit entries loaded</span><Action
      disabled={exhausted}
      action={() => load()}>Load older entries</Action
    >
  </div>
  <details class="audit-diagnostics">
    <summary>Audit delivery details</summary><Metadata value={stats} />
  </details>
{:else}
  <div class="analysis-report-link notice">
    <Icon name="shield" /><span>AI assessments have their own workspace.</span><button
      class="button"
      onclick={() => navigate('analysis')}><Icon name="chevron" />Open AI analysis</button
    >
  </div>
  <div class="report-grid">
    <section class="panel">
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
    </section>
    <section class="panel">
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
    </section>
  </div>
{/if}

<style>
  .audit-diagnostics {
    margin-top: 16px;
    color: var(--muted);
    font-size: 12px;
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
