<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import {
    importedResultReview,
    resultReviewError,
    type ImportedResultReview,
  } from '../runtime/result-review';
  import Icon from './Icon.svelte';
  import ResultReviewEntry from './ResultReviewEntry.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const prefix = $props.id();
  let result = $state.raw<ImportedResultReview | null>(null);
  let pending = $state(false),
    feedback = $state(''),
    error = $state('');
  let tab = $state('changes'),
    page = $state(0);
  let selected = $state<string[]>([]);
  let acknowledgeDeletion = $state(false);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  const available = $derived(typeof host?.localSecurityReview === 'function');
  const changes = $derived(result?.comparison.changes ?? []);
  const pages = $derived(Math.max(1, Math.ceil(changes.length / 20)));
  const rows = $derived(changes.slice(page * 20, (page + 1) * 20));
  const deletionSelected = $derived(
    changes.some((change) => change.type === 'deletion' && selected.includes(change.id)),
  );
  function select(id: string, checked: boolean) {
    selected = checked ? [...selected, id] : selected.filter((item) => item !== id);
    acknowledgeDeletion = false;
  }
  async function run(action: 'review-result' | 'result-status') {
    if (pending || !available || (action === 'result-status' && !result)) return;
    pending = true;
    feedback = '';
    error = '';
    try {
      const request = action === 'review-result' ? { action } : { action, id: result?.id };
      const reply = record(await invoke(host, 'localSecurityReview', request));
      if (!alive) return;
      if (reply.cancelled === true) {
        feedback = 'Cancelled. Previous results are retained.';
        return;
      }
      if (reply.success !== true) {
        error = resultReviewError(reply.error);
        return;
      }
      const next = importedResultReview(reply.result);
      if (!next) {
        error = resultReviewError(null);
        return;
      }
      if (next.id !== result?.id) {
        selected = [];
        acknowledgeDeletion = false;
        page = 0;
      }
      result = next;
      feedback = preview
        ? 'Simulated comparison loaded. No files were read.'
        : 'Imported comparison retained. Original files were not checked.';
    } catch {
      if (alive) error = resultReviewError(null);
    } finally {
      if (alive) pending = false;
    }
  }
  function switchTab(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    tab =
      event.key === 'Home'
        ? 'changes'
        : event.key === 'End'
          ? 'coverage'
          : tab === 'changes'
            ? 'coverage'
            : 'changes';
    document.getElementById(prefix + '-' + tab)?.focus();
  }
</script>

