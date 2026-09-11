<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { confirmed, invoke, record, records, type Host, type RecordData } from '../runtime/host';
  let { host, agent }: { host: Host | null; agent: string } = $props();
  let entries = $state<RecordData[]>([]);
  let catalog = $state<RecordData[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let message = $state('Loading watchlist…');
  let error = $state('');
  let limit = $state(6);
  let toggle = $state<HTMLButtonElement>();
  let alive = true;
  let resolved = $state('');
  const normalize = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toLowerCase();
  const signature = $derived(
    resolved ||
      String(
        catalog.find((row) =>
          [row.id, row.displayName, ...(Array.isArray(row.names) ? row.names : [])].some(
            (name) => normalize(name) === normalize(agent),
          ),
        )?.id || normalize(agent),
      ),
  );
  const current = $derived(entries.find((row) => row.signature === signature && row.pid == null));
  const others = $derived(entries.filter((row) => row !== current));
  function label(entry: RecordData): string {
    const name = catalog.find((row) => row.id === entry.signature)?.displayName || entry.signature;
    return String(name) + (entry.pid ? ` · PID ${entry.pid}` : ' · all processes');
  }
  async function read(): Promise<RecordData[]> {
    const value = await invoke(host, 'blocklistList');
    if (!Array.isArray(value)) throw new Error('The watchlist could not be loaded.');
    // Imported repeated rows share one action. Separate PID scopes remain separate.
    return [
      ...new Map(
        records(value).map((entry) => [
          JSON.stringify([entry.signature, entry.pid ?? null]),
          entry,
        ]),
      ).values(),
    ];
  }
  async function load() {
    if (busy) return;
    busy = true;
    error = '';
    message = 'Loading watchlist…';
    try {
      const [next, database] = await Promise.all([
        read(),
        host?.getAgentDatabase ? invoke(host, 'getAgentDatabase') : Promise.resolve({ agents: [] }),
      ]);
      if (!alive) return;
      entries = next;
      catalog = records(record(database).agents);
      loaded = true;
      message = 'Watchlist is up to date.';
    } catch (e) {
      if (alive) {
        loaded = false;
        message = '';
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (alive) busy = false;
    }
  }
  async function change(entry?: RecordData, origin?: HTMLButtonElement) {
    if (busy || !loaded || !agent.trim()) return;
    const removing = !!entry;
    const name = entry ? label(entry) : agent;
    const focused = document.activeElement === origin;
    busy = true;
    error = '';
    message = `${removing ? 'Removing' : 'Adding'} ${name}…`;
    let saved = false;
    try {
      const result = confirmed(
        await invoke(
          host,
          removing ? 'blocklistRemove' : 'blocklistAdd',
          entry
            ? { signature: entry.signature, pid: entry.pid ?? null }
            : { signature: agent, reason: 'Added from agent controls' },
        ),
      );
      saved = true;
      if (!alive) return;
      if (!removing && typeof record(result.entry).signature === 'string')
        resolved = String(record(result.entry).signature);
      const next = await read();
      if (!alive) return;
      entries = next;
      await tick();
      if (
        alive &&
        focused &&
        origin &&
        !origin.isConnected &&
        document.activeElement === document.body
      )
        toggle?.focus();
      message = removing
        ? `${name} ${result.removed === false ? 'was already absent from' : 'removed from'} the watchlist.`
        : `${name} added to the watchlist.`;
    } catch (e) {
      if (!alive) return;
      const detail = e instanceof Error ? e.message : String(e);
      if (saved) loaded = false;
      message = '';
      error = saved
        ? `Change saved, but the list could not be refreshed. Reload the watchlist. ${detail}`
        : `Change not saved. ${detail}`;
    } finally {
      if (alive) busy = false;
    }
  }
  onMount(() => {
    void load();
    return () => {
      alive = false;
    };
  });
</script>

<section class="detail-section watchlist" aria-label="Alert watchlist">
  <div class="watch-heading">
    <h3>Alert watchlist</h3>
    <button class="button" aria-disabled={busy} onclick={load}>Reload watchlist</button>
  </div>
  <p class="entity-note">
    One entry per agent and scope. Entries raise alerts; they do not block execution.
  </p>
  <div class="watch-subject" aria-busy={busy}>
    <div>
      <strong>{agent || 'Agent not identified'}</strong><small
        >{!loaded
          ? 'Status unavailable'
          : current
            ? 'On the watchlist · all processes'
            : 'Not on the watchlist for all processes'}</small
      >
    </div>
    <button
      bind:this={toggle}
      class="button"
      aria-disabled={busy || !loaded || !agent.trim()}
      onclick={(event) => change(current, event.currentTarget)}
      >{current ? 'Remove agent' : 'Watch agent'}</button
    >
  </div>
  <div class="watch-feedback">
    <p role="status">{message}</p>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
  </div>
  {#if loaded && others.length}<details>
      <summary>Other watchlist entries ({others.length})</summary>
      <ul>
        {#each others.slice(0, limit) as entry (JSON.stringify( [entry.signature, entry.pid ?? null] ))}<li
          >
            <span>{label(entry)}</span><button
              class="button"
              aria-label={`Remove ${label(entry)}`}
              aria-disabled={busy}
              onclick={(event) => change(entry, event.currentTarget)}>Remove</button
            >
          </li>{/each}
      </ul>
      {#if limit < others.length}<button class="button" onclick={() => (limit += 6)}
          >Show more entries</button
        >{/if}
    </details>{/if}
</section>

<style>
  .watchlist {
    min-width: 0;
  }
  .watch-heading,
  .watch-subject,
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  h3,
  p {
    margin: 0;
  }
  .entity-note {
    margin-block: var(--space-2) var(--space-3);
  }
  .watch-subject {
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    background: var(--bg);
  }
  .watch-subject > div,
  li > span {
    flex: 1 1 160px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
    margin-top: var(--space-1);
    font-size: var(--text-caption);
  }
  .watch-feedback {
    min-height: 2.5em;
    padding-block: var(--space-2);
    color: var(--muted);
    font-size: var(--text-body);
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--red);
  }
  summary {
    cursor: pointer;
    padding-block: var(--space-2);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    padding-block: var(--space-2);
    border-top: 1px solid var(--border);
  }
  button {
    white-space: normal;
    height: auto;
  }
</style>
