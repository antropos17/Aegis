<script lang="ts">
  import { instances, measured, type RecordData, type Telemetry } from '../runtime/host';
  import { riskBand } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let query = $state(''),
    sort = $state('riskScore'),
    descending = $state(true);
  function metric(id: string | null, key: string) {
    return !id || telemetry.stale
      ? null
      : measured(telemetry.resources.find((r) => r.instanceId === id)?.[key]);
  }
  let agents = $derived(
    instances(telemetry)
      .filter((a) =>
        `${a.name} ${a.pid} ${a.cwd ?? ''}`.toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          (sort === 'name'
            ? a.name.localeCompare(b.name)
            : sort === 'cpu' || sort === 'memMb'
              ? (metric(a.instanceId, sort) ?? -1) - (metric(b.instanceId, sort) ?? -1)
              : Number((a as unknown as RecordData)[sort]) -
                Number((b as unknown as RecordData)[sort])) * (descending ? -1 : 1),
      ),
  );
</script>

<div class="filterbar">
  <label class="search-field"
    ><Icon name="search" /><input
      type="search"
      aria-label="Search instances"
      placeholder="Find agent, PID or project"
      bind:value={query}
    /></label
  ><label
    >Sort by<select bind:value={sort}
      ><option value="riskScore">Risk</option><option value="name">Name</option><option value="cpu"
        >CPU</option
      ><option value="memMb">RAM</option><option value="fileCount">Files</option><option
        value="networkCount">Network</option
      ></select
    ></label
  ><button class="button" onclick={() => (descending = !descending)}
    >{descending ? 'Descending' : 'Ascending'}</button
  ><span class="spacer"></span><span class="filter-count">{agents.length} instances</span>
</div>
<section class="panel">
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>Agent</th><th>Status</th><th>Risk</th><th>CPU</th><th>RAM</th><th>Files</th><th
            >Network</th
          ><th>Tokens</th><th>Cost</th><th>Latest event</th><th></th></tr
        ></thead
      ><tbody>
        {#each agents as a (a.instanceId ?? a)}{@const token = telemetry.tokens.find(
            (t) => !!a.instanceId && t.instanceId === a.instanceId,
          )}{@const latest = telemetry.events
            .filter((e) => !!a.instanceId && e.instanceId === a.instanceId)
            .sort((x, y) => y.timestamp - x.timestamp)[0]}<tr class="agent-instance-row"
            ><td
              ><button
                class="table-agent"
                onclick={() => inspect(a.name, a as unknown as RecordData)}
                ><AgentLogo id={a.agent} name={a.name} /><strong>{a.name}</strong></button
              ><button
                class="entity-link mono"
                onclick={() => inspect(a.name, a as unknown as RecordData)}>PID {a.pid}</button
              ></td
            ><td><span class="badge low">{telemetry.stale ? 'Last snapshot' : 'Active'}</span></td
            ><td
              ><span class={`risk-value ${riskBand(a.riskScore)}`}
                >{a.riskScore}<small>/100</small></span
              ></td
            ><td class="mono">{metric(a.instanceId, 'cpu')?.toFixed(1) ?? '—'}%</td><td class="mono"
              >{metric(a.instanceId, 'memMb')?.toFixed(1) ?? '—'} MB</td
            ><td>{a.fileCount}</td><td>{a.networkCount}</td><td
              >{measured(token?.totalTokens)?.toLocaleString() ?? '—'}</td
            ><td
              >{measured(token?.costUsd) === null
                ? '—'
                : '$' + Number(token?.costUsd).toFixed(2)}</td
            ><td class="mono">{latest ? new Date(latest.timestamp).toLocaleTimeString() : '—'}</td
            ><td
              ><button
                class="text-button"
                onclick={() => inspect(a.name, a as unknown as RecordData)}
                >Open<Icon name="chevron" /></button
              ></td
            ></tr
          >{:else}<tr
            ><td colspan="11"
              >{telemetry.ready ? 'No matching instances.' : 'Waiting for scan data.'}</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
</section>
<div class="notice" style="margin-top:18px">
  <Icon name="cpu" />Usage is per process instance. A dash means no measurement is available. Token
  costs are estimates.
</div>
