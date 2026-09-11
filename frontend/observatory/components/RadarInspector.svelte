<script lang="ts">
  import { t } from '../runtime/i18n';

  import { record, type Telemetry, type RecordData } from '../runtime/host';
  import { reveal } from '../runtime/motion';
  import {
    groupResource,
    groupRecord,
    displayMeasure,
    riskBand,
    type RadarGroup,
    type ObservedInstance,
  } from '../runtime/radar';
  import { leadingRiskReason } from '../runtime/risk-context';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import ObservationResource from './ObservationResource.svelte';
  import { describeObservation } from '../../../src/shared/observation-display.js';
  let {
    chosen,
    group,
    telemetry,
    selected = $bindable(null),
    inspect,
    openStatistics,
  }: {
    chosen: ObservedInstance | undefined;
    group: RadarGroup | undefined;
    telemetry: Telemetry;
    openStatistics?: (_agent: string) => void;
    selected: string | null;
    inspect: (title: string, row: RecordData) => void;
  } = $props();
  let processOptions = $state(false);
  let previousGroup: string | undefined;
  $effect(() => {
    if (group?.key !== previousGroup) {
      previousGroup = group?.key;
      processOptions = false;
    }
  });
  let ids = $derived(new Set(group?.members.map((a) => a.instanceId).filter(Boolean)));
  let events = $derived(telemetry.events.filter((e) => e.instanceId && ids.has(e.instanceId)));
  let latest = $derived([...events].sort((a, b) => b.timestamp - a.timestamp)[0]);
  function openGroup() {
    if (group) inspect(group.name, groupRecord(group));
  }
  function openProcess() {
    if (chosen) inspect(chosen.name, chosen as unknown as RecordData);
  }
</script>

<aside class="panel inspector" id="inspector">
  <div class="inspector-title">
    <h2><Icon name="agents" />{$t('Agent details')}</h2>
    <span class="detail-status"
      >{group ? (telemetry.stale ? $t('Last snapshot') : $t('Selected')) : $t('No selection')}</span
    >
  </div>
  <div class="inspector-content" use:reveal={group?.key ?? 'empty'}>
    {#if group}
      <div class="agent-identity">
        <AgentLogo id={group.key} name={group.name} size={32} />
        <div>
          <button class="entity-link" onclick={openGroup}>{group.name}</button><small
            >{group.members.length}
            {group.members.length === 1 ? $t('worker process') : $t('worker processes')}</small
          >
        </div>
      </div>
      <section class="inspector-block" aria-label={$t('Agent risk')}>
        <div class="inspector-risk">
          <div>
            <span>{$t('Highest process risk')}</span><span class={`badge ${riskBand(group.risk)}`}
              >{riskBand(group.risk)}</span
            >
          </div>
          <span class={`risk-value ${riskBand(group.risk)}`}>{group.risk}<small>/100</small></span>
        </div>
        <div class="risk-track">
          <i
            style={`transform:scaleX(${group.risk / 100});background:var(--${group.risk < 35 ? 'green' : group.risk < 66 ? 'amber' : 'red'})`}
          ></i>
        </div>
        <p class="entity-note">{leadingRiskReason(group.members[0])}</p>
        <button
          class="entity-link"
          onclick={() => inspect(group.name, { ...groupRecord(group), detailSection: 'risk' })}
          >{$t('Why this score')}<Icon name="chevron" /></button
        >
      </section>
      <section class="inspector-block" aria-label={$t('Combined agent usage')}>
        <h3>{$t('Combined usage')}</h3>
        <div class="inspector-metrics">
          <div>
            <strong>{displayMeasure(groupResource(group, telemetry, 'cpu'), '%')}</strong><span
              >{$t('CPU')}</span
            >
          </div>
          <div>
            <strong>{displayMeasure(groupResource(group, telemetry, 'memMb'))}</strong><span
              >{$t('RAM, MB')}</span
            >
          </div>
          <div><strong>{events.length}</strong><span>{$t('events')}</span></div>
        </div>
      </section>
      {#if openStatistics}<button
          class="button inspector-open"
          onclick={() => openStatistics?.(group.key)}
          >{$t('Agent statistics')}<Icon name="chart" /></button
        >{/if}
      <section class="inspector-block" aria-label={$t('Recent agent activity')}>
        <h3>{$t('Latest activity')}</h3>
        {#if latest}<div class="finding" class:ordinary={!latest.sensitive}>
            <div>
              <Icon name="file" /><span
                >{latest.sensitive ? $t('Needs review') : $t('File event')}</span
              ><time>{new Date(latest.timestamp).toLocaleTimeString()}</time>
            </div>
            <button
              class="entity-link"
              onclick={() => inspect('File observation', latest as unknown as RecordData)}
              ><ObservationResource row={latest as unknown as RecordData} /></button
            >
            <p>{latest.action ?? $t('File change observed.')}</p>
            {#if record(latest.attribution).status !== 'confirmed'}<small
                >{describeObservation(latest as unknown as RecordData).attribution}</small
              >{/if}
          </div>{:else}<p class="entity-note">
            {$t('No retained file events for this agent.')}
          </p>{/if}
      </section>
      <button class="button inspector-open" onclick={openGroup}
        >{$t('Open agent')}<Icon name="chevron" /></button
      >
      <details class="process-options" bind:open={processOptions}>
        <summary>{$t('Individual processes')} <span>{group.members.length}</span></summary>
        <label class="instance-picker"
          ><span>{$t('Choose a process')}</span><select
            aria-label={$t('Selected process')}
            bind:value={selected}
          >
            {#each group.members.filter((a) => a.instanceId) as a (a.instanceId)}<option
                value={a.instanceId}
                >{$t('PID')}
                {a.pid}{a.projectName ? ' · ' + a.projectName : ''}
                {$t('· risk')}
                {a.riskScore}</option
              >{/each}
          </select></label
        >
        <button class="button" onclick={openProcess} disabled={!chosen}
          ><Icon name="cpu" />{$t('Process')}</button
        >
      </details>
    {:else}
      <div class="radar-no-selection">
        <Icon name="radar" />
        <h3>{$t('Choose an agent')}</h3>
        <p>
          {$t(
            'Select a marker or a row in the agent list. Its risk, usage and activity appear here.',
          )}
        </p>
      </div>
    {/if}
  </div>
</aside>
