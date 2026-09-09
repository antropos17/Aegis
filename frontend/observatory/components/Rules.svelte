<script lang="ts">
  import { onMount } from 'svelte';
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
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AgentLogo from './AgentLogo.svelte';
  let section = $state('permissions');
  const profiles: Record<string, [string, string]> = {
    paranoid: ['bell', 'Alert on every category'],
    strict: ['shield', 'More alerts for risky actions'],
    balanced: ['balance', 'Monitor every category'],
    developer: ['terminal', 'Fewer notifications'],
  };
  const labels: Record<string, [string, string, string]> = {
    filesystem: ['folder', 'File system', 'Read and write files'],
    sensitive: ['key', 'Sensitive files', '.env, SSH keys, cloud configuration'],
    network: ['network', 'Network', 'Outbound connections'],
    terminal: ['terminal', 'Terminal', 'Commands and child processes'],
    clipboard: ['clipboard', 'Clipboard', 'Clipboard policy category'],
    screen: ['monitor', 'Screen', 'Screen capture policy category'],
  };
  let { host, telemetry }: { host: Host | null; telemetry: Telemetry } = $props();
  let permissions = $state<RecordData>({});
  let rules = $state<RecordData[]>([]);
  let target = $state('');
  let scope = $state('agent');
  let draft = $state<Record<string, string>>({});
  let error = $state('');
  let loaded = $state(false);
  let alive = true;
  let revision = 0;
  const categories = ['filesystem', 'sensitive', 'network', 'terminal', 'clipboard', 'screen'];
  const presets: Record<string, string[]> = {
    paranoid: ['block', 'block', 'block', 'block', 'block', 'block'],
    strict: ['monitor', 'block', 'block', 'block', 'monitor', 'monitor'],
    balanced: ['monitor', 'monitor', 'monitor', 'monitor', 'monitor', 'monitor'],
    developer: ['allow', 'monitor', 'allow', 'allow', 'allow', 'allow'],
  };
  let agents = $derived(instances(telemetry));
  let options = $derived(
    scope === 'agent'
      ? [
          ...new Set([
            ...agents.map((a) => a.name),
            ...Object.keys(permissions).filter((k) => !k.includes('::')),
          ]),
        ].map((name) => ({ key: name, label: name }))
      : agents
          .filter((a) => a.instanceId)
          .map((a) => ({
            key: a.instanceId!,
            label: `${a.name} · PID ${a.pid} · ${a.cwd ?? a.parentEditor ?? 'standalone'}`,
          })),
  );
  let chosen = $derived(agents.find((a) => a.instanceId === target));
  let contextKey = $derived(scope === 'agent' ? target : chosen?.instanceKey);
  $effect(() => {
    const current = record(contextKey ? permissions[contextKey] : undefined);
    draft = Object.fromEntries(categories.map((cat) => [cat, String(current[cat] ?? 'monitor')]));
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
  async function save() {
    if (!target) throw new Error('Select an agent or instance');
    if (scope === 'instance') {
      const live = agents.find((a) => a.instanceId === target);
      if (!live || telemetry.stale) throw new Error('Instance is no longer reliably observed');
      confirmed(
        await invoke(host, 'saveInstancePermissions', {
          agentName: live.name,
          parentEditor: live.parentEditor,
          cwd: live.cwd,
          permissions: { ...draft },
        }),
      );
    } else {
      // Host replaces the whole map. Preserve project overrides from a fresh read.
      const fresh = record(await invoke(host, 'getAllPermissions'));
      confirmed(
        await invoke(host, 'saveAgentPermissions', {
          ...record(fresh.permissions),
          ...record(fresh.instancePermissions),
          [target]: { ...draft },
        }),
      );
    }
    await load();
  }
</script>

<div class="section-tabs">
  <button aria-pressed={section === 'permissions'} onclick={() => (section = 'permissions')}
    ><Icon name="shield" />Agent permissions</button
  ><button aria-pressed={section === 'rules'} onclick={() => (section = 'rules')}
    ><Icon name="file" />Detection rules <small>{rules.length}</small></button
  >
</div>
<div hidden={section !== 'permissions'}>
  <p class="notice">
    <Icon name="shield" />Profiles control monitoring responses. Policy labels do not establish that
    an action was blocked.
  </p>
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="preset-grid">
    {#each Object.entries(presets) as [name, values] (name)}<button
        class="preset"
        aria-label={name}
        data-profile={name}
        disabled={!target}
        aria-pressed={!!target && categories.every((cat, i) => draft[cat] === values[i])}
        onclick={() => (draft = Object.fromEntries(categories.map((cat, i) => [cat, values[i]])))}
        ><span
          ><Icon name={profiles[name][0]} /><strong>{name}</strong
          >{#if target && categories.every((cat, i) => draft[cat] === values[i])}<Icon
              name="check"
            />{/if}</span
        ><small>{profiles[name][1]}</small></button
      >{/each}
  </div>
  <div class="target-toolbar">
    <label
      >Agent <AgentLogo name={scope === 'agent' ? target : (chosen?.name ?? '')} size={22} /><select
        aria-label="Target"
        bind:value={target}
        ><option value="">Select…</option>{#each options as option (option.key)}<option
            value={option.key}>{option.label}</option
          >{/each}</select
      ></label
    ><label
      ><Icon name="cpu" />Apply to
      <select aria-label="Scope" bind:value={scope} onchange={() => (target = '')}
        ><option value="agent">Agent defaults</option><option value="instance"
          >Project / parent override</option
        ></select
      ></label
    ><Action action={load}>Refresh</Action>
  </div>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>
          <AgentLogo name={scope === 'agent' ? target : (chosen?.name ?? '')} />{scope === 'agent'
            ? target || 'Select an agent'
            : chosen?.name || 'Select an instance'}
        </h2>
        <p>
          {scope === 'agent'
            ? 'Rules by agent name'
            : 'Rules by agent, working directory and parent editor'}
        </p>
      </div>
    </div>
    {#each categories as category (category)}<label class="permission-row"
        ><span
          ><Icon name={labels[category][0]} /><span
            ><strong>{labels[category][1]}</strong><small>{labels[category][2]}</small></span
          ></span
        ><select aria-label={labels[category][1]} disabled={!target} bind:value={draft[category]}
          ><option value="allow">Allow</option><option value="monitor">Monitor</option><option
            value="block">Block</option
          ></select
        ></label
      >{/each}
    <div class="toolbar inset">
      <Action disabled={!loaded || !target} action={save}>Save permissions</Action><Action
        action={async () => {
          await invoke(host, 'resetPermissionsToDefaults');
          await load();
        }}>Reset all to defaults</Action
      >
    </div>
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
  <div class="table-scroll">
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Risk</th><th>State</th></tr></thead
      ><tbody
        >{#each rules as rule (String(rule.id))}<tr
            ><td>{String(rule.id)}</td><td>{String(rule.name ?? rule.reason ?? '')}</td><td
              >{String(rule.category ?? '')}</td
            ><td>{String(rule.risk ?? '')}</td><td
              >{rule.enabled === false ? 'Disabled' : 'Enabled'}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

<style>
  .preset-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .preset {
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    text-align: left;
    --profile-color: var(--muted);
  }
  .preset span {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 12px;
  }
  .preset strong {
    flex: 1;
    text-transform: capitalize;
    font-size: calc(12px * var(--ui-scale));
  }
  .preset :global(.icon) {
    color: var(--profile-color);
    width: 21px;
    height: 21px;
  }
  .preset[data-profile='paranoid'] {
    --profile-color: var(--red);
  }
  .preset[data-profile='strict'] {
    --profile-color: var(--amber);
  }
  .preset[data-profile='balanced'] {
    --profile-color: var(--green);
  }
  .preset[data-profile='developer'] {
    --profile-color: var(--ice);
  }
  .preset[aria-pressed='true'] {
    background: var(--raised);
    border-color: var(--profile-color);
    box-shadow: inset 0 0 0 1px var(--profile-color);
  }
  .target-toolbar,
  .target-toolbar label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: calc(11px * var(--ui-scale));
  }
  .target-toolbar {
    margin-bottom: 12px;
    gap: 12px;
  }
  .target-toolbar select {
    max-width: 280px;
  }
  .permission-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .permission-row > span {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .permission-row strong {
    font-size: calc(12px * var(--ui-scale));
  }
  .permission-row small {
    display: block;
    color: var(--muted);
    margin-top: 3px;
  }
  .permission-row select {
    min-width: 140px;
  }
  .policy-note {
    margin-top: 12px;
    color: var(--muted);
    font-size: 11px;
  }
  @media (max-width: 1000px) {
    .preset-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
