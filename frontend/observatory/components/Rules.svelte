<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    confirmed,
    invoke,
    record,
    records,
    instances,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import { policyTargets, effectivePolicy, policySaveTarget } from '../runtime/policy-targets';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AgentLogo from './AgentLogo.svelte';
  let section = $state('permissions');
  const profiles: Record<string, [string, string]> = {
    paranoid: ['bell', 'Request block for every category'],
    strict: ['shield', 'Request block for sensitive actions'],
    balanced: ['balance', 'Prefer monitoring every category'],
    developer: ['terminal', 'Prefer allowing most categories'],
  };
  const labels: Record<string, [string, string, string]> = {
    filesystem: ['folder', 'File system', 'Read and write files'],
    sensitive: ['key', 'Sensitive files', '.env, SSH keys, cloud configuration'],
    network: ['network', 'Network', 'Outbound connections'],
    terminal: ['terminal', 'Terminal', 'Commands and child processes'],
    clipboard: ['clipboard', 'Clipboard', 'Clipboard policy category'],
    screen: ['monitor', 'Screen', 'Screen capture policy category'],
  };
  let {
    host,
    telemetry,
    targetRequest,
    onPermissionsChanged,
  }: {
    host: Host | null;
    telemetry: Telemetry;
    targetRequest?: { key: string; revision: number };
    onPermissionsChanged?: () => void;
  } = $props();
  let appliedTargetRevision = 0;
  $effect(() => {
    if (!loaded || mutation || !targetRequest || targetRequest.revision === appliedTargetRevision)
      return;
    appliedTargetRevision = targetRequest.revision;
    section = 'permissions';
    scope = targetRequest.key.includes('::') ? 'instance' : 'agent';
    target = targetRequest.key;
  });
  let permissions = $state<RecordData>({});
  let rules = $state<RecordData[]>([]);
  let target = $state('');
  let scope = $state('agent');
  let draft = $state<Record<string, string>>({});
  let error = $state('');
  let loaded = $state(false);
  let mutation = $state<'save' | 'reset' | null>(null);
  let ruleQuery = $state('');
  let activeKey = '';
  let draftBaseline = $state('');
  const drafts: Record<string, Record<string, string>> = {};
  let dirty = $derived(loaded && JSON.stringify(draft) !== draftBaseline);
  let filteredRules = $derived(
    rules.filter((rule) =>
      [rule.id, rule.name, rule.reason, rule.category].some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(ruleQuery.trim().toLowerCase()),
      ),
    ),
  );
  let alive = true;
  let revision = 0;
  const categories = ['filesystem', 'sensitive', 'network', 'terminal', 'clipboard', 'screen'];
  const presets: Record<string, string[]> = {
    paranoid: ['block', 'block', 'block', 'block', 'block', 'block'],
    strict: ['monitor', 'block', 'block', 'block', 'monitor', 'monitor'],
    balanced: ['monitor', 'monitor', 'monitor', 'monitor', 'monitor', 'monitor'],
    developer: ['allow', 'monitor', 'allow', 'allow', 'allow', 'allow'],
  };
  let selectedProfile = $derived(
    Object.keys(presets).find((name) =>
      categories.every((category, index) => draft[category] === presets[name][index]),
    ),
  );
  let agents = $derived(instances(telemetry));
  let options = $derived(
    scope === 'agent'
      ? [
          ...new Set([
            ...agents.map((a) => a.name),
            ...Object.keys(permissions).filter((k) => !k.includes('::')),
          ]),
        ].map((name) => ({ key: name, label: name }))
      : policyTargets(agents, permissions, target),
  );
  let chosen = $derived(agents.find((a) => a.instanceKey === target));
  let contextKey = $derived(target);
  $effect(() => {
    if (loaded && !target && options.length) target = options[0].key;
  });
  $effect(() => {
    const key = scope + ':' + (contextKey ?? target);
    const current = effectivePolicy(contextKey, agents, permissions);
    const next = Object.fromEntries(
      categories.map((cat) => [cat, String(current[cat] ?? 'monitor')]),
    );
    untrack(() => {
      if (activeKey) {
        if (JSON.stringify(draft) !== draftBaseline) drafts[activeKey] = { ...draft };
        else delete drafts[activeKey];
      }
      activeKey = key;
      draft = { ...(drafts[key] ?? next) };
      draftBaseline = JSON.stringify(next);
    });
  });
  async function load() {
    const ticket = ++revision;
    const [all, loadedRules] = await Promise.all([
      invoke(host, 'getAllPermissions'),
      invoke(host, 'getRules'),
    ]);
    if (!alive || ticket !== revision) return;
    const envelope = record(all);
    permissions = { ...record(envelope.permissions), ...record(envelope.instancePermissions) };
    rules = records(loadedRules);
    loaded = true;
  }
  onMount(() => {
    const refresh = () =>
      load().catch((e) => {
        if (alive) error = String(e);
      });
    refresh();
    const cleanup = host?.onRulesReloaded
      ? Reflect.apply(host.onRulesReloaded, host, [refresh])
      : undefined;
    return () => {
      alive = false;
      revision++;
      if (typeof cleanup === 'function') cleanup();
    };
  });
  async function mutate(kind: 'save' | 'reset', action: () => Promise<void>) {
    if (mutation) throw new Error('A policy change is already in progress');
    mutation = kind;
    try {
      await action();
    } finally {
      if (alive) mutation = null;
    }
  }
  async function save() {
    return mutate('save', savePermissions);
  }
  async function reset() {
    return mutate('reset', async () => {
      confirmed(await invoke(host, 'resetPermissionsToDefaults'));
      onPermissionsChanged?.();
      for (const key of Object.keys(drafts)) delete drafts[key];
      draftBaseline = JSON.stringify(draft);
      await load();
    });
  }
  async function savePermissions() {
    if (!target) throw new Error('Select an agent or instance');
    const savingKey = activeKey;
    const savingDraft = { ...draft };
    const savingTarget = target;
    const context = policySaveTarget(savingTarget, agents, scope === 'instance');
    confirmed(
      await invoke(host, 'saveInstancePermissions', { ...context, permissions: savingDraft }),
    );
    onPermissionsChanged?.();
    if (JSON.stringify(drafts[savingKey]) === JSON.stringify(savingDraft)) delete drafts[savingKey];
    if (activeKey === savingKey && JSON.stringify(draft) === JSON.stringify(savingDraft))
      draftBaseline = JSON.stringify(savingDraft);
    await load();
  }
