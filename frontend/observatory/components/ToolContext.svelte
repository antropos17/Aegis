<script lang="ts">
  import type { RecordData } from '../runtime/host';
  import { toolContextView } from '../runtime/tool-context-display';
  import { t } from '../runtime/i18n';

  let { row }: { row: RecordData } = $props();
  const id = $props.id();
  let context = $derived(toolContextView(row));
</script>

<section class="detail-section tool-context" aria-labelledby={id}>
  <h3 {id}>{$t('Preceding tool call')}</h3>
  <p class="association">{$t(context.association)}</p>
  <p class="limit">
    {$t(
      'A preceding call is temporal context. It does not establish causation or change PID attribution.',
    )}
  </p>
  <p class="limit">
    {$t('Live tool correlation is unavailable. This section displays recorded metadata.')}
  </p>
  <dl>
    <div>
      <dt>{$t('Session binding')}</dt>
      <dd>{$t(context.binding)}</dd>
    </div>
    <div>
      <dt>{$t('Object comparison')}</dt>
      <dd>{$t(context.object)}</dd>
    </div>
    <div>
      <dt>{$t('Recorded candidate count')}</dt>
      <dd>{context.count === null ? $t('Unavailable') : context.count}</dd>
    </div>
  </dl>
  {#if context.ambiguous}<p class="context-warning">
      {$t('Multiple candidates; no single tool call is established.')}
    </p>{/if}
  {#if context.truncated}<p class="context-warning">
      {$t('Candidate list is truncated; additional context is unavailable.')}
    </p>{/if}
  {#if context.reasons.length}
    <ul class="reasons">
      {#each context.reasons as reason (reason)}<li>{$t(reason)}</li>{/each}
    </ul>
  {/if}
  {#if context.candidates.length}
    <ol class="candidates" aria-label={$t('Recorded tool candidates')}>
      {#each context.candidates as candidate (candidate.key)}
        <li>
          <div class="candidate-heading">
            <strong>{candidate.provider} · {candidate.tool}</strong><span
              >{$t(candidate.association)}</span
            >
          </div>
          <p>{$t(candidate.relation)} · {candidate.timing}</p>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .tool-context {
    color: var(--ink);
  }
  .association {
    margin: 0 0 var(--space-2);
    font-weight: 600;
  }
  .limit,
  dt,
  .candidate-heading span {
    color: var(--muted);
  }
  .limit,
  .context-warning,
  .reasons,
  .candidates p {
    font: var(--text-body)/1.5 var(--sans);
  }
  .limit {
    margin: 0 0 var(--space-3);
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--space-3);
    margin: 0;
  }
  dt {
    font-size: var(--text-caption);
  }
  dd {
    margin: var(--space-1) 0 0;
    overflow-wrap: anywhere;
  }
  .context-warning {
    color: var(--amber);
    margin: var(--space-3) 0 0;
  }
  .reasons {
    padding-inline-start: var(--space-5);
    margin: var(--space-3) 0 0;
  }
  .candidates {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
  }
  .candidates li {
    border-top: 1px solid var(--border);
    padding: var(--space-3) 0 0;
    margin-top: var(--space-3);
  }
  .candidate-heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .candidate-heading strong,
  .candidate-heading span {
    overflow-wrap: anywhere;
  }
  .candidates p {
    margin: var(--space-2) 0 0;
    font-variant-numeric: tabular-nums;
  }
</style>
