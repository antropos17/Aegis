<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../runtime/i18n';
  import {
    dockerDiscovery,
    dockerDiscoveryLabel,
    dockerDiscoveryReason,
  } from '../runtime/docker-discovery';
  let { snapshot }: { snapshot: unknown } = $props();
  const prefix = $props.id();
  let now = $state(Date.now());
  let discovery = $derived(dockerDiscovery(snapshot, Math.max(now, Date.now())));
  let reason = $derived(dockerDiscoveryReason(discovery.reason));
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<section class="panel docker-candidates" aria-labelledby={prefix + '-title'}>
  <div class="panel-head">
    <h2 id={prefix + '-title'}>{$t('Docker container candidates')}</h2>
    <span class="badge">{$t('Read-only metadata')}</span>
  </div>
  <div class="discovery-context">
    <p role="status">{$t(dockerDiscoveryLabel(discovery))}</p>
    {#if reason}<p class="muted">{$t(reason)}</p>{/if}
    <p class="muted">
      {$t(
        'An image match is candidate evidence. Agent activity and host process identity are unobserved.',
      )}
    </p>
    {#if discovery.observedAt !== null}
      <p class="muted">
        {$t('Last observed:')}
        <time datetime={new Date(discovery.observedAt).toISOString()}
          >{new Date(discovery.observedAt).toLocaleString()}</time
        >
      </p>
    {/if}
    {#if discovery.stale && discovery.candidates.length}
      <p class="muted">
        {$t('Last observed candidates are retained; current container presence is unconfirmed.')}
      </p>
    {/if}
  </div>
  {#if discovery.candidates.length}
    <ul class="candidate-list">
      {#each discovery.candidates as row (row.id)}
        <li>
          <div class="candidate-title">
            <strong>{row.agent}</strong><span class="badge">{$t('Candidate')}</span>
          </div>
          <dl>
            <div>
              <dt>{$t('Container')}</dt>
              <dd>{row.name}</dd>
            </div>
            <div>
              <dt>{$t('Image')}</dt>
              <dd>{row.image}</dd>
            </div>
            <div>
              <dt>{$t('Container ID')}</dt>
              <dd class="container-id">{row.containerId}</dd>
            </div>
            <div>
              <dt>{$t('Match source')}</dt>
              <dd>{$t('Image metadata')}</dd>
            </div>
          </dl>
        </li>
      {/each}
    </ul>
  {:else if discovery.status === 'ready' && !discovery.stale}
    <p class="empty-candidates muted">
      {$t('No Docker container candidates matched the observed image metadata.')}
    </p>
  {:else}
    <p class="empty-candidates muted">
      {$t('A current Docker candidate population is unavailable.')}
    </p>
  {/if}
</section>

<style>
  .docker-candidates {
    margin-bottom: var(--space-4);
  }
  .panel-head,
  .candidate-title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .discovery-context,
  .empty-candidates {
    padding: var(--panel-inset);
  }
  .discovery-context {
    display: grid;
    gap: var(--space-1);
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .candidate-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    border-top: 1px solid var(--border);
    padding: var(--panel-inset);
  }
  .candidate-title {
    margin-bottom: var(--space-2);
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }
  dl > div {
    min-width: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: var(--space-1) 0 0;
    overflow-wrap: anywhere;
  }
  .container-id {
    font-family: var(--mono);
  }
  @media (max-width: 700px) {
    dl {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
