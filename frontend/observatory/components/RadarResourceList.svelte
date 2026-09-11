<script lang="ts">
  import { t } from '../runtime/i18n';

  import type { RadarResource } from '../runtime/radar-resources';
  import Icon from './Icon.svelte';
  import ResourceIcon from './ResourceIcon.svelte';
  import { resourceVisual } from '../runtime/resource-visual';
  let {
    resources,
    layer,
    selected,
    select,
    ready,
  }: {
    resources: RadarResource[];
    layer: string;
    selected?: string;
    select: (_resource: RadarResource, _button: HTMLButtonElement) => void;
    ready: boolean;
  } = $props();
  let page = $state(0);
  const pages = $derived(Math.max(1, Math.ceil(resources.length / 6)));
  const index = $derived(Math.min(page, pages - 1));
  const visible = $derived(resources.slice(index * 6, index * 6 + 6));
  const labels = { review: 'Review', unverified: 'Unverified', observed: 'No risk flag' };
  // Parent keys this list by the user filters, so new telemetry never resets pagination.
</script>

<section
  class="resource-catalog"
  aria-label={layer === 'files' ? $t('Observed files') : $t('Observed destinations')}
>
  <div class="catalog-pages">
    <span
      >{resources.length ? `${index * 6 + 1}–${Math.min(resources.length, index * 6 + 6)}` : '0'}
      {$t('of')}
      {resources.length}</span
    >
    <nav aria-label={$t('Resource pages')}>
      <button
        class="button"
        aria-label={$t('Previous radar resources')}
        aria-disabled={index === 0}
        onclick={() => {
          if (index > 0) page = index - 1;
        }}><Icon name="arrowLeft" /></button
      ><button
        class="button"
        aria-label={$t('Next radar resources')}
        aria-disabled={index === pages - 1}
        onclick={() => {
          if (index < pages - 1) page = index + 1;
        }}><Icon name="chevron" /></button
      >
    </nav>
  </div>
  {#each visible as resource (resource.key)}
    {@const actors = [
      ...new Set(resource.relations.map((relation) => relation.actor || 'Agent not identified')),
    ]}
    <button
      class="resource-choice"
      aria-label={$t('Inspect {value0}', { value0: resource.address })}
      aria-pressed={selected === resource.key}
      onclick={(event) => select(resource, event.currentTarget)}
    >
      <span class="choice-heading"
        ><ResourceIcon row={resource.rows[0]} /><strong>{resource.label}</strong><span
          class="resource-level"
          class:review={resource.level === 'review'}
          >{resource.sensitive ? $t('Sensitive') : labels[resource.level]}</span
        ></span
      >
      {#if layer === 'files'}<span class="resource-path">{resource.address}</span>{/if}
      {#if resource.ip && !resource.address.includes(resource.ip)}<span class="ip"
          >{resource.ip}</span
        >{/if}
      <span class="resource-actors"
        >{actors.slice(0, 2).join(', ')}{actors.length > 2 ? ` +${actors.length - 2}` : ''}</span
      >
      <span class="record-count"
        >{$t(resourceVisual(resource.rows[0]).label)} · {resource.rows.length}
        {$t('record(s) ·')}
        {resource.relations.length}
        {$t('relationships')}</span
      >
    </button>
  {:else}<div class="resource-empty" role="status">
      <Icon name={layer === 'files' ? 'folder' : 'network'} /><strong
        >{ready ? $t('No matching observations') : $t('Waiting for a reliable scan')}</strong
      >
      <p>
        {ready
          ? $t(
              'Try another agent or filter. An empty list does not establish that no activity occurred.',
            )
          : $t('Resources appear when observations are available.')}
      </p>
    </div>{/each}
</section>

<style>
  .resource-catalog {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    overflow: hidden;
    background: var(--panel);
  }
  .catalog-pages,
  nav {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
  }
  .catalog-pages {
    justify-content: space-between;
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-caption);
    color: var(--muted);
  }
  .resource-choice {
    display: block;
    width: 100%;
    padding: var(--space-4);
    background: transparent;
    color: var(--ink);
    border: 0;
    border-bottom: 1px solid var(--border);
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: var(--text-body);
    line-height: 1.55;
  }
  .resource-choice:last-child {
    border-bottom: 0;
  }
  .resource-choice:hover,
  .resource-choice[aria-pressed='true'] {
    background: var(--bg);
  }
  .resource-choice[aria-pressed='true'] {
    box-shadow: inset 3px 0 var(--ink);
  }
  .choice-heading {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .choice-heading strong {
    overflow-wrap: anywhere;
    min-width: 0;
    flex: 1;
    font-size: var(--text-section);
  }
  .choice-heading :global(svg) {
    flex: none;
  }
  .resource-level {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .resource-level.review {
    color: var(--amber);
  }
  .resource-path {
    overflow-wrap: anywhere;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--muted);
  }
  .ip,
  .resource-actors,
  .record-count {
    display: block;
    overflow-wrap: anywhere;
  }
  .resource-actors {
    margin-top: var(--space-2);
  }
  .record-count,
  .ip {
    font-size: var(--text-caption);
    color: var(--muted);
  }
  .resource-empty {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-5);
    color: var(--muted);
    font-size: var(--text-body);
    line-height: 1.6;
  }
  .resource-empty p {
    margin: 0;
  }
</style>
