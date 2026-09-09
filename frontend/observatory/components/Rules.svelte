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

<section class="panel">
  <div class="panel-head">
    <h2>Rules & permissions</h2>
    <Action action={load}>Refresh</Action>
  </div>
  <div class="inset form-stack">
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="toolbar">
      <label
        >Scope<select bind:value={scope} onchange={() => (target = '')}
          ><option value="agent">Agent defaults</option><option value="instance"
            >Project / parent override</option
          ></select
        ></label
      ><label
        >Target<select bind:value={target}
          ><option value="">Select…</option>{#each options as option (option.key)}<option
              value={option.key}>{option.label}</option
            >{/each}</select
        ></label
      >
    </div>
    <p class="muted">
      Project overrides persist by agent, working directory and parent editor. Instances sharing
      that context share permissions. Permission categories reflect the backend's supported policy.
    </p>
    <div class="preset-grid">
      {#each Object.entries(presets) as [name, values] (name)}<button
          class="button"
          disabled={!target}
          class:active={categories.every((cat, i) => draft[cat] === values[i])}
          aria-pressed={categories.every((cat, i) => draft[cat] === values[i])}
          onclick={() => (draft = Object.fromEntries(categories.map((cat, i) => [cat, values[i]])))}
          >{name}</button
        >{/each}
    </div>
    <div class="permission-grid">
      {#each categories as category (category)}<label
          >{category}<select disabled={!target} bind:value={draft[category]}
            ><option value="allow">Allow</option><option value="monitor">Monitor</option><option
              value="block">Block</option
            ></select
          ></label
        >{/each}
    </div>
    <div class="toolbar">
      <Action disabled={!loaded || !target} action={save}>Save permissions</Action><Action
        action={async () => {
          await invoke(host, 'resetPermissionsToDefaults');
          await load();
        }}>Reset all to defaults</Action
      >
    </div>
  </div>
</section>
<section class="panel">
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
    gap: 8px;
  }
  .permission-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }
</style>
