<script lang="ts">
  import { t } from '../runtime/i18n';
  import { actionRoutes, coverageLabels, type ActionCheck } from '../runtime/action-coverage';
  import type { RouteObservation } from '../runtime/action-observation';
  import { summarizeRouteEvidence } from '../runtime/route-evidence';

  let {
    check,
    observation,
  }: {
    check: ActionCheck | null;
    observation: RouteObservation | null;
  } = $props();
  const evidence = $derived(summarizeRouteEvidence(check, observation));
  const heading = $props.id();
  const routeLabel = (route: string) =>
    actionRoutes.find((item) => item.id === route)?.label ?? route;
  const selectionLabel = (selection: string) =>
    selection === 'catalog'
      ? 'Action catalog'
      : selection === 'selected-file-delete'
        ? 'Selected file deletion'
        : 'Single action';
</script>

<section class="panel route-evidence" aria-labelledby={heading}>
  <h2 id={heading}>{$t('Route evidence')}</h2>
  <p class="intro">
    {$t(
      'Each row describes a separate observation. Matching route and selection labels do not bind checked files to a running owner.',
    )}
  </p>
  <dl>
    <div class="evidence-row">
      <dt>{$t('Selected inputs checked?')}</dt>
      <dd>
        {#if evidence.checked}
          <strong>{$t('Captured check')}</strong>
          <span>
            {$t(evidence.checked.kind === 'catalog' ? 'Action catalog' : 'Single action')}
            · {$t(routeLabel(evidence.checked.route))}
          </span>
          <span>{$t(coverageLabels[evidence.checked.configuration])}</span>
          <span class="muted">
            {$t('Captured at')}
            <time datetime={evidence.checked.at}
              >{new Date(evidence.checked.at).toLocaleString()}</time
            >
          </span>
          <span class="muted">{$t('The check is retained; it does not authorize a call.')}</span>
        {:else}
          <strong>{$t('Not checked')}</strong>
          <span class="muted">{$t('No captured configuration check is available here.')}</span>
        {/if}
      </dd>
    </div>
    <div class="evidence-row">
      <dt>{$t('Live MCP owner observed?')}</dt>
      <dd>
        {#if evidence.owner === 'live'}
          <strong class="live">{$t('Live observation')}</strong>
          <span>
            {$t(selectionLabel(evidence.connected!.selection))} · {$t(
              routeLabel(evidence.connected!.route),
            )}
          </span>
        {:else if evidence.owner === 'past'}
          <strong>{$t('Past connection evidence')}</strong>
          <span>
            {$t(selectionLabel(evidence.connected!.selection))} · {$t(
              routeLabel(evidence.connected!.route),
            )}
          </span>
          <span class="muted">{$t('No live route status is available now.')}</span>
        {:else if evidence.owner === 'waiting'}
          <strong>{$t('Waiting for MCP initialization')}</strong>
          <span class="muted">{$t('No initialized owner snapshot has been received.')}</span>
        {:else if evidence.owner === 'ended-before-client'}
          <strong>{$t('Connection ended before owner observation')}</strong>
          <span class="muted">{$t('Only past endpoint contact is available.')}</span>
        {:else}
          <strong>{$t('Not observed')}</strong>
          <span class="muted">{$t('Choose an observation endpoint to inspect one route.')}</span>
        {/if}
        {#if evidence.connected?.lastReceivedAt}
          <span class="muted">
            {$t('Last received update')}
            <time datetime={evidence.connected.lastReceivedAt}
              >{new Date(evidence.connected.lastReceivedAt).toLocaleString()}</time
            >
          </span>
        {/if}
      </dd>
    </div>
    <div class="evidence-row">
      <dt>{$t('Selected tool call reached owner?')}</dt>
      <dd>
        {#if evidence.call === 'reached-live' || evidence.call === 'reached-past'}
          <strong>
            {$t(
              evidence.call === 'reached-live'
                ? 'Reached AEGIS owner'
                : 'Previously reached AEGIS owner',
            )}
          </strong>
          <span>
            {$t('Owner invocations')}: {evidence.connected!.ownerInvocations}
          </span>
          <span class="muted">
            {$t(
              'An owner invocation can return ask or deny. It does not prove execution, deletion or blocking.',
            )}
          </span>
        {:else if evidence.call === 'none-live'}
          <strong>{$t('No selected tool call observed')}</strong>
          <span class="muted">{$t('The current connection reports zero owner invocations.')}</span>
        {:else if evidence.call === 'none-past'}
          <strong>{$t('No owner call in last snapshot')}</strong>
          <span class="muted">{$t('The past connection reported zero owner invocations.')}</span>
        {:else}
          <strong>{$t('No call evidence')}</strong>
          <span class="muted">{$t('Wait for an initialized owner and a selected tool call.')}</span>
        {/if}
      </dd>
    </div>
  </dl>
  {#if evidence.relation === 'matching-labels'}
    <p class="comparison">
      {$t('Check and connection labels match. This is not a configuration binding.')}
    </p>
  {:else if evidence.relation === 'mismatched-labels'}
    <p class="comparison mismatch">
      {$t(
        'Check and connection labels differ. The captured check does not describe this route selection.',
      )}
    </p>
  {:else if evidence.relation === 'no-delete-preflight'}
    <p class="comparison">
      {$t(
        'Selected file deletion has no matching preflight mode in this workspace. Inspect its operation report separately.',
      )}
    </p>
  {/if}
  <p class="muted boundary">
    {$t(
      'Client identity is self-reported. This evidence does not verify blocking or activity through other tools or descendant processes.',
    )}
  </p>
</section>

<style>
  .route-evidence {
    padding: var(--panel-inset);
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  h2,
  p,
  dl,
  dt,
  dd {
    margin: 0;
  }
  h2 {
    font-size: var(--text-section);
  }
  dl {
    display: grid;
    gap: var(--space-3);
  }
  .evidence-row {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) minmax(0, 2fr);
    gap: var(--space-3);
    padding-block: var(--space-2);
    border-top: 1px solid var(--border);
  }
  dd {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  dd span,
  .comparison {
    overflow-wrap: anywhere;
  }
  .muted,
  dt {
    color: var(--muted);
  }
  .live {
    color: var(--green);
  }
  .mismatch {
    color: var(--amber);
  }
  @media (max-width: 650px) {
    .evidence-row {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-1);
    }
  }
</style>
