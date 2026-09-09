<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { confirmed, invoke, record, records, type Host, type RecordData } from '../runtime/host';
  import { validateCatalog } from '../runtime/catalog';
  import {
    createEmptyForm,
    formFromAgent,
    buildCustomAgent,
    applyFormToAgent,
    CATEGORIES,
  } from '../../../src/renderer/lib/utils/agent-crud-utils';
  import Action from './Action.svelte';
  import AgentLogo from './AgentLogo.svelte';
  import Icon from './Icon.svelte';
  import EditorDialog from './EditorDialog.svelte';
  let category = $state('');
  let { host, inspect }: { host: Host | null; inspect: (title: string, row: RecordData) => void } =
    $props();
  let base = $state<RecordData[]>([]);
  let custom = $state<RecordData[]>([]);
  let form = $state(createEmptyForm());
  let editing = $state<string | null>(null);
  let showForm = $state(false);
  let editorSection = $state('general');
  let query = $state('');
  let error = $state('');
  let alive = true;
  let rows = $derived(
    [
      ...base.map((row) => ({ ...row, custom: false })),
      ...custom.map((row) => ({ ...row, custom: true })),
    ].filter(
      (row) =>
        (!category || record(row).category === category) &&
        JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
    ) as RecordData[],
  );
  async function load() {
    const [database, user] = await Promise.all([
      invoke(host, 'getAgentDatabase'),
      invoke(host, 'getCustomAgents'),
    ]);
    if (alive) {
      base = records(record(database).agents ?? database);
      custom = records(user);
    }
  }
  onMount(() => {
    load().catch((e) => {
      if (alive) error = String(e);
    });
    return () => {
      alive = false;
    };
  });
  async function persist(next: RecordData[]) {
    const validated = validateCatalog(next);
    if (validated.some((a) => base.some((b) => a.id === b.id)))
      throw new Error('Custom IDs must differ from bundled agent IDs');
    confirmed(await invoke(host, 'saveCustomAgents', validated));
    await load();
  }
  async function save() {
    if (!form.displayName.trim()) {
      editorSection = 'general';
      throw new Error('Name is required');
    }
    if (!form.processName.trim()) {
      editorSection = 'recognition';
      throw new Error('Process signature is required');
    }
    const next = editing
      ? custom.map((row) => (row.id === editing ? applyFormToAgent(row, form) : row))
      : [...custom, buildCustomAgent(form)];
    await persist(next);
    if (alive) showForm = false;
  }
  async function importAgents() {
    const imported = confirmed(await invoke(host, 'importAgentDatabase'));
    const incoming = validateCatalog(imported.agents);
    const unique = incoming.filter((a) => !base.some((b) => b.id === a.id));
    if (!unique.length) throw new Error('Import contains no custom agents');
    const merged = new SvelteMap(custom.map((a) => [a.id, a]));
    for (const agent of unique) merged.set(agent.id, agent);
    await persist([...merged.values()]);
  }
</script>

