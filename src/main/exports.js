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
const { UNKNOWN_SOURCE_LABEL } = require('./attribution');
const {
  describeObservation,
  groupObservations,
  observationTime,
  endpointLabel,
} = require('../shared/observation-display');
const { version } = require('../../package.json');

let _state = null;

/**
 * Agent name for a HUMAN-facing export cell (CSV, HTML report). An unattributed
 * event carries `agent: ''`; a blank cell in a report the user forwards to
 * someone else reads as a bug rather than as "we did not know".
 * @param {Object} ev - Activity-log event.
 * @returns {string}
 * @since v0.11.0
 */
function displayAgent(ev) {
  const info = describeObservation(ev);
  return (
    info.actor ||
    (info.context
      ? info.context + ' resource (actor not recorded)'
      : info.skill
        ? 'Skill: ' + info.skill.name + ' (actor not recorded)'
        : UNKNOWN_SOURCE_LABEL)
  );
}

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
    defaultPath: path.join(
      app.getPath('downloads'),
      `aegis-log-${new Date().toISOString().slice(0, 10)}.json`,
    ),
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
    // MACHINE-readable: `agent` stays raw ('' when unattributed) and the status
    // is exported alongside it. Substituting a display label here would make a
    // downstream tool group real activity under an agent that does not exist.
    events: _state.activityLog.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      agent: e.agent,
      pid: e.pid,
      file: e.file,
      sensitive: e.sensitive,
      reason: e.reason,
      action: e.action || 'accessed',
      attribution: e.attribution ? e.attribution.status : null,
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
    defaultPath: path.join(
      app.getPath('downloads'),
      `aegis-log-${new Date().toISOString().slice(0, 10)}.csv`,
    ),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  const header = 'Timestamp,Agent Name,Action Type,Target,Sensitive\n';
  const rows = _state.activityLog
    .map((e) => {
      const ts = new Date(e.timestamp).toISOString();
      const action = e.action || 'accessed';
      const sensitive = e.sensitive ? 'yes' : 'no';
      return [ts, displayAgent(e), action, e.file, sensitive].map(csvEscape).join(',');
    })
    .join('\n');
  const netConns = _state.getLatestNetConnections();
  const netRows = netConns
    .map((c) => {
      const ts = new Date().toISOString();
      return [ts, displayAgent(c), 'network', endpointLabel(c), c.flagged ? 'yes' : 'no']
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
  const events = _state.activityLog;
  const netConns = _state.getLatestNetConnections();
  const sources = groupObservations(events, 'agent');
  const fileGroups = groupObservations(events);
  const netGroups = groupObservations(netConns);
  const time = (value) =>
    observationTime(value)
      ? new Date(observationTime(value)).toISOString().replace('T', ' ').slice(0, 19)
      : 'Snapshot';
  const sourceRows = sources
    .map(
      (group) =>
        '<tr><td class="source-label">' +
        escHtml(displayAgent(group.latest)) +
        '</td><td>' +
        new Set(group.rows.map((row) => row.file)).size +
        '</td><td>' +
        group.rows.length +
        '</td></tr>',
    )
    .join('');
  const table = (groups, empty) =>
    '<table><thead><tr><th>Resource</th><th>Agent / context</th><th>Records</th><th>Evidence</th></tr></thead><tbody>' +
    (groups
      .map((group) => {
        const row = group.latest;
        const info = describeObservation(row);
        const evidence = row.remoteIp
          ? row.verdict === 'allowlisted'
            ? 'Allowlisted'
            : row.verdict === 'flagged'
              ? 'Not allowlisted'
              : 'Endpoint unverified'
          : row.sensitive
            ? 'Sensitive'
            : info.attribution;
        const records = group.rows
          .map(
            (item) =>
              '<tr><td>' +
              escHtml(time(item.timestamp)) +
              '</td><td>' +
              escHtml(String(item.pid ?? 'Not recorded')) +
              '</td><td>' +
              escHtml(String(item.action || item.state || 'Observed')) +
              '</td><td><code>' +
              escHtml(String(item.file || item.remoteIp || '')) +
              '</code><small>' +
              escHtml(describeObservation(item).attribution) +
              ' · ' +
              escHtml(String(item.reason || describeObservation(item).source)) +
              '</small></td></tr>',
          )
          .join('');
        return (
          '<tr class="resource-group"><td><strong>' +
          escHtml(info.resource) +
          '</strong><small>' +
          escHtml(info.kind + (info.path && info.path !== info.resource ? ' · ' + info.path : '')) +
          '</small></td><td>' +
          escHtml(displayAgent(row)) +
          '</td><td>' +
          group.rows.length +
          '</td><td><span class="badge">' +
          escHtml(evidence) +
          '</span></td></tr><tr class="group-details"><td colspan="4"><details><summary>' +
          group.rows.length +
          ' recorded observations · latest ' +
          escHtml(time(group.last)) +
          '</summary><table><thead><tr><th>Time</th><th>PID</th><th>Action / state</th><th>Recorded evidence</th></tr></thead><tbody>' +
          records +
          '</tbody></table></details></td></tr>'
        );
      })
      .join('') || '<tr><td colspan="4">' + empty + '</td></tr>') +
    '</tbody></table>';
  const cards = [
    [formatUptimeReport(stats.uptimeMs), 'Monitoring duration'],
    [Array.isArray(stats.uniqueAgents) ? stats.uniqueAgents.length : 0, 'Agents observed'],
    [fileGroups.length, 'File resource groups'],
    [events.filter((row) => row.sensitive).length, 'Sensitive observations'],
    [netGroups.length, 'Endpoint groups'],
  ]
    .map(
      ([value, label]) =>
        '<div class="summary-card"><span>' +
        escHtml(String(label)) +
        '</span><strong>' +
        escHtml(String(value)) +
        '</strong></div>',
    )
    .join('');
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>AEGIS REPORT</title><style>' +
    ':root{color-scheme:light dark;--bg:#f0f0ee;--panel:#fafaf8;--ink:#272925;--muted:#555952;--border:#cdd0c9;--raised:#e7e7e3}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px 24px}header{margin-bottom:24px}h1{margin:0;font-size:28px;font-weight:600}h2{margin:0;padding:16px;font-size:16px;border-bottom:1px solid var(--border)}p,small{color:var(--muted)}small{display:block;font-size:12px;overflow-wrap:anywhere}code{font:12px/1.5 Consolas,monospace;overflow-wrap:anywhere}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}.summary-card,.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px}.summary-card{padding:16px}.summary-card span{display:block;color:var(--muted);font-size:12px}.summary-card strong{display:block;font-size:25px;margin-top:8px}.panel{margin-top:20px;overflow:hidden}table{width:100%;border-collapse:collapse}td,th{padding:12px 16px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border);overflow-wrap:anywhere}th{font-size:12px;font-weight:600;color:var(--muted)}.source-label{font-weight:600}.badge{display:inline-block;padding:3px 7px;border:1px solid var(--border);border-radius:6px;font-size:12px}.group-details td{padding-top:0}.group-details table{margin-top:12px}summary{cursor:pointer;color:var(--muted);font-size:12px;padding:8px 0}details[open]{padding-bottom:8px}footer{margin-top:24px;color:var(--muted);font-size:12px}@media(prefers-color-scheme:dark){:root{--bg:#171819;--panel:#202224;--ink:#ececea;--muted:#bcbdbb;--border:#36393c;--raised:#2b2d30}}@media print{:root{color-scheme:light;--bg:white;--panel:white;--ink:#272925;--muted:#555952;--border:#cdd0c9}main{padding:0}.panel{break-inside:avoid}details{display:none}}' +
    '</style></head><body><main><header><small>AEGIS · Observatory</small><h1>Session report</h1><p>Generated ' +
    escHtml(new Date().toISOString()) +
    ' · repeated observations are grouped; expand a group for recorded evidence.</p></header><div class="summary">' +
    cards +
    '</div><section class="panel"><h2>Agents and resource contexts</h2><table><thead><tr><th>Agent / context</th><th>Distinct files</th><th>Observations</th></tr></thead><tbody>' +
    (sourceRows || '<tr><td colspan="3">No file activity recorded</td></tr>') +
    '</tbody></table></section><section class="panel"><h2>File activity</h2>' +
    table(fileGroups, 'No file activity recorded') +
    '</section><section class="panel"><h2>Network connections</h2>' +
    table(netGroups, 'No network connections recorded') +
    '</section><footer>AEGIS v' +
    escHtml(version) +
    ' · resource context identifies a directory or skill; actor attribution is recorded separately. File contents and API keys are not included.</footer></main></body></html>';
  const reportPath = path.join(app.getPath('temp'), 'aegis-report-' + Date.now() + '.html');
  fs.writeFileSync(reportPath, html);
  const error = await shell.openPath(reportPath);
  return error ? { success: false, error, path: reportPath } : { success: true, path: reportPath };
}

module.exports = { init, exportLog, exportCsv, generateReport };
