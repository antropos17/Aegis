'use strict';

const { execFile } = require('node:child_process');
const { createWindowsObserver, validCreateTime100ns } = require('./platform/windows-observer');
const { ticksToEpochMs } = require('./platform/process-snapshot');
const path = require('node:path');
const observer = createWindowsObserver({ execFile });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Observe only bounded native Claude process metadata through held OS handles.
 * Raw command lines are projected inside the helper, never returned or logged.
 * @param {object[]} agents Current OS-stamped Claude population (at most 32).
 * @returns {Promise<object[]|null>} Fresh metadata, or unavailable. @since v0.21.0 */
async function readClaudeProcesses(agents) {
  if (process.platform !== 'win32' || agents.length < 1 || agents.length > 32) return null;
  const pids = agents.map((agent) => agent.pid);
  return observer.tryRequest('claude-session', { pids }, (rows) => {
    const seen = new Set();
    for (const row of rows) {
      if (
        !row ||
        Object.keys(row).length !== 4 ||
        !pids.includes(row.ProcessId) ||
        seen.has(row.ProcessId) ||
        !validCreateTime100ns(row.CreateTime100ns) ||
        typeof row.Cwd !== 'string' ||
        row.Cwd.length > 4096 ||
        !path.win32.isAbsolute(row.Cwd) ||
        (row.SessionId !== null && !UUID.test(row.SessionId))
      )
        throw Error('invalid-session-observation');
      seen.add(row.ProcessId);
    }
    return rows;
  });
}

/** Match fresh full-resolution birth and launch selector to the observed process.
 * @param {object[]} rows Native observation. @param {object} agent Current process.
 * @returns {object|null} Independently observed row, or null. @since v0.21.0 */
function processWitness(rows, agent) {
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter((row) => row.ProcessId === agent.pid);
  const row = matches.length === 1 ? matches[0] : null;
  return row &&
    validCreateTime100ns(agent.createTime100ns) &&
    row.CreateTime100ns === agent.createTime100ns &&
    ticksToEpochMs(row.CreateTime100ns) === agent.startTime
    ? row
    : null;
}

module.exports = { readClaudeProcesses, processWitness };