<div class="filterbar">
  <label class="search-field"
    ><Icon name="search" /><input
      type="search"
      aria-label="Search catalog"
      bind:value={query}
      placeholder="Name, signature or vendor…"
    /></label
  ><label
    >Category <select aria-label="Catalog category" bind:value={category}
      ><option value="">All categories</option>{#each CATEGORIES as [id, title] (id)}<option
          value={id}>{title}</option
        >{/each}</select
    ></label
  ><span class="spacer"></span><button
    class="button"
    onclick={() => {
      form = createEmptyForm();
      editing = null;
      editorSection = 'general';
      showForm = true;
    }}><Icon name="plus" />Add agent</button
  ><Action action={importAgents}>Import</Action><Action
    action={async () => confirmed(await invoke(host, 'exportAgentDatabase'))}>Export</Action
  >
</div>

<section class="panel">
  {#if error}<p role="alert" class="inset">{error}</p>{/if}
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>Agent</th><th>Category</th><th>Process signatures</th><th>Risk</th><th>Actions</th
          ></tr
        ></thead
      ><tbody
        >{#each rows as row (String(row.id))}<tr
            ><td
              ><button
                class="catalog-identity"
                onclick={() => inspect(String(row.displayName), row)}
                ><AgentLogo id={String(row.id)} /><span
                  ><strong>{String(row.displayName)}</strong><small
                    >{String(row.vendor ?? (row.custom ? 'Custom' : 'Bundled'))}</small
                  ></span
                ></button
              ></td
            ><td>{String(row.category ?? '')}</td><td
              ><div class="signature-links">
                {#each Array.isArray(row.names) ? row.names.slice(0, 3) : [] as name (name)}<button
                    class="text-link"
                    onclick={() =>
                      inspect('Process signature', { signature: name, agent: row.displayName })}
                    >{String(name)}</button
                  >{/each}{#if Array.isArray(row.names) && row.names.length > 3}<button
                    class="text-link"
                    onclick={() => inspect(String(row.displayName), row)}
                    >+{row.names.length - 3} more</button
                  >{/if}
              </div></td
            ><td
              ><span
                class="badge"
                class:low={row.riskProfile === 'low'}
                class:high={row.riskProfile === 'high'}
                class:medium={row.riskProfile === 'medium'}
                >{String(row.riskProfile ?? 'Unknown')}</span
              ></td
            ><td
              ><div class="toolbar">
                <button class="button" onclick={() => inspect(String(row.displayName), row)}
                  >Details</button
                >
                {#if row.custom}<button
                    class="button"
                    onclick={() => {
                      editing = String(row.id);
                      form = formFromAgent(row);
                      editorSection = 'general';
                      showForm = true;
                    }}>Edit</button
                  ><Action action={() => persist(custom.filter((a) => a.id !== row.id))}
                    >Delete</Action
                  >{/if}
              </div></td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

{#if showForm}
  <EditorDialog
    title={editing ? 'Edit custom agent' : 'Add custom agent'}
    caption="Agent catalog"
    tabs={[
      { id: 'general', label: 'General' },
      { id: 'recognition', label: 'Recognition' },
    ]}
    bind:selected={editorSection}
    close={() => (showForm = false)}
  >
    {#snippet children(section)}
      <section class="detail-section">
        {#if section === 'general'}
          <h3>Agent profile</h3>
          <div class="form-grid">
            <label>Name<input bind:value={form.displayName} required /></label>
            <label
              >Category<select bind:value={form.category}
                >{#each CATEGORIES as [id, label] (id)}<option value={id}>{label}</option
                  >{/each}</select
              ></label
            >
            <label
              >Risk profile<select bind:value={form.riskProfile}
                ><option>low</option><option>medium</option><option>high</option></select
              ></label
            >
            <label class="full"
              >Description<textarea bind:value={form.description}></textarea></label
            >
          </div>
        {:else}
          <h3>Process recognition</h3>
          <div class="form-grid">
            <label class="full"
              >Process name<input
                bind:value={form.processName}
                required
                placeholder="agent.exe"
              /></label
            >
          </div>
          <p class="dialog-copy">
            The process signature identifies this agent in observed processes.
          </p>
        {/if}
      </section>
    {/snippet}
    {#snippet actions()}<button class="button" onclick={() => (showForm = false)}>Cancel</button
      ><Action action={save}>Save agent</Action>{/snippet}
  </EditorDialog>
{/if}
<p class="catalog-count muted">{base.length} bundled · {custom.length} custom</p>

<style>
  td:last-child {
    min-width: 88px;
    white-space: nowrap;
  }
  td:last-child .button {
    white-space: nowrap;
  }
  .catalog-count {
    font-size: 11px;
    margin-top: 12px;
  }
  .catalog-identity {
    text-align: left;
  }
  .catalog-identity small {
    display: block;
    color: var(--faint);
  }
  .signature-links {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 10px;
    font-size: 11px;
  }
</style>
