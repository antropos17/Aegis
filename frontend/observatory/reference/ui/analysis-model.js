/* Analysis snapshots are kept in memory. No credentials enter reports or demo storage. */
(() => {
  const O = window.Obs;
  const A = (O.analysis = {
    tab: 'report',
    scroll: {},
    configScroll: 0,
    mode: 'session',
    agent: 'claude',
    period: 'all',
    kind: 'all',
    excludeReviewed: true,
    detail: 'detailed',
    title: 'Activity assessment',
    busy: false,
    error: '',
    result: null,
    history: [],
    request: 0,
    source: 'demo',
    configured: false,
  });
  A.refresh = () => {
    if (O.view !== 'analysis') return;
    const active = document.activeElement;
    const id = active?.id;
    const action = active?.dataset.action;
    O.refresh();
    const target = id
      ? O.$(id)
      : action
        ? document.querySelector(`.analysis-provider [data-action="${CSS.escape(action)}"]`)
        : null;
    if (target && !target.disabled) target.focus({ preventScroll: true });
  };
  A.items = () =>
    O.events.filter(
      (e) =>
        (A.mode === 'session' || e.agent === A.agent) &&
        (A.kind === 'all' || e.type === A.kind) &&
        (A.period === 'all' ||
          e.timestamp >= O.baseTime + O.sequence * 1000 - Number(A.period) * 60000) &&
        (!A.excludeReviewed || !e.fp),
    );
  A.snapshot = () => ({
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    demo: true,
    title: A.title.trim() || 'Activity assessment',
    detail: A.detail,
    scope: A.mode === 'session' ? 'Entire session' : O.agent(A.agent)?.name || 'Unknown agent',
    filters: {
      period: A.period,
      kind: A.kind,
      excludeReviewed: A.excludeReviewed,
    },
    events: A.items().map((e) => ({
      ...e,
      agentName: O.agent(e.agent)?.name || 'Unattributed',
    })),
  });
  A.completeDemo = (r) => {
    const flagged = r.events.filter((e) => e.severity !== 'low' && !e.fp);
    r.risk = flagged.some((e) => ['high', 'critical'].includes(e.severity))
      ? 'HIGH'
      : flagged.length
        ? 'MEDIUM'
        : 'LOW';
    r.summary = `${flagged.length} of ${r.events.length} sampled events require review. ${flagged.length ? 'Compare the flagged resources with the agent’s assigned task before taking action.' : 'No unreviewed alerts appear in this selection.'}`;
    r.justification =
      'Demo assessment derived from event labels. Access alone does not establish a leak; missing telemetry cannot establish safety.';
    r.findings = flagged.map((e) => ({
      text: `${e.agentName}: ${e.action || e.type} — ${e.path}`,
      eventId: e.id,
      severity: e.severity,
    }));
    r.recommendations = flagged.length
      ? [
          'Confirm that the flagged resources belong to the agent’s task.',
          'Check process attribution before changing permissions.',
          'Review unexpected destinations and compare them with related file activity.',
        ]
      : ['Continue monitoring and review any new alerts.'];
    return r;
  };
  A.run = async () => {
    if (A.busy) return;
    const snapshot = A.snapshot();
    if (snapshot && !snapshot.events.length) {
      A.error = 'No events match this selection. Widen the period or change the filters.';
      A.refresh();
      return;
    }
    const request = ++A.request;
    A.busy = true;
    A.error = '';
    A.tab = 'report';
    A.scroll.report = 0;
    A.refresh();
    try {
      const result = await new Promise((resolve) =>
        setTimeout(() => resolve(A.completeDemo(snapshot)), 1000),
      );
      if (request !== A.request) return;
      A.result = result;
      A.history.unshift(result);
      A.history = A.history.slice(0, 12);
      O.notify('Demo assessment ready');
    } catch (e) {
      if (request === A.request) A.error = e.message || 'Analysis failed. Try again.';
    } finally {
      if (request === A.request) {
        A.busy = false;
        A.refresh();
      }
    }
  };
  O.actions['run-analysis'] = A.run;
  O.actions['cancel-analysis'] = () => {
    ++A.request;
    A.busy = false;
    A.refresh();
    O.notify('Demo analysis cancelled');
  };
  O.actions['export-analysis'] = (el) => {
    const r = A.history.find((r) => r.id === el?.dataset.id) || A.result;
    if (!r) return;
    const format = el?.dataset.format || 'html';
    if (format === 'json')
      return O.download(`aegis-analysis-${r.id}.json`, JSON.stringify(r, null, 2));
    const esc = O.escape;
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(r.title)}</title><style>body{font:15px/1.65 system-ui;max-width:960px;margin:48px auto;padding:24px;color:#25282b}h1{font-size:30px}h2{margin-top:28px}small{color:#555}li{margin:8px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}code{font-size:12px}@media print{body{margin:0}}</style><small>AEGIS / ${r.demo ? 'DEMO · No AI request was made' : 'Anthropic · Desktop session'}</small><h1>${esc(r.title)}</h1><p>${esc(r.scope)} · ${esc(r.created)} · ${esc(r.risk)}</p><h2>Assessment</h2><p>${esc(r.summary)}</p><p>${esc(r.justification)}</p><h2>Findings</h2><ul>${r.findings.map((f) => `<li>${esc(f.text)}</li>`).join('') || '<li>No findings in this selection.</li>'}</ul><h2>Recommendations</h2><ol>${r.recommendations.map((v) => `<li>${esc(v)}</li>`).join('')}</ol>${r.detail === 'detailed' && r.events.length ? `<h2>Evidence (${r.events.length})</h2><table><tr><th>Time</th><th>Agent</th><th>Resource</th><th>Attribution</th></tr>${r.events.map((e) => `<tr><td>${esc(O.time(e.timestamp))}</td><td>${esc(e.agentName)}</td><td><code>${esc(e.path)}</code></td><td>${esc(e.attribution)}</td></tr>`).join('')}</table>` : ''}<p><small>${r.demo ? 'Demonstration data; this is not an AI security assessment.' : 'AI-generated assessment; verify findings against source telemetry.'} No watched file contents or API keys are included.</small></p></html>`;
    O.download(`aegis-analysis-${r.id}.html`, html, 'text/html;charset=utf-8');
  };
})();

export {};
