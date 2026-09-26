<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { confirmed, invoke, type Host } from '../runtime/host';
  import { guidedTasks, moreTasks, setupGuides, setupGuideUrl } from '../runtime/task-guide';
  import Icon from './Icon.svelte';

  let {
    host,
    preview = false,
    navigate,
  }: {
    host: Host | null;
    preview?: boolean;
    navigate: (_target: string) => void | Promise<void>;
  } = $props();
  let pending = $state(false);
  let feedback = $state('');
  let failed = $state(false);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  async function openGuide(file: string) {
    const url = setupGuideUrl(file);
    if (pending || preview || !url) return;
    pending = true;
    feedback = '';
    failed = false;
    try {
      confirmed(await invoke(host, 'openExternalUrl', url));
      if (alive) feedback = 'Guide opened in your browser.';
    } catch {
      if (alive) {
        failed = true;
        feedback = 'Could not open the guide. Try again when the desktop connection is available.';
      }
    } finally {
      if (alive) pending = false;
    }
  }
</script>

<section class="task-guide" aria-label={$t('Task guide')}>
  <div class="intro">
    <h2>{$t('What would you like to do?')}</h2>
    <p>{$t('Start with a task. You can return here at any time without losing an open review.')}</p>
  </div>
  <div class="primary-tasks">
    {#each guidedTasks as task (task.target)}
      <button class="task-card" onclick={() => navigate(task.target)}>
        <Icon name={task.icon} />
        <strong>{$t(task.title)}</strong>
        <span>{$t(task.description)}</span>
        <span class="open-task">{$t('Open workspace')} <Icon name="chevron" /></span>
      </button>
    {/each}
  </div>
  <p class="scope-note">
    {$t(
      'Monitoring shows observations. File reviews and action checks do not turn on automatic blocking.',
    )}
  </p>

  <section class="panel more-tasks" aria-labelledby="more-tasks-title">
    <h3 id="more-tasks-title">{$t('More you can do')}</h3>
    <div class="task-list">
      {#each moreTasks as task (task.target)}
        <button class="task-row" onclick={() => navigate(task.target)}>
          <Icon name={task.icon} />
          <span><strong>{$t(task.title)}</strong><small>{$t(task.description)}</small></span>
          <Icon name="chevron" />
        </button>
      {/each}
    </div>
  </section>

  <details class="panel setup">
    <summary
      ><span>{$t('Connect an agent to selected actions')}</span><small
        >{$t('Terminal setup required')}</small
      ></summary
    >
    <div class="setup-body">
      <p>
        {$t(
          'MCP lets an agent call tools exposed by AEGIS. These optional routes need separate setup in a terminal and in your agent client.',
        )}
      </p>
      <p>
        {$t(
          'An action catalog lists executable actions; the agent catalog in the sidebar contains recognition signatures.',
        )}
      </p>
      <ol>
        {#each setupGuides as guide (guide.file)}
          <li>
            <strong>{$t(guide.title)}</strong>
            <p>{$t(guide.description)}</p>
            <button
              class="button"
              disabled={pending || preview || !host?.openExternalUrl}
              onclick={() => openGuide(guide.file)}
              >{$t('Open guide: {title}', { title: $t(guide.title) })}</button
            >
          </li>
        {/each}
      </ol>
      <p>
        {$t(
          'A configuration check does not establish a client connection or verify blocking. Actions outside the selected route are not covered by that check.',
        )}
      </p>
      <p class="muted">
        {$t(
          'Online guides describe the current source version, which may differ from your installed version.',
        )}
      </p>
      {#if preview}<p>
          {$t('External guides are disabled in this simulated preview.')}
        </p>{:else if !host?.openExternalUrl}<p>
          {$t('Opening guides requires the AEGIS desktop connection.')}
        </p>{/if}
      <p role={failed ? 'alert' : 'status'} aria-live="polite">{$t(feedback)}</p>
    </div>
  </details>
  <p class="tip">{$t('Tip: use Commands or Ctrl K to find a task, workspace or setting.')}</p>
</section>

<style>
  .task-guide {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    font-size: var(--text-body);
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: var(--text-title);
    margin-bottom: var(--space-2);
  }
  h3 {
    font-size: var(--text-section);
  }
  p,
  small,
  .task-card > span {
    color: var(--muted);
    line-height: 1.6;
  }
  .primary-tasks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .task-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
    padding: var(--space-4);
    color: var(--text);
    text-align: left;
    font: inherit;
  }
  .task-card strong {
    font-size: var(--text-section);
  }
  .task-card .open-task {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
    padding-top: var(--space-2);
    color: var(--text);
  }
  .task-card:hover,
  .task-row:hover {
    background: var(--raised);
    border-color: var(--strong-border);
  }
  .more-tasks {
    padding: var(--space-4);
  }
  .task-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 var(--space-5);
    margin-top: var(--space-3);
  }
  .task-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    min-height: var(--control-height);
    padding: var(--space-3) var(--space-2);
    border: 1px solid transparent;
    border-top-color: var(--border);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .task-row span {
    min-width: 0;
    flex: 1;
  }
  .task-row small {
    display: block;
    font-size: var(--text-body);
    margin-top: var(--space-1);
  }
  .task-row :global(svg) {
    flex-shrink: 0;
  }
  .setup summary {
    cursor: pointer;
    padding: var(--space-4);
  }
  summary small {
    margin-left: var(--space-3);
    font-size: var(--text-caption);
  }
  .setup-body {
    display: grid;
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-4);
  }
  ol {
    margin: 0;
    padding-left: var(--space-5);
    display: grid;
    gap: var(--space-4);
  }
  li p {
    margin: var(--space-1) 0 var(--space-2);
  }
  .setup .button {
    min-height: var(--control-height);
    height: auto;
    white-space: normal;
    text-align: left;
  }
  .tip {
    font-size: var(--text-caption);
  }
  @media (max-width: 1000px) {
    .primary-tasks,
    .task-list {
      grid-template-columns: minmax(0, 1fr);
    }
    .task-card {
      gap: var(--space-2);
    }
    .task-card > :global(svg) {
      display: none;
    }
  }
</style>
