<script lang="ts">
  import { t } from '../runtime/i18n';

  import { instances, measured, type Telemetry } from '../runtime/host';
  import { isScopedProcess, type AgentScope } from '../runtime/agent-scope';
  import { displayMeasure } from '../runtime/radar';
  import Icon from './Icon.svelte';
  let {
    telemetry,
    scope,
    change,
  }: { telemetry: Telemetry; scope: AgentScope; change: (_scope: AgentScope) => void } = $props();
  let expanded = $state(false);
  let members = $derived(
    instances(telemetry).filter((row) => row.agent === scope.agent && row.pid > 0),
  );
  let visible = $derived(expanded ? members : members.slice(0, 5));
</script>

<section class="panel agent-processes" aria-label={$t('Agent worker processes')}>
  <div class="panel-head">
    <h2><Icon name="cpu" />{$t('Worker processes')} <small>{members.length}</small></h2>
    {#if scope.instanceId}<button
        class="text-button"
        onclick={() => change({ agent: scope.agent, instanceId: '' })}>{$t('All processes')}</button
      >{/if}
  </div>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>{$t('Process')}</th><th>{$t('Project / working directory')}</th><th>{$t('CPU')}</th
          ><th>{$t('RAM')}</th></tr
        ></thead
      >
      <tbody
        >{#each visible as member (member.instanceId ?? member.pid)}
          {@const reading = telemetry.resources.find(
            (row) => !!member.instanceId && row.instanceId === member.instanceId,
          )}
          <tr class:chosen={scope.instanceId === member.instanceId}>
            <td
              ><button
                class="text-button"
                disabled={!isScopedProcess(member)}
                title={isScopedProcess(member)
                  ? $t('Select this process throughout live views')
                  : $t('Process start time was not observed')}
                onclick={() => change({ agent: scope.agent, instanceId: member.instanceId! })}
                ><Icon name="cpu" />{$t('PID')} {member.pid}</button
              ><small>{member.process}</small>{#if !isScopedProcess(member)}<small
                  >{$t('Start time not observed · selection unavailable')}</small
                >{/if}</td
            >
            <td class="location" title={String(member.cwd ?? '')}
              ><span class="process-location"
                >{#if member.projectName || member.cwd}<Icon name="folder" />{/if}<span
                  >{member.projectName || member.cwd || $t('Working directory not recorded')}</span
                ></span
              ></td
            >
            <td>{displayMeasure(telemetry.stale ? null : measured(reading?.cpu), '%')}</td>
            <td>{displayMeasure(telemetry.stale ? null : measured(reading?.memMb), ' MB')}</td>
          </tr>
        {:else}<tr
            ><td colspan="4"
              >{$t(
                'No worker processes in the current observation. Retained activity remains available above.',
              )}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
  {#if members.length > 5}<button class="more button" onclick={() => (expanded = !expanded)}
      >{expanded ? $t('Show fewer processes') : 'Show all ' + members.length + ' processes'}</button
    >{/if}
</section>

<style>
  .agent-processes {
    min-width: 0;
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
  }
  td {
    font-variant-numeric: tabular-nums;
  }
  td small {
    display: block;
    color: var(--muted);
    font-size: calc(10px * var(--ui-scale));
  }
  .location {
    max-width: 320px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .chosen {
    background: var(--accent-bg);
  }
  .process-location {
    display: flex;
    align-items: start;
    gap: var(--space-2);
  }
  .more {
    margin: 12px 16px;
  }
  h2 small {
    color: var(--muted);
    font-weight: 400;
  }
</style>
