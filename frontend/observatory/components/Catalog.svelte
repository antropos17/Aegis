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
  let { host, inspect }: { host: Host | null; inspect: (title: string, row: RecordData) => void } =
    $props();
  let base = $state<RecordData[]>([]);
  let custom = $state<RecordData[]>([]);
  let form = $state(createEmptyForm());
  let editing = $state<string | null>(null);
  let showForm = $state(false);
  let query = $state('');
  let error = $state('');
  let alive = true;
  let rows = $derived(
    [
      ...base.map((row) => ({ ...row, custom: false })),
      ...custom.map((row) => ({ ...row, custom: true })),
    ].filter((row) =>
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
    if (!form.displayName.trim() || !form.processName.trim())
      throw new Error('Name and process signature are required');
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

<section class="panel">
  <div class="panel-head">
    <h2>Agent catalog</h2>
    <span>{base.length} bundled · {custom.length} custom</span>
  </div>
  <div class="toolbar inset">
    <input
      type="search"
      aria-label="Search catalog"
      bind:value={query}
      placeholder="Name, signature or vendor…"
    /><button
      class="button"
      onclick={() => {
        form = createEmptyForm();
        editing = null;
        showForm = true;
      }}>Add agent</button
    ><Action action={importAgents}>Import</Action><Action
      action={async () => confirmed(await invoke(host, 'exportAgentDatabase'))}>Export</Action
    >
  </div>
  {#if error}<p role="alert" class="inset">{error}</p>{/if}
  {#if showForm}<div class="inset form-stack editor">
      <h3>{editing ? 'Edit custom agent' : 'Add custom agent'}</h3>
      <label>Name<input bind:value={form.displayName} /></label><label
        >Process name<input bind:value={form.processName} /></label
      ><label
        >Category<select bind:value={form.category}
          >{#each CATEGORIES as [id, label] (id)}<option value={id}>{label}</option>{/each}</select
        ></label
      ><label
        >Risk profile<select bind:value={form.riskProfile}
          ><option>low</option><option>medium</option><option>high</option></select
        ></label
      ><label>Description<textarea bind:value={form.description}></textarea></label>
      <div class="toolbar">
        <Action action={save}>Save agent</Action><button
          class="button"
          onclick={() => (showForm = false)}>Cancel</button
        >
      </div>
    </div>{/if}
  <div class="table-scroll">
    <table>
      <thead
        ><tr><th>Agent</th><th>Vendor / category</th><th>Process signatures</th><th>Actions</th></tr
        ></thead
      ><tbody
        >{#each rows as row (String(row.id))}<tr
            ><td
              ><button
                class="text-link identity"
                onclick={() => inspect(String(row.displayName), row)}
                ><AgentLogo id={String(row.id)} />{String(row.displayName)}</button
              ><small>{row.custom ? 'Custom' : 'Bundled'}</small></td
            ><td>{String(row.vendor ?? '')}<small>{String(row.category ?? '')}</small></td><td
              >{Array.isArray(row.names) ? row.names.join(', ') : 'Unavailable'}</td
            ><td
              ><div class="toolbar">
                {#if row.website}<Action
                    action={async () =>
                      confirmed(await invoke(host, 'openExternalUrl', row.website))}>Website</Action
                  >{/if}{#if row.custom}<button
                    class="button"
                    onclick={() => {
                      editing = String(row.id);
                      form = formFromAgent(row);
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

<style>
  .identity {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .editor {
    border-block: 1px solid var(--border);
    max-width: 640px;
  }
</style>
