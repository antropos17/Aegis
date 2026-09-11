<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick } from 'svelte';
  import { invoke, record, type Host, type Telemetry, type RecordData } from '../runtime/host';
  import { createProtectionActivityReader, type ProtectionActivity } from '../runtime/protection';
  import ProtectionDetails from './ProtectionDetails.svelte';
  import ProtectionActivityList from './ProtectionActivityList.svelte';
  import Icon from './Icon.svelte';
  let {
    host,
    telemetry,
    liveTelemetry,
    inspect,
    openPolicy,
    navigate,
    policyRevision = 0,
  }: {
    host: Host | null;
    telemetry: Telemetry;
    liveTelemetry?: Telemetry;
    inspect: (_title: string, _row: RecordData) => void;
    openPolicy: (_key: string) => void;
    navigate: (_view: string) => void | Promise<void>;
    policyRevision?: number;
  } = $props();
  const readActivity = createProtectionActivityReader();
  const activity = $derived(
    readActivity(
      telemetry.events as unknown as RecordData[],
      telemetry.network as unknown as RecordData[],
    ),
  );
  const reviewCount = $derived(activity.filter((item) => item.level === 'review').length);
  const agentCount = $derived(new Set(telemetry.agents.map((agent) => agent.agent)).size);
  let filter = $state('all');
  let selected = $state.raw<ProtectionActivity | null>(null);
  const current = $derived(
    selected ? (activity.find((item) => item.key === selected!.key) ?? selected) : null,
  );
  const retained = $derived(!selected || activity.some((item) => item.key === selected!.key));
  let permissions = $state.raw<RecordData | null>(null);
  let policyError = $state(false);
  let mounted = $state(false);
  let revision = 0;
  let alive = true;
  async function loadPermissions() {
    const ticket = ++revision;
    permissions = null;
    policyError = false;
    try {
      const envelope = record(await invoke(host, 'getAllPermissions'));
      if (!envelope.permissions || !envelope.instancePermissions)
        throw new Error('Missing policies');
      if (alive && revision === ticket)
        permissions = { ...record(envelope.permissions), ...record(envelope.instancePermissions) };
    } catch {
      if (alive && revision === ticket) policyError = true;
    }
  }
  onMount(() => {
    mounted = true;
    return () => {
      alive = false;
      revision++;
    };
  });
  $effect(() => {
    policyRevision;
    if (mounted) void loadPermissions();
  });
  let selectionHeading = $state<HTMLSpanElement>();
  let selectionOrigin: HTMLButtonElement;
  async function selectActivity(item: ProtectionActivity, button: HTMLButtonElement) {
    selected = item;
    selectionOrigin = button;
    await tick();
    selectionHeading?.focus({ preventScroll: true });
    selectionHeading?.scrollIntoView?.({ block: 'nearest' });
  }
  function closeDetails() {
    selected = null;
    selectionOrigin?.focus();
  }
</script>

<section class="protection" aria-label={$t('Protection overview')}>
  <div class="intro">
    <div>
      <h2><Icon name="shield" />{$t('Know what your agents are doing')}</h2>
      <p>{$t('Files, connections and actions that need your attention.')}</p>
    </div>
  </div>
  <div class="status-cards">
    <button class:attention={reviewCount > 0} onclick={() => (filter = 'review')}>
      <span>{$t('Needs your review')}</span><strong
        >{telemetry.ready ? reviewCount : '—'} <small>{$t('activity groups')}</small></strong
      >
    </button>
    <button onclick={() => navigate('agents')}
      ><span>{$t('Agents observed')}</span><strong
        >{telemetry.ready ? agentCount : '—'}
        <small>{telemetry.stale ? $t('last seen') : $t('in this snapshot')}</small></strong
      >
    </button>
    <div class="protection-limit">
      <span>{$t('Automatic access blocking')}</span><strong
        ><Icon name="shield" />{$t('Not active')}</strong
      >
      <p>{$t('Saved permissions do not block access.')}</p>
    </div>
  </div>
  <div class="activity-layout" class:has-selection={!!current}>
    <ProtectionActivityList
      {activity}
      ready={telemetry.ready}
      bind:filter
      selectedKey={selected?.key}
      select={selectActivity}
    />
    {#if current}<div class="selection">
        <div class="selection-tools">
          <span bind:this={selectionHeading} tabindex="-1"
            >{retained
              ? $t('Selected activity')
              : $t('Previously selected · no longer in the current data')}</span
          ><button class="button" onclick={closeDetails}>{$t('Close details')}</button>
        </div>
        {#if policyError}<p class="policy-error">
            {$t('Saved preferences could not be loaded.')}
            <button class="button" onclick={loadPermissions}
              ><Icon name="refresh" />{$t('Retry preferences')}</button
            >
          </p>{/if}
        <ProtectionDetails
          activity={current}
          telemetry={liveTelemetry ?? telemetry}
          {permissions}
          {inspect}
          {openPolicy}
        />
      </div>{/if}
  </div>
  <details class="help">
    <summary><Icon name="shield" />{$t('New to AEGIS? Start here')}</summary>
    <div class="help-grid">
      <p>
        <strong>{$t('1. Check the action')}</strong>{$t(
          'Review sensitive files and unexpected destinations. “Unverified” means evidence is missing; it is not a danger verdict.',
        )}
      </p>
      <p>
        <strong>{$t('2. Check who did it')}</strong>{$t(
          '“Indirect match” is an estimate from a path. An open file handle does not prove the file was read.',
        )}
      </p>
      <p>
        <strong>{$t('3. Decide what to do')}</strong>{$t(
          'Open the evidence or the agent’s controls. Saving “Block” records a preference; automatic file and network blocking is not implemented.',
        )}
      </p>
    </div>
  </details>
</section>

<style>
  .protection {
    --body-size: calc(13px * var(--ui-scale));
    font-size: var(--body-size);
  }
  .intro {
    margin-bottom: var(--space-4);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-title);
    margin: 0 0 var(--space-2);
  }
  p {
    color: var(--muted);
    line-height: 1.6;
    margin: 0;
  }
  .status-cards {
    display: grid;
    grid-template-columns: 1fr 1fr 1.2fr;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .status-cards > * {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    padding: var(--space-4);
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .status-cards span {
    color: var(--muted);
  }
  .status-cards strong {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    font-size: var(--text-title);
  }
  .status-cards small {
    font-size: var(--text-body);
    font-weight: 400;
    color: var(--muted);
  }
  .attention strong,
  .protection-limit strong {
    color: var(--amber);
  }
  .activity-layout {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  .has-selection {
    grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  }
  .selection {
    min-width: 0;
  }
  .selection-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--muted);
    font-size: var(--text-caption);
    padding-bottom: var(--space-2);
  }
  .policy-error {
    margin-bottom: var(--space-3);
  }
  .help {
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    padding: var(--space-4);
    margin-top: var(--space-4);
  }
  summary {
    cursor: pointer;
  }
  summary :global(svg) {
    vertical-align: middle;
    margin-right: var(--space-2);
  }
  .help-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    padding-top: var(--space-4);
  }
  .help strong {
    display: block;
    color: var(--text);
    margin-bottom: var(--space-2);
  }
  button {
    cursor: pointer;
  }
  @media (max-width: 1100px) {
    .has-selection {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 750px) {
    .status-cards,
    .help-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
