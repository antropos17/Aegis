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
  let tab = $state('changes');
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
        tab = 'changes';
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
      if (next.id !== result?.id) tab = 'changes';
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
    {#if result}
      <button
        class="button"
        disabled={pending || !available || preview}
        onclick={() => run('result-status')}>{$t('Refresh retained comparison')}</button
      >
      <button
        class="button"
        disabled={pending || !available || preview}
        onclick={() => run('clear-result')}>{$t('Clear retained comparison')}</button
      >
    {/if}
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
      <time datetime={result.createdAt}>{new Date(result.createdAt).toLocaleString()}</time></small
    >
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
      <ResultReviewChanges {changes} complete={result.comparison.complete} {captureKey} />
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
