<script lang="ts">
  import { t } from '../runtime/i18n';

  import { instances, type RecordData, type Telemetry } from '../runtime/host';
  import {
    radarGroups,
    groupResource,
    groupEvidence,
    groupRecord,
    riskBand,
  } from '../runtime/radar';
  import { leadingRiskReason } from '../runtime/risk-context';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import SectionTabs from './SectionTabs.svelte';
  let {
    telemetry,
    inspect,
    openStatistics,
  }: {
    telemetry: Telemetry;
    inspect: (title: string, row: RecordData) => void;
    openStatistics?: (_agent: string) => void;
  } = $props();
  const panelId = $props.id();
  let section = $state('overview');
  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'resources', label: 'Resources' },
    { id: 'activity', label: 'Activity' },
  ];
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
      aria-label={$t('Search agents')}
      placeholder={$t('Find agent, PID or project')}
      bind:value={query}
    /></label
  ><label
    >{$t('Sort by')}<select bind:value={sort}
      ><option value="risk">{$t('Risk')}</option><option value="name">{$t('Name')}</option><option
        value="cpu">{$t('CPU')}</option
      ><option value="memMb">{$t('RAM')}</option><option value="files">{$t('Files')}</option><option
        value="network">{$t('Network')}</option
      ></select
    ></label
  ><button class="button" onclick={() => (descending = !descending)}
    ><Icon name="sort" />{descending ? $t('Descending') : $t('Ascending')}</button
  ><span class="spacer"></span><span class="filter-count"
    >{agents.length}
    {$t('agents ·')}
    {agents.reduce((sum, a) => sum + a.members.length, 0)}
    {$t('processes')}</span
  >
</div>
<section class="panel">
  <SectionTabs
    tabs={sections}
    selected={section}
    change={(id) => {
      section = id;
    }}
    prefix={panelId}
    label={$t('Agent table sections')}
  />
  <div
    class="table-wrap"
    role="tabpanel"
    tabindex="0"
    id={panelId + '-panel-' + section}
    aria-labelledby={panelId + '-tab-' + section}
  >
    <table>
      <thead
        ><tr
          ><th>{$t('Agent')}</th>
          {#if section === 'overview'}<th>{$t('Status')}</th><th>{$t('Risk')}</th>{/if}
          {#if section !== 'activity'}<th>{$t('CPU')}</th><th>{$t('RAM')}</th>{/if}
          {#if section === 'resources'}<th>{$t('Tokens')}</th><th>{$t('Cost')}</th>{/if}
          {#if section === 'activity'}<th>{$t('Files')}</th><th>{$t('Network')}</th>{/if}
          {#if section !== 'resources'}<th>{$t('Latest event')}</th>{/if}<th>{$t('Details')}</th>
        </tr></thead
      ><tbody>
        {#each agents as a (a.key)}<tr class="agent-group-row"
            ><td
              ><button class="table-agent" onclick={() => inspect(a.name, groupRecord(a))}
                ><AgentLogo id={a.key} name={a.name} /><strong>{a.name}</strong></button
              ><button
                class="entity-link"
                onclick={() => inspect(a.name, { ...groupRecord(a), detailSection: 'processes' })}
                >{a.members.length}
                {a.members.length === 1 ? $t('process') : $t('processes')}<Icon
                  name="chevron"
                /></button
              ></td
            >{#if section === 'overview'}<td
                ><span class="badge low"
                  >{telemetry.stale ? $t('Last snapshot') : $t('Active')}</span
                ></td
              ><td
                ><span
                  class={`risk-value ${riskBand(a.risk)}`}
                  title={$t("Highest risk among this agent's processes")}
                  >{a.risk}<small>/100</small></span
                >
                <button
                  class="entity-link risk-reason"
                  aria-label={'Explain risk for ' + a.name}
                  onclick={() => inspect(a.name, { ...groupRecord(a), detailSection: 'risk' })}
                  >{leadingRiskReason(a.members[0])}</button
                ></td
              >{/if}{#if section !== 'activity'}<td class="mono"
                >{a.cpu === null ? '—' : a.cpu.toFixed(1) + '%'}</td
              ><td class="mono">{a.memMb === null ? '—' : a.memMb.toFixed(1) + ' MB'}</td
              >{/if}{#if section === 'activity'}<td>{a.files}</td><td>{a.network}</td
              >{/if}{#if section === 'resources'}<td>{a.tokens?.toLocaleString() ?? '—'}</td><td
                >{a.cost === null ? '—' : '$' + a.cost.toFixed(2)}</td
              >{/if}{#if section !== 'resources'}<td class="mono"
                >{a.latest === null ? '—' : new Date(a.latest).toLocaleTimeString()}</td
              >{/if}<td
              ><button class="text-button" onclick={() => inspect(a.name, groupRecord(a))}
                >{$t('Open')}<Icon name="chevron" /></button
              >{#if openStatistics}<button
                  class="text-button"
                  aria-label={a.name + ' statistics'}
                  onclick={() => openStatistics?.(a.key)}
                  >{$t('Statistics')}<Icon name="chart" /></button
                >{/if}</td
            ></tr
          >{:else}<tr
            ><td colspan={section === 'activity' ? 5 : 7}
              >{telemetry.ready ? $t('No matching agents.') : $t('Waiting for scan data.')}</td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>
</section>
<div class="notice" style="margin-top:18px">
  <Icon name="cpu" />{$t(
    'One row per agent. Usage combines its processes; risk shows the highest process score. A dash means the total is incomplete. Open an agent to inspect individual processes.',
  )}
</div>

<style>
  .risk-reason {
    display: block;
    max-width: 170px;
    margin-top: 4px;
    font-size: calc(11px * var(--ui-scale));
    line-height: 1.4;
    text-align: left;
    white-space: normal;
  }
</style>