</script>

<div class="subnav">
  <button aria-pressed={section === 'permissions'} onclick={() => (section = 'permissions')}
    ><Icon name="shield" />Agent permissions</button
  ><button aria-pressed={section === 'rules'} onclick={() => (section = 'rules')}
    ><Icon name="file" />Detection rules <small>{rules.length}</small></button
  >
</div>
<div hidden={section !== 'permissions'}>
  <div class="policy-explanation">
    <strong>Saved preferences · automatic blocking is not active</strong>
    <p>
      These settings record your intended policy. They do not currently block file or network
      access, or change which observations are collected. To pause or stop an agent, open its
      process controls.
    </p>
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="filterbar target-toolbar">
    <label
      >Agent <AgentLogo
        name={scope === 'agent' ? target : (chosen?.name ?? target.split('::')[0])}
        size={22}
      /><select aria-label="Target" disabled={mutation === 'reset'} bind:value={target}
        ><option value="">Select…</option>{#each options as option (option.key)}<option
            value={option.key}>{option.label}</option
          >{/each}</select
      ></label
    ><label
      ><Icon name="cpu" />Apply to
      <select
        disabled={mutation === 'reset'}
        aria-label="Scope"
        bind:value={scope}
        onchange={() => (target = '')}
        ><option value="agent">Agent defaults</option><option value="instance"
          >Project / parent override</option
        ></select
      ></label
    ><Action disabled={mutation !== null} action={load}>Refresh</Action>
  </div>
  <section class="panel">
    <div class="preset-grid">
      {#each Object.entries(presets) as [name, values] (name)}<button
          class="preset"
          aria-label={name}
          title={profiles[name][1]}
          data-id={name}
          disabled={!target || mutation === 'reset'}
          aria-pressed={!!target && categories.every((cat, i) => draft[cat] === values[i])}
          onclick={() => (draft = Object.fromEntries(categories.map((cat, i) => [cat, values[i]])))}
          ><span class="preset-heading"
            ><Icon name={profiles[name][0]} /><strong>{name}</strong><Icon
              name="check"
              class="preset-check"
            /></span
          ><small>{profiles[name][1]}</small></button
        >{/each}
    </div>
    <p class="preset-caption">
      {selectedProfile
        ? profiles[selectedProfile][1]
        : 'Custom permissions · adjust individual categories below'}
    </p>
    {#each categories as category (category)}
      <div class="permission-row">
        <div class="permission-identity">
          <Icon name={labels[category][0]} />
          <div>
            <h3>{labels[category][1]}</h3>
            <p>{labels[category][2]}</p>
          </div>
        </div>
        <select
          aria-label={labels[category][1]}
          disabled={!target || mutation === 'reset'}
          bind:value={draft[category]}
        >
          <option value="allow">Prefer allow</option><option value="monitor">Monitor</option><option
            value="block">Request block</option
          >
        </select>
      </div>
    {/each}
    <div class="toolbar inset permission-save">
      <span role="status" class="draft-status"
        >{dirty ? 'Unsaved permissions' : 'Permissions saved'}</span
      >
      <Action disabled={!loaded || !target || !dirty || mutation !== null} action={save}
        >Save permissions</Action
      ><Action
        disabled={!dirty || mutation !== null}
        action={async () => {
          delete drafts[activeKey];
          const current = effectivePolicy(contextKey, agents, permissions);
          draft = Object.fromEntries(
            categories.map((cat) => [cat, String(current[cat] ?? 'monitor')]),
          );
          draftBaseline = JSON.stringify(draft);
        }}>Discard changes</Action
      >
    </div>
    <details class="permission-reset">
      <summary>Restore default policy</summary>
      <p>This restores permissions for every agent and project.</p>
      <Action disabled={mutation !== null} action={reset}>Reset all to defaults</Action>
    </details>
  </section>
  <p class="policy-note">
    Project overrides persist by agent, working directory and parent editor. Instances sharing that
    context share permissions.
  </p>
</div>
<section class="panel" hidden={section !== 'rules'}>
  <div class="panel-head">
    <h2>Loaded detection rules</h2>
    <Action
      action={async () => {
        confirmed(await invoke(host, 'reloadRules'));
        await load();
      }}>Reload rules</Action
    >
  </div>
  <div class="filterbar rules-filter">
    <label class="search-field"
      ><Icon name="search" /><input
        type="search"
        aria-label="Search detection rules"
        bind:value={ruleQuery}
        placeholder="Name, category or rule ID…"
      /></label
    ><span class="muted">{filteredRules.length} of {rules.length} rules</span>
  </div>
  <div class="table-scroll">
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Risk</th><th>State</th></tr></thead
      ><tbody
        >{#each filteredRules as rule (String(rule.id))}<tr
            ><td>{String(rule.id)}</td><td>{String(rule.name ?? rule.reason ?? '')}</td><td
              >{String(rule.category ?? '')}</td
            ><td>{String(rule.risk ?? '')}</td><td
              >{rule.enabled === false ? 'Disabled' : 'Enabled'}</td
            ></tr
          >{:else}<tr
            ><td colspan="5" class="empty-rules"
              >{ruleQuery ? 'No rules match this search.' : 'No detection rules loaded.'}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

<style>
  .policy-explanation {
    margin: 10px 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--surface-radius);
    color: var(--muted);
    font-size: calc(12px * var(--ui-scale));
  }
  .policy-explanation strong {
    color: var(--amber);
  }
  .policy-explanation p {
    margin-top: 8px;
    line-height: 1.5;
  }
  .preset-caption {
    margin: 0;
    padding: 0 18px 14px;
    color: var(--muted);
    font-size: calc(12px * var(--ui-scale));
  }
  .preset {
    padding: 10px;
  }
  .preset small {
    display: none;
  }
  .preset-heading {
    gap: 6px;
  }
  .preset strong {
    font-size: calc(11px * var(--ui-scale));
  }
  .preset-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 16px 18px;
    margin: 0;
  }
  .permission-save {
    position: sticky;
    bottom: 0;
    background: var(--panel);
    border-top: 1px solid var(--border);
    z-index: 1;
    flex-wrap: wrap;
  }
  .draft-status {
    margin-right: auto;
    color: var(--muted);
    font-size: calc(12px * var(--ui-scale));
  }
  .permission-reset {
    padding: 16px 18px;
    border-top: 1px solid var(--border);
    font-size: calc(12px * var(--ui-scale));
  }
  .permission-reset summary {
    cursor: pointer;
    color: var(--muted);
  }
  .permission-reset p {
    margin: 12px 0;
    color: var(--muted);
  }
  .rules-filter {
    padding: 12px 18px;
    margin: 0;
  }
  .empty-rules {
    padding: 24px;
    color: var(--muted);
  }
  .target-toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    padding: 12px 0;
  }
  @media (max-width: 700px) {
    .target-toolbar {
      position: static;
    }
    .preset-caption {
      margin: 0;
      padding: 0 18px 14px;
      color: var(--muted);
      font-size: calc(12px * var(--ui-scale));
    }
    .preset {
      padding: 10px;
    }
    .preset small {
      display: none;
    }
    .preset-heading {
      gap: 6px;
    }
    .preset strong {
      font-size: calc(11px * var(--ui-scale));
    }
    .preset-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .target-toolbar select {
    max-width: 300px;
  }
  .permission-row select {
    min-width: 140px;
  }
  .preset strong {
    text-transform: capitalize;
  }
  .policy-note {
    margin-top: 12px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
