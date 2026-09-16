<script lang="ts">
  import { t } from '../runtime/i18n';
  import type { RecordData } from '../runtime/host';

  let { row }: { row: RecordData } = $props();
  const record = (value: unknown): RecordData =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as RecordData)
      : {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const reasons: Record<string, string> = {
    'process-relationship-only':
      'The observed parent relationship does not establish delegation or data transfer.',
    'connection-observed-before-file':
      'This TCP connection was already observed before the file event.',
    'first-tcp-observation-after-file':
      'This TCP connection was first observed after the file event.',
    'tcp-history-unavailable':
      'Connection history is incomplete; the local socket could not be identified.',
    'file-read-unobserved': 'The file event reports a held handle, without a file-access event.',
    'ownership-incomplete': 'At least one step has no recorded owner evidence.',
    'ownership-inferred': 'At least one owner is inferred from a path.',
  };
  let details = $derived(record(row.extra ?? row.details));
  let assessment = $derived(record(details.assessment));
  let relationship = $derived(record(details.relationship));
  let related = $derived(relationship.source === 'fresh-process-table');
  let calibrated = $derived(assessment.policy === 'credential-egress-v1');
  let steps = $derived(Array.isArray(details.steps) ? details.steps.slice(0, 16).map(record) : []);
  let explanation = $derived(
    Array.isArray(assessment.reasons)
      ? assessment.reasons.filter(
          (key): key is string => typeof key === 'string' && Object.hasOwn(reasons, key),
        )
      : [],
  );
  function time(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15
      ? new Date(value).toLocaleTimeString()
      : '—';
  }
  function endpoint(net: RecordData, side: 'local' | 'remote'): string {
    const address = text(net[side + 'Ip']);
    const port = net[side + 'Port'];
    return address
      ? `${address.includes(':') ? '[' + address + ']' : address}:${typeof port === 'number' ? port : '—'}`
      : '—';
  }
</script>

<section class="detail-section sequence-evidence" aria-label={$t('Sequence evidence')}>
  <div class="section-heading">
    <h3>{$t('Sequence evidence')}</h3>
    <span class="badge">{text(details.ruleId) || text(row.action)}</span>
  </div>
  <p class="entity-note">
    {related
      ? $t(
          'These observations belong to two distinct process instances with an observed parent relationship.',
        )
      : $t('These observations are linked to the same recorded process instance.')}
  </p>
  {#if related}
    <p class="entity-note">
      {$t('Observed parent PID {parent} → child PID {child}.', {
        parent: relationship.parentPid,
        child: relationship.childPid,
      })}
    </p>
    <dl>
      <dt>{$t('Relationship snapshot at file event')}</dt>
      <dd>{time(relationship.fileRelationObservedAt)}</dd>
      <dt>{$t('Relationship snapshot at TCP event')}</dt>
      <dd>{time(relationship.observedAt)}</dd>
    </dl>
  {/if}
  {#if calibrated}
    <p class="assessment">
      <strong>{$t('Data transfer was not observed.')}</strong>
      {$t('This is a temporal correlation, not proof of credential theft.')}
    </p>
    <ul class="reasons">
      {#each explanation as reason, index (index)}<li>{$t(reasons[reason])}</li>{/each}
    </ul>
  {:else}
    <p class="entity-note">{$t('Evidence assessment was not recorded for this rule.')}</p>
  {/if}
  {#if steps.length}
    <ol class="steps">
      {#each steps as step, index (index)}
        {@const net = record(step.network)}
        {@const owner = record(step.attribution)}
        <li>
          <div class="step-heading">
            <strong
              >{index + 1}. {$t(
                step.action === 'network-connection'
                  ? 'TCP observation'
                  : step.action === 'file-handle-held'
                    ? 'File handle held'
                    : step.action === 'file-accessed'
                      ? 'File access observation'
                      : 'Observation',
              )}</strong
            >
            <span>{time(step.at)}</span>
          </div>
          {#if related && step.agent}<p class="owner">
              {$t('Recorded agent')}: {text(step.agent)}
            </p>{/if}
          {#if step.path}<code>{text(step.path)}</code>{/if}
          {#if step.network}
            <dl>
              <dt>{$t('Local socket')}</dt>
              <dd><code>{endpoint(net, 'local')}</code></dd>
              <dt>{$t('Remote endpoint')}</dt>
              <dd><code>{endpoint(net, 'remote')}</code></dd>
              {#if net.domain}<dt>{$t('Domain')}</dt>
                <dd>{text(net.domain)}</dd>{/if}
              <dt>{$t('First TCP observation')}</dt>
              <dd>{time(net.firstObservedAt)}</dd>
            </dl>
          {/if}
          <p class="owner">
            {$t('Owner evidence')}: {$t(
              owner.status === 'confirmed' && Array.isArray(owner.evidence) && owner.evidence.length
                ? 'PID-backed'
                : owner.status === 'inferred'
                  ? 'Inferred'
                  : 'Not recorded',
            )}
            {#if typeof step.pid === 'number'}
              · PID {step.pid}{/if}
          </p>
          {#if step.instanceId}<code class="identity">{text(step.instanceId)}</code>{/if}
          {#if Array.isArray(owner.evidence) && owner.evidence.length}
            <code class="identity"
              >{owner.evidence.filter((value) => typeof value === 'string').join(', ')}</code
            >
          {/if}
        </li>
      {/each}
    </ol>
  {:else}<p class="entity-note">{$t('Ordered steps were not recorded.')}</p>{/if}
  {#if calibrated}
    <p class="entity-note">
      {$t(
        related
          ? 'Only a direct parent relationship observed within 30 seconds is covered. Polling gaps, limited process identity resolution and unobserved processes can break this correlation. No delegated action or transferred content is established.'
          : 'Polling records observation order. File contents and TCP payloads are not inspected. Tuple reuse, gaps and bounded history limit the assessment; transfers over existing connections and activity across different processes remain unresolved.',
      )}
    </p>
  {/if}
</section>

<style>
  .assessment {
    color: var(--ink);
    line-height: 1.6;
  }
  .reasons {
    margin: 0;
    padding-left: var(--space-5);
    color: var(--muted);
  }
  .steps {
    display: grid;
    gap: var(--space-3);
    list-style: none;
    margin: var(--space-3) 0;
    padding: 0;
  }
  .steps > li {
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
  }
  .step-heading {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  .step-heading > span,
  .owner,
  .identity {
    color: var(--muted);
  }
  code {
    overflow-wrap: anywhere;
    white-space: normal;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(90px, 1fr) minmax(0, 3fr);
    gap: var(--space-2);
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .owner {
    margin: var(--space-2) 0 0;
  }
  .identity {
    display: block;
    font-size: var(--text-caption);
  }
</style>
