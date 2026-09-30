<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { ResultReviewChange, ResultReviewPreview } from '../../../src/shared/types';
  let {
    change,
    selected,
    onselect,
  }: { change: ResultReviewChange; selected: boolean; onselect: (_checked: boolean) => void } =
    $props();
  const stateLabel = (preview: ResultReviewPreview) =>
    preview.state === 'absent'
      ? 'Absent from complete snapshot'
      : preview.state === 'incomplete'
        ? 'Not captured · incomplete snapshot'
        : preview.state === 'binary'
          ? 'Binary content · no text preview'
          : preview.state === 'truncated'
            ? 'Text preview truncated'
            : 'Captured text preview';
  const parts = $derived([
    {
      label: 'Before',
      preview: change.beforePreview,
      bytes: change.beforeBytes,
      hash: change.beforeSha256,
    },
    {
      label: 'After',
      preview: change.afterPreview,
      bytes: change.afterBytes,
      hash: change.afterSha256,
    },
  ]);
</script>

<div class="change-entry">
  <label class="selection"
    ><input
      type="checkbox"
      checked={selected}
      onchange={(event) => onselect(event.currentTarget.checked)}
    />
    <span
      ><strong>{change.path}</strong><small
        >{$t(
          change.type === 'addition'
            ? 'Addition'
            : change.type === 'deletion'
              ? 'Deletion'
              : change.type === 'edit'
                ? 'Edit'
                : 'Unknown change',
        )}</small
      ></span
    >
  </label>
  <details>
    <summary>{$t('Inspect captured content')}</summary>
    <p class="muted">
      {$t('Read-only captured bytes. Control characters appear as visible U+ labels.')}
    </p>
    <div class="previews">
      {#each parts as part (part.label)}<section aria-label={$t(part.label)}>
          <h3>{$t(part.label)}</h3>
          <p class="muted">{$t(stateLabel(part.preview))}</p>
          {#if part.preview.text !== null}<pre>{part.preview.text}</pre>{/if}
          <details class="metadata">
            <summary>{$t('Full bytes and SHA-256')}</summary>
            <dl>
              <dt>{$t('Full byte count')}</dt>
              <dd>{part.bytes === null ? $t('Not captured') : part.bytes}</dd>
              <dt>SHA-256</dt>
              <dd>{part.hash ?? $t('Not captured')}</dd>
            </dl>
          </details>
        </section>{/each}
    </div>
  </details>
</div>

<style>
  .change-entry {
    padding-block: var(--space-3);
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .selection {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .selection span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    margin-top: var(--space-2);
  }
  small,
  dt,
  .muted {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  summary {
    margin-top: var(--space-2);
    cursor: pointer;
  }
  .previews {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  h3 {
    font-size: var(--text-body);
    margin: var(--space-3) 0;
  }
  dd {
    margin: var(--space-2) 0;
    overflow-wrap: anywhere;
  }
  pre {
    max-block-size: 16em;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--text-caption);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
  }
  @media (max-width: 980px) {
    .previews {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