<section class="panel result-review" aria-label={$t('Imported result comparison')}>
  <div class="title">
    <Icon name="file" />
    <h2>{$t('Imported result comparison')}</h2>
  </div>
  <p class="muted">
    {$t('Compare a returned artifact without running its code or writing to your project.')}
  </p>
  {#if result}
    <dl class="summary">
      <div>
        <dt>{$t('Capture source')}</dt>
        <dd>{$t(preview ? 'Simulated imported artifact' : 'Imported artifact')}</dd>
      </div>
      <div>
        <dt>{$t('Original-state confidence')}</dt>
        <dd>
          {$t(
            result.comparison.complete
              ? 'Complete imported snapshots · originals unverified'
              : 'Incomplete snapshots · changes unknown',
          )}
        </dd>
      </div>
      <div>
        <dt>{$t('Retained status')}</dt>
        <dd>{$t('Retained for this window · unreviewed')}</dd>
      </div>
      <div>
        <dt>{$t('Writer status')}</dt>
        <dd>{$t('Stop unconfirmed')}</dd>
      </div>
    </dl>
    <small>{$t('Captured at:')} {result.createdAt}</small>
    <div class="tabs section-tabs" role="tablist" aria-label={$t('Comparison sections')}>
      <button
        class="button"
        id={prefix + '-changes'}
        role="tab"
        aria-selected={tab === 'changes'}
        aria-controls={prefix + '-changes-panel'}
        tabindex={tab === 'changes' ? 0 : -1}
        onkeydown={switchTab}
        onclick={() => (tab = 'changes')}>{$t('Changes')} ({changes.length})</button
      >
      <button
        class="button"
        id={prefix + '-coverage'}
        role="tab"
        aria-selected={tab === 'coverage'}
        aria-controls={prefix + '-coverage-panel'}
        tabindex={tab === 'coverage' ? 0 : -1}
        onkeydown={switchTab}
        onclick={() => (tab = 'coverage')}>{$t('Coverage')}</button
      >
    </div>
    <div
      role="tabpanel"
      id={prefix + '-changes-panel'}
      aria-labelledby={prefix + '-changes'}
      hidden={tab !== 'changes'}
    >
      {#if !changes.length}<p>
          {$t(
            result.comparison.complete
              ? 'No differing content in the imported snapshots.'
              : 'Changes cannot be determined from incomplete snapshots.',
          )}
        </p>{/if}
      {#each rows as change (change.id)}
        <ResultReviewEntry
          {change}
          selected={selected.includes(change.id)}
          onselect={(checked) => select(change.id, checked)}
        />
      {/each}
      {#if pages > 1}<div class="actions">
          <button
            class="button"
            aria-disabled={page === 0}
            onclick={() => {
              if (page > 0) page--;
            }}>{$t('Previous')}</button
          ><span>{page + 1} / {pages}</span><button
            class="button"
            aria-disabled={page + 1 === pages}
            onclick={() => {
              if (page + 1 < pages) page++;
            }}>{$t('Next')}</button
          >
        </div>{/if}
      {#if deletionSelected}<label class="ack"
          ><input type="checkbox" bind:checked={acknowledgeDeletion} />{$t(
            'I explicitly reviewed the selected deletions.',
          )}</label
        >{/if}
      <p class="muted">
        {$t('Selection is a review draft. It does not authorize project writes.')}
      </p>
    </div>
    <div
      role="tabpanel"
      id={prefix + '-coverage-panel'}
      aria-labelledby={prefix + '-coverage'}
      hidden={tab !== 'coverage'}
    >
      <p>
        {$t(
          'Imported stop, acceptance and boundary claims are untrusted. No writer termination or protected boundary was observed.',
        )}
      </p>
      <p>
        {$t(
          'Current original bytes, hostile filesystem swaps, guest return authenticity and power-loss recovery were not checked.',
        )}
      </p>
      <details>
        <summary>{$t('Comparison digests')}</summary>
        <dl class="digests">
          <dt>{$t('Baseline digest')}</dt>
          <dd>{result.comparison.baselineDigest}</dd>
          <dt>{$t('Result digest')}</dt>
          <dd>{result.comparison.snapshotDigest}</dd>
        </dl>
      </details>
    </div>
    <div class="actions">
      <button
        class="button"
        disabled={pending || !available || preview}
        onclick={() => run('result-status')}>{$t('Refresh retained comparison')}</button
      ><button class="button" disabled>{$t('Launch unavailable')}</button><button
        class="button"
        disabled>{$t('Project export unavailable')}</button
      >
    </div>
    <p class="muted">
      {$t(
        'Launch and project export require protection and current-original verification that this comparison does not provide.',
      )}
    </p>
  {:else}<p>{$t('No imported comparison yet.')}</p>{/if}
  {#if preview}<p class="muted">{$t('Preview · simulated comparison only.')}</p>{/if}
  <div class="actions">
    <button
      class="button"
      disabled={pending || !available}
      aria-busy={pending}
      onclick={() => run('review-result')}
      ><Icon name={preview ? 'play' : 'file'} />{$t(
        preview ? 'Show example comparison' : 'Choose result and compare',
      )}</button
    >
  </div>
  <div class="feedback" aria-live="polite" aria-atomic="true">
    {#if error}<p role="alert">{$t(error)}</p>{:else}<p role="status">
        {$t(pending ? 'Reading the selected comparison…' : feedback)}
      </p>{/if}
  </div>
</section>

<style>
  .result-review {
    min-width: 0;
    padding: var(--panel-inset);
  }
  .title,
  .actions,
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  h2 {
    font-size: var(--text-section);
    margin: 0;
  }
  p {
    line-height: 1.6;
    margin: var(--space-3) 0;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  dt,
  small,
  .muted {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  dd {
    margin: var(--space-2) 0 0;
    overflow-wrap: anywhere;
  }
  .tabs {
    margin: var(--space-4) 0;
  }
  .ack {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-2);
  }
  .actions {
    margin-top: var(--space-3);
  }
  .digests {
    max-width: 100%;
  }
  .feedback {
    min-height: 1.8em;
    font-size: var(--text-caption);
  }
  [role='alert'] {
    color: var(--red);
  }
  @media (max-width: 980px) {
    .summary {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
