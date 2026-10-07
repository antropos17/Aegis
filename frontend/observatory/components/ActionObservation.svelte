<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
  import {
    observationLabels,
    parseRouteObservation,
    type RouteObservation,
  } from '../runtime/action-observation';
  let {
    host,
    preview = false,
    onObservation,
  }: {
    host: Host | null;
    preview?: boolean;
    onObservation?: (_value: RouteObservation | null) => void;
  } = $props();
  let observation = $state.raw<RouteObservation | null>(null);
  let busy = $state(false);
  let error = $state('');
  let feedback = $state('');
  let pendingCommand = $state('');
  let alive = true,
    generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const available = $derived(!preview && typeof host?.localSecurityReview === 'function');
  const active = $derived(
    observation && ['connecting', 'awaiting-client', 'observed'].includes(observation.state),
  );
  function unavailable() {
    observation = {
      state:
        observation?.state === 'observed' || observation?.state === 'coverage-lost'
          ? 'coverage-lost'
          : 'unavailable',
      reason: 'observation-unavailable',
      lastObservedAt: observation?.lastObservedAt ?? null,
      snapshot: observation?.snapshot ?? null,
    };
    onObservation?.(observation);
  }
  async function request(action: string, epoch: number) {
    let expired = false;
    const timeout = setTimeout(
      () => {
        expired = true;
        if (alive && epoch === generation) {
          unavailable();
          busy = false;
        }
      },
      action === 'observe-route' ? 900000 : 3500,
    );
    expiry = timeout;
    try {
      const response = record(await invoke(host, 'localSecurityReview', { action }));
      if (!alive || epoch !== generation || expired) {
        if (action === 'observe-route' && response.success === true)
          void invoke(host, 'localSecurityReview', { action: 'stop-observing-route' }).catch(
            () => {},
          );
        return;
      }
      if (response.success !== true) {
        if (response.cancelled === true && action === 'observe-route')
          feedback = 'Cancelled. Previous observation details are retained.';
        if (response.cancelled !== true) {
          if (action === 'route-observation') unavailable();
          error = 'Observation request could not be completed.';
        }
        return;
      }
      const next = parseRouteObservation(response.observation);
      if (!next) {
        unavailable();
        return;
      }
      observation = next;
      onObservation?.(next);
    } catch {
      if (alive && epoch === generation) unavailable();
    } finally {
      clearTimeout(timeout);
      if (alive && epoch === generation && !expired) {
        busy = false;
        if (
          observation &&
          ['connecting', 'awaiting-client', 'observed'].includes(observation.state)
        )
          timer = setTimeout(() => void request('route-observation', epoch), 1000);
      }
    }
  }
  function command(action: string) {
    if (busy || !available) return;
    clearTimeout(timer);
    clearTimeout(expiry);
    busy = true;
    pendingCommand = action;
    error = '';
    feedback = '';
    void request(action, ++generation);
  }
  onDestroy(() => {
    alive = false;
    generation++;
    clearTimeout(timer);
    clearTimeout(expiry);
    onObservation?.(null);
    if (observation)
      void invoke(host, 'localSecurityReview', { action: 'stop-observing-route' }).catch(() => {});
  });
</script>

