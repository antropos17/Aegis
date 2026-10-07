<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../runtime/i18n';

  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupEvidence, groupRecord } from '../runtime/radar';
  import { measuredStatisticsTotal, statisticsValue } from '../runtime/statistics-metrics';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (_title: string, _row: RecordData) => void } = $props();
  let groups = $derived(
    radarGroups(instances(telemetry)).map((g) => {
      const groupState = {
        ...telemetry,
        agents: g.members.map((member) => ({
          ...member,
          instanceId: member.instanceId ?? undefined,
        })),
      };
      return {
        ...g,
        ...groupEvidence(g, telemetry),
        tokenUsage: measuredStatisticsTotal(groupState, telemetry.tokens, 'totalTokens'),
        costUsage: measuredStatisticsTotal(groupState, telemetry.tokens, 'costUsd'),
        unobservedClaudeBirth:
          telemetry.ready &&
          !telemetry.stale &&
          g.key === 'Claude Code' &&
          telemetry.agents.some(
            (agent) =>
              agent.agent === 'Claude Code' &&
              agent.pid > 0 &&
              agent.instanceIdSource === 'unknown',
          ),
      };
    }),
  );
  let showSources = $state(false);
</script>

<section class="panel tokens-panel">
  <header>
    <div>
      <h3>{$t('Usage by agent')}</h3>
      <p>{$t('Current processes · exact identity coverage · estimates are labeled')}</p>
    </div>
    <button class="button" aria-expanded={showSources} onclick={() => (showSources = !showSources)}
      ><Icon name="database" />{$t('Source samples ·')} {telemetry.tokens.length}</button
    >
  </header>
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>{$t('Agent')}</th><th>{$t('Coverage')}</th><th>{$t('Tokens')}</th><th
            >{$t('Estimated cost')}</th
          ></tr
        ></thead
      ><tbody>
        {#each groups as group (group.key)}
          <tr
            ><td
              ><button class="entity-link" onclick={() => inspect(group.name, groupRecord(group))}
                >{group.name}</button
              ><small>{group.members.length} {$t('processes')}</small></td
            ><td>{group.tokenUsage.measured} / {group.tokenUsage.total}</td><td
              >{statisticsValue(group.tokenUsage.value)}<small
                >{group.tokenUsage.value === null
                  ? $t('No current measurement')
                  : group.tokenUsage.measured < group.tokenUsage.total
                    ? $t('Measured subtotal')
                    : $t('From supported logs')}{group.estimated
                  ? $t(' · includes estimates')
                  : ''}</small
              >{#if group.unobservedClaudeBirth}<small
                  >{$t(
                    'Token usage for a Claude Code process is unavailable because its start time was not observed.',
                  )}</small
                >{/if}</td
            ><td
              >{statisticsValue(group.costUsage.value, 'USD')}<small
                >{group.costUsage.measured} / {group.costUsage.total}
                {$t('processes priced')}{group.costUsage.value !== null &&
                group.costUsage.measured < group.costUsage.total
                  ? $t(' · subtotal')
                  : ''}</small
              ></td
            ></tr
          >
        {:else}<tr><td colspan="4">{$t('No current agents with token attribution.')}</td></tr
          >{/each}
      </tbody>
    </table>
  </div>
  {#if showSources}
    <div class="source-list">
      {#each telemetry.tokens as token, index (index)}
        {@const agent = telemetry.agents.find(
          (a) => a.instanceId && a.instanceId === token.instanceId,
        )}
        <article>
          <div>
            <h4>
              {token.archived === true
                ? $t('Archived exited usage')
                : agent?.agent || $t('Unlinked source')}
              <small
                >{token.archived === true
                  ? $t('{count} compacted records', { count: token.archivedRecords })
                  : typeof token.pid === 'number'
                    ? 'PID ' + token.pid
                    : 'Sample ' + (index + 1)}</small
              >
            </h4>
            <span>{token.estimated === true ? $t('Estimated') : $t('Recorded')}</span>
          </div>
          <dl>
            <div>
              <dt>{$t('Total')}</dt>
              <dd>{statisticsValue(measured(token.totalTokens))}</dd>
            </div>
            <div>
              <dt>{$t('Input')}</dt>
              <dd>{statisticsValue(measured(token.inputTokens))}</dd>
            </div>
            <div>
              <dt>{$t('Output')}</dt>
              <dd>{statisticsValue(measured(token.outputTokens))}</dd>
            </div>
            <div>
              <dt>{$t('Estimated cost')}</dt>
              <dd>{statisticsValue(measured(token.costUsd), 'USD')}</dd>
            </div>
          </dl>
          {#if Array.isArray(token.models)}<p>
              {token.models.filter((m) => typeof m === 'string').join(' · ')}
            </p>{/if}
          {#if token.modelsTruncated === true}<p>
              {$t('Additional model labels omitted. Usage and cost totals are retained.')}
            </p>{/if}
        </article>
      {:else}<p class="muted">{$t('No source samples are available.')}</p>{/each}
    </div>
  {/if}
  <p class="footnote">
    {$t(
      'Local log coverage is limited to supported agents. Pricing is an estimate and may be incomplete or out of date. Missing source data does not mean zero usage.',
    )}
  </p>
</section>

<style>
  .tokens-panel {
    overflow: hidden;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    justify-content: space-between;
    padding: var(--panel-inset);
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 550;
  }
  header p,
  .footnote {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.6;
  }
  header p {
    margin: var(--space-1) 0 0;
  }
  header .button {
    font-size: 11px;
  }
  .footnote {
    margin: 0;
    padding: var(--panel-inset);
    border-top: 1px solid var(--border);
  }
  .source-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
    gap: var(--space-3);
    padding: var(--panel-inset);
    border-top: 1px solid var(--border);
    max-height: 420px;
    overflow: auto;
  }
  article {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: var(--space-3);
    min-width: 0;
  }
  article > div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    align-items: center;
  }
  h4 {
    margin: 0;
    font-size: 12px;
  }
  h4 small {
    display: block;
    margin-top: var(--space-1);
    font-weight: 400;
  }
  small,
  article span,
  article p,
  dt {
    font-size: 10px;
    color: var(--muted);
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: var(--space-3) 0 0;
  }
  dd {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    margin: var(--space-1) 0 0;
  }
  article p {
    overflow-wrap: anywhere;
    line-height: 1.5;
    margin: var(--space-3) 0 0;
  }
</style>
