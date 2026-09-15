<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
  import {
    localReview,
    reviewError,
    reviewModes,
    reviewAdapters,
    reportFormats,
    type LocalReview,
  } from '../runtime/local-security';
  import Icon from './Icon.svelte';
  import LocalSecurityResults from './LocalSecurityResults.svelte';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const prefix = $props.id();
  let mode = $state('scan');
  let adapter = $state('project');
  let tools = $state(false);
  let baseline = $state(false);
  let format = $state('cisco-skill-json');
  let pending = $state(false);
  let error = $state('');
  let feedback = $state('');
  let result = $state.raw<LocalReview | null>(null);
  let savedAcceptance = $state(false);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  const available = $derived(typeof host?.localSecurityReview === 'function');
  const adapters = $derived(
    reviewAdapters.filter((item) => item.id !== 'package' || ['scan', 'import'].includes(mode)),
  );
  function changeMode() {
    if (adapter === 'package' && !['scan', 'import'].includes(mode)) adapter = 'project';
  }
  async function run(action: 'run' | 'export' | 'save-snapshot' | 'accept' = 'run') {
    if (pending || !available) return;
    pending = true;
    error = '';
    feedback = '';
    try {
      const request =
        action === 'run'
          ? {
              action,
              mode,
              adapter,
              tools: mode !== 'import' && tools,
              baseline: mode === 'import' && baseline,
              ...(mode === 'import' ? { format } : {}),
            }
          : {
              action,
              id: result?.id,
              ...(action === 'accept' ? { digest: result?.snapshot?.digest } : {}),
            };
      const reply = record(await invoke(host, 'localSecurityReview', request));
      if (!alive) return;
      if (reply.cancelled === true) {
        feedback = 'Cancelled. Previous results are retained.';
        return;
      }
      if (reply.success !== true) {
        error = reviewError(reply.error);
        return;
      }
      if (action === 'run') {
        const next = localReview(reply.review);
        if (!next) {
          error = reviewError(null);
          return;
        }
        result = next;
        savedAcceptance = false;
        feedback = preview
          ? 'Simulated review loaded. No files were read.'
          : 'Local review completed. Review the results and coverage.';
      } else {
        if (reply.saved !== true || (action === 'accept' && reply.accepted !== true)) {
          error = reviewError(null);
          return;
        }
        savedAcceptance ||= action === 'accept';
        feedback =
          action === 'accept'
            ? 'Content rechecked. A separate accepted snapshot was saved.'
            : 'A new JSON file was saved.';
      }
    } catch {
      if (alive) error = reviewError(null);
    } finally {
      if (alive) pending = false;
    }
  }
</script>

