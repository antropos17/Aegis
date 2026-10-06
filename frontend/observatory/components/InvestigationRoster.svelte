<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../runtime/i18n';
  import { instances, type Telemetry } from '../runtime/host';
  import { isScopedProcess, type AgentScope } from '../runtime/agent-scope';
  import { radarGroups, riskBand, type RadarGroup } from '../runtime/radar';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';

  let {
    telemetry,
    scope,
    change,
  }: {
    telemetry: Telemetry;
    scope: AgentScope;
    change: (_scope: AgentScope) => void;
  } = $props();
  const id = $props.id();
  let query = $state('');
  let order = $state<string[]>([]);
  let selectedLabel = $state({ key: '', name: '' });
  let groups = $derived(telemetry.ready ? radarGroups(instances(telemetry)) : []);

  // Preserve existing product positions; new products join at the end. Only the
  // current population and a departed selection remain in this bounded order.
  $effect(() => {
    const keys = groups.map((group) => group.key);
    if (scope.agent && !keys.includes(scope.agent)) keys.push(scope.agent);
    const previous = untrack(() => order);
    const next = [...previous.filter((key) => keys.includes(key))];
    for (const key of keys) if (!next.includes(key)) next.push(key);
    if (JSON.stringify(previous) !== JSON.stringify(next)) order = next;
    const selected = groups.find((group) => group.key === scope.agent);
    const label = untrack(() => selectedLabel);
    if (selected && (label.key !== selected.key || label.name !== selected.name))
      selectedLabel = { key: selected.key, name: selected.name };
    else if (!selected && label.key !== scope.agent)
      selectedLabel = { key: scope.agent, name: scope.agent };
  });

  let products = $derived.by(() => {
    const byKey = new Map(groups.map((group) => [group.key, group]));
    const keys = order.filter((key) => byKey.has(key) || key === scope.agent);
    for (const group of groups) if (!keys.includes(group.key)) keys.push(group.key);
    if (scope.agent && !keys.includes(scope.agent)) keys.push(scope.agent);
    return keys.map((key) => {
      const group = byKey.get(key);
      return {
        key,
        group,
        name: group?.name ?? (selectedLabel.key === key ? selectedLabel.name : key),
      };
    });
  });
  let rows = $derived(
    products.filter(
      (row) =>
        !row.group || row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );

  function score(group: RadarGroup | undefined): number | null {
    return telemetry.ready && group?.members.every(isScopedProcess) ? group.risk : null;
  }
  function status(group: RadarGroup | undefined): string {
    if (!telemetry.ready) return $t('Observation unavailable');
    if (!group)
      return $t(telemetry.stale ? 'Absent from retained population' : 'Not currently observed');
    const count = group.members.length;
    return (
      count +
      ' ' +
      $t(count === 1 ? 'worker process' : 'worker processes') +
      ' · ' +
      $t(telemetry.stale ? 'Last snapshot' : 'Observed now')
    );
  }
  function riskLabel(group: RadarGroup | undefined): string {
    const risk = score(group);
    return risk === null
      ? $t('Risk unavailable')
      : $t(telemetry.stale ? 'Retained highest risk' : 'Highest risk') + ' · ' + risk + '/100';
  }
</script>

<aside class="investigation-roster" aria-labelledby={id + '-heading'}>
  <label class="roster-compact">
    <span>{$t('Agent / context')}</span>
    <select
      value={scope.agent}
      onchange={(event) => change({ agent: event.currentTarget.value, instanceId: '' })}
    >
      <option value="">{$t('All agents')}</option>
      {#each products as product (product.key)}
        <option value={product.key}
          >{product.name}{product.group ? '' : ' · ' + status(product.group)}</option
        >
      {/each}
    </select>
  </label>
  <div class="roster-desktop">
    <h2 id={id + '-heading'}>{$t('Agents')}</h2>
    <label class="roster-search">
      <span>{$t('Search agents')}</span>
      <input type="search" aria-label={$t('Search agents')} bind:value={query} />
    </label>
    <button
      class="button roster-choice all-agents"
      aria-label={$t('All agents')}
      aria-pressed={!scope.agent}
      onclick={() => change({ agent: '', instanceId: '' })}
      ><Icon name="agents" />{$t('All agents')}</button
    >
  </div>
  <p class="roster-status" role="status">
    {#if !telemetry.ready}
      {$t('Waiting for reliable agent observations.')}
    {:else if telemetry.stale}
      {$t('Last reliable agent population is retained.')}
    {/if}
  </p>
  <div class="roster-list roster-desktop">
    {#each rows as row (row.key)}
      <button
        class="button roster-choice"
        aria-label={row.name}
        aria-describedby={id +
          '-status-' +
          encodeURIComponent(row.key) +
          ' ' +
          id +
          '-risk-' +
          encodeURIComponent(row.key)}
        aria-pressed={scope.agent === row.key}
        onclick={() => change({ agent: row.key, instanceId: '' })}
      >
        <span class="roster-heading">
          <AgentLogo id={row.key} name={row.name} size={22} />
          <strong>{row.name}</strong>
        </span>
        <span class="roster-meta" id={id + '-status-' + encodeURIComponent(row.key)}
          >{status(row.group)}</span
        >
        <span
          id={id + '-risk-' + encodeURIComponent(row.key)}
          class={'badge roster-risk ' +
            (score(row.group) === null ? '' : riskBand(score(row.group)!))}
          >{riskLabel(row.group)}</span
        >
      </button>
    {/each}
  </div>
  {#if telemetry.ready && !groups.length}
    <p class="roster-empty">
      {$t(telemetry.stale ? 'No agents in retained population.' : 'No observed agents.')}
    </p>
  {:else if telemetry.ready && !rows.length}
    <p class="roster-empty roster-desktop">{$t('No matching agents.')}</p>
  {/if}
</aside>

<style>
  .investigation-roster {
    width: 100%;
    max-width: 230px;
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-section);
  }
  .roster-compact {
    display: none;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .roster-compact select {
    flex: 1;
    width: 100%;
    min-width: 0;
  }
  .roster-search {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .roster-search input {
    width: 100%;
    min-width: 0;
  }
  .roster-list {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .roster-choice {
    display: grid;
    justify-content: stretch;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    height: auto;
    min-height: var(--control-height);
    padding: var(--space-2);
    text-align: left;
    white-space: normal;
  }
  .roster-choice[aria-pressed='true'] {
    border-color: var(--strong-border);
    background: var(--raised);
  }
  .all-agents {
    display: flex;
    align-items: center;
    justify-content: start;
  }
  .roster-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .roster-heading strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--text-body);
    line-height: 1.4;
  }
  .roster-meta,
  .roster-status,
  .roster-empty {
    color: var(--muted);
    font-size: var(--text-caption);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .roster-status,
  .roster-empty {
    margin: var(--space-2) 0;
  }
  .roster-status:empty {
    display: none;
  }
  .roster-risk {
    justify-self: start;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  @media (max-width: 1000px) {
    .investigation-roster {
      max-width: none;
    }
    .roster-list {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
    }
  }
  @media (max-width: 980px) {
    .investigation-roster {
      padding: var(--space-2);
    }
    .roster-compact {
      display: flex;
    }
    .roster-desktop {
      display: none;
    }
  }
</style>
