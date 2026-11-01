<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';

  let { host }: { host: Host | null } = $props();
  let date = $state('');
  let pending = $state(false);
  let result = $state<'consistent' | 'inconsistent' | 'unavailable' | null>(null);
  let generation = 0;
  let alive = true;
  const id = $props.id();
  onDestroy(() => {
    alive = false;
    generation++;
  });

  function changeDate() {
    generation++;
    result = null;
  }

  async function review() {
    if (!date || pending) return;
    const selected = date;
    const ticket = ++generation;
    pending = true;
    result = null;
    try {
      const status = record(await invoke(host, 'reviewAuditIntegrity', selected)).status;
      if (alive && ticket === generation)
        result = status === 'consistent' || status === 'inconsistent' ? status : 'unavailable';
    } catch {
      if (alive && ticket === generation) result = 'unavailable';
    } finally {
      if (alive) pending = false;
    }
  }
</script>

<section class="panel integrity" aria-labelledby={id + '-title'}>
  <h2 id={id + '-title'}>{$t('Local audit chain check')}</h2>
  <p class="entity-note">{$t('Choose the local calendar date of one retained audit file.')}</p>
  <div class="controls">
    <label for={id + '-date'}>{$t('Audit date')}</label>
    <input id={id + '-date'} type="date" bind:value={date} oninput={changeDate} />
    <button class="button" disabled={!date || pending} aria-busy={pending} onclick={review}>
      {$t('Check local chain')}
    </button>
  </div>
  <p class="entity-note">
    {$t(
      'A consistent chain does not prove completeness or external authenticity. A rewritten chain, missing final records and unrecorded events may go undetected.',
    )}
  </p>
  {#if pending}<p role="status">{$t('Checking the selected audit file…')}</p>
  {:else if result === 'consistent'}<p role="status">
      {$t('Local chain consistent at check time.')}
    </p>
  {:else if result === 'inconsistent'}<p role="status">
      {$t('Local chain inconsistent. The cause is unknown.')}
    </p>
  {:else if result === 'unavailable'}<p role="status">
      {$t(
        'Local chain check unavailable. The file may be missing, changing, unreadable or outside the check limits.',
      )}
    </p>{/if}
</section>

<style>
  .integrity {
    margin-top: var(--space-3);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .integrity p {
    line-height: 1.5;
  }
</style>
