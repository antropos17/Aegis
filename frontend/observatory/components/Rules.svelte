<script lang="ts">
  import { t } from '../runtime/i18n';

  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    confirmed,
    invoke,
    instances,
    type Host,
    type RecordData,
    type Telemetry,
  } from '../runtime/host';
  import { policyTargets, effectivePolicy, policySaveTarget } from '../runtime/policy-targets';
  import {
    permissionEnvelope,
    permissionMap,
    ruleReply,
    permissionCategories,
    policyDraft,
    policySnapshot,
    policyMapSnapshot,
  } from '../runtime/rules-persistence';
  import Action from './Action.svelte';
  import Icon from './Icon.svelte';
  import AgentLogo from './AgentLogo.svelte';
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
    scope = targetRequest.key.includes('::') ? 'instance' : 'agent';
    target = targetRequest.key;
  });
  let permissions = $state<RecordData>({});
  let rules = $state<RecordData[]>([]);
  let target = $state('');
  let scope = $state('agent');
  let draft = $state<Record<string, string>>({});
  let error = $state('');
  let writeNotice = $state('');
  let loaded = $state(false);
  let permissionsState = $state<'loading' | 'ready' | 'failed'>('loading');
  let rulesState = $state<'loading' | 'ready' | 'failed'>('loading');
  let rulesLoaded = $state(false);
  let rulesLoadError = $state('');
  let mutation = $state<'save' | 'reset' | null>(null);
  let ruleQuery = $state('');
  let ruleMutation = $state<string | null>(null);
  let ruleError = $state('');
  let activeKey = '';
  let draftBaseline = $state('');
  const drafts: Record<string, Record<string, string>> = {};
  const acknowledged = new SvelteMap<string, { key: string; draft: Record<string, string> }>();
  let refreshPending: 'save' | 'reset' | null = null;
  let dirty = $derived(loaded && policySnapshot(draft) !== draftBaseline);
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
  const categories = permissionCategories;
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
    const next = policyDraft(current);
    untrack(() => {
      retainDraft();
      activeKey = key;
      draft = { ...(drafts[key] ?? next) };
      draftBaseline = policySnapshot(next);
    });
  });
  function retainDraft() {
    if (!activeKey) return;
    if (policySnapshot(draft) !== draftBaseline) drafts[activeKey] = { ...draft };
    else delete drafts[activeKey];
  }
  function adoptPermissions(next: RecordData, resetExpected?: RecordData | null) {
    retainDraft();
    let differs = false;
    for (const [targetKey, submitted] of acknowledged) {
      if (
        policySnapshot(effectivePolicy(targetKey, agents, next)) !== policySnapshot(submitted.draft)
      ) {
        if (activeKey === submitted.key) drafts[submitted.key] = { ...draft };
        else if (!drafts[submitted.key]) drafts[submitted.key] = { ...submitted.draft };
        differs = true;
      } else if (
        drafts[submitted.key] &&
        policySnapshot(drafts[submitted.key]) === policySnapshot(submitted.draft)
      ) {
        delete drafts[submitted.key];
      }
    }
    acknowledged.clear();
    const resetMatches =
      resetExpected != null && policyMapSnapshot(next) === policyMapSnapshot(resetExpected);
    if (resetMatches) for (const key of Object.keys(drafts)) delete drafts[key];
    // The next effect must not restash a clean draft against its previous baseline.
    activeKey = '';
    permissions = next;
    writeNotice =
      resetExpected === null
        ? 'Default policy restored. Could not confirm the current policy. Local drafts are preserved.'
        : resetExpected !== undefined && !resetMatches
          ? 'Default policy restored. Current saved policy differs from the reset reply. Local drafts are preserved.'
          : differs
            ? 'Current saved policy differs from the submitted permissions. Your draft is preserved.'
            : '';
    refreshPending = null;
  }
  async function load(options?: { resetExpected: RecordData | null }) {
    if (!alive) return;
    const ticket = ++revision;
    permissionsState = 'loading';
    rulesState = 'loading';
    await Promise.all([
      (async () => {
        try {
          const next = permissionEnvelope(await invoke(host, 'getAllPermissions'));
          if (!alive || ticket !== revision) return;
          adoptPermissions(next, options?.resetExpected);
          loaded = true;
          permissionsState = 'ready';
          error = '';
        } catch (cause) {
          if (!alive || ticket !== revision) return;
          permissionsState = 'failed';
          error = cause instanceof Error ? cause.message : String(cause);
          if (refreshPending === 'save')
            writeNotice = 'Permissions saved. Could not refresh the current policy. Retry loading.';
          else if (refreshPending === 'reset')
            writeNotice =
              'Default policy restored. Could not refresh the current policy. Local drafts are preserved.';
        }
      })(),
      (async () => {
        try {
          const next = ruleReply(await invoke(host, 'getRules'));
          if (!alive || ticket !== revision) return;
          rules = next;
          rulesLoaded = true;
          rulesState = 'ready';
          rulesLoadError = '';
        } catch (cause) {
          if (!alive || ticket !== revision) return;
          rulesState = 'failed';
          rulesLoadError = cause instanceof Error ? cause.message : String(cause);
        }
      })(),
    ]);
  }
  onMount(() => {
    const refresh = () => void load();
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
    // Only an acknowledged write invalidates reads of the previous persisted policy.
    writeNotice = '';
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
      const reply = confirmed(await invoke(host, 'resetPermissionsToDefaults'));
      if (!alive) return;
      revision++;
      acknowledged.clear();
      refreshPending = 'reset';
      writeNotice = 'Default policy restored. Refreshing the current policy.';
      onPermissionsChanged?.();
      let resetExpected: RecordData | null = null;
      try {
        resetExpected = permissionMap(reply.permissions);
      } catch {
        // A confirmed command remains confirmed; missing readback evidence cannot seed defaults.
      }
      await load({ resetExpected });
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
    if (!alive) return;
    revision++;
    retainDraft();
    activeKey = '';
    permissions = { ...permissions, [savingTarget]: savingDraft };
    acknowledged.set(savingTarget, { key: savingKey, draft: savingDraft });
    refreshPending = 'save';
    writeNotice = 'Permissions saved. Refreshing the current policy.';
    onPermissionsChanged?.();
    await load();
  }
  async function setRuleEnabled(rule: RecordData, enabled: boolean, input: HTMLInputElement) {
    const id = String(rule.id);
    if (ruleMutation) {
      input.checked = rule.enabled !== false;
      return;
    }
    ruleMutation = id;
    ruleError = '';
    try {
      confirmed(await invoke(host, 'setRuleEnabled', id, enabled));
      if (alive) rules = rules.map((row) => (row.id === id ? { ...row, enabled } : row));
    } catch (cause) {
      input.checked = rule.enabled !== false;
      if (alive) ruleError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (alive) ruleMutation = null;
    }
  }
</script>

<div class="rules-composition">
  <section class="permissions-pane" aria-labelledby="permissions-heading">
    <h2 id="permissions-heading">{$t('Agent permissions')}</h2>
    <div class="policy-explanation">
      <strong>{$t('Saved preferences · automatic blocking is not active')}</strong>
      <p>
        {$t(
          'These settings record your intended policy. They do not currently block file or network access, or change which observations are collected. To pause or stop an agent, open its process controls.',
        )}
      </p>
    </div>
    {#if error}<p role="alert">{$t(error)}</p>{/if}
    {#if writeNotice}<p role="status">{$t(writeNotice)}</p>{/if}
    {#if permissionsState === 'loading'}<p role="status">{$t('Loading permissions…')}</p>
    {:else if permissionsState === 'failed'}<p role="status">
        {loaded
          ? $t('Permissions unavailable. Showing last loaded preferences.')
          : $t('Permissions unavailable. Retry loading.')}
      </p>
    {:else if !Object.keys(permissions).length}<p role="status">
        {$t('No saved permission overrides.')}
      </p>{/if}
    <div class="filterbar target-toolbar">
      <label class="target-field"
        ><span class="target-label">{$t('Agent')}</span>
        <span class="target-control"
          ><AgentLogo
            name={scope === 'agent' ? target : (chosen?.name ?? target.split('::')[0])}
            size={22}
          /><select
            aria-label={$t('Target')}
            disabled={!loaded || mutation === 'reset'}
            bind:value={target}
            ><option value="">{$t('Select…')}</option>{#each options as option (option.key)}<option
                value={option.key}>{option.label}</option
              >{/each}</select
          ></span
        ></label
      ><label class="target-field"
        ><span class="target-label"><Icon name="cpu" />{$t('Apply to')}</span>
        <select
          disabled={!loaded || mutation === 'reset'}
          aria-label={$t('Scope')}
          bind:value={scope}
          onchange={() => (target = '')}
          ><option value="agent">{$t('Agent defaults')}</option><option value="instance"
            >{$t('Project / parent override')}</option
          ></select
        ></label
      ><Action disabled={mutation !== null} action={load}
        ><Icon name="refresh" />{permissionsState === 'failed'
          ? $t('Retry loading')
          : $t('Refresh')}</Action
      >
    </div>
    <section class="panel">
      <div class="preset-grid">
        {#each Object.entries(presets) as [name, values] (name)}<button
            class="preset"
            aria-label={$t(name)}
            title={$t(profiles[name][1])}
            data-id={$t(name)}
            disabled={!loaded || !target || mutation === 'reset'}
            aria-pressed={!!target && categories.every((cat, i) => draft[cat] === values[i])}
            onclick={() =>
              (draft = Object.fromEntries(categories.map((cat, i) => [cat, values[i]])))}
            ><span class="preset-heading"
              ><Icon name={profiles[name][0]} /><strong>{$t(name)}</strong><Icon
                name="check"
                class="preset-check"
              /></span
            ><small>{$t(profiles[name][1])}</small></button
          >{/each}
      </div>
      {#if !selectedProfile}<p class="preset-caption">
          {$t('Custom permissions · adjust individual categories below')}
        </p>{/if}
      {#each categories as category (category)}
        <div class="permission-row">
          <div class="permission-identity">
            <Icon name={labels[category][0]} />
            <div>
              <h3>{$t(labels[category][1])}</h3>
              <p>{$t(labels[category][2])}</p>
            </div>
          </div>
          <select
            aria-label={$t(labels[category][1])}
            disabled={!loaded || !target || mutation === 'reset'}
            bind:value={draft[category]}
          >
            <option value="allow">{$t('Prefer allow')}</option><option value="monitor"
              >{$t('Monitor')}</option
            ><option value="block">{$t('Request block')}</option>
          </select>
        </div>
      {/each}
      <div class="toolbar inset permission-save">
        <span role="status" class="draft-status"
          >{loaded && target
            ? dirty
              ? $t('Unsaved permissions')
              : $t('Permissions saved')
            : ''}</span
        >
        <Action disabled={!loaded || !target || !dirty || mutation !== null} action={save}
          ><Icon name="check" />{$t('Save permissions')}</Action
        ><Action
          disabled={!dirty || mutation !== null}
          action={async () => {
            delete drafts[activeKey];
            acknowledged.delete(contextKey);
            const current = effectivePolicy(contextKey, agents, permissions);
            draft = policyDraft(current);
            draftBaseline = policySnapshot(draft);
            writeNotice = '';
          }}><Icon name="close" />{$t('Discard changes')}</Action
        >
      </div>
      <details class="permission-reset">
        <summary>{$t('Restore default policy')}</summary>
        <p>{$t('This restores permissions for every agent and project.')}</p>
        <Action disabled={!loaded || mutation !== null} action={reset}
          ><Icon name="refresh" />{$t('Reset all to defaults')}</Action
        >
      </details>
    </section>
    <p class="policy-note">
      {$t(
        'Project overrides persist by agent, working directory and parent editor. Instances sharing that context share permissions.',
      )}
    </p>
  </section>
  <section class="panel detection-pane" aria-labelledby="detection-heading">
    <div class="panel-head">
      <h2 id="detection-heading">{$t('Loaded detection rules')}</h2>
      <Action
        disabled={ruleMutation !== null}
        action={async () => {
          confirmed(await invoke(host, 'reloadRules'));
          await load();
        }}><Icon name="refresh" />{$t('Reload rules')}</Action
      >
    </div>
    <p class="rule-scope muted">
      {$t('Turning off a rule stops its file path match. Other sensors and detections continue.')}
    </p>
    {#if rulesState === 'loading'}<p role="status">{$t('Loading detection rules…')}</p>
    {:else if rulesState === 'failed'}
      <p role="status">
        {rulesLoaded
          ? $t('Detection rules unavailable. Showing last loaded rules.')
          : $t('Detection rules unavailable. Retry loading.')}
      </p>
      <p role="alert">{$t(rulesLoadError)}</p>
      <Action action={load}><Icon name="refresh" />{$t('Retry loading')}</Action>
    {/if}
    {#if ruleError}<p class="rule-error" role="alert">{ruleError}</p>{/if}
    <div class="filterbar rules-filter">
      <label class="search-field"
        ><Icon name="search" /><input
          type="search"
          aria-label={$t('Search detection rules')}
          bind:value={ruleQuery}
          placeholder={$t('Name, category or rule ID…')}
        /></label
      ><span class="muted">{filteredRules.length} {$t('of')} {rules.length} {$t('rules')}</span>
    </div>
    <div class="table-scroll">
      <table class="rules-table">
        <thead
          ><tr
            ><th>{$t('ID')}</th><th>{$t('Name')}</th><th>{$t('Category')}</th><th>{$t('Risk')}</th
            ><th>{$t('On / off')}</th></tr
          ></thead
        ><tbody
          >{#each filteredRules as rule (String(rule.id))}<tr
              ><td>{String(rule.id)}</td><td
                >{String(rule.name ?? rule.reason ?? '')}<small class="rule-meta"
                  >{String(rule.category ?? '')} · {String(rule.risk ?? '')}</small
                ></td
              ><td>{String(rule.category ?? '')}</td><td>{String(rule.risk ?? '')}</td><td
                ><label class="rule-toggle"
                  ><input
                    type="checkbox"
                    aria-label={$t('Enable {name}', { name: String(rule.name ?? rule.id) })}
                    checked={rule.enabled !== false}
                    disabled={ruleMutation !== null}
                    onchange={(event) =>
                      void setRuleEnabled(rule, event.currentTarget.checked, event.currentTarget)}
                  /><span>{rule.enabled === false ? $t('Off') : $t('On')}</span></label
                ></td
              ></tr
            >{:else}<tr
              ><td colspan="5" class="empty-rules"
                >{ruleQuery && rulesLoaded
                  ? $t('No rules match this search.')
                  : rulesState === 'ready'
                    ? $t('No detection rules loaded.')
                    : ''}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </section>
</div>

<style>
  .rules-composition {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.8fr);
    gap: var(--space-4);
    align-items: start;
  }
  .permissions-pane,
  .detection-pane {
    min-width: 0;
  }
  .permissions-pane {
    container-type: inline-size;
    container-name: permissions;
  }
  .permissions-pane > h2 {
    margin: 0;
    font-size: var(--text-body);
    font-weight: 700;
  }
  .detection-pane :global(.panel-head) {
    flex-wrap: wrap;
  }
  @media (max-width: 1100px) {
    .rules-composition {
      grid-template-columns: minmax(0, 1fr);
    }
  }

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
    display: block;
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
  @container permissions (max-width: 680px) {
    .preset-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container permissions (max-width: 320px) {
    .preset-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .permission-save {
    position: static;
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
    display: grid;
    grid-template-columns: minmax(220px, 1.2fr) minmax(210px, 1fr) auto;
    gap: var(--space-3);
    align-items: end;
    padding: var(--space-3) 0;
  }
  .target-toolbar .target-field {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    min-width: 0;
  }
  .target-label,
  .target-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .target-control {
    min-width: 0;
  }
  .target-toolbar select {
    min-width: 0;
    width: 100%;
    max-width: none;
  }
  .permission-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(170px, 220px);
  }
  .permission-row select {
    width: 100%;
    min-width: 0;
  }
  .permission-identity {
    min-width: 0;
  }
  .permission-identity h3,
  .permission-identity p {
    margin: 0;
  }
  .rule-scope {
    padding: 0 var(--space-4);
    font-size: var(--text-caption);
  }
  .rule-error {
    margin: 0 var(--space-4) var(--space-3);
    color: var(--red);
  }
  .rule-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
    cursor: pointer;
  }
  .rule-toggle input {
    appearance: none;
    position: relative;
    width: 38px;
    height: 22px;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--raised);
    cursor: inherit;
  }
  .rule-toggle input::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform 120ms ease;
  }
  .rule-toggle input:checked {
    border-color: var(--accent);
    background: var(--accent-bg);
  }
  .rule-toggle input:checked::before {
    background: var(--accent);
    transform: translateX(16px);
  }
  .rule-toggle input:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .rule-toggle input:disabled {
    cursor: wait;
  }
  .rule-meta {
    display: none;
  }
  @media (max-width: 1000px) {
    .rules-table th:nth-child(3),
    .rules-table td:nth-child(3),
    .rules-table th:nth-child(4),
    .rules-table td:nth-child(4) {
      display: none;
    }
    .rules-table th:first-child {
      width: 100px;
    }
    .rules-table th:last-child {
      width: 100px;
    }
    .rule-meta {
      display: block;
      margin-top: 4px;
      color: var(--muted);
    }
  }
  @media (max-width: 700px) {
    .target-toolbar {
      grid-template-columns: minmax(0, 1fr);
    }
    .permission-row {
      grid-template-columns: minmax(0, 1fr);
    }
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
