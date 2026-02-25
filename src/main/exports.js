/**
 * @file exports.js
 * @module main/exports
 * @description Log export (JSON), CSV export, and HTML report generation
 *   with save-dialog integration.
 * @requires fs
 * @requires path
 * @requires electron
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, shell, app } = require('electron');

let _state = null;

/**
 * Initialise with shared state references.
 * @param {Object} state
 * @param {Array}    state.activityLog
 * @param {Function} state.getLatestNetConnections
 * @param {number}   state.monitoringStarted
 * @param {Function} state.getMainWindow
 * @param {Function} state.getStats
 * @returns {void}
 * @since v0.1.0
 */
function init(state) {
  _state = state;
}

/**
 * Escape a value for safe CSV embedding.
 * @param {*} val
 * @returns {string}
 * @since v0.1.0
 */
function csvEscape(val) {
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Escape a string for safe HTML embedding.
 * @param {string} str
 * @returns {string}
 * @since v0.1.0
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format milliseconds as "Xh Ym Zs".
 * @param {number} ms
 * @returns {string}
 * @since v0.1.0
 */
function formatUptimeReport(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

/**
 * Export the activity log as a JSON file via save dialog.
 * @returns {Promise<{success:boolean, path?:string, eventCount?:number}>}
 * @since v0.1.0
 */
async function exportLog() {
  const mw = _state.getMainWindow();
  const result = await dialog.showSaveDialog(mw, {
    title: 'Export AEGIS Activity Log',
    defaultPath: `aegis-log-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  const stats = _state.getStats();
  const payload = {
    exportedAt: new Date().toISOString(),
    monitoringStarted: new Date(_state.monitoringStarted).toISOString(),
    uptimeSeconds: Math.floor(stats.uptimeMs / 1000),
    summary: {
      totalFiles: stats.totalFiles,
      sensitiveFiles: stats.totalSensitive,
      peakAgents: stats.peakAgents,
      uniqueAgents: stats.uniqueAgents,
    },
    events: _state.activityLog.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      agent: e.agent,
      pid: e.pid,
      file: e.file,
      sensitive: e.sensitive,
      reason: e.reason,
      action: e.action || 'accessed',
    })),
  };
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2));
  return { success: true, path: result.filePath, eventCount: _state.activityLog.length };
}

/**
 * Export activity log + network connections as CSV via save dialog.
 * @returns {Promise<{success:boolean, path?:string, eventCount?:number}>}
 * @since v0.1.0
 */
async function exportCsv() {
  const mw = _state.getMainWindow();
  const result = await dialog.showSaveDialog(mw, {
    title: 'Export AEGIS Activity Log (CSV)',
    defaultPath: `aegis-log-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  const header = 'Timestamp,Agent Name,Action Type,Target,Sensitive\n';
  const rows = _state.activityLog
    .map((e) => {
      const ts = new Date(e.timestamp).toISOString();
      const action = e.action || 'accessed';
      const sensitive = e.sensitive ? 'yes' : 'no';
      return [ts, e.agent, action, e.file, sensitive].map(csvEscape).join(',');
    })
    .join('\n');
  const netConns = _state.getLatestNetConnections();
  const netRows = netConns
    .map((c) => {
      const ts = new Date().toISOString();
      return [ts, c.agent, 'network', `${c.remoteIp}:${c.remotePort}`, c.flagged ? 'yes' : 'no']
        .map(csvEscape)
        .join(',');
    })
    .join('\n');
  const csv = header + rows + (netRows ? '\n' + netRows : '');
  fs.writeFileSync(result.filePath, csv);
  return {
    success: true,
    path: result.filePath,
    eventCount: _state.activityLog.length + netConns.length,
  };
}

/**
 * Generate an HTML report, write to temp, and open in default browser.
 * @returns {Promise<{success:boolean, path?:string}>}
 * @since v0.1.0
 */
async function generateReport() {
  const stats = _state.getStats();
  const sensitiveEvents = _state.activityLog.filter((e) => e.sensitive);
  const netConns = _state.getLatestNetConnections();
  const agentFileCounts = {};
  for (const e of _state.activityLog)
    agentFileCounts[e.agent] = (agentFileCounts[e.agent] || 0) + 1;
  const maxCount = Math.max(1, ...Object.values(agentFileCounts));
  const barChartRows = Object.entries(agentFileCounts)
    .map(([agent, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      return `<tr><td style="padding:4px 10px;white-space:nowrap;color:#00e5ff;font-weight:600">${escHtml(agent)}</td><td style="padding:4px 10px;width:100%"><div style="background:#1a3a5c;border-radius:3px;height:20px;position:relative"><div style="background:#00e5ff;height:100%;border-radius:3px;width:${pct}%"></div></div></td><td style="padding:4px 10px;white-space:nowrap;color:#90a4ae">${count}</td></tr>`;
    })
    .join('');
  const sensitiveRows = sensitiveEvents
    .map((e) => {
      const ts = new Date(e.timestamp).toISOString().replace('T', ' ').slice(0, 19);
      return `<tr><td style="padding:3px 8px;color:#546e7a">${escHtml(ts)}</td><td style="padding:3px 8px;color:#00e5ff">${escHtml(e.agent)}</td><td style="padding:3px 8px;color:#ff1744">${escHtml(e.file)}</td><td style="padding:3px 8px;color:#ffc107">${escHtml(e.reason)}</td></tr>`;
    })
    .join('');
  const netRows = netConns
    .map((c) => {
      const flagStyle = c.flagged ? 'color:#ffc107;font-weight:600' : 'color:#90a4ae';
      return `<tr><td style="padding:3px 8px;color:#00e5ff">${escHtml(c.agent)}</td><td style="padding:3px 8px;color:#90a4ae">${escHtml(c.remoteIp)}</td><td style="padding:3px 8px;color:#78909c">${c.remotePort}</td><td style="padding:3px 8px;${flagStyle}">${escHtml(c.domain || 'unknown')}</td><td style="padding:3px 8px;color:#546e7a">${escHtml(c.state)}</td></tr>`;
    })
    .join('');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>AEGIS Report - ${new Date().toISOString().slice(0, 10)}</title>
<style>body{font-family:'Segoe UI',Consolas,monospace;background:#0a0e17;color:#c8d6e5;margin:0;padding:24px}h1{color:#00e5ff;font-size:20px;letter-spacing:3px;margin-bottom:4px}h2{color:#546e7a;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin:24px 0 10px;border-bottom:1px solid #1a2744;padding-bottom:6px}.summary{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0}.s-card{background:#0d1220;border:1px solid #1a2744;padding:12px 20px;border-radius:6px;text-align:center}.s-val{font-size:22px;font-weight:700;color:#00e5ff}.s-lbl{font-size:9px;letter-spacing:1.5px;color:#546e7a;margin-top:2px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th{text-align:left;padding:6px 8px;color:#546e7a;font-size:10px;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid #1a2744}td{font-family:Consolas,monospace;font-size:11px}tr:hover td{background:rgba(255,255,255,0.02)}.timestamp{color:#546e7a;font-size:10px;margin-top:32px}</style></head><body>
<h1>AEGIS REPORT</h1><p style="color:#546e7a;font-size:11px">Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}</p>
<h2>Summary</h2><div class="summary"><div class="s-card"><div class="s-val">${formatUptimeReport(stats.uptimeMs)}</div><div class="s-lbl">MONITORING DURATION</div></div><div class="s-card"><div class="s-val">${stats.uniqueAgents.length}</div><div class="s-lbl">AGENTS DETECTED</div></div><div class="s-card"><div class="s-val">${stats.totalFiles}</div><div class="s-lbl">FILES TRACKED</div></div><div class="s-card"><div class="s-val" style="color:#ff1744">${stats.totalSensitive}</div><div class="s-lbl">SENSITIVE ALERTS</div></div><div class="s-card"><div class="s-val">${netConns.length}</div><div class="s-lbl">NETWORK CONNECTIONS</div></div></div>
<h2>Files per Agent</h2><table>${barChartRows || '<tr><td style="padding:8px;color:#37474f">No file activity recorded</td></tr>'}</table>
<h2>Sensitive File Accesses (${sensitiveEvents.length})</h2><table><tr><th>Timestamp</th><th>Agent</th><th>File</th><th>Reason</th></tr>${sensitiveRows || '<tr><td colspan="4" style="padding:8px;color:#37474f">No sensitive file accesses detected</td></tr>'}</table>
<h2>Network Connections (${netConns.length})</h2><table><tr><th>Agent</th><th>Remote IP</th><th>Port</th><th>Domain</th><th>State</th></tr>${netRows || '<tr><td colspan="5" style="padding:8px;color:#37474f">No network connections detected</td></tr>'}</table>
<p class="timestamp">Report generated by AEGIS v0.1.0</p></body></html>`;
  const reportPath = path.join(app.getPath('temp'), `aegis-report-${Date.now()}.html`);
  fs.writeFileSync(reportPath, html);
  shell.openPath(reportPath);
  return { success: true, path: reportPath };
}

module.exports = { init, exportLog, exportCsv, generateReport };
