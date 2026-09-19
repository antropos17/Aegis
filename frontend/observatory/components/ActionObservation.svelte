<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../runtime/i18n';
  import { invoke, record, type Host } from '../runtime/host';
  import {
    observationLabels,
    parseRouteObservation,
    type RouteObservation,
  } from '../runtime/action-observation';
  let { host, preview = false }: { host: Host | null; preview?: boolean } = $props();
  let observation = $state.raw<RouteObservation | null>(null);
  let busy = $state(false);
  let error = $state('');
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
    error = '';
    void request(action, ++generation);
  }
  onDestroy(() => {
    alive = false;
    generation++;
    clearTimeout(timer);
    clearTimeout(expiry);
    if (observation)
      void invoke(host, 'localSecurityReview', { action: 'stop-observing-route' }).catch(() => {});
  });
</script>

<section class="panel observation-panel" aria-label={$t('Live route observation')}>
  <h2>{$t('Live route observation')}</h2>
  <p>
    {$t(
      'Observe one explicitly connected AEGIS MCP route. This does not run an action or verify blocking.',
    )}
  </p>
  <p class="state" role="status" aria-live="polite">
    {$t(observation ? observationLabels[observation.state] : 'No route observation selected')}
  </p>
  {#if observation?.state === 'coverage-lost'}
    <p>
      {$t(
        'Live coverage evidence is no longer available. The last received details are retained below; the agent may still be running.',
      )}
    </p>
  {/if}
  {#if observation?.lastObservedAt}<p class="muted">
      {$t('Last received update')}:
      <time datetime={observation.lastObservedAt}
        >{new Date(observation.lastObservedAt).toLocaleString()}</time
      >
    </p>{/if}
  {#if observation?.snapshot}
    {@const snapshot = observation.snapshot}
    <dl>
      <div>
        <dt>{$t('Execution route')}</dt>
        <dd>{$t(snapshot.route === 'mcp-review' ? 'MCP terminal review' : 'MCP stdio')}</dd>
      </div>
      <div>
        <dt>{$t('Selection type')}</dt>
        <dd>{$t(snapshot.selection === 'catalog' ? 'Action catalog' : 'Single action')}</dd>
      </div>
      <div>
        <dt>{$t('Client label · self-reported')}</dt>
        <dd>
          {snapshot.client?.name ?? $t('Not available')} · {snapshot.client?.version ??
            $t('Version unavailable')}
        </dd>
      </div>
      <div>
        <dt>{$t('Selected actions')}</dt>
        <dd>{snapshot.selectedActionCount}</dd>
      </div>
      <div>
        <dt>{$t('Action attempts')}</dt>
        <dd>{snapshot.actionAttempts}</dd>
      </div>
      <div>
        <dt>{$t('Owner calls settled / started')}</dt>
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
          'Counts describe this MCP connection only. A settled call does not prove a command ran or a process stopped.',
        )}
      </p>
    </details>
  {/if}
  <p class="muted">
    {$t(
      'Client identity is unverified. Blocking has not been tested. Other agent tools and descendant processes remain outside this observation.',
    )}
  </p>
  <div class="controls">
    <button
      class="button"
      disabled={busy || !available || !!active}
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
    </p>{/if}
  <details>
    <summary>{$t('How to connect observation')}</summary>
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
  </details>
  <p role="alert">{$t(error)}</p>
</section>

<style>
  .observation-panel {
    padding: var(--panel-inset);
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: var(--text-section);
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
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
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
    white-space: normal;
  }
  summary {
    cursor: pointer;
  }
  details p {
    margin-top: var(--space-2);
  }
</style>
