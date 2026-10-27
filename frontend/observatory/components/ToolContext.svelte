<script lang="ts">
  import { confirmed, invoke, type Host, type RecordData } from '../runtime/host';
  import { toolContextView, type ToolContextView } from '../runtime/tool-context-display';
  import { t } from '../runtime/i18n';

  let { row, host = null }: { row: RecordData; host?: Host | null } = $props();
  const id = $props.id();
  type Availability = 'available' | 'partial' | 'unavailable' | 'invalid';
  let loaded = $state<{
    eventId: string;
    version: number;
    availability: Availability;
    view: ToolContextView;
  } | null>(null);
  let pending = $state<string | null>(null);
  let failed = $state<{ eventId: string; version: number } | null>(null);
  // A private generation invalidates in-flight work when a selection changes
  // away and back; rendering is driven by eventId and the loaded state.
  const selection = { version: 0 };
  let eventId = $derived(typeof row.eventId === 'string' ? row.eventId : null);
  let canExplain = $derived(eventId !== null && typeof host?.explainToolContext === 'function');
  let hasLive = $derived(
    loaded !== null && loaded.eventId === eventId && loaded.version === selection.version,
  );
  let context = $derived(hasLive && loaded ? loaded.view : toolContextView(row));
  $effect(() => {
    eventId;
    selection.version++;
  });

  function project(result: RecordData): { availability: Availability; view: ToolContextView } {
    const availability = result.availability;
    const invalidView = () => toolContextView({ toolContext: null });
    if (
      (availability !== 'available' &&
        availability !== 'partial' &&
        availability !== 'unavailable') ||
      !result.toolContext ||
      typeof result.toolContext !== 'object' ||
      Array.isArray(result.toolContext)
    )
      return { availability: 'invalid', view: invalidView() };
    const value = result.toolContext as RecordData;
    // A partial source cannot establish a complete association, even if its
    // envelope contains an otherwise positive capsule.
    const capsule =
      availability === 'partial' &&
      Array.isArray(value.reasons) &&
      !value.reasons.includes('partial-source')
        ? { ...value, reasons: [...value.reasons, 'partial-source'] }
        : value;
    const view = toolContextView({ toolContext: capsule });
    if (view.reasons.includes('Recorded tool context could not be validated.'))
      return { availability: 'invalid', view: invalidView() };
    if (availability !== 'unavailable') return { availability, view };
    const reasons = view.reasons.filter(
      (reason) =>
        ![
          'Session binding, object and time interval matched.',
          'The recorded session binding matched.',
          'A positive diagnostic was recorded; current evidence limits the association.',
        ].includes(reason),
    );
    return {
      availability,
      view: {
        ...view,
        association: 'Unavailable',
        binding: 'Unavailable',
        object: 'Unavailable',
        count: null,
        truncated: false,
        ambiguous: false,
        candidates: [],
        reasons: reasons.length ? reasons : ['Tool context is unavailable for this observation.'],
      },
    };
  }

  async function explain() {
    if (!canExplain || !eventId || pending !== null) return;
    const selected = eventId;
    const version = selection.version;
    pending = selected;
    failed = null;
    loaded = null;
    try {
      const result = confirmed(await invoke(host, 'explainToolContext', selected));
      if (eventId === selected && selection.version === version)
        loaded = { eventId: selected, version, ...project(result) };
    } catch {
      if (eventId === selected && selection.version === version)
        failed = { eventId: selected, version };
    } finally {
      pending = null;
    }
  }
</script>

