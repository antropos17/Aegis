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
              ></td
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
              {agent?.agent || $t('Unlinked source')}
              <small
                >{typeof token.pid === 'number'
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
    gap: 12px;
    justify-content: space-between;
    padding: 18px;
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
    margin: 6px 0 0;
  }
  header .button {
    font-size: 11px;
  }
  .footnote {
    margin: 0;
    padding: 16px 18px;
    border-top: 1px solid var(--border);
  }
  .source-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 12px;
    padding: 18px;
    border-top: 1px solid var(--border);
    max-height: 420px;
    overflow: auto;
  }
  article {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    min-width: 0;
  }
  article > div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }
  h4 {
    margin: 0;
    font-size: 12px;
  }
  h4 small {
    display: block;
    margin-top: 5px;
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
    gap: 16px;
    margin: 14px 0 0;
  }
  dd {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    margin: 5px 0 0;
  }
  article p {
    overflow-wrap: anywhere;
    line-height: 1.5;
    margin: 12px 0 0;
  }
</style>
