<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, tick } from 'svelte';
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
  let nameInput = $state<HTMLInputElement>();
  let processInput = $state<HTMLInputElement>();
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
  let loaded = $state(false);
  let mutating = $state(false);
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
      loaded = true;
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
  async function mutate(action: () => Promise<void>) {
    if (mutating || !loaded) throw new Error('Catalog is not ready for another change');
    mutating = true;
    try {
      await action();
    } finally {
      if (alive) mutating = false;
    }
  }
  async function persist(next: RecordData[]) {
    const validated = validateCatalog(next);
    if (
      validated.some(
        (a) => base.some((b) => a.id === b.id) && !custom.some((existing) => existing.id === a.id),
      )
    )
      throw new Error('Custom IDs must differ from bundled agent IDs');
    confirmed(await invoke(host, 'saveCustomAgents', validated));
    await load();
  }
  async function save() {
    if (!form.displayName.trim()) {
      editorSection = 'general';
      await tick();
      nameInput?.focus();
      throw new Error('Name is required');
    }
    if (!form.processName.trim()) {
      editorSection = 'recognition';
      await tick();
      processInput?.focus();
      throw new Error('Process signature is required');
    }
    await mutate(async () => {
      const next = editing
        ? custom.map((row) => (row.id === editing ? applyFormToAgent(row, form) : row))
        : [...custom, buildCustomAgent(form)];
      await persist(next);
      if (alive) showForm = false;
    });
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
      aria-label={$t('Search catalog')}
      bind:value={query}
      placeholder={$t('Name, signature or vendor…')}
    /></label
  ><label
    >{$t('Category')}
    <select aria-label={$t('Catalog category')} bind:value={category}
      ><option value="">{$t('All categories')}</option>{#each CATEGORIES as [id, title] (id)}<option
          value={id}>{$t(title)}</option
        >{/each}</select
    ></label
  ><span class="spacer"></span><button
    class="button"
    disabled={mutating}
    onclick={() => {
      form = createEmptyForm();
      editing = null;
      editorSection = 'general';
      showForm = true;
    }}><Icon name="plus" />{$t('Add agent')}</button
  ><Action disabled={mutating || !loaded} action={() => mutate(importAgents)}>{$t('Import')}</Action
  ><Action action={async () => confirmed(await invoke(host, 'exportAgentDatabase'))}
    >{$t('Export')}</Action
  >
</div>

<section class="panel">
  {#if error}<p role="alert" class="inset">{error}</p>{/if}
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>{$t('Agent')}</th><th>{$t('Category')}</th><th>{$t('Process signatures')}</th><th
            >{$t('Risk')}</th
          ><th>{$t('Actions')}</th></tr
        ></thead
      ><tbody
        >{#each rows as row ((row.custom ? 'custom:' : 'bundled:') + String(row.id))}{@const signatures =
            [...new Set(Array.isArray(row.names) ? row.names : [])]}<tr
            ><td
              ><button
                class="catalog-identity"
                onclick={() => inspect(String(row.displayName), row)}
                ><AgentLogo id={String(row.id)} /><span
                  ><strong>{String(row.displayName)}</strong><small
                    >{String(row.vendor ?? (row.custom ? 'Custom' : 'Bundled'))}</small
                  >{#if row.custom && base.some((bundled) => bundled.id === row.id)}<small
                      >{$t('Bundled ID conflict · not used for detection')}</small
                    >{/if}</span
                ></button
              ></td
            ><td>{String(row.category ?? '')}</td><td
              ><div class="signature-links">
                {#each signatures.slice(0, 3) as name (name)}<button
                    class="text-link"
                    onclick={() =>
                      inspect('Process signature', { signature: name, agent: row.displayName })}
                    >{String(name)}</button
                  >{/each}{#if signatures.length > 3}<button
                    class="text-link"
                    onclick={() => inspect(String(row.displayName), row)}
                    >+{signatures.length - 3} {$t('more')}</button
                  >{/if}
              </div></td
            ><td
              ><span
                class="badge"
                class:low={row.riskProfile === 'low'}
                class:high={row.riskProfile === 'high'}
                class:medium={row.riskProfile === 'medium'}
                >{String(row.riskProfile || 'Not specified')}</span
              ></td
            ><td
              ><div class="toolbar">
                <button class="button" onclick={() => inspect(String(row.displayName), row)}
                  >{$t('Details')}</button
                >
                {#if row.custom}<button
                    class="button"
                    disabled={mutating}
                    onclick={() => {
                      editing = String(row.id);
                      form = formFromAgent(row);
                      editorSection = 'general';
                      showForm = true;
                    }}>{$t('Edit')}</button
                  ><Action
                    disabled={mutating}
                    action={() => mutate(() => persist(custom.filter((a) => a.id !== row.id)))}
                    >{$t('Delete')}</Action
                  >{/if}
              </div></td
            ></tr
          >{:else}<tr
            ><td colspan="5" class="catalog-empty"
              ><strong
                >{query || category
                  ? $t('No matching agents')
                  : $t('No agents in the catalog')}</strong
              >
              <p>
                {query || category
                  ? $t('Try another name or category.')
                  : $t('Add a custom agent to recognize its processes.')}
              </p>
              {#if query || category}<button
                  class="button"
                  onclick={() => {
                    query = '';
                    category = '';
                  }}>{$t('Clear filters')}</button
                >{/if}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

{#if showForm}
  <EditorDialog
    title={editing ? $t('Edit custom agent') : $t('Add custom agent')}
    caption={$t('Agent catalog')}
    tabs={[
      { id: 'general', label: 'General' },
      { id: 'recognition', label: 'Recognition' },
    ]}
    bind:selected={editorSection}
    close={() => (showForm = false)}
  >
    {#snippet children(section)}
      <fieldset class="detail-section" disabled={mutating}>
        {#if section === 'general'}
          <h3>{$t('Agent profile')}</h3>
          <div class="form-grid">
            <label
              >{$t('Name')}<input
                bind:this={nameInput}
                bind:value={form.displayName}
                required
              /></label
            >
            <label
              >{$t('Category')}<select bind:value={form.category}
                >{#each CATEGORIES as [id, label] (id)}<option value={id}>{$t(label)}</option
                  >{/each}</select
              ></label
            >
            <label
              >{$t('Risk profile')}<select bind:value={form.riskProfile}
                ><option value="low">{$t('low')}</option><option value="medium"
                  >{$t('medium')}</option
                ><option value="high">{$t('high')}</option></select
              ></label
            >
            <label class="full"
              >{$t('Description')}<textarea bind:value={form.description}></textarea></label
            >
          </div>
        {:else}
          <h3>{$t('Process recognition')}</h3>
          <div class="form-grid">
            <label class="full"
              >{$t('Process name')}<input
                bind:this={processInput}
                bind:value={form.processName}
                required
                placeholder={$t('agent.exe')}
              /></label
            >
          </div>
          <p class="dialog-copy">
            {$t('The process signature identifies this agent in observed processes.')}
          </p>
        {/if}
      </fieldset>
    {/snippet}
    {#snippet actions()}<button class="button" onclick={() => (showForm = false)}
        >{$t('Cancel')}</button
      ><Action disabled={mutating || !loaded} action={save}>{$t('Save agent')}</Action>{/snippet}
  </EditorDialog>
{/if}
<p class="catalog-count muted">{base.length} {$t('bundled ·')} {custom.length} {$t('custom')}</p>

<style>
  fieldset {
    min-width: 0;
    margin-inline: 0;
  }
  .catalog-empty {
    padding: 28px;
    text-align: center;
    color: var(--muted);
  }
  .catalog-empty p {
    margin: 8px 0 14px;
  }
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
