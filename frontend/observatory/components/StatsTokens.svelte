<script lang="ts">
  import { instances, measured, type Telemetry, type RecordData } from '../runtime/host';
  import { radarGroups, groupEvidence, groupRecord } from '../runtime/radar';
  import { statisticsValue } from '../runtime/statistics-metrics';
  let {
    telemetry,
    inspect,
  }: { telemetry: Telemetry; inspect: (_title: string, _row: RecordData) => void } = $props();
  let groups = $derived(
    radarGroups(instances(telemetry)).map((g) => ({ ...g, ...groupEvidence(g, telemetry) })),
  );
  let showSources = $state(false);
</script>

<section class="panel tokens-panel">
  <header>
    <div>
      <h3>Usage by agent</h3>
      <p>Current processes · exact identity coverage · estimates are labeled</p>
    </div>
    <button class="button" aria-expanded={showSources} onclick={() => (showSources = !showSources)}
      >Source samples · {telemetry.tokens.length}</button
    >
  </header>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Agent</th><th>Coverage</th><th>Tokens</th><th>Estimated cost</th></tr></thead
      ><tbody>
        {#each groups as group (group.key)}
          {@const covered = group.members.filter(
            (a) =>
              a.instanceId &&
              telemetry.tokens.some(
                (t) => t.instanceId === a.instanceId && measured(t.totalTokens) !== null,
              ),
          ).length}
          <tr
            ><td
              ><button class="entity-link" onclick={() => inspect(group.name, groupRecord(group))}
                >{group.name}</button
              ><small>{group.members.length} processes</small></td
            ><td>{covered} / {group.members.length}</td><td
              >{statisticsValue(group.tokens)}<small
                >{group.estimated
                  ? 'Includes estimates'
                  : group.tokens === null
                    ? 'Incomplete coverage'
                    : 'From supported logs'}</small
              ></td
            ><td>{statisticsValue(group.cost, 'USD')}</td></tr
          >
        {:else}<tr><td colspan="4">No current agents with token attribution.</td></tr>{/each}
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
              {agent?.agent || 'Unlinked source'}
              <small
                >{typeof token.pid === 'number'
                  ? 'PID ' + token.pid
                  : 'Sample ' + (index + 1)}</small
              >
            </h4>
            <span>{token.estimated === true ? 'Estimated' : 'Recorded'}</span>
          </div>
          <dl>
            <div>
              <dt>Total</dt>
              <dd>{statisticsValue(measured(token.totalTokens))}</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>{statisticsValue(measured(token.inputTokens))}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{statisticsValue(measured(token.outputTokens))}</dd>
            </div>
            <div>
              <dt>Estimated cost</dt>
              <dd>{statisticsValue(measured(token.costUsd), 'USD')}</dd>
            </div>
          </dl>
          {#if Array.isArray(token.models)}<p>
              {token.models.filter((m) => typeof m === 'string').join(' · ')}
            </p>{/if}
        </article>
      {:else}<p class="muted">No source samples are available.</p>{/each}
    </div>
  {/if}
  <p class="footnote">
    Local log coverage is limited to supported agents. Pricing is an estimate and may be incomplete
    or out of date. Missing source data does not mean zero usage.
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
