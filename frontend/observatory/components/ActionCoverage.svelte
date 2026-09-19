<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
  import {
    actionRoutes,
    coverageLabels,
    parseActionCheck,
    type ActionCheck,
    type ActionKind,
    type ActionRoute,
  } from '../runtime/action-coverage';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  const prefix = $props.id();
  let kind = $state<ActionKind>('single');
  let route = $state<ActionRoute>('mcp-stdio');
  let pending = $state(false);
  let feedback = $state('');
  let error = $state('');
  let result = $state.raw<ActionCheck | null>(null);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  const available = $derived(typeof host?.localSecurityReview === 'function');
  const routes = $derived(
    actionRoutes.filter((item) => kind === 'single' || item.id.startsWith('mcp-')),
  );
  function changeKind() {
    if (kind === 'catalog' && !route.startsWith('mcp-')) route = 'mcp-stdio';
  }
  async function check() {
    if (pending || !available) return;
    const selectedKind = kind,
      selectedRoute = route;
    pending = true;
    feedback = '';
    error = '';
    try {
      const reply = record(
        await invoke(host, 'localSecurityReview', {
          action: selectedKind === 'single' ? 'check-route' : 'check-catalog',
          route: selectedRoute,
        }),
      );
      if (!alive) return;
      if (reply.cancelled === true) {
        feedback = 'Cancelled. Previous results are retained.';
        return;
      }
      const next = reply.success === true ? parseActionCheck(reply.check) : null;
      if (!next || next.kind !== selectedKind || next.route !== selectedRoute) {
        error = 'The configuration check could not be loaded. Previous results are retained.';
        return;
      }
      result = next;
      feedback = preview
        ? 'Example check loaded. No files were read.'
        : 'Configuration check completed. No action was executed.';
    } catch {
      if (alive)
        error = 'The configuration check could not be loaded. Previous results are retained.';
    } finally {
      if (alive) pending = false;
    }
  }
</script>

