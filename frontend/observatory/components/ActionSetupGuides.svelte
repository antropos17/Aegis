<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../runtime/i18n';
  import { confirmed, invoke, type Host } from '../runtime/host';
  import { setupGuideUrl } from '../runtime/task-guide';

  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const prefix = $props.id();
  type GuideFile =
    | 'ACTION-DELETE-FILE.md'
    | 'ACTION-EXECUTION.md'
    | 'ACTION-APPCONTAINER.md'
    | 'MCP-STDIO-GATEWAY.md';
  const guides = [
    {
      file: 'ACTION-DELETE-FILE.md',
      label: 'Selected-file deletion setup',
      title: 'Delete one selected file',
      description:
        'Use the separate terminal-owned exact-file MCP route. The executable/catalog check does not assess it or establish automatic blocking or general coverage.',
      button: 'Open selected-file deletion guide',
      icon: 'trash',
    },
    {
      file: 'ACTION-EXECUTION.md',
      label: 'Protected Windows action setup',
      title: 'Control an allowed Windows action tree',
      description:
        'The separate Windows Job CLI route controls ordinary descendants after an exact allow. The configuration check does not assess this CLI route or verify blocking.',
      button: 'Open protected Windows action guide',
      icon: 'terminal',
    },
    {
      file: 'ACTION-APPCONTAINER.md',
      label: 'Windows AppContainer setup',
      title: 'Check a selected Windows AppContainer launch',
      description:
        'Select Windows AppContainer CLI to check selected files and executable metadata, this Windows runtime, current-process terminal and helper file presence. Recheck in the intended interactive terminal; launch and installed provider compatibility remain untested.',
      button: 'Open AppContainer guide',
      icon: 'shield',
    },
    {
      file: 'MCP-STDIO-GATEWAY.md',
      label: 'Stdio gateway setup',
      title: 'Third-party MCP server gateway',
      description:
        'The separate stdio gateway (--mcp-gateway-stdio) has its own setup and limits. Action control does not check gateway setup, a running gateway, or live coverage.',
      button: 'Open stdio gateway guide',
      icon: 'server',
    },
  ] as const;
  let guidePending = $state(false);
  let guideFeedback = $state('');
  let guideFailed = $state(false);
  let guideTarget = $state<GuideFile | null>(null);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });

  async function openGuide(file: GuideFile) {
    const url = setupGuideUrl(file);
    if (guidePending || preview || !host?.openExternalUrl || !url) return;
    guidePending = true;
    guideTarget = file;
    guideFeedback = '';
    guideFailed = false;
    try {
      confirmed(await invoke(host, 'openExternalUrl', url));
      if (alive) guideFeedback = 'Guide opened in your browser.';
    } catch {
      if (alive) {
        guideFailed = true;
        guideFeedback =
          'Could not open the guide. Try again when the desktop connection is available.';
      }
    } finally {
      if (alive) guidePending = false;
    }
  }
</script>

<section class="panel route-setup-guides" aria-labelledby={prefix + '-heading'}>
  <header class="guides-heading">
    <Icon name="book" />
    <h2 id={prefix + '-heading'}>{$t('Route setup guides')}</h2>
  </header>
  <div class="guide-grid">
    {#each guides as guide (guide.file)}
      <section class="guide-card" aria-label={$t(guide.label)}>
        <h3 class="guide-title"><Icon name={guide.icon} /><span>{$t(guide.title)}</span></h3>
        <div class="guide-body">
          <p>{$t(guide.description)}</p>
          <button
            type="button"
            class="button"
            disabled={guidePending || preview || !host?.openExternalUrl}
            onclick={() => openGuide(guide.file)}>{$t(guide.button)}</button
          >
          {#if guideTarget === guide.file}<p
              class="guide-feedback"
              role={guideFailed ? 'alert' : 'status'}
              aria-live="polite"
            >
              {$t(guideFeedback)}
            </p>{/if}
        </div>
      </section>
    {/each}
  </div>
  {#if preview}<p class="capability-note">
      {$t('External guides are disabled in this simulated preview.')}
    </p>{:else if !host?.openExternalUrl}<p class="capability-note">
      {$t('Opening guides requires the AEGIS desktop connection.')}
    </p>{/if}
</section>

<style>
  .route-setup-guides {
    container-type: inline-size;
    min-width: 0;
    padding: 0;
  }
  .guides-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--panel-inset);
    border-bottom: 1px solid var(--strong-border);
    border-radius: var(--surface-radius) var(--surface-radius) 0 0;
    background: var(--raised);
  }
  h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: 700;
  }
  .guide-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    padding: var(--panel-inset);
  }
  .guide-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--panel);
  }
  .guide-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--panel-inset);
    border-bottom: 1px solid var(--border);
    border-radius: var(--surface-radius) var(--surface-radius) 0 0;
    background: var(--raised);
    font-size: var(--text-body);
    font-weight: 700;
    line-height: 1.5;
  }
  .guides-heading :global(.icon),
  .guide-title :global(.icon) {
    flex-shrink: 0;
  }
  .guide-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: var(--space-3);
    padding: var(--panel-inset);
  }
  p {
    margin: 0;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  button {
    align-self: flex-start;
    margin-top: auto;
    min-height: var(--control-height);
    max-width: 100%;
    white-space: normal;
    text-align: left;
  }
  .guide-feedback[role='alert'] {
    color: var(--red);
  }
  .capability-note {
    padding: 0 var(--panel-inset) var(--panel-inset);
    color: var(--muted);
  }
  @container (max-width: 640px) {
    .guide-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
