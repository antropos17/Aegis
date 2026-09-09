(() => {
  const O = window.Obs;
  const grade = (score) =>
    score <= 10
      ? 'A+'
      : score <= 20
        ? 'A'
        : score <= 30
          ? 'B+'
          : score <= 40
            ? 'B'
            : score <= 55
              ? 'C'
              : score <= 70
                ? 'D'
                : 'F';
  let auditType = 'all',
    auditLimit = 30;
  const cleanEvents = (items) =>
    items.map((e) => ({
      demo: true,
      timestamp: e.timestamp,
      agent: O.agent(e.agent)?.name || null,
      instanceId: O.agent(e.agent)?.instanceId || null,
      type: e.type,
      action: e.action,
      path: e.path,
      attribution: e.attribution,
      severity: e.severity,
      falsePositive: e.fp,
    }));
  const csv = (items) => {
    const data = cleanEvents(items),
      keys = ['timestamp', 'agent', 'type', 'action', 'path', 'attribution', 'severity'];
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return (
      '\ufeff' +
      [keys.map(quote).join(','), ...data.map((e) => keys.map((k) => quote(e[k])).join(','))].join(
        '\r\n',
      )
    );
  };
  const reportHtml = () =>
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>AEGIS — demo report</title><style>body{font:15px/1.6 system-ui;max-width:1000px;margin:50px auto;padding:20px;color:#233340}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ddd;padding:10px}small{color:#567}</style><h1>AEGIS · session report</h1><p>Demo data. These are not results from monitoring this computer.</p><p>${O.events.length} events · ${O.agents.length} agents · ${O.network.length} connections</p><h2>Agents</h2><table><tr><th>Agent</th><th>Risk</th><th>CPU</th><th>RAM</th></tr>${O.agents.map((a) => `<tr><td>${O.escape(a.name)}</td><td>${a.risk}/100</td><td>${a.cpu}%</td><td>${a.memory} MB</td></tr>`).join('')}</table><h2>Events needing review</h2><table><tr><th>Time</th><th>Agent</th><th>Resource</th><th>Attribution</th></tr>${O.events
      .filter((e) => e.severity !== 'low')
      .map(
        (e) =>
          `<tr><td>${O.time(e.timestamp)}</td><td>${O.agent(e.agent)?.name || 'Unknown'}</td><td>${O.escape(e.path)}</td><td>${O.attribution[e.attribution][0]}</td></tr>`,
      )
      .join('')}</table><small>File contents are not included.</small></html>`;
  O.auditEntries = () =>
    [
      ...O.auditActions,
      ...O.events.map((e) => ({
        eventId: e.id,
        agentId: e.agent,
        timestamp: e.timestamp,
        type:
          e.type === 'network'
            ? 'network-connection'
            : e.type === 'config'
              ? 'config-access'
              : 'file-access',
        detail: e.path,
        instanceId: O.agent(e.agent)?.instanceId || null,
        agent: O.agent(e.agent)?.name || null,
      })),
    ].sort((a, b) => b.timestamp - a.timestamp);
  function auditText() {
    return O.auditEntries()
      .map((e) => JSON.stringify({ demo: true, ...e }))
      .join('\n');
  }
  O.actions['export-json'] = () =>
    O.download(
      'aegis-session-demo.json',
      JSON.stringify({ demo: true, events: cleanEvents(O.events) }, null, 2),
    );
  O.actions['export-csv'] = () =>
    O.download('aegis-events-demo.csv', csv(O.events), 'text/csv;charset=utf-8');
  O.actions['export-filtered'] = () =>
    O.download('aegis-filtered-demo.csv', csv(O.filteredEvents()), 'text/csv;charset=utf-8');
  O.actions['export-html'] = () =>
    O.download('aegis-report-demo.html', reportHtml(), 'text/html;charset=utf-8');
  O.actions['export-audit'] = () =>
    O.download('aegis-audit-demo.jsonl', auditText(), 'application/x-ndjson');
  /* Stored ZIP records, CRC32; no library or network needed. */
  function zip(files) {
    const enc = new TextEncoder(),
      parts = [],
      central = [];
    let offset = 0;
    const crc = (bytes) => {
      let c = 0xffffffff;
      for (const b of bytes) {
        c ^= b;
        for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    for (const [name, text] of files) {
      const n = enc.encode(name),
        b = enc.encode(text),
        checksum = crc(b),
        h = new Uint8Array(30 + n.length),
        v = new DataView(h.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x800, true);
      v.setUint32(14, checksum, true);
      v.setUint32(18, b.length, true);
      v.setUint32(22, b.length, true);
      v.setUint16(26, n.length, true);
      h.set(n, 30);
      parts.push(h, b);
      const c = new Uint8Array(46 + n.length),
        d = new DataView(c.buffer);
      d.setUint32(0, 0x02014b50, true);
      d.setUint16(4, 20, true);
      d.setUint16(6, 20, true);
      d.setUint16(8, 0x800, true);
      d.setUint32(16, checksum, true);
      d.setUint32(20, b.length, true);
      d.setUint32(24, b.length, true);
      d.setUint16(28, n.length, true);
      d.setUint32(42, offset, true);
      c.set(n, 46);
      central.push(c);
      offset += h.length + b.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0),
      end = new Uint8Array(22),
      dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, files.length, true);
    dv.setUint16(10, files.length, true);
    dv.setUint32(12, size, true);
    dv.setUint32(16, offset, true);
    const out = new Uint8Array(offset + size + 22);
    let at = 0;
    for (const part of [...parts, ...central, end]) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
  O.actions['export-zip'] = () =>
    O.download(
      'aegis-evidence-demo.zip',
      zip([
        ['README.txt', 'AEGIS prototype. Demonstration data only. No file contents or API keys.'],
        ['events.json', JSON.stringify(cleanEvents(O.events), null, 2)],
        ['events.csv', csv(O.events)],
        ['report.html', reportHtml()],
        ['audit.jsonl', auditText()],
      ]),
      'application/zip',
    );
  function summary() {
    const attention = O.events.filter((e) => e.severity !== 'low' && !e.fp);
    return `<div class="report-grid"><section class="panel">${O.panelHead('Session summary', 'Saved demo sample')}<div class="inline-stats"><div><strong>${O.events.length}</strong><span>events</span></div><div><strong>${attention.length}</strong><span>need review</span></div><div><strong>${O.agents.length}</strong><span>agents</span></div></div>${O.table(
      ['Agent', 'Events', 'Risk', 'Grade', 'Reviewed'],
      O.agents.map(
        (a) =>
          `<tr><td><button class="table-agent" data-action="agent-detail" data-id="${a.id}">${O.mark(a)}${a.name}</button></td><td>${O.events.filter((e) => e.agent === a.id).length}</td><td>${O.risk(a.risk)}</td><td>${O.badge(grade(a.risk), O.band(a.risk))}</td><td>${O.ack.has(a.instanceId) ? 'Yes' : 'No'}</td></tr>`,
      ),
    )}</section><section class="panel">${O.panelHead('Export', 'Files contain demo metadata')}<div class="export-grid">${[
      ['JSON', 'export-json'],
      ['CSV', 'export-csv'],
      ['HTML report', 'export-html'],
      ['ZIP archive', 'export-zip'],
      ['Full audit JSONL', 'export-audit'],
    ]
      .map(([text, action]) => O.button(text, action, 'download'))
      .join(
        '',
      )}</div><div class="notice" style="margin:0 20px 20px">${O.icon('file')}Exports exclude watched file contents and API keys.</div></section></div>`;
  }
  O.renderers.reports = () =>
    `<div class="analysis-report-link notice">${O.icon('shield')}<span>AI assessments have their own workspace.</span>${O.button('Open AI analysis', 'open-analysis-view', 'chevron')}</div>${summary()}`;
  function auditRows() {
    const rows = O.auditEntries().filter((e) => auditType === 'all' || e.type === auditType);
    return `${O.table(
      ['Time', 'Type', 'Instance / agent', 'Entry'],
      rows
        .slice(0, auditLimit)
        .map(
          (e) =>
            `<tr><td class="mono">${O.time(e.timestamp)}</td><td><code>${O.escape(e.type)}</code></td><td>${e.agentId ? `${O.agentLink(e.agentId)}` : O.escape(e.agent || '—')}<div class="faint mono">${e.agentId && e.instanceId ? O.processLink(O.agent(e.agentId), O.agent(e.agentId), e.instanceId) : O.escape(e.instanceId || '')}</div></td><td><button class="data-link resource-link" data-action="audit-entry" data-entry="${O.escape(JSON.stringify(e))}"><code>${O.escape(e.detail)}</code>${O.icon('chevron')}</button></td></tr>`,
        ),
    )}<div class="pagination"><span>${Math.min(auditLimit, rows.length)} of ${rows.length}</span>${rows.length > auditLimit ? O.button('Load earlier entries', 'more-audit') : ''}</div>`;
  }
  O.renderers.audit = () =>
    `<section class="panel"><div class="inline-stats"><div><strong>${O.auditEntries().length}</strong><span>entries</span></div><div><strong>0</strong><span>not recorded in demo</span></div><div><strong>${O.num(new TextEncoder().encode(auditText()).length / 1024)} KB</strong><span>JSONL size</span></div><div><strong style="font-size:16px">${O.time(O.events.at(-1).timestamp)} — ${O.time(O.events[0].timestamp)}</strong><span>event time range</span></div></div></section><div class="filterbar" style="margin-top:20px"><label>Type<select id="audit-type">${O.options([['all', 'All entries'], ...['file-access', 'config-access', 'network-connection', 'watchlist', 'permission', 'analysis', 'suspend', 'resume', 'kill'].map((x) => [x, x])], auditType)}</select></label><span class="spacer"></span>${O.button('Audit folder', 'audit-directory', 'folder')}${O.button('Export full audit', 'export-audit', 'download')}</div><section class="panel" id="audit-table">${auditRows()}</section>`;
  O.actions['audit-entry'] = (el) => {
    const entry = JSON.parse(el.dataset.entry);
    if (entry.eventId && O.events.some((event) => event.id === entry.eventId)) {
      O.actions.event({ dataset: { id: entry.eventId } });
      return;
    }
    O.modal(
      'Audit entry',
      `<dl class="details-grid"><dt>Time</dt><dd>${O.time(entry.timestamp)}</dd><dt>Type</dt><dd>${O.escape(entry.type)}</dd><dt>Details</dt><dd><code>${O.escape(entry.detail)}</code></dd></dl>`,
      O.button(
        'Copy entry',
        'copy-audit-entry',
        'copy',
        `data-entry="${O.escape(JSON.stringify(entry))}"`,
      ),
      'Recorded demo action',
    );
  };
  O.actions['copy-audit-entry'] = (el) =>
    O.copy(JSON.stringify(JSON.parse(el.dataset.entry), null, 2));
  O.actions['more-audit'] = () => {
    auditLimit += 30;
    O.$('audit-table').innerHTML = auditRows();
  };
  O.actions['audit-directory'] = () =>
    O.modal(
      'Audit folder',
      `<p class="dialog-copy">Desktop AEGIS opens the local audit folder. This prototype has no log folder; export the current entries as JSONL.</p>`,
      O.button('Export JSONL', 'export-audit', 'download'),
    );
  O.bindAudit = () =>
    O.$('audit-type').addEventListener('change', (e) => {
      auditType = e.target.value;
      auditLimit = 30;
      O.$('audit-table').innerHTML = auditRows();
    });
})();

export {};
