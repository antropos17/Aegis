(() => {
  const O = window.Obs;
  let rulesTab = 'permissions',
    databaseQuery = '',
    databaseCategory = 'all',
    dbLimit = 30,
    ruleQuery = '',
    scope = 'name',
    permissionAgent = 'claude';
  const categories = [
    ['filesystem', 'File system', 'Read and write files'],
    ['sensitive', 'Sensitive files', '.env, SSH keys, cloud configuration'],
    ['network', 'Network', 'Outbound connections'],
    ['terminal', 'Terminal', 'Run commands and child processes'],
    ['clipboard', 'Clipboard', 'Clipboard access'],
    ['screen', 'Screen', 'Screen capture'],
  ];
  const presetValues = {
    paranoid: ['block', 'block', 'block', 'block', 'block', 'block'],
    strict: ['monitor', 'block', 'block', 'block', 'monitor', 'monitor'],
    balanced: ['monitor', 'monitor', 'monitor', 'monitor', 'monitor', 'monitor'],
    developer: ['allow', 'monitor', 'allow', 'allow', 'allow', 'allow'],
  };
  const presetLabels = {
    paranoid: ['Paranoid', 'Alert on every category'],
    strict: ['Strict', 'More alerts for risky actions'],
    balanced: ['Balanced', 'Monitor every category'],
    developer: ['Developer', 'Fewer notifications'],
  };
  const presetIcons = {
    paranoid: 'bell',
    strict: 'shield',
    balanced: 'balance',
    developer: 'terminal',
  };
  const categoryIcons = {
    filesystem: 'folder',
    sensitive: 'key',
    network: 'network',
    terminal: 'terminal',
    clipboard: 'clipboard',
    screen: 'monitor',
  };
  const states = [
    ['allow', 'Allow'],
    ['monitor', 'Monitor'],
    ['block', 'Alert'],
  ];
  function perms() {
    const a = O.agent(permissionAgent),
      map = scope === 'instance' ? O.instancePermissions : O.permissions,
      key = scope === 'instance' ? a.instanceId : a.name;
    return (
      map[key] ||
      O.permissions[a.name] ||
      Object.fromEntries(
        categories.map(([key], i) => [key, presetValues[O.preset]?.[i] || 'monitor']),
      )
    );
  }
  function permissionBody() {
    const a = O.agent(permissionAgent),
      p = perms();
    return `<div class="notice">${O.icon('shield')}Profiles control monitoring responses. Alert does not block actions. Clipboard and screen are policy categories; dedicated sensors are not shown here.</div><div class="preset-grid">${Object.entries(
      presetLabels,
    )
      .map(
        ([key, [name, desc]]) =>
          `<button class="preset" data-action="preset" data-id="${key}" aria-pressed="${O.preset === key}"><span class="preset-heading">${O.icon(presetIcons[key])}<strong>${name}</strong><svg class="icon preset-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg></span><small>${desc}</small></button>`,
      )
      .join(
        '',
      )}</div><div class="filterbar"><label>Agent<span class="agent-select-identity">${O.mark(a)}<select id="permission-agent">${O.options(
      O.agents.map((a) => [a.id, a.name]),
      permissionAgent,
    )}</select></span></label><label>${O.icon('cpu')}Apply to<select id="permission-scope">${O.options(
      [
        ['name', 'All instances'],
        ['instance', `Only PID ${a.pid}`],
      ],
      scope,
    )}</select></label><span class="spacer"></span>${O.button('Reset to defaults', 'reset-permissions')}</div><section class="panel">${O.panelHead(scope === 'instance' ? `Permissions for PID ${a.pid}` : a.name, scope === 'instance' ? 'Override for the selected instance' : 'Rules by agent name', '', O.mark(a))}${categories.map(([key, label, desc]) => `<label class="permission-row"><span class="permission-identity">${O.icon(categoryIcons[key])}<span><h3>${label}</h3><p>${desc}</p></span></span><select data-permission="${key}" aria-label="${label}">${O.options(states, p[key])}</select></label>`).join('')}</section>`;
  }
  function rulesLibrary() {
    const items = O.rules.filter((r) =>
      `${r.id} ${r.name} ${r.category} ${r.pattern}`
        .toLowerCase()
        .includes(ruleQuery.toLowerCase()),
    );
    return `<div class="filterbar"><label class="search-field">${O.icon('search')}<input type="search" id="rule-search" placeholder="ID, name or pattern" aria-label="Search rules" value="${O.escape(ruleQuery)}"></label><span class="spacer"></span><span class="filter-count">${items.length} of ${O.rules.length} rules</span>${O.button('Reload', 'reload-rules', 'refresh')}</div><section class="panel">${
      items.length
        ? O.table(
            ['ID', 'Rule', 'Category', 'Pattern', ''],
            items.map(
              (r) =>
                `<tr><td class="mono">${O.escape(r.id)}</td><td><strong>${O.escape(r.name)}</strong></td><td>${O.escape(r.category)}</td><td>${O.entityLink('rule-detail', r.pattern.slice(0, 65), { id: r.id }, 'file')}</td><td>${O.button('Open', 'rule-detail', '', `data-id="${O.escape(r.id)}"`)}</td></tr>`,
            ),
          )
        : O.empty('No rules found.')
    }</section>`;
  }
  O.renderers.rules = () =>
    `<div class="subnav"><button data-action="rules-tab" data-id="permissions" aria-pressed="${rulesTab === 'permissions'}">${O.icon('shield')}Agent permissions</button><button data-action="rules-tab" data-id="library" aria-pressed="${rulesTab === 'library'}">${O.icon('file')}Detection rules <span class="faint">${O.rules.length}</span></button></div><div id="rules-content">${rulesTab === 'permissions' ? permissionBody() : rulesLibrary()}</div>`;
  O.actions['rules-tab'] = (el) => {
    rulesTab = el.dataset.id;
    O.refresh();
  };
  O.actions.preset = (el) => {
    O.preset = el.dataset.id;
    for (const a of O.agents)
      O.permissions[a.name] = Object.fromEntries(
        categories.map(([key], i) => [key, presetValues[O.preset][i]]),
      );
    O.persist();
    O.logAction('preset', O.preset);
    O.refresh();
    document.querySelector(`.preset[data-id="${O.preset}"]`)?.focus({ preventScroll: true });
    O.notify('Profile applied to all agent names in the demo');
  };
  O.actions['reset-permissions'] = () =>
    O.confirm(
      'Reset permissions?',
      'Local permissions and instance overrides will return to the Balanced profile.',
      () => {
        O.permissions = {};
        O.instancePermissions = {};
        O.preset = 'balanced';
        O.persist();
        O.refresh();
        O.notify('Permissions reset');
      },
    );
  O.actions['instance-rights'] = (el) => {
    permissionAgent = el.dataset.id;
    scope = 'instance';
    rulesTab = 'permissions';
    O.$('modal').close();
    if (O.view === 'rules') O.refresh();
    else O.navigate('rules');
  };
  O.actions['rule-detail'] = (el) => {
    const r = O.rules.find((r) => r.id === el.dataset.id);
    O.modal(
      r.name,
      `<dl class="details-grid"><dt>ID</dt><dd class="mono">${O.escape(r.id)}</dd><dt>Category</dt><dd>${O.escape(r.category)}</dd><dt>Pattern</dt><dd><code>${O.escape(r.pattern)}</code></dd><dt>Evidence</dt><dd>${O.escape(r.reason)}</dd></dl>`,
      '',
      'Rule from the current repository',
    );
  };
  O.actions['reload-rules'] = () => {
    O.rules = [...AegisCatalog.rules];
    O.refresh();
    O.notify(`Rule snapshot reloaded: ${O.rules.length}`);
  };
  O.bindRules = () => {
    if (rulesTab === 'permissions') {
      O.$('permission-agent').addEventListener('change', (e) => {
        permissionAgent = e.target.value;
        O.refresh();
      });
      O.$('permission-scope').addEventListener('change', (e) => {
        scope = e.target.value;
        O.refresh();
      });
      document.querySelectorAll('[data-permission]').forEach((el) =>
        el.addEventListener('change', () => {
          const a = O.agent(permissionAgent),
            map = scope === 'instance' ? O.instancePermissions : O.permissions,
            key = scope === 'instance' ? a.instanceId : a.name;
          map[key] = { ...perms(), [el.dataset.permission]: el.value };
          O.persist();
          O.logAction('permission', `${key} ${el.dataset.permission}=${el.value}`);
          O.notify('Permission saved in the prototype');
        }),
      );
    } else
      O.$('rule-search').addEventListener('input', (e) => {
        ruleQuery = e.target.value;
        const input = e.target,
          start = input.selectionStart;
        O.$('rules-content').innerHTML = rulesLibrary();
        O.bindRules();
        O.$('rule-search').focus();
        O.$('rule-search').setSelectionRange?.(start, start);
      });
  };
  O.dbEntries = () => [...O.catalog, ...O.custom];
  function filteredDb() {
    return O.dbEntries().filter(
      (a) =>
        (databaseCategory === 'all' ||
          (databaseCategory === 'custom' ? a.custom : a.category === databaseCategory)) &&
        `${a.displayName} ${a.names.join(' ')} ${a.vendor || ''}`
          .toLowerCase()
          .includes(databaseQuery.toLowerCase()),
    );
  }
  function dbTable() {
    const all = filteredDb();
    return `${
      all.length
        ? `<section class="panel">${O.table(
            ['Agent', 'Category', 'Process signatures', 'Risk', ''],
            all.slice(0, dbLimit).map(
              (a) =>
                `<tr><td><button class="catalog-identity" data-action="db-detail" data-id="${O.escape(a.id)}" title="Open agent definition">${O.catalogMark(a)}<span><strong>${O.escape(a.displayName)}</strong>${a.custom ? ' · custom' : ''}<small>${O.escape(a.vendor || 'Custom')}</small></span></button></td><td>${O.escape(a.category)}</td><td><div class="signature-links">${a.names
                  .slice(0, 3)
                  .map((name) =>
                    O.entityLink('signature-detail', name, {
                      id: a.id,
                      signature: name,
                    }),
                  )
                  .join(
                    '',
                  )}${a.names.length > 3 ? O.entityLink('db-detail', `+${a.names.length - 3} more`, { id: a.id }) : ''}</div></td><td>${O.badge(a.riskProfile || 'low', a.riskProfile || 'low')}</td><td>${a.custom ? `${O.button('Edit', 'edit-agent', '', `data-id="${O.escape(a.id)}"`)} ${O.button('Delete', 'delete-agent', '', `data-id="${O.escape(a.id)}"`)}` : O.button('Details', 'db-detail', '', `data-id="${O.escape(a.id)}"`)}</td></tr>`,
            ),
          )}</section>`
        : O.empty('No agents found.')
    }<div class="pagination"><span>${Math.min(dbLimit, all.length)} of ${all.length} · total ${O.dbEntries().length}</span>${all.length > dbLimit ? O.button('Show more', 'more-database') : ''}</div>`;
  }
  O.renderers.database = () =>
    `<div class="filterbar"><label class="search-field">${O.icon('search')}<input id="database-search" type="search" aria-label="Search agent catalog" placeholder="Name, process or vendor" value="${O.escape(databaseQuery)}"></label><label>Category<select id="database-category">${O.options([['all', 'All categories'], ['custom', 'Custom'], ...[...new Set(O.catalog.map((a) => a.category))].sort().map((x) => [x, x])], databaseCategory)}</select></label><span class="spacer"></span>${O.button('Import', 'import-database', 'upload')}${O.button('Export', 'export-database', 'download')}${O.button('Add', 'add-agent', 'plus')}</div><div id="database-table">${dbTable()}</div>`;
  O.bindDatabase = () => {
    O.$('database-search').addEventListener('input', (e) => {
      databaseQuery = e.target.value;
      dbLimit = 30;
      O.$('database-table').innerHTML = dbTable();
    });
    O.$('database-category').addEventListener('change', (e) => {
      databaseCategory = e.target.value;
      dbLimit = 30;
      O.$('database-table').innerHTML = dbTable();
    });
  };
  O.actions['more-database'] = () => {
    dbLimit += 30;
    O.$('database-table').innerHTML = dbTable();
  };
  O.actions['db-detail'] = (el) => {
    const a = O.dbEntries().find((a) => a.id === el.dataset.id);
    if (!a) return;
    O.modal(
      a.displayName,
      `<div class="agent-identity">${O.catalogMark(a)}<strong>${O.escape(a.displayName)}</strong></div><p class="dialog-copy">${O.escape(a.description)}</p><dl class="details-grid"><dt>Vendor</dt><dd>${O.escape(a.vendor || '—')}</dd><dt>Website</dt><dd>${O.websiteLink(a.website)}</dd><dt>Category</dt><dd>${O.escape(a.category)}</dd><dt>Signatures ${O.help('Process names used for detection. A signature is a matching rule, not proof that this process is currently running.')}</dt><dd><div class="signature-links">${a.names.map((name) => O.entityLink('signature-detail', name, { id: a.id, signature: name })).join('')}</div></dd><dt>Domains</dt><dd><div class="entity-stack">${(a.knownDomains || []).map((domain) => O.pathLink(domain, 'network')).join('') || 'No data'}</div></dd><dt>Configuration files</dt><dd><div class="entity-stack">${(a.configPaths || []).map((path) => O.pathLink(path, /[\\/]$/.test(path) ? 'folder' : 'file')).join('') || 'No data'}</div></dd><dt>Base risk ${O.help('Catalog risk is a default profile. Live instance risk also considers observed activity.')}</dt><dd>${O.badge(a.riskProfile || 'low', a.riskProfile || 'low')}</dd></dl>`,
      a.custom ? O.button('Edit', 'edit-agent', '', `data-id="${O.escape(a.id)}"`) : '',
      a.custom ? 'Custom entry' : 'AEGIS catalog entry',
    );
  };
  async function agentForm(id) {
    const a = O.custom.find((a) => a.id === id);
    O.editingAgent = id || null;
    const shown = await O.modal(
      a ? 'Edit agent' : 'Add agent',
      `<form id="agent-form"><div class="form-grid"><label>Name<input name="displayName" required maxlength="80" value="${O.escape(a?.displayName || '')}"></label><label>Process<input name="process" required maxlength="120" placeholder="agent.exe" value="${O.escape(a?.names?.[0] || '')}"></label><label>Category<select name="category">${O.options(
        ['coding-assistant', 'ai-ide', 'cli-tool', 'autonomous', 'framework'].map((x) => [x, x]),
        a?.category || 'cli-tool',
      )}</select></label><label>Base risk<select name="riskProfile">${O.options(
        [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ],
        a?.riskProfile || 'low',
      )}</select></label><label class="full">Description<textarea name="description" rows="3" maxlength="500">${O.escape(a?.description || '')}</textarea></label></div></form>`,
      `${O.button('Cancel', 'close-modal')}<button class="button primary" type="submit" form="agent-form">Save</button>`,
      'Changes are saved in this prototype only',
    );
    if (shown === false || !O.$('agent-form')) return;
    O.$('agent-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        entry = {
          id: a?.id || `custom-${Date.now()}`,
          displayName: String(f.get('displayName')).trim(),
          names: [String(f.get('process')).trim()],
          category: f.get('category'),
          riskProfile: f.get('riskProfile'),
          description: f.get('description'),
          custom: true,
        };
      if (!entry.displayName || !entry.names[0]) return;
      O.custom = O.custom.filter((x) => x.id !== entry.id);
      O.custom.push(entry);
      O.persist();
      O.$('modal').close();
      O.refresh();
      O.notify('Custom agent saved');
    });
  }
  O.actions['add-agent'] = () => agentForm();
  O.actions['edit-agent'] = (el) => agentForm(el.dataset.id);
  O.actions['delete-agent'] = (el) =>
    O.confirm(
      'Delete custom agent?',
      'This only deletes the entry from the prototype catalog.',
      () => {
        O.custom = O.custom.filter((a) => a.id !== el.dataset.id);
        O.persist();
        O.refresh();
      },
    );
  O.actions['export-database'] = () =>
    O.download(
      'aegis-agent-database-demo.json',
      JSON.stringify({ demo: true, agents: O.dbEntries() }, null, 2),
    );
  O.actions['import-database'] = () =>
    O.importJSON((data) => {
      const entries = Array.isArray(data) ? data : data.agents;
      if (!Array.isArray(entries) || entries.length > 500)
        throw Error('Expected an agents array with up to 500 entries.');
      const custom = entries.filter((a) => !O.catalog.some((b) => b.id === a.id));
      if (
        custom.some(
          (a) =>
            typeof a.displayName !== 'string' ||
            !a.displayName.trim() ||
            !Array.isArray(a.names) ||
            !a.names.length ||
            a.names.some((n) => typeof n !== 'string' || !n.trim()),
        )
      )
        throw Error('Each agent needs a displayName and a non-empty names array.');
      O.custom = custom.map((a, i) => ({
        id: `custom-import-${Date.now()}-${i}`,
        displayName: a.displayName.slice(0, 80),
        names: a.names.map((n) => n.slice(0, 120)),
        category: typeof a.category === 'string' ? a.category : 'cli-tool',
        riskProfile: ['low', 'medium', 'high'].includes(a.riskProfile) ? a.riskProfile : 'low',
        description: typeof a.description === 'string' ? a.description.slice(0, 500) : '',
        custom: true,
      }));
      O.persist();
      O.refresh();
      O.notify(`Custom agents imported: ${custom.length}`);
    });
})();

export {};
