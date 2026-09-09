(() => {
  const O = window.Obs,
    A = O.analysis;
  const button = O.button,
    esc = O.escape;
  const risk = (r) => O.badge(r.risk, r.risk.toLowerCase());
  const field = (label, id, options, value, disabled = false) =>
    `<label class="analysis-field"><span>${label}</span><select id="${id}" ${disabled ? 'disabled' : ''}>${O.options(options, value)}</select></label>`;
  const evidence = (events) =>
    events.length
      ? `<div class="analysis-evidence">${events.map((e) => `<div class="analysis-evidence-row"><time class="mono">${O.time(e.timestamp)}</time><div>${O.agentLink(e.agent)}<div>${O.entityLink('analysis-evidence', O.shortPath(e.path), { id: e.id }, e.type === 'network' ? 'network' : 'file')}</div></div>${O.badge(e.severity, e.severity)}</div>`).join('')}</div>`
      : O.empty('No evidence in this selection.');
  function resultView() {
    const r = A.result;
    if (A.busy)
      return `<div class="analysis-running" role="status" aria-live="polite"><span class="analysis-spinner">${O.icon('refresh')}</span><h2>${A.source === 'demo' ? 'Preparing the demo assessment' : 'Waiting for Anthropic'}</h2><p class="muted">${A.source === 'demo' ? 'The selected events have been captured as a fixed snapshot.' : 'AEGIS is analyzing the desktop session. You can visit another tab while it runs.'}</p>${A.source === 'demo' ? button('Cancel', 'cancel-analysis', 'close') : ''}</div>`;
    if (!r)
      return `<div class="analysis-empty">${O.icon('report')}<h2>Review agent activity</h2><p class="muted">Choose a scope and run an assessment. Findings link back to captured evidence.</p><ol><li><span>1</span>Choose a session or an agent</li><li><span>2</span>Review the selected metadata</li><li><span>3</span>Assess findings and export the report</li></ol><small>Demo results are generated from event labels.</small></div>`;
    return `<article class="analysis-document"><div class="analysis-document-meta"><span>${r.demo ? 'DEMO ASSESSMENT' : 'ANTHROPIC ASSESSMENT'}</span>${risk(r)}</div><h2>${esc(r.title)}</h2><p class="muted">${esc(r.scope)} · ${new Date(r.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Saved snapshot</p><p class="analysis-summary">${esc(r.summary)}</p><p class="muted">${esc(r.justification)}</p><div class="analysis-metrics"><div><strong>${r.findings.length}</strong><span>findings</span></div><div><strong>${r.recommendations.length}</strong><span>next steps</span></div><div><strong>${r.demo ? r.events.length : '—'}</strong><span>${r.demo ? 'sampled events' : 'evidence in desktop'}</span></div></div><h3>${O.icon('shield')}Findings</h3><div class="analysis-findings">${r.findings.map((f, i) => `<div><span class="analysis-index">${String(i + 1).padStart(2, '0')}</span><div><p>${esc(f.text)}</p>${f.eventId ? `${O.entityLink('analysis-evidence', 'View evidence', { id: f.eventId }, 'file')}` : ''}</div></div>`).join('') || '<p class="muted">No findings in this selection.</p>'}</div><h3>${O.icon('check')}Recommended checks</h3><ol class="analysis-recommendations">${r.recommendations.map((v) => `<li>${esc(v)}</li>`).join('')}</ol><div class="analysis-export">${button('Export HTML', 'export-analysis', 'download')}${button('Export JSON', 'export-analysis', 'download', 'data-format="json"')}<small>${!r.demo ? 'Desktop assessment · source telemetry remains in AEGIS.' : r.detail === 'detailed' ? 'HTML includes the evidence appendix.' : 'Compact HTML · findings and next steps.'}</small></div></article>`;
  }
  function historyView() {
    return A.history.length
      ? `<div class="analysis-history">${A.history.map((r) => `<button data-action="analysis-history" data-id="${r.id}">${O.icon('report')}<span><strong>${esc(r.title)}</strong><small>${esc(r.scope)} · ${new Date(r.created).toLocaleTimeString()} · ${r.demo ? 'Demo' : 'Anthropic'}</small></span>${risk(r)}${O.icon('chevron')}</button>`).join('')}</div><p class="analysis-footnote">Up to 12 reports are kept for this browser session. Export a report to keep it after reloading.</p>`
      : O.empty('Your completed assessments will appear here.');
  }
  O.renderers.analysis = () => {
    const native = A.source === 'anthropic',
      items = A.items(),
      lock = A.busy || native;
    return `<div class="analysis-provider panel"><div class="analysis-provider-name">${O.mark({ id: 'claude' })}<div><strong>Anthropic</strong><span>${native ? 'Desktop connection · session analysis' : 'Not connected · demo available'}</span></div></div><div class="analysis-provider-actions">${button(native ? 'Connection settings' : 'Connect AI analysis', 'connect-analysis', 'settings', A.busy ? 'disabled' : '')}<button class="button primary analysis-run" data-action="run-analysis" ${A.busy || (!native && !items.length) ? 'disabled' : ''}>${O.icon('play')}${A.busy ? 'Analysis in progress' : native ? 'Analyze desktop session' : 'Run demo analysis'}</button></div></div><div class="analysis-layout"><section class="panel analysis-config">${O.panelHead('New assessment', 'Configure the scope and report', '', O.icon('settings'))}<div class="analysis-config-body"><fieldset ${A.busy ? 'disabled' : ''}>${
      A.configured
        ? field(
            'Data source',
            'analysis-source',
            [
              ['demo', 'Demo sample'],
              ['anthropic', 'Anthropic · desktop'],
            ],
            A.source,
          )
        : ''
    }${field(
      'Scope',
      'analysis-mode',
      [
        ['session', 'Entire session'],
        ['agent', 'Selected agent'],
      ],
      native ? 'session' : A.mode,
      lock,
    )}${
      !native && A.mode === 'agent'
        ? field(
            'Agent',
            'analysis-agent',
            O.agents.map((a) => [a.id, a.name]),
            A.agent,
            A.busy,
          )
        : ''
    }${
      !native
        ? `${field(
            'Period',
            'analysis-period',
            [
              ['all', 'All recorded events'],
              ['5', 'Last 5 minutes'],
              ['15', 'Last 15 minutes'],
            ],
            A.period,
          )}${field(
            'Event type',
            'analysis-kind',
            [
              ['all', 'All event types'],
              ['file', 'File access'],
              ['network', 'Network'],
              ['config', 'Configuration'],
            ],
            A.kind,
          )}<label class="analysis-check"><input id="analysis-reviewed" type="checkbox" ${A.excludeReviewed ? 'checked' : ''}>Exclude false positives ${O.help('Events marked as false positives are excluded from the demo selection. Your original event log is unchanged.')}</label>`
        : '<p class="analysis-footnote">Uses the real session collected by desktop AEGIS. Prototype filters and sample evidence are not sent.</p>'
    }<hr><label class="analysis-field"><span>Report title</span><input id="analysis-title" maxlength="100" value="${esc(A.title)}"></label>${field(
      'HTML report',
      'analysis-detail',
      [
        ['detailed', 'Detailed · include evidence'],
        ['compact', 'Compact · findings only'],
      ],
      A.detail,
    )}<p class="analysis-footnote">${native ? 'The desktop engine controls the model and analysis prompt.' : 'Changes apply to the next run. Demo mode makes no AI request.'}</p></fieldset><div class="analysis-selection">${O.icon('database')}<span>${native ? 'Desktop telemetry' : `${items.length} events selected`}</span></div>${native ? '<small class="analysis-footnote">Sends session metadata to Anthropic. Provider usage charges may apply.</small>' : ''}</div></section><section class="panel analysis-output"><div class="subnav analysis-tabs" aria-label="Analysis sections">${[
      ['report', 'report', 'Report'],
      ['evidence', 'file', 'Evidence'],
      ['history', 'history', `History${A.history.length ? ` (${A.history.length})` : ''}`],
    ]
      .map(
        ([id, icon, label]) =>
          `<button data-action="analysis-tab" data-id="${id}" aria-pressed="${A.tab === id}">${O.icon(icon)}${label}</button>`,
      )
      .join(
        '',
      )}</div><div class="analysis-body" id="analysis-body" tabindex="0" aria-label="Assessment content">${A.error ? `<div class="notice analysis-error" role="alert">${O.icon('shield')}<span>${esc(A.error)}</span></div>` : ''}${A.tab === 'report' ? resultView() : A.tab === 'history' ? historyView() : `<div class="analysis-evidence-head"><h2>${A.result ? 'Report evidence' : 'Selection preview'}</h2><p class="muted">${A.result ? (A.result.demo ? 'Captured at the time of the report. Start a new run to include changed filters or new events.' : 'Real telemetry stays in the desktop engine. Sample events are not evidence for this assessment.') : 'Metadata only: timestamps, paths, agent identity and attribution. No file contents.'}</p></div>${evidence(A.result ? A.result.events : native ? [] : items)}`}</div></section></div>`;
  };
  O.bindAnalysis = () => {
    const config = document.querySelector('.analysis-config-body'),
      body = O.$('analysis-body');
    config.scrollTop = A.configScroll || 0;
    body.scrollTop = A.scroll[A.tab] || 0;
    config.addEventListener(
      'scroll',
      () => {
        A.configScroll = config.scrollTop;
      },
      { passive: true },
    );
    const tab = A.tab;
    body.addEventListener(
      'scroll',
      () => {
        A.scroll[tab] = body.scrollTop;
      },
      { passive: true },
    );
    for (const [id, key] of [
      ['analysis-source', 'source'],
      ['analysis-mode', 'mode'],
      ['analysis-agent', 'agent'],
      ['analysis-period', 'period'],
      ['analysis-kind', 'kind'],
      ['analysis-detail', 'detail'],
    ]) {
      O.$(id)?.addEventListener('change', (e) => {
        A[key] = e.target.value;
        A.error = '';
        A.refresh();
        O.$(id)?.focus({ preventScroll: true });
      });
    }
    O.$('analysis-reviewed')?.addEventListener('change', (e) => {
      A.excludeReviewed = e.target.checked;
      A.refresh();
      O.$('analysis-reviewed')?.focus({ preventScroll: true });
    });
    O.$('analysis-title')?.addEventListener('input', (e) => {
      A.title = e.target.value;
    });
  };
  O.actions['analysis-tab'] = (el) => {
    const tab = el.dataset.id;
    if (A.tab === tab) return;
    O.transition(() => {
      A.tab = tab;
      A.refresh();
      document
        .querySelector(`[data-action="analysis-tab"][data-id="${tab}"]`)
        ?.focus({ preventScroll: true });
    }, 'analysis');
  };
  O.actions['analysis-history'] = (el) => {
    const result = A.history.find((r) => r.id === el.dataset.id);
    if (!result) return;
    O.transition(() => {
      A.result = result;
      A.tab = 'report';
      A.scroll.report = 0;
      A.refresh();
      O.$('analysis-body')?.focus({ preventScroll: true });
    }, 'analysis');
  };
  O.actions['analysis-evidence'] = (el) => {
    const e =
      A.result?.events.find((e) => e.id === el.dataset.id) ||
      A.items().find((e) => e.id === el.dataset.id);
    if (!e) return;
    O.modal(
      'Evidence record',
      `<dl class="details-grid"><dt>Agent</dt><dd>${O.agentLink(e.agent)}</dd><dt>Time</dt><dd>${O.time(e.timestamp)}</dd><dt>Resource</dt><dd>${O.pathLink(e.path, e.type)}</dd><dt>Action</dt><dd>${esc(e.action || e.type)}</dd><dt>Severity</dt><dd>${O.badge(e.severity, e.severity)}</dd><dt>Attribution</dt><dd>${esc(O.attribution[e.attribution]?.[1] || e.attribution)}</dd></dl>`,
      '',
      'Demo metadata · captured evidence',
    );
  };
  O.actions['open-analysis-view'] = () => O.navigate('analysis');
  O.actions['agent-analysis'] = async (el) => {
    if (A.busy) {
      O.notify('Wait for the current analysis to finish, or cancel the demo run.');
      return;
    }
    A.mode = 'agent';
    A.agent = el.dataset.id || O.selected || O.agents[0].id;
    A.source = 'demo';
    A.result = null;
    A.tab = 'report';
    O.actions['close-modal']();
    if (O.view === 'analysis') A.refresh();
    else await O.navigate('analysis');
  };
  O.actions['connect-analysis'] = async () => {
    if (A.busy) return;
    await O.modal(
      'Connect AI analysis',
      `<div class="analysis-connect"><div class="analysis-provider-name">${O.mark({ id: 'claude' })}<div><strong>Anthropic</strong><span>Use your own API key</span></div></div><p>Analyze activity collected by AEGIS: agent metadata, sensitive paths, connection details and monitoring summaries. Watched file contents are not sent by the existing engine.</p><div class="notice">Provider connection is pending backend integration. This preview cannot save keys or send analysis requests.</div><label class="analysis-field"><span>API key · integration pending</span><input type="password" disabled placeholder="Available after backend integration"></label><p class="analysis-footnote">Explore the report workflow using the demo sample. No key is saved or transmitted here.</p></div>`,
      button('Close', 'close-modal', 'close'),
      'Provider connection',
    );
  };
})();

export {};
