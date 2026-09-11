<script lang="ts">
  import { t } from '../runtime/i18n';

  import type { RecordData, Telemetry } from '../runtime/host';
  import {
    resourceProcess,
    type RadarResource,
    type ResourceRelation,
  } from '../runtime/radar-resources';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  let {
    resource,
    layer,
    telemetry,
    inspect,
    retained = true,
  }: {
    resource: RadarResource;
    layer: string;
    telemetry: Telemetry;
    inspect: (_title: string, _row: RecordData) => void;
    retained?: boolean;
  } = $props();
  let page = $state(0);
  let previousKey = '';
  $effect(() => {
    if (resource.key !== previousKey) {
      previousKey = resource.key;
      page = 0;
    }
  });
  const pages = $derived(Math.max(1, Math.ceil(resource.relations.length / 4)));
  const index = $derived(Math.min(page, pages - 1));
  const relations = $derived(resource.relations.slice(index * 4, index * 4 + 4));
  const labels = {
    review: 'Review needed',
    unverified: 'Unverified destination',
    observed: 'No risk flag',
  };
  function evidence(rows: RecordData[]) {
    inspect(
      layer === 'files' ? 'File observation' : 'Network observation',
      rows.length === 1 ? rows[0] : { observationGroup: resource.label, observations: rows },
    );
  }
  function process(relation: ResourceRelation) {
    const agent = resourceProcess(relation, telemetry);
    if (agent) inspect(agent.agent, { ...agent, name: agent.agent, detailSection: 'processes' });
  }
</script>

