<script lang="ts">
  import Icon from './Icon.svelte';
  import ResourceIcon from './ResourceIcon.svelte';
  import { resourceVisual } from '../runtime/resource-visual';
  import { t } from '../runtime/i18n';

  import { instances, type RecordData, type Telemetry } from '../runtime/host';
  import { protectionPolicy, type ProtectionActivity } from '../runtime/protection';
  let {
    activity,
    telemetry,
    permissions,
    inspect,
    openPolicy,
  }: {
    activity: ProtectionActivity;
    telemetry: Telemetry;
    permissions: RecordData | null;
    inspect: (_title: string, _row: RecordData) => void;
    openPolicy: (_key: string) => void;
  } = $props();
  const policy = $derived(protectionPolicy(activity, instances(telemetry), permissions));
</script>

<aside class="panel evidence" aria-label={$t('Selected activity')}>
  <h3>{$t('Understand this activity')}</h3>
  <p class="actor">{activity.actor}</p>
  <p>{$t(activity.action)}</p>
  <div class="destination">
    <span class="destination-label">{$t('Where')}</span>
    <div class="destination-resource">
      <ResourceIcon row={activity.latest} />
      <div>
        <span class="destination-kind">{$t(resourceVisual(activity.latest).label)}</span><code
          >{activity.target}</code
        >
      </div>
    </div>
  </div>
  {#if activity.latest.remoteIp}<p class="muted">
      {$t('Observed IP:')}
      {String(activity.latest.remoteIp)}{activity.latest.remotePort
        ? `:${activity.latest.remotePort}`
        : ''}
    </p>{/if}
  <h4>{activity.level === 'review' ? $t('Why review this?') : $t('What is known?')}</h4>
  <p>{$t(activity.reason)}</p>
  {#if activity.latest.reason}<p class="muted">
      {$t('Recorded reason:')}
      {String(activity.latest.reason)}
    </p>{/if}
  <details>
    <summary>{$t(activity.attribution)} {$t('· how do we know?')}</summary>
    <p>{activity.explanation}</p>
    <p>{$t('Source:')} {activity.source}</p>
    {#if activity.latest.action === 'holding' || activity.latest.action === 'accessed'}
      <p>{$t('An open handle does not prove that file contents were read.')}</p>
    {/if}
    <p>
      {activity.rows.length}
      {$t('retained record(s)')}{activity.time
        ? $t(' · latest {value0}', { value0: new Date(activity.time).toLocaleString() })
        : $t(' · observation time unavailable')}
    </p>
  </details>
  <div class="preference">
    <h4>{$t('Current saved preference')}</h4>
    <strong>{$t(policy.label)}</strong>
    <p>
      {$t(
        'AEGIS does not automatically block file or network access. A saved rule does not prove an action was allowed or denied.',
      )}
    </p>
    {#if policy.agent}<button class="button" onclick={() => openPolicy(policy.agent!.instanceKey)}
        ><Icon name="edit" />{$t('Edit this agent’s policy')}</button
      >{/if}
  </div>
  <h4>{$t('What you can do')}</h4>
  <p>
    {$t(
      'If this activity is unexpected, inspect the agent. Its process page offers pause and stop controls.',
    )}
  </p>
  <div class="actions">
    <button
      class="button"
      onclick={() =>
        inspect(
          'Activity evidence',
          activity.rows.length > 1 ? { observations: activity.rows } : activity.latest,
        )}><Icon name="file" />{$t('Open evidence')}</button
    >
    <button
      class="button"
      disabled={!policy.agent || telemetry.stale}
      onclick={() =>
        policy.agent && inspect(policy.agent.name, { ...policy.agent, detailSection: 'processes' })}
      ><Icon name="cpu" />{$t('Agent & controls')}</button
    >
  </div>
  {#if !policy.agent || telemetry.stale}<p class="muted">
      {$t('Process controls need an exact, currently observed agent.')}
    </p>{/if}
</aside>

<style>
  .evidence {
    padding: var(--space-4);
    align-self: start;
    font-size: var(--text-body);
    line-height: 1.6;
    min-width: 0;
  }
  h3 {
    font-size: var(--text-section);
    margin: 0 0 var(--space-4);
  }
  h4 {
    font-size: var(--text-body);
    margin: var(--space-4) 0 var(--space-2);
  }
  p {
    margin: var(--space-2) 0;
    overflow-wrap: anywhere;
  }
  .actor {
    font-weight: 650;
    font-size: var(--text-section);
  }
  .destination {
    background: var(--bg);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    margin: var(--space-3) 0;
  }
  .destination-label,
  .destination-kind {
    display: block;
    color: var(--muted);
    margin-bottom: var(--space-1);
  }
  .destination-resource {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: var(--space-2);
  }
  code {
    overflow-wrap: anywhere;
    white-space: normal;
    font-size: var(--text-body);
  }
  details {
    margin: var(--space-4) 0;
  }
  summary {
    cursor: pointer;
  }
  .preference {
    border-block: 1px solid var(--border);
    padding-bottom: var(--space-4);
  }
  .preference strong {
    color: var(--amber);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    white-space: normal;
    height: auto;
    min-height: var(--control-height);
  }
</style>
