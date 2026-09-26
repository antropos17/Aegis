<script lang="ts">
  import ActionObservation from './ActionObservation.svelte';
  import RouteEvidence from './RouteEvidence.svelte';
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { confirmed, invoke, record, type Host } from '../runtime/host';
  import { setupGuideUrl } from '../runtime/task-guide';
  import {
    actionRoutes,
    actionCheckGuidance,
    routeHelp,
    coverageLabels,
    parseActionCheck,
    type ActionCheck,
    type ActionKind,
    type ActionRoute,
  } from '../runtime/action-coverage';
  import type { RouteObservation } from '../runtime/action-observation';
  let {
    host,
    preview = false,
    navigate,
  }: {
    host: Host | null;
    preview?: boolean;
    navigate?: (_target: string) => void | Promise<void>;
  } = $props();
  const prefix = $props.id();
  let kind = $state<ActionKind>('single');
  let route = $state<ActionRoute>('mcp-stdio');
  let pending = $state(false);
  let feedback = $state('');
  let error = $state('');
  let guidePending = $state(false);
  let guideFeedback = $state('');
  let guideFailed = $state(false);
  let result = $state.raw<ActionCheck | null>(null);
  let routeObservation = $state.raw<RouteObservation | null>(null);
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  const available = $derived(typeof host?.localSecurityReview === 'function');
  const guidance = $derived(result ? actionCheckGuidance(result) : null);
  const actionCounts = $derived.by(() => {
    const counts = { allow: 0, ask: 0, deny: 0, invalid: 0, unassessed: 0 };
    if (result?.kind !== 'catalog') return counts;
    for (const action of result.report.actions) {
      if (action.configuration === 'invalid') counts.invalid++;
      else if (action.configuration !== 'valid') counts.unassessed++;
      else if (action.policyDecision === 'allow') counts.allow++;
      else if (action.policyDecision === 'ask') counts.ask++;
      else if (action.policyDecision === 'deny') counts.deny++;
      else counts.unassessed++;
    }
    return counts;
  });
  const routes = $derived(
    actionRoutes.filter((item) => kind === 'single' || item.id.startsWith('mcp-')),
  );
  function changeKind() {
    if (kind === 'catalog' && !route.startsWith('mcp-')) route = 'mcp-stdio';
  }
  async function openSelectedFileGuide() {
    const url = setupGuideUrl('ACTION-DELETE-FILE.md');
    if (guidePending || preview || !host?.openExternalUrl || !url) return;
    guidePending = true;
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
  <ActionObservation {host} {preview} onObservation={(value) => (routeObservation = value)} />
  {#if result || routeObservation}
    <RouteEvidence check={result} observation={routeObservation} />
  {/if}
  {#if result}
    <section class="panel result" tabindex="-1" aria-label={$t('Action check result')}>
      <button
        class="button setup-link"
        onclick={() => document.getElementById(prefix + '-kind')?.focus()}
        >{$t('Change check setup')}</button
      >

      <h2>{$t('Captured configuration check')}</h2>
      {#if guidance}<p class="result-summary">{$t(guidance.summary)}</p>{/if}
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
      {#if guidance}<div class="next-step">
          <h3>{$t('Next step')}</h3>
          <p>{$t(guidance.next)}</p>
        </div>{/if}
      <p class="muted">
        {$t(
          'Agent connection has not been checked. Protection outside this route is unknown; control of processes started by the selected command is unsupported.',
        )}
      </p>
      {#if result.kind === 'catalog'}
        <h3>{$t('Selected catalog actions')}</h3>
        {#if result.report.actions.length}
          <p class="muted">
            {$t('These counts describe the captured configuration check. No actions were run.')}
          </p>
          <dl class="outcome-counts">
            <div>
              <dt>{$t('Allow')}</dt>
              <dd>{actionCounts.allow}</dd>
            </div>
            <div>
              <dt>{$t('Ask')}</dt>
              <dd>{actionCounts.ask}</dd>
            </div>
            <div>
              <dt>{$t('Deny')}</dt>
              <dd>{actionCounts.deny}</dd>
            </div>
            <div>
              <dt>{$t('Invalid configuration')}</dt>
              <dd>{actionCounts.invalid}</dd>
            </div>
            {#if actionCounts.unassessed}<div>
                <dt>{$t('Not assessed')}</dt>
                <dd>{actionCounts.unassessed}</dd>
              </div>{/if}
          </dl>
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
                </dl>
                {#if action.configuration === 'invalid' || action.policyDecision === 'ask' || action.policyDecision === 'deny'}
                  <p class="action-reason">
                    <strong>{$t('Check detail')}:</strong>
                    {$t(coverageLabels[action.reason] ?? 'Reason unavailable')}
                  </p>
                {:else}
                  <details>
                    <summary>{$t('Check detail')}</summary>
                    <p>{$t(coverageLabels[action.reason] ?? 'Reason unavailable')}</p>
                  </details>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}<p>{$t('No individual action observations are available for this check.')}</p>{/if}
      {/if}
      <details class="technical">
        <summary>{$t('Technical details')}</summary>
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
      </details>
    </section>
  {/if}

  <section class="panel setup" aria-label={$t('Action check setup')}>
    <h2>{$t('Check action configuration')}</h2>
    <p class="notice">{$t('Configuration check only; blocking has not been verified.')}</p>
    <p class="muted">
      {$t(
        'Check the files that tell AEGIS which commands an agent may run. This does not run commands or change settings.',
      )}
    </p>
    <section class="selected-file-guide" aria-label={$t('Selected-file deletion setup')}>
      <h3>{$t('Delete one selected file')}</h3>
      <p>
        {$t(
          'Use the separate terminal-owned exact-file MCP route. The executable/catalog check below does not assess it or establish automatic blocking or general coverage.',
        )}
      </p>
      <button
        type="button"
        class="button"
        disabled={guidePending || preview || !host?.openExternalUrl}
        onclick={openSelectedFileGuide}>{$t('Open selected-file deletion guide')}</button
      >
      {#if preview}<p class="muted">
          {$t('External guides are disabled in this simulated preview.')}
        </p>{:else if !host?.openExternalUrl}<p class="muted">
          {$t('Opening guides requires the AEGIS desktop connection.')}
        </p>{/if}
      <p class="guide-feedback" role={guideFailed ? 'alert' : 'status'} aria-live="polite">
        {$t(guideFeedback)}
      </p>
    </section>
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
      <p class="file-help">
        {$t(
          kind === 'single'
            ? 'For one action, choose its policy JSON file, then its request JSON file.'
            : 'For a catalog, choose the catalog JSON file that lists your actions.',
        )}
      </p>
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
      <p id={prefix + '-route-help'} class="muted">{$t(routeHelp[route])}</p>
      <button type="submit" class="button primary" disabled={pending || !available}
        >{$t(preview ? 'Show example check' : 'Choose files and check')}</button
      >
      {#if result}<button
          type="button"
          class="button"
          onclick={(event) =>
            event.currentTarget
              .closest('.action-coverage-workspace')
              ?.querySelector<HTMLElement>('.result')
              ?.focus()}>{$t('View captured result')}</button
        >{/if}
    </form>
    <p class="muted">
      {$t(
        'Runtime and terminal availability describe this AEGIS process, not a future agent process.',
      )}
    </p>
    <div class="feedback" role="status" aria-live="polite" aria-atomic="true">
      {$t(pending ? 'Choose the requested files and wait for the configuration check…' : feedback)}
    </div>
    <div role="alert" aria-atomic="true">{$t(error)}</div>
  </section>
  {#if !result}
    <section class="panel empty">
      <h2>{$t('No action check yet')}</h2>
      <p>
        {$t(
          'Already have AEGIS configuration files? Choose them above. If not, ask the person setting up your agent for a policy and request, or a catalog.',
        )}
      </p>
      {#if navigate}<button class="button" onclick={() => navigate?.('guide')}
          >{$t('Open setup guide')}</button
        >{/if}
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
  .selected-file-guide {
    border-top: 1px solid var(--border);
    margin-top: var(--space-4);
    padding-top: var(--space-3);
  }
  .selected-file-guide h3 {
    margin-top: 0;
  }
  .selected-file-guide .button {
    margin-top: var(--space-2);
  }
  .selected-file-guide .guide-feedback {
    margin-bottom: 0;
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
  .outcome-counts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-4);
  }
  .outcome-counts > div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    min-width: 0;
  }
  .outcome-counts dt {
    overflow-wrap: anywhere;
  }
  .outcome-counts dd {
    font-size: var(--text-section);
    font-variant-numeric: tabular-nums;
  }
  .action-reason {
    margin-bottom: 0;
    overflow-wrap: anywhere;
  }
  .actions li {
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
  }
  .empty {
    color: var(--muted);
  }
  .result-summary {
    font-weight: 600;
  }
  .technical {
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
    margin-top: var(--space-3);
  }
  summary {
    cursor: pointer;
    min-height: var(--control-height);
    align-content: center;
  }
  .next-step h3 {
    margin-top: var(--space-2);
  }
  @media (max-width: 600px) {
    .fields,
    dl > div {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
