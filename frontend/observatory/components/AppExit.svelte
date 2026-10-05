<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
  import Icon from './Icon.svelte';

  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const feedbackId = $props.id();
  let pending = $state(false);
  let feedback = $state('');
  let alive = true;
  let available = $derived(!preview && typeof host?.quitApp === 'function');
  onDestroy(() => (alive = false));

  async function quit() {
    if (!available || pending) return;
    pending = true;
    feedback = '';
    try {
      const result = record(await invoke(host, 'quitApp'));
      if (!alive) return;
      if (result.success === true) return;
      feedback = result.cancelled === true ? 'Exit cancelled.' : 'AEGIS could not quit. Try again.';
    } catch {
      if (alive) feedback = 'AEGIS could not quit. Try again.';
    }
    if (alive) pending = false;
  }
</script>

<div class="app-exit">
  <button
    class="button"
    disabled={!available}
    aria-disabled={pending}
    aria-busy={pending}
    aria-describedby={feedbackId}
    title={$t('Stop monitoring and quit AEGIS')}
    onclick={quit}><Icon name="close" />{$t(pending ? 'Quitting…' : 'Quit AEGIS')}</button
  >
  <p class="exit-feedback" id={feedbackId} role="status">
    {$t(!available ? 'Available in the desktop app.' : feedback)}
  </p>
</div>

<style>
  .app-exit {
    min-width: 0;
    padding: 0 var(--space-2);
  }
  .button {
    width: 100%;
    justify-content: center;
  }
  .button[aria-disabled='true'] {
    cursor: wait;
  }
  .exit-feedback {
    min-height: 1.5em;
    margin: var(--space-1) 0 0;
    font-size: var(--text-caption);
    line-height: 1.5;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
</style>