<section class="detail-section tool-context" aria-labelledby={id}>
  <h3 {id}>{$t('Preceding tool call')}</h3>
  <p class="association">{$t(context.association)}</p>
  <p class="limit">
    {$t(
      'A preceding call is temporal context. It does not establish causation or change PID attribution.',
    )}
  </p>
  {#if canExplain}
    <button
      class="button"
      onclick={explain}
      disabled={pending !== null}
      aria-busy={pending === eventId}
    >
      {$t(pending === eventId ? 'Reading local history…' : 'Explain from local history')}
    </button>
    <p class="limit">
      {$t(
        'Reads local Claude Code history for this observation. Prompts and argument values stay private.',
      )}
    </p>
    {#if hasLive && loaded}<p class="limit" role="status">
        {$t(
          loaded.availability === 'available'
            ? 'Local history checked. This explanation does not modify the recorded audit evidence.'
            : loaded.availability === 'partial'
              ? 'Local history is partially available. This explanation does not modify the recorded audit evidence.'
              : loaded.availability === 'unavailable'
                ? 'Local history is unavailable. The recorded observation is unchanged.'
                : 'Local history response could not be validated. The recorded observation is unchanged.',
        )}
      </p>{/if}
    {#if failed?.eventId === eventId && failed?.version === selection.version}<p
        class="context-warning"
        role="status"
      >
        {$t('Local history could not be read. The recorded observation is unchanged.')}
      </p>{/if}
  {:else}
    <p class="limit">
      {$t('Live tool correlation is unavailable. This section displays recorded metadata.')}
    </p>
  {/if}
  <dl>
    <div>
      <dt>{$t('Session binding')}</dt>
      <dd>{$t(context.binding)}</dd>
    </div>
    <div>
      <dt>{$t('Object comparison')}</dt>
      <dd>{$t(context.object)}</dd>
    </div>
    <div>
      <dt>{$t('Recorded candidate count')}</dt>
      <dd>{context.count === null ? $t('Unavailable') : context.count}</dd>
    </div>
  </dl>
  {#if context.ambiguous}<p class="context-warning">
      {$t('Multiple candidates; no single tool call is established.')}
    </p>{/if}
  {#if context.truncated}<p class="context-warning">
      {$t('Candidate list is truncated; additional context is unavailable.')}
    </p>{/if}
  {#if context.reasons.length}
    <ul class="reasons">
      {#each context.reasons as reason (reason)}<li>{$t(reason)}</li>{/each}
    </ul>
  {/if}
  {#if context.candidates.length}
    <ol class="candidates" aria-label={$t('Recorded tool candidates')}>
      {#each context.candidates as candidate (candidate.key)}
        <li>
          <div class="candidate-heading">
            <strong
              >{candidate.provider} · {candidate.tool === 'Other tool'
                ? $t('Other tool')
                : candidate.tool}</strong
            ><span>{$t(candidate.association)}</span>
          </div>
          <p>{$t(candidate.relation)} · {$t(candidate.timing, { deltaMs: candidate.deltaMs })}</p>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .tool-context {
    color: var(--ink);
  }
  .association {
    margin: 0 0 var(--space-2);
    font-weight: 600;
  }
  .limit,
  dt,
  .candidate-heading span {
    color: var(--muted);
  }
  .limit,
  .context-warning,
  .reasons,
  .candidates p {
    font: var(--text-body)/1.5 var(--sans);
  }
  .limit {
    margin: 0 0 var(--space-3);
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--space-3);
    margin: 0;
  }
  dt {
    font-size: var(--text-caption);
  }
  dd {
    margin: var(--space-1) 0 0;
    overflow-wrap: anywhere;
  }
  .context-warning {
    color: var(--amber);
    margin: var(--space-3) 0 0;
  }
  .reasons {
    padding-inline-start: var(--space-5);
    margin: var(--space-3) 0 0;
  }
  .candidates {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
  }
  .candidates li {
    border-top: 1px solid var(--border);
    padding: var(--space-3) 0 0;
    margin-top: var(--space-3);
  }
  .candidate-heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .candidate-heading strong,
  .candidate-heading span {
    overflow-wrap: anywhere;
  }
  .candidates p {
    margin: var(--space-2) 0 0;
    font-variant-numeric: tabular-nums;
  }
</style>
