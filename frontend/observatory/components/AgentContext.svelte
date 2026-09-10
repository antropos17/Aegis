<script lang="ts">
  import type { Telemetry } from '../runtime/host';
  import { isScopedProcess, type AgentScope } from '../runtime/agent-scope';
  import AgentLogo from './AgentLogo.svelte';
  let {
    telemetry,
    scope,
    change,
  }: {
    telemetry: Telemetry;
    scope: AgentScope;
    change: (_scope: AgentScope) => void;
  } = $props();
  let names = $derived(
    [...new Set(telemetry.agents.map((row) => row.agent).filter(Boolean))].sort(),
  );
  let members = $derived(telemetry.agents.filter((row) => row.agent === scope.agent));
  let missing = $derived(
    scope.instanceId
      ? !members.some((row) => row.instanceId === scope.instanceId)
      : !!scope.agent && !members.length,
  );
</script>

<section class="agent-context" aria-label="Selected agent context">
  <div class="context-symbol"><AgentLogo name={scope.agent} size={22} /></div>
  <label
    >Agent
    <select
      aria-label="Selected agent"
      value={scope.agent}
      onchange={(event) => change({ agent: event.currentTarget.value, instanceId: '' })}
    >
      <option value="">All agents</option>
      {#each names as name (name)}<option value={name}>{name}</option>{/each}
      {#if scope.agent && !names.includes(scope.agent)}<option value={scope.agent}
          >{scope.agent} · not currently observed</option
        >{/if}
    </select>
  </label>
  <label
    >Process
    <select
      aria-label="Selected process"
      value={scope.instanceId}
      disabled={!scope.agent || (!scope.instanceId && !members.some(isScopedProcess))}
      onchange={(event) => change({ agent: scope.agent, instanceId: event.currentTarget.value })}
    >
      <option value="">All processes</option>
      {#each members.filter(isScopedProcess) as row (row.instanceId)}
        <option value={row.instanceId}
          >PID {row.pid}{row.projectName ? ' · ' + row.projectName : ''}</option
        >
      {/each}
      {#if scope.instanceId && missing}<option value={scope.instanceId}
          >Selected process · no longer observed</option
        >{/if}
    </select>
  </label>
  <div class="context-note">
    <strong>{scope.agent ? 'Shared across live views' : 'All observed agents'}</strong>
    <span
      >{missing
        ? 'Selection retained · current measurements unavailable'
        : scope.agent
          ? 'Overview, resources, files and connections follow this selection.'
          : 'Choose an agent to bring its information together.'}</span
    >
  </div>
  {#if scope.agent}<button class="button" onclick={() => change({ agent: '', instanceId: '' })}
      >All agents</button
    >{/if}
</section>

<style>
  .agent-context {
    display: flex;
    align-items: end;
    gap: 12px;
    flex-wrap: wrap;
    margin: 0 0 18px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
  }
  .context-symbol {
    align-self: center;
  }
  label {
    display: grid;
    gap: 5px;
    margin: 0;
    flex: 0 1 180px;
    min-width: 130px;
    color: var(--muted);
    font-size: calc(11px * var(--ui-scale));
  }
  select {
    width: 100%;
    min-width: 0;
  }
  .context-note {
    display: grid;
    gap: 4px;
    align-self: center;
    flex: 1 1 200px;
    line-height: 1.4;
    font-size: calc(11px * var(--ui-scale));
  }
  .context-note strong {
    color: var(--ink);
    font-weight: 600;
  }
  .context-note span {
    color: var(--muted);
  }
  @media (max-width: 1000px) {
    .context-note {
      display: none;
    }
    label {
      flex: 1 1 140px;
    }
  }
</style>
