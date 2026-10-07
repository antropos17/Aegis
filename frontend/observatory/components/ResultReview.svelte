<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { invoke, record, type Host } from '../runtime/host';
  import { t } from '../runtime/i18n';
  import {
    importedResultReview,
    resultReviewError,
    type ImportedResultReview,
  } from '../runtime/result-review';
  import Icon from './Icon.svelte';
  import ResultReviewChanges from './ResultReviewChanges.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const prefix = $props.id();
  let result = $state.raw<ImportedResultReview | null>(null);
  let displayExpired = $state(false);
  let pending = $state(false),
    feedback = $state(''),
    error = $state('');
  let pendingAction = $state('');
  let importButton: HTMLButtonElement | undefined;
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  const available = $derived(typeof host?.localSecurityReview === 'function');
  const changes = $derived(result?.comparison.changes ?? []);
  const captureKey = $derived(JSON.stringify(result));
  async function run(action: 'review-result' | 'result-status' | 'clear-result') {
    if (pending || !available || (action !== 'review-result' && (!result || preview))) return;
    const requestedId = result?.id;
    pending = true;
    pendingAction = action;
    feedback = '';
    error = '';
    try {
      const request = action === 'review-result' ? { action } : { action, id: requestedId };
      const reply = record(await invoke(host, 'localSecurityReview', request));
      if (!alive) return;
      if (reply.cancelled === true) {
        feedback = 'Cancelled. Previous results are retained.';
        return;
      }
      if (reply.success !== true) {
        if (
          action !== 'review-result' &&
          reply.error === 'result-review-expired' &&
          requestedId === result?.id
        )
          displayExpired = true;
        error = resultReviewError(reply.error);
        return;
      }
      if (action === 'clear-result') {
        if (reply.cleared !== true || reply.id !== requestedId || result?.id !== requestedId) {
          error = resultReviewError(null);
          return;
        }
        result = null;
        displayExpired = false;
        feedback =
          'Retained comparison cleared from this window. The imported file and project were not changed.';
        pending = false;
        await tick();
        if (alive && importButton && !importButton.closest('[hidden]')) importButton.focus();
        return;
      }
      const next = importedResultReview(reply.result);
      if (!next || (action === 'result-status' && next.id !== requestedId)) {
        error = resultReviewError(null);
        return;
      }
      result = next;
      displayExpired = false;
      feedback = preview
        ? 'Simulated comparison loaded. No files were read.'
        : 'Imported comparison retained. Original files were not checked.';
    } catch {
      if (alive) error = resultReviewError(null);
    } finally {
      if (alive) {
        pending = false;
        pendingAction = '';
      }
    }
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
  <div class="actions import-actions">
    <button
      bind:this={importButton}
      data-result-import
      class="button primary"
      disabled={pending || !available}
      aria-busy={pendingAction === 'review-result'}
      onclick={() => run('review-result')}
      ><Icon name={preview ? 'play' : 'file'} />{$t(
        preview ? 'Show example comparison' : 'Choose result and compare',
      )}</button
    >
  </div>
  <div class="feedback" role="status" aria-live="polite" aria-atomic="true">
    {$t(
      pending
        ? pendingAction === 'clear-result'
          ? 'Clearing the retained comparison…'
          : pendingAction === 'result-status'
            ? 'Refreshing retained metadata…'
            : 'Reading the selected comparison…'
        : feedback,
    )}
  </div>
  <div role={error ? 'alert' : undefined} aria-live="assertive" aria-atomic="true">{$t(error)}</div>
  {#if !available}<p class="muted">
      {$t('Result comparison is unavailable in this runtime. Open the current AEGIS desktop app.')}
    </p>{/if}
  {#if result}
    <p class="notice">
      {$t(
        result.comparison.complete
          ? 'Inspect the captured changes, then read Coverage before using the returned files.'
          : 'This capture is incomplete. Read Coverage; additions, edits and deletions cannot be verified.',
      )}
    </p>
    <div class="comparison-layout">
      <section class="comparison-changes" aria-labelledby={prefix + '-changes'}>
        <div class="section-title">
          <Icon name="history" />
          <h3 id={prefix + '-changes'}>{$t('Changes')} ({changes.length})</h3>
        </div>
        <ResultReviewChanges {changes} complete={result.comparison.complete} {captureKey} />
      </section>
      <section class="comparison-coverage" aria-labelledby={prefix + '-coverage'}>
        <div class="section-title">
          <Icon name="shield" />
          <h3 id={prefix + '-coverage'}>{$t('Coverage')}</h3>
        </div>
        <div class="actions retained-actions">
          <button
            class="button"
            disabled={pending || !available || preview}
            aria-busy={pendingAction === 'result-status'}
            onclick={() => run('result-status')}>{$t('Refresh retained comparison')}</button
          >
          <button
            class="button"
            disabled={pending || !available || preview}
            aria-busy={pendingAction === 'clear-result'}
            onclick={() => run('clear-result')}>{$t('Clear retained comparison')}</button
          >
        </div>
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
            <dd>
              {$t(
                displayExpired
                  ? 'Display retained · desktop comparison unavailable'
                  : 'Retained for this window · unreviewed',
              )}
            </dd>
          </div>
          <div>
            <dt>{$t('Writer status')}</dt>
            <dd>{$t('Stop unconfirmed')}</dd>
          </div>
        </dl>
        <small
          >{$t('Captured at:')}
          <time datetime={result.createdAt}>{new Date(result.createdAt).toLocaleString()}</time
          ></small
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
        <div class="actions">
          <button class="button" disabled>{$t('Launch unavailable')}</button><button
            class="button"
            disabled>{$t('Project export unavailable')}</button
          >
        </div>
        <p class="muted">
          {$t(
            'Launch and project export require protection and current-original verification that this comparison does not provide.',
          )}
        </p>
      </section>
    </div>
  {:else}<p>{$t('No imported comparison yet.')}</p>
    <p class="muted">
      {$t(
        'Choose an AEGIS result bundle with before and after snapshots. A project folder or scanner report belongs in the local review above.',
      )}
    </p>{/if}
  {#if preview}<p class="muted">{$t('Preview · simulated comparison only.')}</p>{/if}
</section>

<style>
  .result-review {
    min-width: 0;
    padding: var(--panel-inset);
  }
  .title,
  .actions,
  .section-title {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  h2 {
    font-size: var(--text-section);
    margin: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-body);
  }
  .section-title {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--space-3);
  }
  .comparison-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(250px, 290px);
    align-items: start;
    gap: var(--space-4);
    margin-top: var(--space-4);
    min-width: 0;
  }
  .comparison-changes,
  .comparison-coverage {
    min-width: 0;
    padding: var(--panel-inset);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
  }
  .comparison-changes {
    container-type: inline-size;
  }
  @container (max-width: 380px) {
    .comparison-changes :global(.filters) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .comparison-coverage {
    background: var(--bg);
    border-color: var(--strong-border);
  }
  p {
    line-height: 1.6;
    margin: var(--space-3) 0;
  }
  .summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    margin: 0;
    padding: 0;
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
  .notice {
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
  }
  .primary {
    border-color: var(--strong-border);
    font-weight: 600;
  }
  button {
    min-height: var(--control-height);
    white-space: normal;
  }
  .actions {
    margin-top: var(--space-3);
  }
  .retained-actions {
    display: grid;
    margin-block: 0 var(--space-4);
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
  @media (max-width: 800px) {
    .comparison-layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
