<script lang="ts">
  import ActionObservation from './ActionObservation.svelte';
  import RouteEvidence from './RouteEvidence.svelte';
  import ActionSetupGuides from './ActionSetupGuides.svelte';
  import Icon from './Icon.svelte';
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
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
  function focusCheckSetup() {
    document.getElementById(prefix + '-kind')?.focus();
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
  <nav class="task-links" aria-label={$t('Action control tasks')}>
    <button type="button" class="button setup-jump" disabled={pending} onclick={focusCheckSetup}
      >{$t('Go to configuration check')}</button
    >
    <button
      type="button"
      class="button"
      onclick={(event) =>
        event.currentTarget
          .closest('.action-coverage-workspace')
          ?.querySelector<HTMLElement>('[data-route-observation]')
          ?.focus()}>{$t('Go to live observation')}</button
    >
    {#if navigate}<button type="button" class="button" onclick={() => navigate?.('local-security')}
        >{$t('Compare returned files in Local security')}</button
      >{/if}
  </nav>
  <div class="action-columns">
    <div class="action-check-column">
      <section class="panel setup" aria-label={$t('Action check setup')}>
        <div class="panel-head">
          <h2><Icon name="file" />{$t('Check action configuration')}</h2>
        </div>
        <div class="panel-body">
          <p class="notice">{$t('Configuration check only; blocking has not been verified.')}</p>
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
                <select
                  id={prefix + '-kind'}
                  bind:value={kind}
                  onchange={changeKind}
                  disabled={pending}
                >
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
                  {#each routes as item (item.id)}<option value={item.id}>{$t(item.label)}</option
                    >{/each}
                </select>
              </div>
            </div>
            <p class="file-help">
              {$t(
                kind === 'single'
                  ? 'For one action, choose its policy JSON file, then its request JSON file.'
                  : 'For a catalog, choose the catalog JSON file that lists your actions.',
              )}
            </p>
            <p id={prefix + '-route-help'} class="muted">{$t(routeHelp[route])}</p>
            <button
              type="submit"
              class="button primary"
              disabled={pending || !available}
              aria-busy={pending}
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
          <div class="feedback" role="status" aria-live="polite" aria-atomic="true">
            {$t(
              pending
                ? 'Choose the requested files and wait for the configuration check…'
                : feedback,
            )}
          </div>
          <div role="alert" aria-atomic="true">{$t(error)}</div>
          <p class="muted">
            {$t(
              'Check the files that tell AEGIS which commands an agent may run. This does not run commands or change settings.',
            )}
          </p>
          {#if preview}<p class="preview-note">
              {$t('Preview · example checks only. No files are selected or read.')}
            </p>{/if}
          {#if !available}<p>
              {$t(
                'Action checks are unavailable in this runtime. Open the current AEGIS desktop app.',
              )}
            </p>{/if}
          <p class="muted">
            {$t(
              'Runtime and terminal availability describe this AEGIS process, not a future agent process.',
            )}
          </p>
        </div>
      </section>
      {#if result}
        <section class="panel result" tabindex="-1" aria-label={$t('Action check result')}>
          <div class="panel-head">
            <h2><Icon name="shield" />{$t('Captured configuration check')}</h2>
            <button class="button setup-link" onclick={focusCheckSetup}
              >{$t('Change check setup')}</button
            >
          </div>
          <div class="panel-body">
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
            <p>
              {$t(
                'This is a retained observation, not live route status or permission to execute.',
              )}
            </p>
            {#if guidance}<div class="next-step">
                <h3>{$t('Next step')}</h3>
                <p>{$t(guidance.next)}</p>
              </div>{/if}
            <p class="muted">
              {$t(
                result.route === 'appcontainer'
                  ? 'AppContainer launch, isolation, descendant cleanup and installed provider compatibility have not been tested. The check does not authorize execution.'
                  : 'Agent connection has not been checked. Protection outside this route is unknown; control of processes started by the selected command is unsupported.',
              )}
            </p>
            {#if result.kind === 'catalog'}
              <h3>{$t('Selected catalog actions')}</h3>
              {#if result.report.actions.length}
                <p class="muted">
                  {$t(
                    'These counts describe the captured configuration check. No actions were run.',
                  )}
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
                      <p class="action-reason">
                        <strong>{$t('Check detail')}:</strong>
                        {$t(coverageLabels[action.reason] ?? 'Reason unavailable')}
                      </p>
                    </li>
                  {/each}
                </ul>
              {:else}<p>
                  {$t('No individual action observations are available for this check.')}
                </p>{/if}
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
                {#if result.route === 'appcontainer'}<div>
                    <dt>{$t('AppContainer helper file')}</dt>
                    <dd>{$t(coverageLabels[result.report.helper])}</dd>
                  </div>
                  <div>
                    <dt>{$t('Selected executable metadata')}</dt>
                    <dd>{$t(coverageLabels[result.report.executableObservation])}</dd>
                  </div>{/if}
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
                  <dd>{$t(result.route === 'appcontainer' ? 'Not started' : 'Unsupported')}</dd>
                </div>
              </dl>
            </details>
          </div>
        </section>
      {/if}
      {#if !result}
        <section class="panel empty">
          <div class="panel-head"><h2><Icon name="report" />{$t('No action check yet')}</h2></div>
          <div class="panel-body">
            <p>
              {$t(
                'Already have AEGIS configuration files? Choose them above. If not, ask the person setting up your agent for a policy and request, or a catalog.',
              )}
            </p>
            {#if navigate}<button class="button" onclick={() => navigate?.('guide')}
                >{$t('Open setup guide')}</button
              >{/if}
          </div>
        </section>
      {/if}
    </div>
    <div class="action-observation-column">
      <ActionObservation {host} {preview} onObservation={(value) => (routeObservation = value)} />
      {#if result || routeObservation}
        <RouteEvidence check={result} observation={routeObservation} />
      {/if}
    </div>
  </div>
  <ActionSetupGuides {host} {preview} />
</div>

<style>
  .action-coverage-workspace {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .action-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.72fr);
    align-items: start;
    gap: var(--space-4);
    min-width: 0;
  }
  .action-check-column,
  .action-observation-column {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .panel {
    padding: 0;
    min-width: 0;
    container-type: inline-size;
  }
  .panel-head {
    flex-wrap: wrap;
  }
  .panel-head h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 700;
  }
  .panel-head :global(.icon) {
    flex-shrink: 0;
  }
  .panel-head button {
    margin: 0;
  }
  .panel-body {
    display: grid;
    gap: var(--space-3);
    padding: var(--panel-inset);
  }
  h2 {
    font-size: var(--text-section);
    margin: 0;
  }
  h3 {
    font-size: var(--text-body);
    margin: 0;
  }
  h4 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-body);
    overflow-wrap: anywhere;
  }
  p {
    line-height: 1.6;
    margin: 0;
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
    border-left: 3px solid var(--amber);
    background: var(--amber-bg);
  }
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-3);
  }
  form > p,
  .fields {
    flex-basis: 100%;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: var(--space-3);
    width: 100%;
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
    margin: 0;
    min-height: var(--control-height);
    white-space: normal;
    max-width: 100%;
    justify-self: start;
  }
  .task-links {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .task-links button {
    justify-self: start;
    max-width: 100%;
    margin-top: 0;
  }
  .primary {
    border-color: var(--selection-border);
    background: var(--selection);
    font-weight: 600;
  }
  .feedback:not(:empty),
  [role='alert']:not(:empty) {
    padding: var(--space-3);
    border: 1px solid var(--strong-border);
    border-radius: var(--control-radius);
    background: var(--raised);
  }
  [role='alert'] {
    color: var(--red);
  }
  dl {
    display: grid;
    gap: var(--space-3);
    margin: 0;
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
    margin-bottom: var(--space-1);
  }
  @container (max-width: 340px) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @container (max-width: 420px) {
    dl > div {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 780px) {
    .action-columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
