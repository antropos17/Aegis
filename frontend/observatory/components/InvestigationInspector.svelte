<script lang="ts">
  import { t } from '../runtime/i18n';
  import { confirmed, invoke, type Host, type RecordData } from '../runtime/host';
  import { describeObservation, observationTime } from '../../../src/shared/observation-display.js';
  import { exactExceptionTarget } from '../runtime/false-positive-control';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import ObservationIdentity from './ObservationIdentity.svelte';
  import FalsePositiveToggle from './FalsePositiveToggle.svelte';
  let {
    host,
    request,
    close,
    fullDetails,
    refreshFalsePositives,
    statusRevision = 0,
    visible = true,
  }: {
    host: Host | null;
    request: { title: string; row: RecordData; agents: RecordData[] };
    close: () => void;
    fullDetails: () => void;
    refreshFalsePositives: () => Promise<void>;
    statusRevision?: number;
    visible?: boolean;
  } = $props();
  const prefix = $props.id();
  const info = $derived(describeObservation(request.row, request.agents));
  const exceptionTarget = $derived(exactExceptionTarget(request.row));
  const observedAt = $derived(observationTime(request.row.timestamp));
  const folderPath = $derived(
    info.kind !== 'Network' && (request.row.file || request.row.path || request.row.cwd),
  );
</script>

<section
  id="investigation-evidence"
  tabindex="-1"
  class="investigation-inspector panel"
  aria-label={$t('Selected evidence')}
>
  <div class="inspector-heading">
    <h2 id={prefix + '-title'}>{$t('Selected evidence')}</h2>
    <button class="icon-button" aria-label={$t('Close evidence')} onclick={close}
      ><Icon name="close" /></button
    >
  </div>
  <div class="resource-line">
    <span class="badge">{$t(info.kind)}</span>
    <strong>{String(request.row.action || request.row.state || $t('Not recorded'))}</strong>
    {#if request.row.sensitive}<span class="badge sensitive">{$t('Sensitive')}</span>{/if}
  </div>
  <div class="recorded-resource">
    <span>{$t('Full path / address')}</span>
    <code>{info.path}</code>
  </div>
  <div class="recorded-owner">
    <span>{$t('Agent / context')}</span>
    <ObservationIdentity row={request.row} agents={request.agents} />
  </div>
  <p class="recorded-explanation">{info.explanation}</p>
  <p class="recorded-time">
    {observedAt ? new Date(observedAt).toLocaleString() : $t('Observation time not recorded')}
  </p>
  <div class="evidence-actions">
    {#if folderPath}
      <Action
        disabled={typeof host?.revealInExplorer !== 'function'}
        action={async () => confirmed(await invoke(host, 'revealInExplorer', folderPath))}
        >{$t('Show in folder')}</Action
      >
    {/if}
    <button class="button" onclick={fullDetails}>{$t('Full details')}</button>
  </div>
  {#if exceptionTarget}
    <div class="exception-area">
      <FalsePositiveToggle
        {host}
        target={exceptionTarget}
        {refreshFalsePositives}
        {statusRevision}
        {visible}
      />
    </div>
  {/if}
</section>

<style>
  .investigation-inspector {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--panel-inset);
    position: sticky;
    top: var(--workspace-sticky-offset, 0px);
  }
  .inspector-heading,
  .resource-line,
  .evidence-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .inspector-heading {
    justify-content: space-between;
  }
  .evidence-actions {
    align-items: flex-start;
  }
  h2 {
    margin: 0;
    font-size: var(--text-body);
  }
  .recorded-resource,
  .recorded-owner {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .recorded-resource > span,
  .recorded-owner > span,
  .recorded-time {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  .recorded-resource code {
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: var(--text-caption);
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .recorded-explanation {
    font-size: var(--text-caption);
  }
  .sensitive {
    color: var(--amber);
  }
  .exception-area {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
  }
  @media (max-width: 1180px) {
    .investigation-inspector {
      position: static;
    }
  }
</style>
