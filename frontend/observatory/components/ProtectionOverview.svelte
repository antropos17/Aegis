<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
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
  const reviewedRows = new SvelteMap<string, WeakSet<RecordData>>();
  const reviewedKeys = $derived.by(() => {
    const keys = new SvelteSet<string>();
    for (const item of activity) {
      const rows = reviewedRows.get(item.key);
      if (
        item.kind === 'File' &&
        item.level === 'review' &&
        rows &&
        item.rows.every((row) => rows.has(row))
      )
        keys.add(item.key);
    }
    return keys;
  });
  $effect(() => {
    for (const key of reviewedRows.keys()) if (!reviewedKeys.has(key)) reviewedRows.delete(key);
  });
  const reviewCount = $derived(
    activity.filter((item) => item.level === 'review' && !reviewedKeys.has(item.key)).length,
  );
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
  function toggleReview(key: string) {
    const item = activity.find((entry) => entry.key === key);
    if (!item || item.kind !== 'File' || item.level !== 'review') return;
    if (reviewedKeys.has(key)) reviewedRows.delete(key);
    else reviewedRows.set(key, new WeakSet(item.rows));
  }
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
  let activityLayout = $state<HTMLDivElement>();
  let selectionOrigin: HTMLButtonElement;
  async function selectActivity(item: ProtectionActivity, button: HTMLButtonElement) {
    selected = item;
    selectionOrigin = button;
    await tick();
    if (!selectionHeading?.isConnected || selectionHeading.closest('[hidden], [inert]')) return;
    selectionHeading?.focus({ preventScroll: true });
    selectionHeading?.scrollIntoView?.({ block: 'nearest' });
  }
  async function closeDetails() {
    const origin = selectionOrigin;
    selected = null;
    await tick();
    const target = origin?.isConnected
      ? origin
      : activityLayout?.querySelector<HTMLElement>('.activity-panel');
    if (!target || target.closest('[hidden], [inert]')) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest' });
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
  <div class="activity-layout" class:has-selection={!!current} bind:this={activityLayout}>
    <ProtectionActivityList
      {activity}
      {reviewedKeys}
      {reviewCount}
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
          reviewed={reviewedKeys.has(current.key)}
          reviewable={retained && current.kind === 'File' && current.level === 'review'}
          toggleReview={() => current && toggleReview(current.key)}
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
    <div class="help-actions">
      <button class="button" onclick={() => navigate('guide')}>{$t('Explore all tasks')}</button>
    </div>
  </details>
</section>

<style>
  .protection {
    font-size: var(--text-body);
  }
  .intro {
    margin-bottom: var(--space-4);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-section);
    margin: 0 0 var(--space-1);
  }
  p {
    color: var(--muted);
    line-height: 1.6;
    margin: 0;
  }
  .status-cards {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .status-cards > * {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    padding: var(--space-3);
    flex: 1 1 150px;
    min-width: 0;
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
    margin: var(--space-1) 0 0;
    font-size: var(--text-title);
  }
  .status-cards small {
    font-size: var(--text-body);
    font-weight: 400;
    color: var(--muted);
  }
  .attention strong {
    color: var(--amber);
  }
  .status-cards .protection-limit {
    flex: 2 1 240px;
  }
  .protection-limit strong {
    font-size: var(--text-section);
  }
  .status-cards > button:hover {
    background: var(--raised);
    border-color: var(--strong-border);
  }
  .activity-layout {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  .has-selection {
    grid-template-columns: minmax(280px, 0.85fr) minmax(0, 1.6fr);
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
  .help-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .help-actions .button {
    min-height: var(--control-height);
    height: auto;
    white-space: normal;
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
    .help-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-height: 700px) {
    .intro {
      display: none;
    }
  }
</style>