<section class="resource-investigation" aria-label={$t('Resource relationships')}>
  <header>
    <span class="eyebrow"
      >{layer === 'files' ? $t('Selected file') : $t('Selected destination')}</span
    >
    <h3><Icon name={layer === 'files' ? 'file' : 'network'} />{resource.label}</h3>
    {#if layer === 'files'}<code>{resource.address}</code>{/if}
    {#if resource.ip}<p>{$t('Observed IP:')} <code>{resource.ip}</code></p>{/if}
    {#if !retained}<p class="notice">
        {$t('No longer in the current data. These are the records you selected earlier.')}
      </p>{/if}
    {#if telemetry.stale}<p class="notice">
        {$t('Observation is stale. Current process navigation is unavailable.')}
      </p>{/if}
  </header>
  <div class="resource-assessment" class:review={resource.level === 'review'}>
    <strong>{labels[resource.level]}</strong>
    <p>{resource.reason}</p>
  </div>
  <div class="relation-heading">
    <h4>{$t('Who is linked to this resource?')}</h4>
    <span>{resource.relations.length} {$t('relationships')}</span>
  </div>
  <div class="relations">
    {#each relations as relation (relation.key)}
      {@const live = resourceProcess(relation, telemetry)}
      <article class="relation" data-evidence={relation.status}>
        <div class="relationship-route">
          <div class="source">
            <AgentLogo name={relation.actor || 'Unknown'} size={26} />
            <div>
              <strong>{relation.actor || $t('Agent not identified')}</strong><small
                >{relation.instanceId
                  ? $t('PID {value0} · {value1}', {
                      value0: relation.rows[0].pid ?? live?.pid ?? 'not recorded',
                      value1: live ? 'currently observed' : 'no current process link',
                    })
                  : $t('No process identity recorded')}</small
              >
            </div>
          </div>
          <span
            class="relationship-line"
            class:inferred={relation.status !== 'confirmed'}
            class:unlinked={!relation.actor}
            aria-hidden="true"><Icon name="chevron" /></span
          >
          <span class="destination-icon" aria-hidden="true"
            ><Icon name={layer === 'files' ? 'file' : 'network'} /></span
          >
        </div>
        <div class="actions-observed">
          {#each relation.actions as action (action)}<span>{action}</span>{/each}
        </div>
        <p class="attribution">{relation.attribution} · {relation.rows.length} {$t('record(s)')}</p>
        <details>
          <summary>{$t('How was this link established?')}</summary>
          <p>{relation.explanation}</p>
          <p>
            {$t('Sources:')}
            {[
              ...new Set(
                relation.rows.map((row) =>
                  String(row.source || (layer === 'network' ? 'Network snapshot' : 'Not recorded')),
                ),
              ),
            ].join(', ')}
          </p>
          {#if relation.rows.some((row) => row.action === 'holding' || row.action === 'accessed')}<p
            >
              {$t('An open file handle does not prove that the contents were read.')}
            </p>{/if}
          {#if relation.rows.some((row) => row.selfAccess === true)}<p>
              {$t('Includes activity in the agent’s own files.')}
            </p>{/if}
          {#if layer === 'network'}<p>
              {$t('Connection states:')}
              {[...new Set(relation.rows.map((row) => String(row.state || 'Not recorded')))].join(
                ', ',
              )}{$t('. A connection does not show what was sent.')}
            </p>{/if}
        </details>
        <div class="relation-actions">
          <button class="button" onclick={() => evidence(relation.rows)}
            >{$t('View records')}</button
          ><button class="button" disabled={!live} onclick={() => process(relation)}
            >{$t('Inspect process')}</button
          >
        </div>
      </article>
    {/each}
  </div>
  {#if pages > 1}<nav class="relation-pages" aria-label={$t('Relationship pages')}>
      <button
        class="button"
        aria-label={$t('Previous relationships')}
        aria-disabled={index === 0}
        onclick={() => {
          if (index > 0) page = index - 1;
        }}>{$t('Previous')}</button
      ><span>{index + 1} / {pages}</span><button
        class="button"
        aria-label={$t('Next relationships')}
        aria-disabled={index === pages - 1}
        onclick={() => {
          if (index < pages - 1) page = index + 1;
        }}>{$t('Next')}</button
      >
    </nav>{/if}
  <footer>
    <span
      >{resource.rows.length}
      {$t('retained record(s)')}{resource.time
        ? $t(' · latest {value0}', { value0: new Date(resource.time).toLocaleString() })
        : ''}</span
    ><button class="button" onclick={() => evidence(resource.rows)}
      >{$t('All resource records')}</button
    >
  </footer>
</section>

<style>
  .resource-investigation {
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    background: var(--panel);
    min-width: 0;
    font-size: var(--text-body);
    line-height: 1.55;
  }
  header,
  footer,
  .resource-assessment,
  .relation-heading {
    padding: var(--space-4);
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  .eyebrow,
  small,
  footer,
  .relation-heading span {
    color: var(--muted);
    font-size: var(--text-caption);
  }
  h3 {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    overflow-wrap: anywhere;
    margin: var(--space-2) 0;
    font-size: var(--text-section);
  }
  h3 :global(svg),
  .source :global(.agent-mark) {
    flex: none;
  }
  code {
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: var(--text-body);
  }
  p {
    margin: var(--space-2) 0 0;
    overflow-wrap: anywhere;
  }
  .notice,
  .review strong {
    color: var(--amber);
  }
  .resource-assessment {
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .resource-assessment p {
    color: var(--muted);
  }
  .relation-heading {
    padding-bottom: var(--space-2);
  }
  h4 {
    font-size: var(--text-body);
    margin: 0 0 var(--space-1);
  }
  .relations {
    padding-inline: var(--space-4);
  }
  .relation {
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .relationship-route {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 40px 30px;
    gap: var(--space-2);
    align-items: center;
  }
  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .source strong,
  small {
    display: block;
    overflow-wrap: anywhere;
  }
  .relationship-line {
    border-top: 2px solid var(--muted);
    position: relative;
  }
  .relationship-line :global(svg) {
    position: absolute;
    right: -5px;
    top: -9px;
  }
  .relationship-line.inferred {
    border-top-style: dashed;
  }
  .relationship-line.unlinked {
    visibility: hidden;
  }
  .destination-icon {
    color: var(--muted);
  }
  .actions-observed {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .actions-observed span {
    background: var(--bg);
    border-radius: var(--control-radius);
    padding: var(--space-1) var(--space-2);
  }
  .attribution {
    color: var(--muted);
  }
  details {
    margin-top: var(--space-2);
    color: var(--muted);
  }
  summary {
    cursor: pointer;
  }
  .relation-actions,
  .relation-pages,
  footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .relation-actions {
    margin-top: var(--space-3);
  }
  .relation-pages {
    flex-direction: row;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
  }
  footer {
    border-top: 1px solid var(--border);
    justify-content: space-between;
  }
  button {
    white-space: normal;
    height: auto;
  }
</style>
