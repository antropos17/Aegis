<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { AgentScope } from '../runtime/agent-scope';
  import type { Host, RecordData, Telemetry } from '../runtime/host';
  import InvestigationRoster from './InvestigationRoster.svelte';
  import InvestigationHeader from './InvestigationHeader.svelte';
  import InvestigationInspector from './InvestigationInspector.svelte';
  import Events from './Events.svelte';
  let {
    telemetry,
    liveTelemetry,
    host,
    scope,
    change,
    inspect,
    capture,
    request,
    closeEvidence,
    refreshFalsePositives,
    fullDetails,
    paused = false,
    visible = true,
    channelRequest,
    statusRevision = 0,
    inspectorVisible = true,
  }: {
    telemetry: Telemetry;
    liveTelemetry: Telemetry;
    host: Host | null;
    scope: AgentScope;
    change: (_scope: AgentScope) => void;
    inspect: (_title: string, _row: RecordData) => void;
    capture: (_title: string, _row: RecordData, _agents?: RecordData[]) => void;
    fullDetails: (_title: string, _row: RecordData) => void;
    request: { title: string; row: RecordData; agents: RecordData[] } | null;
    closeEvidence: () => void;
    refreshFalsePositives: () => Promise<void>;
    paused?: boolean;
    visible?: boolean;
    channelRequest?: { channel: 'files' | 'connections'; revision: number };
    statusRevision?: number;
    inspectorVisible?: boolean;
  } = $props();
</script>

<section class="investigation-workbench" aria-label={$t('Investigation workspace')}>
  <InvestigationRoster {telemetry} {scope} {change} />
  <div class="investigation-body">
    <div id="investigation-context" tabindex="-1">
      <InvestigationHeader {telemetry} {liveTelemetry} {host} {scope} {change} {inspect} {paused} />
    </div>
    <div class="evidence-workspace" class:has-evidence={request !== null}>
      <div class="activity-feed">
        <h2 id="investigation-activity" tabindex="-1">{$t('Activity')}</h2>
        <Events
          {telemetry}
          {scope}
          inspect={capture}
          advanced={false}
          combined
          captureContext
          showPause={false}
          viewPaused={paused}
          {visible}
          {channelRequest}
        />
      </div>
      {#if request}
        {#key request}
          <InvestigationInspector
            {host}
            {request}
            {refreshFalsePositives}
            {statusRevision}
            visible={inspectorVisible}
            close={closeEvidence}
            fullDetails={() => fullDetails(request!.title, request!.row)}
          />
        {/key}
      {/if}
    </div>
  </div>
</section>

<style>
  .investigation-workbench {
    display: grid;
    grid-template-columns: minmax(155px, 195px) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    min-width: 0;
  }
  .investigation-body,
  .activity-feed {
    min-width: 0;
  }
  .investigation-body {
    display: grid;
    gap: var(--space-3);
  }
  .evidence-workspace {
    display: grid;
    gap: var(--space-3);
    align-items: start;
    min-width: 0;
  }
  .evidence-workspace.has-evidence {
    grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
  }
  .activity-feed > h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-body);
  }
  .activity-feed :global(.activity-channels) {
    margin-bottom: var(--space-2);
  }
  @media (max-width: 1180px) {
    .evidence-workspace.has-evidence {
      grid-template-columns: minmax(0, 1fr);
    }
    .has-evidence :global(.investigation-inspector) {
      grid-row: 1;
    }
  }
  @media (max-width: 980px) {
    .investigation-workbench {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2);
    }
    .investigation-body {
      gap: var(--space-2);
    }
    .investigation-workbench :global(.investigation-roster) {
      max-width: none;
    }
    .investigation-workbench :global(.roster-list) {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
    }
  }
</style>