<section class="panel observation-panel" aria-label={$t('Live route observation')}>
  <header class="observation-heading">
    <Icon name="activity" />
    <h2 data-route-observation tabindex="-1">{$t('Live route observation')}</h2>
  </header>
  <div class="observation-body">
    <p>
      {$t(
        'Observe one explicitly connected AEGIS MCP route. This does not run an action or verify blocking.',
      )}
    </p>
    <p class="state" role="status" aria-label={$t('Route observation status')} aria-live="polite">
      {$t(observation ? observationLabels[observation.state] : 'No route observation selected')}
    </p>
    <div class="controls">
      <button
        class="button"
        disabled={busy || !available || !!active}
        aria-busy={busy}
        onclick={() => command('observe-route')}>{$t('Choose observation endpoint')}</button
      >
      {#if active}<button
          class="button"
          disabled={busy}
          onclick={() => command('stop-observing-route')}>{$t('Stop observing')}</button
        >{/if}
    </div>
    {#if preview}<p class="muted">
        {$t(
          'Live observation is available in the desktop app only. Preview does not connect to endpoints.',
        )}
      </p>{:else if !available}<p class="muted">
        {$t('Live observation requires the AEGIS desktop connection.')}
      </p>{/if}
    <p
      class="request-feedback"
      role="status"
      aria-label={$t('Observation request status')}
      aria-live="polite"
      aria-atomic="true"
    >
      {$t(
        busy
          ? pendingCommand === 'stop-observing-route'
            ? 'Stopping only the observation connection…'
            : 'Choose the observation endpoint, then wait for the local connection…'
          : feedback,
      )}
    </p>
    <p role="alert">{$t(error)}</p>
    {#if observation?.state === 'coverage-lost'}
      <p>
        {$t(
          'Live coverage evidence is no longer available. The last received details are retained below; the agent may still be running.',
        )}
      </p>
    {/if}
    {#if observation?.state === 'awaiting-client'}<p>
        {$t(
          'The observer is connected. Initialize this route in your MCP client to receive its selected-action details.',
        )}
      </p>
    {:else if observation?.state === 'stopped'}<p>
        {$t('Only this observation connection stopped. No agent or action was stopped.')}
      </p>
    {:else if observation?.state === 'unavailable'}<p>
        {$t(
          'Check that the endpoint belongs to a running route. To reconnect, start a new route with a new observation endpoint.',
        )}
      </p>{/if}
    {#if observation?.lastObservedAt}<p class="muted">
        {$t('Last received update')}:
        <time datetime={observation.lastObservedAt}
          >{new Date(observation.lastObservedAt).toLocaleString()}</time
        >
      </p>{/if}
    {#if observation?.snapshot}
      {@const snapshot = observation.snapshot}
      {@const fileDeletion = snapshot.selection === 'selected-file-delete'}
      <dl>
        <div>
          <dt>{$t('Execution route')}</dt>
          <dd>
            {$t(
              snapshot.route === 'mcp-review' ? 'MCP terminal review' : 'Selected-action MCP stdio',
            )}
          </dd>
        </div>
        <div>
          <dt>{$t('Selection type')}</dt>
          <dd>
            {$t(
              snapshot.selection === 'catalog'
                ? 'Action catalog'
                : fileDeletion
                  ? 'Selected file deletion'
                  : 'Single action',
            )}
          </dd>
        </div>
        <div>
          <dt>{$t('Client label · self-reported')}</dt>
          <dd>
            {snapshot.client?.name ?? $t('Not available')} · {snapshot.client?.version ??
              $t('Version unavailable')}
          </dd>
        </div>
        <div>
          <dt>{$t(fileDeletion ? 'Selected file operations' : 'Selected actions')}</dt>
          <dd>{snapshot.selectedActionCount}</dd>
        </div>
        <div>
          <dt>{$t(fileDeletion ? 'File deletion attempts' : 'Action attempts')}</dt>
          <dd>{snapshot.actionAttempts}</dd>
        </div>
        <div>
          <dt>
            {$t(
              fileDeletion ? 'Deletion calls settled / started' : 'Owner calls settled / started',
            )}
          </dt>
          <dd>{snapshot.ownerSettled} / {snapshot.ownerInvocations}</dd>
        </div>
      </dl>
      <details>
        <summary>{$t('Observation details')}</summary>
        <p>{$t('Connection')}: <span class="connection">{snapshot.connectionId}</span></p>
        <p>
          {$t('Owner failures')}: {snapshot.ownerFailures} · {$t('Cancellation requests')}: {snapshot.cancellationRequests}
        </p>
        <p>
          {$t(
            fileDeletion
              ? 'Counts describe this MCP connection only. A settled deletion call does not prove a file was unlinked.'
              : 'Counts describe this MCP connection only. A settled call does not prove a command ran or a process stopped.',
          )}
        </p>
      </details>
    {/if}
    <p class="muted">
      {$t(
        'Client identity is unverified. Blocking has not been tested. Other agent tools and descendant processes remain outside this observation.',
      )}
    </p>
    <section class="connection-guide" aria-label={$t('How to connect observation')}>
      <h3>{$t('How to connect observation')}</h3>
      <p>
        {$t(
          'Start your selected AEGIS MCP route with --observe and a new endpoint JSON path in a private directory. Choose that file here while the route is running. Each endpoint accepts one observer; start a new route to reconnect.',
        )}
      </p>
      <p>
        {$t(
          'Observation uses a separate local connection. Selecting an endpoint does not install or configure an agent.',
        )}
      </p>
    </section>
  </div>
</section>

<style>
  .observation-panel {
    padding: 0;
    min-width: 0;
    container-type: inline-size;
    container-name: route-observation;
  }
  .observation-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--panel-inset);
    border-bottom: 1px solid var(--strong-border);
    border-radius: var(--surface-radius) var(--surface-radius) 0 0;
    background: var(--raised);
  }
  .observation-heading :global(.icon) {
    flex-shrink: 0;
  }
  .observation-body {
    display: grid;
    gap: var(--space-3);
    padding: var(--panel-inset);
    min-width: 0;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: var(--text-section);
    font-weight: 700;
  }
  h3 {
    font-size: var(--text-body);
    font-weight: 700;
  }
  p {
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .state {
    font-weight: 600;
  }
  .muted,
  dt {
    color: var(--muted);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--space-3);
  }
  dl > div {
    min-width: 0;
  }
  dt {
    overflow-wrap: anywhere;
  }
  dd {
    margin: var(--space-1) 0 0;
    overflow-wrap: anywhere;
  }
  .connection {
    overflow-wrap: anywhere;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    min-height: var(--control-height);
    max-width: 100%;
    white-space: normal;
    text-align: left;
  }
  .request-feedback {
    min-height: 1.6em;
  }
  [role='alert'] {
    color: var(--red);
  }
  .connection-guide {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    background: var(--raised);
    min-width: 0;
  }
  details {
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }
  summary {
    cursor: pointer;
  }
  details p {
    margin-top: var(--space-2);
  }
  @container route-observation (max-width: 480px) {
    .controls {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