<div class="action-coverage-workspace">
  <section class="panel setup" aria-label={$t('Action check setup')}>
    <h2>{$t('Action control')}</h2>
    <p class="notice">{$t('Configuration check only; blocking has not been verified.')}</p>
    <p class="muted">
      {$t(
        'Inspect selected action policies and route prerequisites without executing actions, connecting to agents or changing settings.',
      )}
    </p>
    {#if preview}<p class="preview-note">
        {$t('Preview · example checks only. No files are selected or read.')}
      </p>{/if}
    {#if !available}<p>
        {$t('Action checks are unavailable in this runtime. Open the current AEGIS desktop app.')}
      </p>{/if}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void check();
      }}
      aria-busy={pending}
    >
      <div class="fields">
        <div class="field">
          <label for={prefix + '-kind'}>{$t('Selection type')}</label>
          <select id={prefix + '-kind'} bind:value={kind} onchange={changeKind} disabled={pending}>
            <option value="single">{$t('Single action')}</option><option value="catalog"
              >{$t('Action catalog')}</option
            >
          </select>
        </div>
        <div class="field">
          <label for={prefix + '-route'}>{$t('Execution route')}</label>
          <select
            id={prefix + '-route'}
            bind:value={route}
            disabled={pending}
            aria-describedby={prefix + '-route-help'}
          >
            {#each routes as item (item.id)}<option value={item.id}>{$t(item.label)}</option>{/each}
          </select>
        </div>
      </div>
      <p id={prefix + '-route-help'} class="muted">
        {$t(
          'Runtime and terminal availability describe this AEGIS process, not a future agent process.',
        )}
      </p>
      <button type="submit" class="button primary" disabled={pending || !available}
        >{$t(preview ? 'Show example check' : 'Choose files and check')}</button
      >
    </form>
    <div class="feedback" role="status" aria-live="polite" aria-atomic="true">
      {$t(pending ? 'Choose the requested files and wait for the configuration check…' : feedback)}
    </div>
    <div role="alert" aria-atomic="true">{$t(error)}</div>
  </section>
  {#if result}
    <section class="panel result" aria-label={$t('Action check result')}>
      <h2>{$t('Captured configuration check')}</h2>
      <p class="captured">
        {$t(result.kind === 'single' ? 'Single action' : 'Action catalog')} · {$t(
          actionRoutes.find((item) => item.id === result?.route)?.label ?? '',
        )}
      </p>
      <p class="muted">
        {$t('Captured at')}
        <time datetime={result.createdAt}>{new Date(result.createdAt).toLocaleString()}</time>
      </p>
      <p>{$t('This is a retained observation, not live route status or permission to execute.')}</p>
      <dl>
        <div>
          <dt>{$t('Configuration')}</dt>
          <dd>{$t(coverageLabels[result.report.configuration])}</dd>
        </div>
        <div>
          <dt>{$t('Policy decision')}</dt>
          <dd>{$t(coverageLabels[result.report.policyDecision])}</dd>
        </div>
        <div>
          <dt>{$t('Check detail')}</dt>
          <dd>{$t(coverageLabels[result.report.reason])}</dd>
        </div>
        <div>
          <dt>{$t('Current AEGIS runtime')}</dt>
          <dd>{$t(coverageLabels[result.report.runtime])}</dd>
        </div>
        <div>
          <dt>{$t('Terminal in the checking process')}</dt>
          <dd>{$t(coverageLabels[result.report.terminal])}</dd>
        </div>
        <div>
          <dt>{$t('Configuration observation')}</dt>
          <dd>{$t('Not retained as a binding or authorization')}</dd>
        </div>
        <div>
          <dt>{$t('Agent connection')}</dt>
          <dd>{$t('Not checked')}</dd>
        </div>
        <div>
          <dt>{$t('Blocking verification')}</dt>
          <dd>{$t('Not performed')}</dd>
        </div>
        <div>
          <dt>{$t('Outside-route coverage')}</dt>
          <dd>{$t('Unknown')}</dd>
        </div>
        <div>
          <dt>{$t('Descendant control')}</dt>
          <dd>{$t('Unsupported')}</dd>
        </div>
      </dl>
      {#if result.kind === 'catalog'}
        <h3>{$t('Selected catalog actions')}</h3>
        {#if result.report.actions.length}
          <ul class="actions">
            {#each result.report.actions as action (action.name)}
              <li>
                <h4>{action.name}</h4>
                <dl>
                  <div>
                    <dt>{$t('Configuration')}</dt>
                    <dd>{$t(coverageLabels[action.configuration])}</dd>
                  </div>
                  <div>
                    <dt>{$t('Policy decision')}</dt>
                    <dd>{$t(coverageLabels[action.policyDecision])}</dd>
                  </div>
                  <div>
                    <dt>{$t('Check detail')}</dt>
                    <dd>{$t(coverageLabels[action.reason])}</dd>
                  </div>
                </dl>
              </li>
            {/each}
          </ul>
        {:else}<p>{$t('No individual action observations are available for this check.')}</p>{/if}
      {/if}
    </section>
  {:else}
    <section class="panel empty">
      <h2>{$t('No action check yet')}</h2>
      <p>
        {$t(
          'Choose an action or catalog and a route, then select the configuration files in the native dialog.',
        )}
      </p>
    </section>
  {/if}
</div>

<style>
  .action-coverage-workspace {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .panel {
    padding: var(--panel-inset);
    min-width: 0;
  }
  h2 {
    font-size: var(--text-section);
    margin: 0;
  }
  h3 {
    font-size: var(--text-body);
    margin: var(--space-4) 0 var(--space-2);
  }
  h4 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-body);
    overflow-wrap: anywhere;
  }
  p {
    line-height: 1.6;
    margin: var(--space-2) 0;
  }
  .muted {
    color: var(--muted);
  }
  .notice,
  .preview-note {
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
  }
  .notice {
    font-weight: 600;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin-block: var(--space-4);
  }
  .field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  select {
    width: 100%;
    min-width: 0;
  }
  button {
    margin-top: var(--space-3);
    min-height: var(--control-height);
    white-space: normal;
  }
  .primary {
    border-color: var(--strong-border);
    font-weight: 600;
  }
  .feedback {
    min-height: 1.8em;
    margin-top: var(--space-2);
  }
  [role='alert'] {
    color: var(--red);
  }
  dl {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-3) 0;
  }
  dl > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--space-3);
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-3);
  }
  .actions li {
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
  }
  .empty {
    text-align: center;
    color: var(--muted);
  }
  @media (max-width: 600px) {
    .fields,
    dl > div {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
