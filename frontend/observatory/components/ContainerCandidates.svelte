<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../runtime/i18n';
  import {
    containerDiscovery,
    configurationStale,
    containerDiscoveryCopy,
    containerDiscoveryLabel,
    containerDiscoveryReason,
  } from '../runtime/container-discovery';
  let { dockerSnapshot, podmanSnapshot }: { dockerSnapshot: unknown; podmanSnapshot: unknown } =
    $props();
  const prefix = $props.id();
  let now = $state(Date.now());
  let discoveries = $derived.by(() => {
    const observedNow = Math.max(now, Date.now());
    return [
      {
        runtime: 'docker' as const,
        snapshot: containerDiscovery(dockerSnapshot, 'docker', observedNow),
      },
      {
        runtime: 'podman' as const,
        snapshot: containerDiscovery(podmanSnapshot, 'podman', observedNow),
      },
    ];
  });
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<section class="panel container-candidates" aria-labelledby={prefix + '-title'}>
  <div class="panel-head">
    <h2 id={prefix + '-title'}>{$t('Container candidates')}</h2>
    <span class="badge">{$t('Read-only metadata')}</span>
  </div>
  <p class="candidate-context muted">
    {$t(
      'An image match is candidate evidence. Agent activity and host process identity are unobserved.',
    )}
  </p>
  {#each discoveries as { runtime, snapshot: discovery } (runtime)}
    {@const copy = containerDiscoveryCopy[runtime]}
    {@const reason = containerDiscoveryReason(discovery.reason, runtime)}
    <section class="runtime-section" aria-labelledby={prefix + '-' + runtime + '-title'}>
      <h3 class="runtime-title" id={prefix + '-' + runtime + '-title'}>{$t(copy.title)}</h3>
      <div class="discovery-context">
        <p role="status">{$t(containerDiscoveryLabel(discovery, runtime))}</p>
        {#if reason}<p class="muted">{$t(reason)}</p>{/if}
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
            {$t(
              'Last observed candidates are retained; current container presence is unconfirmed.',
            )}
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
              {#if row.runtime === 'docker' && row.configuration}
                {@const configuration = row.configuration}
                <div class="configuration-context">
                  <h4>{$t('Observed configuration')}</h4>
                  {#if configuration.status === 'unavailable'}
                    <p class="muted">{$t('Configuration unavailable')}</p>
                  {:else}
                    <p class="muted">
                      {$t('Last observed:')}
                      {#if configuration.observedAt !== null}<time
                          datetime={new Date(configuration.observedAt).toISOString()}
                          >{new Date(configuration.observedAt).toLocaleString()}</time
                        >{/if}
                    </p>
                    {#if configurationStale(configuration, discovery.stale, Math.max(now, Date.now()))}
                      <p class="muted">
                        {$t('Configuration is stale; current settings are unconfirmed.')}
                      </p>
                    {/if}
                    <dl>
                      {#each [['Running', configuration.running], ['Privileged', configuration.privileged], ['Read-only root filesystem', configuration.readOnlyRootFilesystem], ['Network mode', configuration.networkMode], ['PID mode', configuration.pidMode]] as [label, value] (label)}
                        {#if value !== undefined}<div>
                            <dt>{$t(String(label))}</dt>
                            <dd>{typeof value === 'boolean' ? $t(value ? 'Yes' : 'No') : value}</dd>
                          </div>{/if}
                      {/each}
                    </dl>
                  {/if}
                  <p class="muted">
                    {$t(
                      'Configuration observations do not establish isolation or a security grade.',
                    )}
                  </p>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-candidates muted">
          {$t(discovery.status === 'ready' && !discovery.stale ? copy.empty : copy.missing)}
        </p>
      {/if}
    </section>
  {/each}
</section>

<style>
  .container-candidates {
    margin-bottom: var(--space-4);
  }
  .panel-head,
  .candidate-title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .candidate-context,
  .runtime-title,
  .discovery-context,
  .empty-candidates {
    padding: var(--panel-inset);
  }
  .runtime-section {
    border-top: 1px solid var(--border);
  }
  .runtime-title {
    margin: 0;
    padding-bottom: 0;
    font-size: inherit;
    overflow-wrap: anywhere;
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
  .configuration-context {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  h4 {
    margin: 0;
    font-size: inherit;
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
