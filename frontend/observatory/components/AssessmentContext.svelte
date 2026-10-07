<script lang="ts">
  import { t } from '../runtime/i18n';
  import { record, type RecordData } from '../runtime/host';
  import Icon from './Icon.svelte';
  let {
    report,
    contextId,
    openEvidence,
  }: { report: RecordData; contextId: string; openEvidence: () => void | Promise<void> } = $props();
  const countFields = [
    ['totalFiles', 'File observations'],
    ['totalSensitive', 'Sensitive observations'],
    ['totalAgents', 'Agent products'],
    ['totalNet', 'Connections'],
  ];
  function strings(value: unknown) {
    return Array.isArray(value) ? value.map(String) : [];
  }
</script>

<section class="assessment-context" aria-labelledby={contextId + '-context'}>
  <div class="assessment-context-head">
    <h3 id={contextId + '-context'}>{$t('Assessment context')}</h3>
    <button class="button" aria-controls={contextId + '-evidence'} onclick={openEvidence}
      ><Icon name="file" />{$t('View recorded evidence')}</button
    >
  </div>
  <p class="assessment-source">
    {$t(String(report.countsSource))} · {$t('Recorded for this assessment')}
  </p>
  <dl class="assessment-counts">
    {#each countFields as [key, label] (key)}
      {@const value = record(report.counts)[key]}
      <div>
        <dt>{$t(label)}</dt>
        <dd>
          {typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : '—'}
        </dd>
      </div>
    {/each}
  </dl>
  <div class="assessment-next-check">
    <strong>{$t('First recommended check')}</strong>
    <p>{strings(report.recommendations)[0] ?? $t('No recommendations returned.')}</p>
  </div>
</section>

<style>
  .assessment-context {
    margin-top: var(--space-4);
    padding: var(--panel-inset);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    overflow-wrap: anywhere;
  }
  .assessment-context-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .assessment-context-head h3 {
    margin: 0;
    font-size: var(--text-body);
  }
  .assessment-source,
  .assessment-counts dt {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .assessment-source {
    margin: var(--space-2) 0;
  }
  .assessment-counts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
    margin: var(--space-3) 0;
  }
  .assessment-counts dd {
    flex: none;
    white-space: nowrap;
    margin: 0;
    font-size: var(--text-section);
    font-variant-numeric: tabular-nums;
  }
  .assessment-counts > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }
  .assessment-counts dt {
    min-width: 0;
  }
  @media (max-width: 980px) {
    .assessment-counts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .assessment-next-check {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
    font-size: var(--text-body);
  }
  .assessment-next-check p {
    margin: var(--space-1) 0 0;
    color: var(--muted);
  }
</style>
