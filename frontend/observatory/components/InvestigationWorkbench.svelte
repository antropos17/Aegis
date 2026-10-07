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
    <div class="investigation-sidebar">
      <div id="investigation-context" tabindex="-1">
        <InvestigationHeader
          {telemetry}
          {liveTelemetry}
          {host}
          {scope}
          {change}
          {inspect}
          {paused}
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
    gap: var(--space-4);
    align-items: start;
    min-width: 0;
  }
  .investigation-body,
  .investigation-sidebar,
  .activity-feed {
    min-width: 0;
  }
  .investigation-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(250px, 300px);
    gap: var(--space-4);
    align-items: start;
  }
  .investigation-sidebar {
    display: grid;
    gap: var(--space-4);
    align-self: stretch;
    align-content: start;
  }
  .activity-feed {
    border: 1px solid var(--strong-border);
    border-radius: var(--surface-radius);
    padding: var(--panel-inset);
    background: var(--panel);
  }
  .activity-feed > h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-body);
  }
  .activity-feed :global(.activity-channels) {
    margin-bottom: var(--space-2);
  }
  @media (max-width: 980px) {
    .investigation-workbench {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
    }
    .investigation-body {
      gap: var(--space-4);
      grid-template-columns: minmax(0, 1fr) 250px;
    }
    .investigation-workbench :global(.investigation-roster) {
      max-width: none;
    }
    .investigation-workbench :global(.roster-list) {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
    }
  }
  @media (max-width: 760px) {
    .investigation-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
