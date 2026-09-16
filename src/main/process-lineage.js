'use strict';

/** Attach direct monitored-parent evidence from the same fresh map as identity stamping.
 * Cached parent names, presentation groups and working directories never establish a link.
 * @param {object[]} agents Stamped process records.
 * @param {Map|undefined} processMap Fresh process observation, absent on unsupported platforms.
 * @returns {void} @since 0.15.1
 */
function annotateParentRelations(agents, processMap) {
  const byPid = new Map();
  const duplicates = new Set();
  for (const agent of agents) {
    delete agent.parentRelation;
    if (byPid.has(agent.pid)) duplicates.add(agent.pid);
    byPid.set(agent.pid, agent);
  }
  if (!(processMap instanceof Map)) return;
  const eligible = (agent) =>
    agent &&
    !duplicates.has(agent.pid) &&
    agent.pid > 0 &&
    agent.instanceIdSource === 'os' &&
    typeof agent.instanceId === 'string' &&
    agent.instanceId.length > 0 &&
    agent.instanceId.length <= 512 &&
    Number.isFinite(agent.startTime) &&
    agent.startTime > 0 &&
    processMap.get(agent.pid)?.startTime === agent.startTime;
  for (const child of agents) {
    if (!eligible(child)) continue;
    const parent = byPid.get(processMap.get(child.pid)?.ppid);
    if (
      !eligible(parent) ||
      parent.pid === child.pid ||
      parent.instanceId === child.instanceId ||
      parent.startTime >= child.startTime ||
      processMap.get(parent.pid)?.ppid === child.pid
    )
      continue;
    child.parentRelation = {
      parentPid: parent.pid,
      parentInstanceId: parent.instanceId,
      source: 'fresh-process-table',
    };
  }
}

module.exports = { annotateParentRelations };
