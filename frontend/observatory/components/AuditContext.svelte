<script lang="ts">
  import { t } from '../runtime/i18n';
  import Icon from './Icon.svelte';
  let {
    section,
    select,
  }: { section: string; select: (_section: 'entries' | 'delivery') => void | Promise<void> } =
    $props();
  const id = $props.id();
</script>

<section class="panel audit-context" aria-labelledby={id + '-title'}>
  <div>
    <h2 id={id + '-title'}>{$t('Audit history and delivery')}</h2>
    <p>
      {$t(
        'Review retained activity in Entries. Check saved, queued and dropped record counts in Delivery.',
      )}
    </p>
  </div>
  <button
    class="button"
    aria-controls={'audit-panel-' + (section === 'entries' ? 'delivery' : 'entries')}
    onclick={() => select(section === 'entries' ? 'delivery' : 'entries')}
  >
    <Icon name={section === 'entries' ? 'shield' : 'history'} />
    {$t(section === 'entries' ? 'Check delivery counters' : 'Review retained entries')}
  </button>
</section>

<style>
  .audit-context {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--panel-inset);
    margin-bottom: var(--space-3);
  }
  .audit-context > div {
    min-width: 0;
    flex: 1 1 280px;
  }
  .audit-context h2 {
    margin: 0;
    font-size: var(--text-section);
  }
  .audit-context p {
    margin: var(--space-1) 0 0;
    color: var(--muted);
    font-size: var(--text-body);
    line-height: 1.5;
  }
  .audit-context button {
    white-space: normal;
    text-align: left;
  }
</style>