<div class="local-security-workspace">
  <section class="panel review-setup" aria-label={$t('Local review setup')}>
    <div class="setup-title">
      <Icon name="shield" />
      <div>
        <h2>{$t('Review agent files before use')}</h2>
        <p class="muted">
          {$t(
            'Runs locally. No code execution, server connections or uploads. Findings and coverage gaps remain available for your review.',
          )}
        </p>
      </div>
    </div>
    {#if preview}<p class="preview-note">
        {$t(
          'Preview · simulated results only. File selection, exports and acceptance require the desktop app.',
        )}
      </p>{:else if !available}<p role="status">
        {$t('Local review is unavailable in this runtime. Open the current AEGIS desktop app.')}
      </p>{/if}
    <div class="review-fields">
      <div class="field">
        <label for={prefix + '-mode'}>{$t('Review type')}</label><select
          id={prefix + '-mode'}
          bind:value={mode}
          onchange={changeMode}
          disabled={pending}
          aria-describedby={prefix + '-mode-help'}
          >{#each reviewModes as item (item.id)}<option value={item.id}>{$t(item.label)}</option
            >{/each}</select
        >
        <small id={prefix + '-mode-help'}
          >{$t(reviewModes.find((item) => item.id === mode)?.description ?? '')}</small
        >
      </div>
      <div class="field">
        <label for={prefix + '-adapter'}>{$t('Directory layout')}</label><select
          id={prefix + '-adapter'}
          bind:value={adapter}
          disabled={pending}
          aria-describedby={prefix + '-adapter-help'}
          >{#each adapters as item (item.id)}<option value={item.id}>{$t(item.label)}</option
            >{/each}</select
        >
        <small id={prefix + '-adapter-help'}
          >{$t(reviewAdapters.find((item) => item.id === adapter)?.hint ?? '')}</small
        >
      </div>
    </div>
    {#if mode === 'import'}<div class="review-fields">
        <div class="field">
          <label for={prefix + '-format'}>{$t('Report format')}</label><select
            id={prefix + '-format'}
            bind:value={format}
            disabled={pending}
            >{#each reportFormats as [id, label] (id)}<option value={id}>{label}</option
              >{/each}</select
          >
        </div>
        <label class="check"
          ><input type="checkbox" bind:checked={baseline} disabled={pending} />{$t(
            'Compare with a previous AEGIS static report',
          )}</label
        >
      </div>{:else}<label class="check"
        ><input type="checkbox" bind:checked={tools} disabled={pending} />{$t(
          'Include an offline MCP tools/list file',
        )}</label
      >{/if}
    <div class="run-row">
      <button
        class="button primary"
        disabled={pending || !available}
        aria-busy={pending}
        onclick={() => run()}
        ><Icon name={preview ? 'play' : 'folder'} />{$t(
          preview ? 'Show example result' : 'Choose folder and review',
        )}</button
      >
      <span class="muted"
        >{$t(
          mode === 'compare'
            ? 'You will also choose the inventory snapshot to compare.'
            : mode === 'import'
              ? 'You will also choose the external report. No scanner is launched.'
              : tools
                ? 'You will also choose the MCP export. No server is contacted.'
                : 'Only the selected directory is reviewed.',
        )}</span
      >
    </div>
    <div class="review-feedback" aria-live="polite" aria-atomic="true">
      {#if error}<p role="alert">{$t(error)}</p>{:else}<p role="status">
          {$t(
            pending
              ? 'Choose the requested files, then wait for the bounded local review…'
              : feedback,
          )}
        </p>{/if}
    </div>
  </section>
  {#if result}{#key result.id}<LocalSecurityResults
        review={result}
        {pending}
        {preview}
        {savedAcceptance}
        action={run}
      />{/key}
  {:else}<section class="panel review-empty">
      <Icon name="file" />
      <h2>{$t('No local review yet')}</h2>
      <p>
        {$t(
          'Choose a review type and directory layout, then select the folder. Findings, file fingerprints, package evidence and coverage appear here.',
        )}
      </p>
      <div class="capabilities">
        <span>{$t('Commands & scripts')}</span><span>{$t('Hooks & MCP configuration')}</span><span
          >{$t('Instruction patterns')}</span
        ><span>{$t('Content changes')}</span>
      </div>
      <small>{$t('Observation and review do not enable automatic access blocking.')}</small>
    </section>{/if}
</div>

<style>
  .local-security-workspace {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .review-setup,
  .review-empty {
    padding: var(--panel-inset);
  }
  .setup-title {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  h2 {
    font-size: var(--text-section);
    margin: 0;
  }
  p {
    line-height: 1.6;
    margin: var(--space-2) 0;
  }
  .review-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: var(--space-4) 0;
  }
  label,
  .field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  small {
    color: var(--muted);
    line-height: 1.5;
    font-size: var(--text-caption);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .check input {
    flex-shrink: 0;
  }
  .run-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-top: var(--space-4);
  }
  .run-row > span {
    flex: 1;
    min-width: min(100%, 200px);
    font-size: var(--text-caption);
  }
  .primary {
    border-color: var(--strong-border);
    font-weight: 600;
  }
  .review-feedback {
    min-height: 1.8em;
    font-size: var(--text-caption);
  }
  .review-feedback p {
    margin-bottom: 0;
  }
  [role='alert'] {
    color: var(--red);
  }
  .review-empty {
    text-align: center;
    padding-block: var(--space-5);
  }
  .review-empty h2 {
    margin-top: var(--space-3);
  }
  .review-empty p {
    max-width: 70ch;
    margin-inline: auto;
    color: var(--muted);
  }
  .capabilities {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-4) 0;
  }
  .capabilities span {
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: var(--space-2);
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .preview-note {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
  }
  @media (max-width: 980px) {
    .review-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
