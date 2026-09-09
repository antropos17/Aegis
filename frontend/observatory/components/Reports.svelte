<script lang="ts">
  import { onMount } from 'svelte';
  import { confirmed, invoke, record, records, type Host, type RecordData } from '../runtime/host';
  import Action from './Action.svelte';
  import Metadata from './Metadata.svelte';
  let {
    host,
    audit = false,
    inspect,
  }: {
    host: Host | null;
    audit?: boolean;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
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
    <div class="panel-head">
      <h2>Persisted audit history</h2>
      <Action
        action={async () => {
          confirmed(await invoke(host, 'openAuditLogDir'));
        }}>Open log folder</Action
      >
    </div>
    <div class="inset">
      <Metadata value={stats} />
      <p class="muted">
        Persisted, queued and dropped counts describe separate stages. Chain metadata remains
        attached to each entry.
      </p>
    </div>
  </section>
  <section class="panel">
    <div class="toolbar inset">
      <label
        >Type <select bind:value={type}
          ><option value="">All</option><option>file-access</option><option>config-access</option
          ><option>network-connection</option><option>agent-enter</option><option>agent-exit</option
          ><option>anomaly-alert</option><option>sequence-detection</option><option
            >observation-gap</option
          ><option>permission-deny</option></select
        ></label
      ><Action action={() => load(true)}>Apply filter / refresh</Action>
    </div>
    {#if error}<p role="alert" class="inset">{error}</p>{/if}
    <div class="table-scroll">
      <table>
        <thead><tr><th>Time</th><th>Type</th><th>Observation</th></tr></thead><tbody
          >{#each rows as row (row)}<tr
              ><td>{String(row.timestamp ?? 'Unavailable')}</td><td
                >{String(row.type ?? 'Unknown')}</td
              ><td
                ><button class="text-link" onclick={() => inspect('Audit entry', row)}
                  >{String(
                    row.file ?? row.path ?? row.agent ?? row.eventId ?? 'View metadata',
                  )}</button
                ></td
              ></tr
            >{:else}<tr><td colspan="3">No entries loaded.</td></tr>{/each}</tbody
        >
      </table>
    </div>
    <div class="inset">
      <Action disabled={exhausted} action={() => load()}>Load older entries</Action>
    </div>
  </section>
{:else}
  <section class="panel">
    <div class="panel-head">
      <h2>Export observations</h2>
      <span>Native exports & printable report</span>
    </div>
    <div class="export-grid inset">
      {#each exports as [method, label] (method)}<div class="export-card">
          <h3>{label}</h3>
          <p class="muted">
            {method === 'generateReport'
              ? 'Open a generated HTML report in your default application.'
              : 'Export recorded observations to a file you choose.'}
          </p>
          <Action action={async () => confirmed(await invoke(host, method))}>Export</Action>
        </div>{/each}
    </div>
  </section>
{/if}

<style>
  .export-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 12px;
  }
  .export-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
</style>
