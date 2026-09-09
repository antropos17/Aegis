<script lang="ts">
  import { instances, type RecordData, type Telemetry } from '../runtime/host';
  import {
    radarGroups,
    groupResource,
    groupEvidence,
    groupRecord,
    riskBand,
  } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (title: string, row: RecordData) => void } = $props();
  let query = $state(''),
    sort = $state('risk'),
    descending = $state(true);
  let agents = $derived(
    radarGroups(instances(telemetry))
      .filter((a) =>
        `${a.name} ${a.members.map((m) => `${m.pid} ${m.cwd ?? ''}`).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .map((a) => ({
        ...a,
        ...groupEvidence(a, telemetry),
        cpu: groupResource(a, telemetry, 'cpu'),
        memMb: groupResource(a, telemetry, 'memMb'),
      }))
      .sort(
        (a, b) =>
          (sort === 'name'
            ? a.name.localeCompare(b.name)
            : Number((a as unknown as RecordData)[sort] ?? -1) -
              Number((b as unknown as RecordData)[sort] ?? -1)) * (descending ? -1 : 1),
      ),
  );
</script>

<div class="filterbar">
  <label class="search-field"
    ><Icon name="search" /><input
      type="search"
      aria-label="Search agents"
      placeholder="Find agent, PID or project"
      bind:value={query}
    /></label
  ><label
    >Sort by<select bind:value={sort}
      ><option value="risk">Risk</option><option value="name">Name</option><option value="cpu"
        >CPU</option
      ><option value="memMb">RAM</option><option value="files">Files</option><option value="network"
        >Network</option
      ></select
    ></label
  ><button class="button" onclick={() => (descending = !descending)}
    >{descending ? 'Descending' : 'Ascending'}</button
  ><span class="spacer"></span><span class="filter-count"
    >{agents.length} agents · {agents.reduce((sum, a) => sum + a.members.length, 0)} processes</span
  >
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
        {#each agents as a (a.key)}<tr class="agent-group-row"
            ><td
              ><button class="table-agent" onclick={() => inspect(a.name, groupRecord(a))}
                ><AgentLogo id={a.key} name={a.name} /><strong>{a.name}</strong></button
              ><button class="entity-link" onclick={() => inspect(a.name, groupRecord(a))}
                >{a.members.length}
                {a.members.length === 1 ? 'process' : 'processes'}<Icon name="chevron" /></button
              ></td
            ><td><span class="badge low">{telemetry.stale ? 'Last snapshot' : 'Active'}</span></td
            ><td
              ><span
                class={`risk-value ${riskBand(a.risk)}`}
                title="Highest risk among this agent's processes">{a.risk}<small>/100</small></span
              ></td
            ><td class="mono">{a.cpu === null ? '—' : a.cpu.toFixed(1) + '%'}</td><td class="mono"
              >{a.memMb === null ? '—' : a.memMb.toFixed(1) + ' MB'}</td
            ><td>{a.files}</td><td>{a.network}</td><td>{a.tokens?.toLocaleString() ?? '—'}</td><td
              >{a.cost === null ? '—' : '$' + a.cost.toFixed(2)}</td
            ><td class="mono"
              >{a.latest === null ? '—' : new Date(a.latest).toLocaleTimeString()}</td
            ><td
              ><button class="text-button" onclick={() => inspect(a.name, groupRecord(a))}
                >Open<Icon name="chevron" /></button
              ></td
            ></tr
          >{:else}<tr
            ><td colspan="11"
              >{telemetry.ready ? 'No matching agents.' : 'Waiting for scan data.'}</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
</section>
<div class="notice" style="margin-top:18px">
  <Icon name="cpu" />One row per agent. Usage combines its processes; risk shows the highest process
  score. A dash means the total is incomplete. Open an agent to inspect individual processes.
</div>
