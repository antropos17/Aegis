<script lang="ts">
  import { t } from '../runtime/i18n';

  import { riskContext } from '../runtime/risk-context';
  import { riskBand } from '../runtime/radar';
  import type { RecordData, Telemetry } from '../runtime/host';
  import Icon from './Icon.svelte';
  let {
    row,
    telemetry,
    navigate,
  }: {
    row: RecordData;
    telemetry: Telemetry;
    navigate: (_title: string, _row: RecordData) => void;
  } = $props();
  let context = $derived(riskContext(row, telemetry));
  const points = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
</script>

<section class="detail-section risk-explanation">
  <div class="section-heading">
    <h3>{$t('Why this score')}</h3>
    <span class="badge"
      >{telemetry.stale
        ? $t('Last reliable snapshot')
        : context.captured
          ? $t('Assessment when opened')
          : $t('Latest assessment')}</span
    >
  </div>
  {#if context.subject}
    <div class="assessment-head">
      <strong
        class="risk-value"
        class:low={context.score !== null && riskBand(context.score) === 'low'}
        class:medium={context.score !== null && riskBand(context.score) === 'medium'}
        class:high={context.score !== null && riskBand(context.score) === 'high'}
      >
        {context.score ?? '—'}<small>/100</small>
      </strong>
      <div>
        <strong
          >{context.score === null
            ? $t('Unavailable')
            : riskBand(context.score) + ' observed risk'}</strong
        >
        <p class="primary-reason">
          {!context.subject.instanceId
            ? $t('Activity cannot be linked')
            : (context.contributions[0]?.label ?? $t('No scored activity'))}
        </p>
      </div>
    </div>
    {#if row.agentGroupKey}
      <p class="scope">
        {context.processCount}
        {$t('worker')}
        {context.processCount === 1 ? $t('process') : $t('processes')}
        {$t('· Highest score: PID')}
        {String(context.subject.pid)}.
        {#if context.tied > 1}{context.tied} {$t('processes share this score.')}{/if}
      </p>
      <button
        class="button"
        onclick={() => navigate(String(context.subject?.name || 'Process'), context.subject!)}
      >
        {$t('View process PID')}
        {String(context.subject.pid)}<Icon name="chevron" />
      </button>
    {:else}
      <p class="scope">
        {$t('Assessment for PID')}
        {String(context.subject.pid)} · {String(context.subject.process || 'Process')}
      </p>
    {/if}
    {#if context.unlinked}
      <p class="notice">
        {context.unlinked}
        {context.unlinked === 1 ? $t('process has') : $t('processes have')}
        {$t(
          'no recorded identity. Their activity cannot be linked, so the assessment has limited coverage.',
        )}
      </p>
    {/if}
    {#if context.available}
      {#if context.contributions.length}
        <ul class="factor-list">
          {#each context.contributions as factor (factor.id)}
            <li>
              <div><strong>{$t(factor.label)}</strong><span>+{points(factor.points)}</span></div>
              <p>{$t(factor.detail)}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="notice">
          {$t(
            'No contributing file or network activity in the available observations. Coverage determines what AEGIS can assess.',
          )}
        </p>
      {/if}
      {#if context.adjustment < 0}
        <div class="adjustment">
          <strong>{$t('Saved exception')}</strong><span>{points(context.adjustment)}</span>
        </div>
        <p class="entity-note">
          {$t("An existing false-positive exception lowers this agent's score.")}
        </p>
      {/if}
      <p class="entity-note">
        {$t(
          'The total is rounded and capped at 100 before saved adjustments. Older file activity carries less weight. Behaviour anomaly is assessed separately.',
        )}
      </p>
    {:else}
      <p class="notice">{$t('A factor breakdown is unavailable for this assessment.')}</p>
    {/if}
  {:else}
    <p class="notice">
      {$t(
        'This agent is no longer in the available snapshot. A current risk explanation is unavailable.',
      )}
    </p>
  {/if}
</section>

<style>
  .risk-explanation {
    display: grid;
    gap: 14px;
  }
  .assessment-head {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .assessment-head > div {
    min-width: 0;
  }
  .assessment-head > div > strong {
    text-transform: capitalize;
  }
  p {
    margin: 4px 0 0;
    line-height: 1.5;
    color: var(--muted);
  }
  .scope {
    color: var(--text);
  }
  .button {
    justify-self: start;
  }
  .factor-list {
    list-style: none;
    padding: 0;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 9px;
    overflow: hidden;
  }
  .factor-list li {
    padding: 12px 14px;
  }
  .factor-list li + li {
    border-top: 1px solid var(--border);
  }
  .factor-list li > div,
  .adjustment {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 14px;
  }
  .factor-list span,
  .adjustment span {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .factor-list p {
    font-size: calc(12px * var(--ui-scale));
  }
  .notice {
    margin: 0;
  }
</style>
